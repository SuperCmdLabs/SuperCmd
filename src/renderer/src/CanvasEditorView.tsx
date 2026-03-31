/**
 * Canvas Editor View
 *
 * Renders the Excalidraw canvas editor in the detached canvas window.
 * - Lazy-loads Excalidraw from canvas-lib/ via sc-asset://canvas-lib/ protocol
 * - Auto-saves scene data with size-adaptive debounce
 * - Shows save status in footer
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, createElement } from 'react';
import ReactDOM from 'react-dom';
import { Image, Save, FilePlus, RotateCcw, Download, Copy, Sun, Moon } from 'lucide-react';
import IconCodeEditor from './icons/Snippet';

const canvasIconStyle = {
  '--nc-gradient-1-color-1': '#fcd34d',
  '--nc-gradient-1-color-2': '#d97706',
  '--nc-gradient-2-color-1': '#fef3c7b8',
  '--nc-gradient-2-color-2': '#fcd34d90',
} as React.CSSProperties;
import ExtensionActionFooter from './components/ExtensionActionFooter';

// Excalidraw's UMD bundle expects React/ReactDOM as window globals
(window as any).React = React;
(window as any).ReactDOM = ReactDOM;

// Targeted Tailwind preflight overrides for Excalidraw
const excalidrawOverrideCSS = `
.excalidraw-container .excalidraw button,
.excalidraw-container .excalidraw [role="button"] {
  overflow: hidden;
}
.excalidraw-container .excalidraw .color-picker-content button,
.excalidraw-container .excalidraw .color-picker__button {
  font-size: 0 !important;
  overflow: hidden !important;
}
.excalidraw-container .excalidraw svg {
  display: inline !important;
  vertical-align: middle;
}
`;

if (!document.getElementById('excalidraw-tailwind-fix')) {
  const style = document.createElement('style');
  style.id = 'excalidraw-tailwind-fix';
  style.textContent = excalidrawOverrideCSS;
  document.head.appendChild(style);
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

async function generateCanvasTitle(): Promise<string> {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = MONTHS[now.getMonth()];
  const year = String(now.getFullYear()).slice(-2);
  const base = `${day} ${month} ${year}`;
  const re = new RegExp(`^${base}( \\d+)?$`);
  const existing: any[] = await window.electron.canvasGetAll();
  const count = existing.filter((c) => re.test(c.title)).length;
  return count === 0 ? base : `${base} ${count + 1}`;
}

interface CanvasEditorViewProps {
  mode: 'create' | 'edit';
  canvasId: string | null;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const CanvasEditorView: React.FC<CanvasEditorViewProps> = ({ mode, canvasId }) => {
  const [title, setTitle] = useState('Untitled Canvas');
  const [currentCanvasId, setCurrentCanvasId] = useState<string | null>(canvasId);
  const [isExcalidrawLoaded, setIsExcalidrawLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [installStatus, setInstallStatus] = useState<{ status: string; progress?: number; error?: string } | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [ExcalidrawComponent, setExcalidrawComponent] = useState<any>(null);
  const [showActions, setShowActions] = useState(false);
  const [excalidrawKey, setExcalidrawKey] = useState(0);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  const isGlassyTheme = document.documentElement.classList.contains('sc-glassy') || document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass = document.documentElement.classList.contains('sc-native-liquid-glass') || document.body.classList.contains('sc-native-liquid-glass');

  const initialSceneRef = useRef<any>(null);
  const savedLibraryRef = useRef<any[]>([]);
  const excalidrawApiRef = useRef<any>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if canvas lib is installed
  useEffect(() => {
    window.electron.canvasCheckInstalled().then(setIsInstalled);
  }, []);

  // Load persisted library items once on mount
  useEffect(() => {
    window.electron.loadCanvasLibrary?.().then((items: any[]) => {
      if (items?.length) savedLibraryRef.current = items;
    });
  }, []);

  // Listen for install status updates
  useEffect(() => {
    const cleanup = window.electron.onCanvasInstallStatus((payload: any) => {
      setInstallStatus(payload);
      if (payload.status === 'done') {
        setIsInstalled(true);
        setInstallStatus(null);
      }
    });
    return cleanup;
  }, []);

  // Create or load canvas + scene data — runs when props change (including canvas switching)
  useEffect(() => {
    const init = async () => {
      // Use the prop directly, not the stale state
      let id = canvasId;

      if (mode === 'edit' && id) {
        // Load existing canvas
        const canvases = await window.electron.canvasGetAll();
        const canvas = canvases.find((c: any) => c.id === id);
        if (canvas) setTitle(canvas.title);
      } else {
        // Create new canvas with date-based title
        const title = await generateCanvasTitle();
        const canvas = await window.electron.canvasCreate({ title });
        id = canvas.id;
        setTitle(canvas.title);
      }

      // Sync state
      setCurrentCanvasId(id);

      // Load scene data BEFORE mounting Excalidraw
      initialSceneRef.current = null;
      if (id) {
        const scene = await window.electron.canvasGetScene(id);
        if (scene && scene.elements && scene.elements.length > 0) {
          initialSceneRef.current = scene;
          // Restore the theme the canvas was last saved in so element colours
          // (which are stored absolutely, not theme-relative) stay correct.
          // e.g. text created in light mode has dark stroke — opening in dark
          // mode would make it invisible against the dark background.
          const savedTheme = scene.appState?.theme as 'dark' | 'light' | undefined;
          if (savedTheme === 'dark' || savedTheme === 'light') {
            setTheme(savedTheme);
          }
        }
      }

      // Force Excalidraw re-mount with new data by changing key
      setExcalidrawKey((k) => k + 1);
      setSceneReady(true);
    };
    init();
  }, [mode, canvasId]);

  // Load Excalidraw bundle when installed AND scene is ready
  useEffect(() => {
    if (!isInstalled || !sceneReady || isExcalidrawLoaded || loadError) return;

    const existingBundle = (window as any).ExcalidrawBundle;
    if (existingBundle?.Excalidraw) {
      setExcalidrawComponent(() => existingBundle.Excalidraw);
      setIsExcalidrawLoaded(true);
      return;
    }

    const loadExcalidraw = async () => {
      try {
        if (!document.getElementById('excalidraw-css')) {
          try {
            const cssRes = await fetch('sc-asset://canvas-lib/excalidraw-bundle.css');
            if (cssRes.ok) {
              const cssText = await cssRes.text();
              const style = document.createElement('style');
              style.id = 'excalidraw-css';
              style.textContent = cssText;
              document.head.appendChild(style);
            }
          } catch {}
        }

        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'sc-asset://canvas-lib/excalidraw-bundle.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Excalidraw bundle'));
          document.head.appendChild(script);
        });

        const bundle = (window as any).ExcalidrawBundle;
        if (!bundle || !bundle.Excalidraw) {
          throw new Error('Excalidraw bundle loaded but component not found');
        }

        setExcalidrawComponent(() => bundle.Excalidraw);
        setIsExcalidrawLoaded(true);
      } catch (e: any) {
        console.error('[Canvas] Failed to load Excalidraw:', e);
        setLoadError(e.message || 'Failed to load canvas editor');
      }
    };

    loadExcalidraw();
  }, [isInstalled, sceneReady, isExcalidrawLoaded, loadError]);

  const saveThumbnailAsync = useCallback(async (elements: any[], appState: any, files: any) => {
    if (!currentCanvasId) return;
    try {
      const bundle = (window as any).ExcalidrawBundle;
      if (!bundle?.exportToSvg) return;
      const nonDeletedElements = elements.filter((el: any) => !el.isDeleted);
      if (!nonDeletedElements.length) return;
      const svg: SVGSVGElement = await bundle.exportToSvg({
        elements: nonDeletedElements,
        appState: { ...appState, exportWithDarkMode: true, exportBackground: true },
        files,
      });
      await window.electron.canvasSaveThumbnail(currentCanvasId, svg.outerHTML);
    } catch { /* thumbnail failure is non-critical */ }
  }, [currentCanvasId]);

  const handleSaveNow = useCallback(async () => {
    if (!currentCanvasId || !excalidrawApiRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    try {
      const elements = excalidrawApiRef.current.getSceneElements();
      const { collaborators, ...savableAppState } = excalidrawApiRef.current.getAppState();
      const files = excalidrawApiRef.current.getFiles();
      await window.electron.canvasSaveScene(currentCanvasId, { elements, appState: savableAppState, files });
      void saveThumbnailAsync(elements, savableAppState, files);
      setSaveStatus('saved');
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 5_000);
    } catch {
      setSaveStatus('error');
    }
  }, [currentCanvasId, saveThumbnailAsync]);

  // Auto-save with size-adaptive debounce
  const handleSceneChange = useCallback((elements: any[], appState: any, files: any) => {
    if (!currentCanvasId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const estimatedSize = JSON.stringify({ elements, files }).length;
    const debounceMs = estimatedSize > 5_000_000 ? 30_000 : 10_000;

    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        const { collaborators, ...savableAppState } = appState;
        await window.electron.canvasSaveScene(currentCanvasId!, { elements, appState: savableAppState, files });
        void saveThumbnailAsync(elements, savableAppState, files);
        setSaveStatus('saved');
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1_500);
      } catch {
        setSaveStatus('error');
      }
    }, debounceMs);
  }, [currentCanvasId, saveThumbnailAsync]);

  // Export as PNG image
  const handleExportImage = useCallback(async () => {
    if (!excalidrawApiRef.current) return;
    try {
      const bundle = (window as any).ExcalidrawBundle;
      if (!bundle?.exportToBlob) return;
      const elements = excalidrawApiRef.current.getSceneElements();
      const appState = excalidrawApiRef.current.getAppState();
      const files = excalidrawApiRef.current.getFiles();
      const blob = await bundle.exportToBlob({
        elements,
        appState: { ...appState, exportWithDarkMode: theme === 'dark' },
        files,
        mimeType: 'image/png',
      });
      // Convert blob to buffer and save via clipboard or file dialog
      const buffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      // Write to temp file and let user save
      const dataUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${title.replace(/[/\\?%*:|"<>]/g, '-')}.png`;
      a.click();
      URL.revokeObjectURL(dataUrl);
    } catch (e) {
      console.error('[Canvas] Export image failed:', e);
    }
  }, [title, theme]);

  // New canvas (save current + open new)
  const handleNewCanvas = useCallback(async () => {
    await handleSaveNow();
    const title = await generateCanvasTitle();
    const canvas = await window.electron.canvasCreate({ title });
    setCurrentCanvasId(canvas.id);
    setTitle(canvas.title);
    initialSceneRef.current = null;
    if (excalidrawApiRef.current) {
      excalidrawApiRef.current.resetScene();
    }
  }, [handleSaveNow]);

  // Reset canvas
  const handleReset = useCallback(() => {
    if (excalidrawApiRef.current) {
      excalidrawApiRef.current.resetScene();
    }
  }, []);

  // Export JSON
  const handleExportJSON = useCallback(async () => {
    if (!currentCanvasId) return;
    await window.electron.canvasExport(currentCanvasId, 'json');
  }, [currentCanvasId]);

  const handleToggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('canvas-theme', newTheme);
    if (excalidrawApiRef.current) {
      excalidrawApiRef.current.updateScene({ appState: { theme: newTheme } });
    }
  }, [theme]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (currentCanvasId) {
      window.electron.canvasUpdate(currentCanvasId, { title: newTitle });
    }
  }, [currentCanvasId]);

  const handleInstall = useCallback(async () => {
    setInstallStatus({ status: 'downloading', progress: 0 });
    try {
      await window.electron.canvasInstall();
    } catch (e: any) {
      setInstallStatus({ status: 'error', error: e.message || 'Installation failed' });
    }
  }, []);

  // Copy canvas as image to clipboard
  const handleCopyAsImage = useCallback(async () => {
    if (!excalidrawApiRef.current) return;
    try {
      const bundle = (window as any).ExcalidrawBundle;
      if (!bundle?.exportToBlob) return;
      const elements = excalidrawApiRef.current.getSceneElements();
      const { collaborators, ...appState } = excalidrawApiRef.current.getAppState();
      const files = excalidrawApiRef.current.getFiles();
      const blob = await bundle.exportToBlob({
        elements, appState: { ...appState, exportWithDarkMode: theme === 'dark' }, files, mimeType: 'image/png',
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setSaveStatus('saved');
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1_500);
    } catch (e) {
      console.error('[Canvas] Copy as image failed:', e);
    }
  }, [theme]);

  const actions = useMemo(() => [
    { title: 'Export Image', icon: <Image className="w-4 h-4" />, shortcut: ['⇧', '⌘', 'E'], execute: handleExportImage },
    { title: 'Copy as Image', icon: <Copy className="w-4 h-4" />, shortcut: ['⇧', '⌘', 'C'], execute: handleCopyAsImage },
    { title: 'Save to Disk', icon: <Download className="w-4 h-4" />, shortcut: [] as string[], execute: handleExportJSON },
    { title: 'New Canvas', icon: <FilePlus className="w-4 h-4" />, shortcut: ['⌘', 'N'], execute: handleNewCanvas },
    { title: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode', icon: theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />, shortcut: [] as string[], execute: handleToggleTheme },
    { title: 'Reset Canvas', icon: <RotateCcw className="w-4 h-4" />, shortcut: [] as string[], execute: handleReset },
  ], [theme, handleExportImage, handleCopyAsImage, handleExportJSON, handleNewCanvas, handleToggleTheme, handleReset]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // When actions menu is open: navigate and execute
      if (showActions) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          setSelectedActionIndex((i) => Math.min(i + 1, actions.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          setSelectedActionIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          actions[selectedActionIndex]?.execute();
          setShowActions(false);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setShowActions(false);
          return;
        }
        if (e.key === 'k' && e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          setShowActions(false);
          return;
        }
        return;
      }

      if (e.key === 's' && e.metaKey) {
        e.preventDefault();
        handleSaveNow();
        return;
      }
      if (e.key === 'e' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        handleExportImage();
        return;
      }
      if (e.key === 'c' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        handleCopyAsImage();
        return;
      }
      if (e.key === 'n' && e.metaKey) {
        e.preventDefault();
        handleNewCanvas();
        return;
      }
      if (e.key === 'k' && e.metaKey) {
        e.preventDefault();
        setShowActions((v) => !v);
        setSelectedActionIndex(0);
        return;
      }
    };
    // Use capture phase so we intercept before Excalidraw's own handlers
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showActions, selectedActionIndex, actions, handleSaveNow, handleExportImage, handleCopyAsImage, handleNewCanvas]);

  // Load library items sent from main process (via "Add to Excalidraw" in library browser)
  useEffect(() => {
    const cleanup = window.electron.onCanvasAddLibrary?.((payload) => {
      const items = payload?.libraryItems;
      if (!items?.length || !excalidrawApiRef.current) return;
      const api = excalidrawApiRef.current;
      if (typeof api.updateLibrary === 'function') {
        api.updateLibrary({ libraryItems: items, merge: true, openLibraryMenu: true });
      } else {
        api.updateScene({ libraryItems: items });
      }
    });
    return cleanup;
  }, []);

  // After each canvas mount, scroll to fit all elements so they're always visible.
  // The saved scrollX/scrollY can be misaligned if the window size changed between
  // sessions, leaving elements off-screen and impossible to click on.
  useEffect(() => {
    if (!sceneReady || !initialSceneRef.current?.elements?.length) return;
    const timer = setTimeout(() => {
      const api = excalidrawApiRef.current;
      if (!api) return;
      const elements = api.getSceneElements?.();
      if (elements?.length) {
        api.scrollToContent?.(elements, { fitToContent: true, animate: false });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [excalidrawKey, sceneReady]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  // Auto-save before the canvas window closes
  useEffect(() => {
    const cleanup = window.electron.onCanvasSaveBeforeClose(() => {
      handleSaveNow().finally(() => {
        window.electron.canvasSaveComplete();
      });
    });
    return cleanup;
  }, [handleSaveNow]);

  // Install screen
  if (isInstalled === false) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="mb-4 flex justify-center"><IconCodeEditor size="48px" style={canvasIconStyle} /></div>
          <h2 className="text-lg font-semibold mb-2">Install & Setup Canvas</h2>
          <p className="text-[13px] text-white/50 mb-6 leading-relaxed">
            Canvas uses Excalidraw for drawing. This requires a one-time
            download (~5 MB). Your canvases are stored locally.
          </p>
          {installStatus?.status === 'error' ? (
            <>
              <p className="text-[12px] text-red-400 mb-4">{installStatus.error || 'Download failed'}</p>
              <button onClick={handleInstall} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg border border-[var(--snippet-divider-strong)] bg-white/[0.14] text-[14px] font-medium text-[var(--text-primary)] hover:bg-white/[0.2] transition-colors">
                Retry Download
              </button>
            </>
          ) : installStatus?.status === 'downloading' || installStatus?.status === 'extracting' ? (
            <>
              <div className="w-64 mx-auto h-1.5 bg-white/10 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${installStatus.progress || 0}%` }} />
              </div>
              <p className="text-[12px] text-white/40">
                {installStatus.status === 'downloading' ? 'Downloading Excalidraw...' : 'Setting up...'}
              </p>
            </>
          ) : (
            <button onClick={handleInstall} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg border border-[var(--snippet-divider-strong)] bg-white/[0.14] text-[14px] font-medium text-[var(--text-primary)] hover:bg-white/[0.2] transition-colors">
              Download & Install
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isInstalled === null || !sceneReady) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[13px] text-white/20 animate-pulse">Loading...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-[14px] font-medium text-white/70 mb-1">Failed to load canvas</p>
          <p className="text-[12px] text-white/40 mb-4">{loadError}</p>
          <button onClick={() => { setLoadError(null); setIsExcalidrawLoaded(false); }} className="px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-indigo-500/20">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const renderSaveStatus = () => {
    const dotClass = saveStatus === 'saving'
      ? 'bg-[#5a8bff]'
      : saveStatus === 'saved'
        ? 'bg-[var(--status-success)]'
        : saveStatus === 'error'
          ? 'bg-[var(--status-danger)]'
          : 'bg-white/20';
    const dotShadow = saveStatus === 'saving'
      ? '0 0 0 4px rgba(90, 139, 255, 0.18), 0 0 14px rgba(90, 139, 255, 0.22)'
      : saveStatus === 'saved'
        ? '0 0 0 4px rgba(47, 154, 100, 0.18)'
        : saveStatus === 'error'
          ? '0 0 0 4px rgba(217, 75, 75, 0.16)'
          : 'none';
    const label = saveStatus === 'saving' ? 'Saving'
      : saveStatus === 'saved' ? 'Saved'
        : saveStatus === 'error' ? 'Save failed'
          : 'Auto-save on';

    return (
      <span className="inline-flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} style={{ boxShadow: dotShadow }} />
        <span className="text-[var(--text-secondary)] text-[0.8125rem] font-medium">{label}</span>
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col" style={{ borderRadius: 14, overflow: 'hidden', border: '1.5px solid rgba(0,0,0,0.22)', boxSizing: 'border-box' }}>
      {/* Title bar — tall enough for traffic lights (y:16 + 12px button = 28px min) */}
      <div className="h-[38px] flex items-center justify-center" style={{ WebkitAppRegion: 'drag' } as any}>
        <input
          value={title}
          onChange={handleTitleChange}
          className="max-w-[260px] appearance-none bg-transparent p-0 text-center text-[12px] leading-[38px] text-white/50 font-medium outline-none"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          placeholder="Canvas title..."
        />
      </div>

      {/* Canvas content area */}
      <div className="flex-1 relative overflow-hidden excalidraw-container">
        {!isExcalidrawLoaded ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-[13px] text-white/20 animate-pulse">Loading canvas...</div>
          </div>
        ) : ExcalidrawComponent ? (
          createElement(ExcalidrawComponent, {
            key: excalidrawKey,
            excalidrawAPI: (api: any) => { excalidrawApiRef.current = api; },
            theme,
            initialData: {
              ...(initialSceneRef.current ? {
                elements: initialSceneRef.current.elements,
                appState: {
                  ...initialSceneRef.current.appState,
                  theme,
                  collaborators: new Map(),
                },
                files: initialSceneRef.current.files,
              } : { appState: { theme } }),
              libraryItems: savedLibraryRef.current,
            },
            onLibraryChange: (items: any[]) => {
              savedLibraryRef.current = items;
              window.electron.saveCanvasLibrary?.(items);
            },
            onChange: (elements: any[], appState: any, files: any) => {
              handleSceneChange(elements, appState, files);
            },
            UIOptions: {
              canvasActions: {
                saveToActiveFile: false,
                loadScene: false,
                export: false,
                saveAsImage: false,
              },
            },
          })
        ) : null}
      </div>

      {/* Actions overlay — matches Snippets pattern */}
      {showActions && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setShowActions(false)}
          style={{ background: 'var(--bg-scrim)' }}
        >
          <div
            className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl"
            style={
              isNativeLiquidGlass
                ? {
                    background: 'rgba(var(--surface-base-rgb), 0.72)',
                    backdropFilter: 'blur(44px) saturate(155%)',
                    WebkitBackdropFilter: 'blur(44px) saturate(155%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
                    boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
                  }
                : isGlassyTheme
                ? {
                    background: 'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                    backdropFilter: 'blur(96px) saturate(190%)',
                    WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.05)',
                  }
                : {
                    background: 'var(--card-bg)',
                    backdropFilter: 'blur(40px)',
                    WebkitBackdropFilter: 'blur(40px)',
                    border: '1px solid var(--border-primary)',
                  }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto py-1">
              {actions.map((action, idx) => (
                <div
                  key={idx}
                  className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors hover:bg-[var(--overlay-item-hover-bg)] text-[var(--text-secondary)] ${
                    idx === selectedActionIndex ? 'bg-[var(--action-menu-selected-bg)]' : ''
                  }`}
                  style={
                    idx === selectedActionIndex
                      ? {
                          background: 'var(--action-menu-selected-bg)',
                          borderColor: 'var(--action-menu-selected-border)',
                          boxShadow: 'var(--action-menu-selected-shadow)',
                        }
                      : undefined
                  }
                  onMouseMove={() => setSelectedActionIndex(idx)}
                  onClick={() => { action.execute(); setShowActions(false); }}
                >
                  {action.icon && (
                    <span className="text-[var(--text-muted)]">{action.icon}</span>
                  )}
                  <span className="flex-1 text-sm truncate">{action.title}</span>
                  {action.shortcut.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      {action.shortcut.map((k, keyIdx) => (
                        <kbd
                          key={`${idx}-${keyIdx}`}
                          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] font-medium text-[var(--text-muted)]"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer — uses ExtensionActionFooter for consistent styling */}
      <ExtensionActionFooter
        leftContent={<span className="truncate">{renderSaveStatus()}</span>}
        primaryAction={{
          label: 'Save',
          onClick: handleSaveNow,
          shortcut: ['⌘', 'S'],
        }}
        actionsButton={{
          label: 'Actions',
          onClick: () => setShowActions((v) => !v),
          shortcut: ['⌘', 'K'],
        }}
      />
    </div>
  );
};

export default CanvasEditorView;
