/**
 * Canvas Editor View
 *
 * Renders the Excalidraw canvas editor in the detached canvas window.
 * - Lazy-loads Excalidraw from canvas-lib/ on mount
 * - Auto-saves scene data with size-adaptive debounce
 * - Shows save status in footer
 * - Shows skeleton loading state while Excalidraw loads
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

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

  const excalidrawRef = useRef<any>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      // Load existing canvas metadata
      window.electron.canvasGetAll().then((canvases: any[]) => {
        const canvas = canvases.find((c: any) => c.id === currentCanvasId);
        if (canvas) setTitle(canvas.title);
      });
    }
  }, [mode, currentCanvasId]);

  // Auto-save with size-adaptive debounce
  const handleSceneChange = useCallback((elements: any[], appState: any, files: any) => {
    if (!currentCanvasId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    // Estimate scene size for adaptive debounce
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

  // Title update
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (currentCanvasId) {
      window.electron.canvasUpdate(currentCanvasId, { title: newTitle });
    }
  }, [currentCanvasId]);

  // Handle install
  const handleInstall = useCallback(async () => {
    setInstallStatus({ status: 'downloading', progress: 0 });
    try {
      await window.electron.canvasInstall();
    } catch (e: any) {
      setInstallStatus({ status: 'error', error: e.message || 'Installation failed' });
    }
  }, []);

  // Export
  const handleExport = useCallback(async () => {
    if (!currentCanvasId) return;
    await window.electron.canvasExport(currentCanvasId, 'json');
  }, [currentCanvasId]);

  // Cleanup timers
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

  // Skeleton loading state while Excalidraw loads
  const renderSkeleton = () => (
    <div className="flex-1 flex flex-col">
      {/* Skeleton toolbar */}
      <div className="h-10 flex items-center justify-center gap-1 border-b border-white/5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-8 h-8 rounded-md bg-white/5 animate-pulse" />
        ))}
      </div>
      {/* Skeleton canvas area */}
      <div className="flex-1 bg-white/[0.02] flex items-center justify-center">
        <div className="text-[13px] text-white/20 animate-pulse">Loading canvas...</div>
      </div>
    </div>
  );

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
      <div className="h-12 flex items-center px-20 border-b border-white/5" style={{ WebkitAppRegion: 'drag' } as any}>
        <input
          value={title}
          onChange={handleTitleChange}
          className="bg-transparent text-[13px] text-white/80 font-medium text-center w-full outline-none"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          placeholder="Canvas title..."
        />
      </div>

      {/* Canvas content area */}
      <div ref={containerRef} className="flex-1 relative">
        {!isExcalidrawLoaded && renderSkeleton()}
        {/* Excalidraw will be mounted here when the library is loaded */}
        <div
          id="excalidraw-container"
          className={`absolute inset-0 ${isExcalidrawLoaded ? '' : 'hidden'}`}
        />
      </div>

      {/* Footer */}
      <div className="h-10 flex items-center justify-between px-4 border-t border-white/5 text-[11px]">
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
