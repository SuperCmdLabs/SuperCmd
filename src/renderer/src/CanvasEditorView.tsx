/**
 * Canvas Editor View
 *
 * Renders the Excalidraw canvas editor in the detached canvas window.
 * - Lazy-loads Excalidraw from canvas-lib/ via sc-asset://canvas-lib/ protocol
 * - Auto-saves scene data with size-adaptive debounce
 * - Shows save status in footer
 */

import React, { useState, useEffect, useRef, useCallback, createElement } from 'react';
import ReactDOM from 'react-dom';
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
  // Track a "key" to force Excalidraw re-mount when switching canvases
  const [excalidrawKey, setExcalidrawKey] = useState(0);

  const initialSceneRef = useRef<any>(null);
  const excalidrawApiRef = useRef<any>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if canvas lib is installed
  useEffect(() => {
    window.electron.canvasCheckInstalled().then(setIsInstalled);
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
        // Create new canvas
        const canvas = await window.electron.canvasCreate({ title: 'Untitled Canvas' });
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
        setSaveStatus('saved');
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 30_000);
      } catch {
        setSaveStatus('error');
      }
    }, debounceMs);
  }, [currentCanvasId]);

  // Manual save (Cmd+Enter)
  const handleSaveNow = useCallback(async () => {
    if (!currentCanvasId || !excalidrawApiRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    try {
      const elements = excalidrawApiRef.current.getSceneElements();
      const { collaborators, ...savableAppState } = excalidrawApiRef.current.getAppState();
      const files = excalidrawApiRef.current.getFiles();
      await window.electron.canvasSaveScene(currentCanvasId, { elements, appState: savableAppState, files });
      setSaveStatus('saved');
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 5_000);
    } catch {
      setSaveStatus('error');
    }
  }, [currentCanvasId]);

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
        appState: { ...appState, exportWithDarkMode: true },
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
  }, [title]);

  // New canvas (save current + open new)
  const handleNewCanvas = useCallback(async () => {
    await handleSaveNow();
    const canvas = await window.electron.canvasCreate({ title: 'Untitled Canvas' });
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault();
        handleSaveNow();
        return;
      }
      if (e.key === 'e' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        handleExportImage();
        return;
      }
      if (e.key === 'k' && e.metaKey) {
        e.preventDefault();
        setShowActions((v) => !v);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSaveNow, handleExportImage]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  // Install screen
  if (isInstalled === false) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🎨</div>
          <h2 className="text-lg font-semibold mb-2">Install & Setup Canvas</h2>
          <p className="text-[13px] text-white/50 mb-6 leading-relaxed">
            Canvas uses Excalidraw for drawing. This requires a one-time
            download (~5 MB). Your canvases are stored locally.
          </p>
          {installStatus?.status === 'error' ? (
            <>
              <p className="text-[12px] text-red-400 mb-4">{installStatus.error || 'Download failed'}</p>
              <button onClick={handleInstall} className="px-5 py-2.5 rounded-lg text-[14px] font-medium text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
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
            <button onClick={handleInstall} className="px-5 py-2.5 rounded-lg text-[14px] font-medium text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
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
    switch (saveStatus) {
      case 'saving': return <span className="text-white/40">Saving...</span>;
      case 'saved': return <span className="text-green-400/60">✓ Saved</span>;
      case 'error': return <span className="text-red-400/60">Save failed</span>;
      default: return <span className="text-white/30">Auto-save on</span>;
    }
  };

  const actionItems = [
    { label: 'Export Image', shortcut: '⌘⇧E', action: handleExportImage },
    { label: 'Save to Disk', shortcut: '', action: handleExportJSON },
    { label: 'New Canvas', shortcut: '⌘N', action: handleNewCanvas },
    { label: 'Reset Canvas', shortcut: '', action: handleReset },
  ];

  return (
    <div className="flex-1 flex flex-col">
      {/* Compact title bar */}
      <div className="h-8 flex items-center pl-[78px] pr-4" style={{ WebkitAppRegion: 'drag' } as any}>
        <input
          value={title}
          onChange={handleTitleChange}
          className="h-full w-full appearance-none bg-transparent p-0 text-center text-[12px] leading-8 text-white/60 font-medium outline-none"
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
            theme: 'dark',
            initialData: initialSceneRef.current ? {
              elements: initialSceneRef.current.elements,
              appState: {
                ...initialSceneRef.current.appState,
                theme: 'dark',
                collaborators: new Map(),
              },
              files: initialSceneRef.current.files,
            } : undefined,
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

      {/* Actions overlay */}
      {showActions && (
        <div
          className="absolute bottom-10 right-3 w-56 rounded-xl shadow-xl z-50 overflow-hidden"
          style={{ background: 'var(--card-bg)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' }}
        >
          <div className="p-1.5">
            {actionItems.map((item, i) => (
              <button
                key={i}
                onClick={() => { item.action(); setShowActions(false); }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[12px] text-white/70 hover:bg-white/5 transition-colors"
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="text-[10px] text-white/30">{item.shortcut}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer — uses ExtensionActionFooter for consistent styling */}
      <ExtensionActionFooter
        leftContent={<span className="truncate">{renderSaveStatus()}</span>}
        primaryAction={{
          label: 'Save',
          onClick: handleSaveNow,
          shortcut: ['⌘', '↩'],
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
