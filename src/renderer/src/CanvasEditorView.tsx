/**
 * Canvas Editor View
 *
 * Renders the Excalidraw canvas editor in the detached canvas window.
 * - Lazy-loads Excalidraw from canvas-lib/ via sc-asset://canvas-lib/ protocol
 * - Auto-saves scene data with size-adaptive debounce
 * - Shows save status in footer
 * - Shows skeleton loading state while Excalidraw loads
 */

import React, { useState, useEffect, useRef, useCallback, createElement } from 'react';
import ReactDOM from 'react-dom';

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

// Inject the override CSS once
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
  const [initialScene, setInitialScene] = useState<any>(null);
  const [ExcalidrawComponent, setExcalidrawComponent] = useState<any>(null);

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

  // Create or load canvas on mount
  useEffect(() => {
    if (mode === 'create' && !currentCanvasId) {
      window.electron.canvasCreate({ title: 'Untitled Canvas' }).then((canvas: any) => {
        setCurrentCanvasId(canvas.id);
        setTitle(canvas.title);
      });
    } else if (currentCanvasId) {
      window.electron.canvasGetAll().then((canvases: any[]) => {
        const canvas = canvases.find((c: any) => c.id === currentCanvasId);
        if (canvas) setTitle(canvas.title);
      });
    }
  }, [mode, currentCanvasId]);

  // Load scene data when canvas ID is available
  useEffect(() => {
    if (!currentCanvasId) return;
    window.electron.canvasGetScene(currentCanvasId).then((scene: any) => {
      if (scene && scene.elements && scene.elements.length > 0) {
        setInitialScene(scene);
      }
    });
  }, [currentCanvasId]);

  // Load Excalidraw bundle when installed
  useEffect(() => {
    if (!isInstalled || isExcalidrawLoaded || loadError) return;

    // Skip if already loaded from a previous mount
    const existingBundle = (window as any).ExcalidrawBundle;
    if (existingBundle?.Excalidraw) {
      setExcalidrawComponent(() => existingBundle.Excalidraw);
      setIsExcalidrawLoaded(true);
      return;
    }

    const loadExcalidraw = async () => {
      try {
        // Load CSS by fetching content and injecting as <style> at END of <head>
        // This ensures Excalidraw styles override Tailwind's preflight
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
          } catch (e) {
            console.warn('[Canvas] Could not load Excalidraw CSS:', e);
          }
        }

        // Load JS bundle
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'sc-asset://canvas-lib/excalidraw-bundle.js';
          script.onload = () => {
            console.log('[Canvas] Excalidraw bundle loaded');
            resolve();
          };
          script.onerror = (e) => {
            console.error('[Canvas] Script load error:', e);
            reject(new Error('Failed to load Excalidraw bundle'));
          };
          document.head.appendChild(script);
        });

        // Check that the bundle exposed the global
        const bundle = (window as any).ExcalidrawBundle;
        console.log('[Canvas] window.ExcalidrawBundle:', bundle);
        console.log('[Canvas] window.ExcalidrawBundle keys:', bundle ? Object.keys(bundle) : 'null');
        console.log('[Canvas] window.React:', !!(window as any).React);
        console.log('[Canvas] window.ReactDOM:', !!(window as any).ReactDOM);
        if (!bundle || !bundle.Excalidraw) {
          throw new Error('Excalidraw bundle loaded but component not found');
        }

        console.log('[Canvas] Excalidraw component ready');
        setExcalidrawComponent(() => bundle.Excalidraw);
        setIsExcalidrawLoaded(true);
      } catch (e: any) {
        console.error('[Canvas] Failed to load Excalidraw:', e);
        setLoadError(e.message || 'Failed to load canvas editor');
      }
    };

    loadExcalidraw();
  }, [isInstalled, isExcalidrawLoaded, loadError]);

  // Auto-save with size-adaptive debounce
  const handleSceneChange = useCallback((elements: any[], appState: any, files: any) => {
    if (!currentCanvasId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const estimatedSize = JSON.stringify({ elements, files }).length;
    const debounceMs = estimatedSize > 5_000_000 ? 30_000 : 10_000;

    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await window.electron.canvasSaveScene(currentCanvasId!, { elements, appState, files });
        setSaveStatus('saved');
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 30_000);
      } catch {
        setSaveStatus('error');
      }
    }, debounceMs);
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

  const handleExport = useCallback(async () => {
    if (!currentCanvasId) return;
    await window.electron.canvasExport(currentCanvasId, 'json');
  }, [currentCanvasId]);

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
              <button
                onClick={handleInstall}
                className="px-5 py-2.5 rounded-lg text-[14px] font-medium text-white"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                Retry Download
              </button>
            </>
          ) : installStatus?.status === 'downloading' || installStatus?.status === 'extracting' ? (
            <>
              <div className="w-64 mx-auto h-1.5 bg-white/10 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${installStatus.progress || 0}%` }}
                />
              </div>
              <p className="text-[12px] text-white/40">
                {installStatus.status === 'downloading' ? 'Downloading Excalidraw...' : 'Setting up...'}
              </p>
            </>
          ) : (
            <button
              onClick={handleInstall}
              className="px-5 py-2.5 rounded-lg text-[14px] font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              Download & Install
            </button>
          )}
        </div>
      </div>
    );
  }

  // Loading check state
  if (isInstalled === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[13px] text-white/40">Loading...</div>
      </div>
    );
  }

  // Load error
  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-[14px] font-medium text-white/70 mb-1">Failed to load canvas</p>
          <p className="text-[12px] text-white/40 mb-4">{loadError}</p>
          <button
            onClick={() => { setLoadError(null); setIsExcalidrawLoaded(false); }}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-indigo-500/20 border border-indigo-500/30"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Save status text
  const renderSaveStatus = () => {
    switch (saveStatus) {
      case 'saving': return <span className="text-white/40">Saving...</span>;
      case 'saved': return <span className="text-green-400/60">✓ Saved</span>;
      case 'error': return <span className="text-red-400/60">Save failed — retrying</span>;
      default: return <span className="text-white/30">Auto-save on</span>;
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Title bar area (below traffic lights) */}
      <div className="h-12 flex items-center px-20" style={{ WebkitAppRegion: 'drag' } as any}>
        <input
          value={title}
          onChange={handleTitleChange}
          className="bg-transparent text-[13px] text-white/80 font-medium text-center w-full outline-none"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          placeholder="Canvas title..."
        />
      </div>

      {/* Canvas content area */}
      <div className="flex-1 relative overflow-hidden excalidraw-container">
        {!isExcalidrawLoaded ? (
          /* Skeleton loading state */
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-[13px] text-white/20 animate-pulse">Loading canvas...</div>
          </div>
        ) : ExcalidrawComponent ? (
          /* Excalidraw mounted */
          createElement(ExcalidrawComponent, {
            theme: 'dark',
            initialData: initialScene ? {
              elements: initialScene.elements,
              appState: { ...initialScene.appState, theme: 'dark' },
              files: initialScene.files,
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

      {/* Footer */}
      <div className="h-10 flex items-center justify-between px-4 text-[11px]">
        <div>{renderSaveStatus()}</div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-2 py-1 rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
          >
            Export <kbd className="ml-1 px-1 py-0.5 text-[9px] bg-white/10 rounded border border-white/10">⌘E</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CanvasEditorView;
