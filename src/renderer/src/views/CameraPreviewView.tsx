import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, FlipHorizontal, RefreshCw } from 'lucide-react';

interface CameraPreviewViewProps {
  portalTarget: HTMLElement;
  onClose: () => void;
}

const CameraPreviewView: React.FC<CameraPreviewViewProps> = ({ portalTarget, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mirroredRef = useRef(true);

  const [error, setError] = useState<string | null>(null);
  const [mirrored, setMirrored] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [captureFlash, setCaptureFlash] = useState(false);

  // Keep mirroredRef in sync for stable capture callback
  useEffect(() => {
    mirroredRef.current = mirrored;
  }, [mirrored]);

  // Enumerate video input devices (after first camera permission is granted)
  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'videoinput')))
      .catch(() => {});
  }, []);

  // Start/restart stream when device changes
  useEffect(() => {
    let active = true;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setError(null);

    const deviceId = devices[deviceIndex]?.deviceId;
    const constraints: MediaStreamConstraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
      audio: false,
    };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        // Re-enumerate after permission to pick up device labels
        navigator.mediaDevices
          .enumerateDevices()
          .then((all) => setDevices(all.filter((d) => d.kind === 'videoinput')))
          .catch(() => {});
      })
      .catch((err: Error) => {
        if (active) setError(err.message || 'Camera unavailable');
      });

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [deviceIndex, devices.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (mirroredRef.current) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    // White flash feedback
    setCaptureFlash(true);
    setTimeout(() => setCaptureFlash(false), 150);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const homeDir = (window as any).electron?.homeDir || '';
        await (window as any).electron.fsWriteBinaryFile(
          `${homeDir}/Desktop/Camera ${ts}.png`,
          data
        );
      } catch {
        // silently ignore save errors
      }
    }, 'image/png');
  }, []);

  // Register Cmd+S in the child window so the shortcut fires when the overlay is focused
  useEffect(() => {
    const childWindow = portalTarget.ownerDocument.defaultView;
    if (!childWindow) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        capturePhoto();
      }
    };

    childWindow.addEventListener('keydown', handleKeyDown);
    return () => childWindow.removeEventListener('keydown', handleKeyDown);
  }, [capturePhoto, portalTarget]);

  const switchCamera = useCallback(() => {
    setDeviceIndex((i) => (i + 1) % Math.max(devices.length, 1));
  }, [devices.length]);

  const content = (
    <div
      className="w-full h-full flex flex-col bg-[#111] rounded-2xl overflow-hidden"
      style={{ fontFamily: 'system-ui, sans-serif', WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Flash overlay */}
      {captureFlash && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'white',
            opacity: 0.75,
            zIndex: 20,
            pointerEvents: 'none',
            borderRadius: 'inherit',
          }}
        />
      )}

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/50 px-6 text-center">
          <Camera className="w-8 h-8 opacity-40" />
          <p className="text-xs leading-relaxed">{error}</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="flex-1 w-full object-cover"
          style={{
            transform: mirrored ? 'scaleX(-1)' : 'none',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        />
      )}

      {/* Bottom toolbar */}
      <div
        className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Toggle mirror */}
        <button
          onClick={() => setMirrored((m) => !m)}
          className="w-6 h-6 rounded-full flex items-center justify-center"
          style={{
            background: mirrored ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.55)',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          title="Toggle Mirror"
        >
          <FlipHorizontal style={{ width: 10, height: 10, color: 'rgba(255,255,255,0.8)' }} />
        </button>

        {/* Capture shutter */}
        <button
          onClick={capturePhoto}
          className="w-8 h-8 rounded-full border-2 border-white/70 flex items-center justify-center hover:scale-105 transition-transform"
          style={{
            background: 'rgba(255,255,255,0.15)',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          title="Take Photo (⌘S)"
        >
          <div className="w-4 h-4 rounded-full bg-white/90" />
        </button>

        {/* Switch camera (only shown when multiple devices are detected) */}
        {devices.length > 1 && (
          <button
            onClick={switchCamera}
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(0,0,0,0.55)',
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
            title="Switch Camera"
          >
            <RefreshCw style={{ width: 10, height: 10, color: 'rgba(255,255,255,0.8)' }} />
          </button>
        )}
      </div>

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
        style={{
          background: 'rgba(0,0,0,0.55)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        title="Close Camera Preview"
      >
        <X style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.8)' }} />
      </button>

      {/* Shortcut hint */}
      <div
        className="absolute top-2 left-2 text-white/25 text-[9px] pointer-events-none select-none"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        ⌘S
      </div>
    </div>
  );

  return createPortal(
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>{content}</div>,
    portalTarget
  );
};

export default CameraPreviewView;
