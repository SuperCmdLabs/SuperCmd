import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Image, RefreshCw, RotateCcw, Settings, Video, X } from 'lucide-react';
import ExtensionActionFooter from './components/ExtensionActionFooter';

interface CameraExtensionProps {
  onClose: () => void;
}

type CameraPermissionState = 'checking' | 'granted' | 'denied' | 'error';

interface CameraAction {
  title: string;
  icon: React.ReactNode;
  shortcut?: string[];
  execute: () => void | Promise<void>;
  disabled?: boolean;
  style?: 'default' | 'destructive';
}

type CaptureStatus = {
  kind: 'success' | 'neutral';
  text: string;
};

function stopMediaStream(stream?: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {}
  }
}

function getCameraErrorMessage(error: unknown): { state: CameraPermissionState; message: string } {
  const name = String((error as any)?.name || '').toLowerCase();
  const message = String((error as any)?.message || '');

  if (name === 'notallowederror' || name === 'securityerror' || name === 'permissiondeniederror') {
    return {
      state: 'denied',
      message: 'Camera access is denied. Allow camera access in System Settings and retry.',
    };
  }

  if (name === 'notfounderror' || name === 'devicesnotfounderror') {
    return {
      state: 'error',
      message: 'No camera was found on this device.',
    };
  }

  if (name === 'notreadableerror' || name === 'trackstarterror') {
    return {
      state: 'error',
      message: 'Camera is currently in use by another app.',
    };
  }

  if (name === 'overconstrainederror' || name === 'constraintnotsatisfiederror') {
    return {
      state: 'error',
      message: 'The selected camera is unavailable.',
    };
  }

  return {
    state: 'error',
    message: message || 'Failed to start camera.',
  };
}

const CameraExtension: React.FC<CameraExtensionProps> = ({ onClose }) => {
  const [permissionState, setPermissionState] = useState<CameraPermissionState>('checking');
  const [errorText, setErrorText] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [capturePreviewDataUrl, setCapturePreviewDataUrl] = useState<string | null>(null);
  const [capturePreviewVisible, setCapturePreviewVisible] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const [flashVisible, setFlashVisible] = useState(false);
  const [isHorizontallyFlipped, setIsHorizontallyFlipped] = useState(false);
  const [lastCapturedPath, setLastCapturedPath] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const captureNoticeTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const capturePreviewFadeTimerRef = useRef<number | null>(null);
  const capturePreviewClearTimerRef = useRef<number | null>(null);
  const startRequestIdRef = useRef(0);
  const unmountedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const clearTransientUi = useCallback(() => {
    if (captureNoticeTimerRef.current != null) {
      window.clearTimeout(captureNoticeTimerRef.current);
      captureNoticeTimerRef.current = null;
    }
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    if (capturePreviewFadeTimerRef.current != null) {
      window.clearTimeout(capturePreviewFadeTimerRef.current);
      capturePreviewFadeTimerRef.current = null;
    }
    if (capturePreviewClearTimerRef.current != null) {
      window.clearTimeout(capturePreviewClearTimerRef.current);
      capturePreviewClearTimerRef.current = null;
    }
  }, []);

  const refocusCameraRoot = useCallback(() => {
    window.requestAnimationFrame(() => {
      rootRef.current?.focus();
    });
  }, []);

  const showCaptureStatus = useCallback((status: CaptureStatus, durationMs = 3000) => {
    setCaptureStatus(status);
    if (captureNoticeTimerRef.current != null) {
      window.clearTimeout(captureNoticeTimerRef.current);
    }
    captureNoticeTimerRef.current = window.setTimeout(() => {
      setCaptureStatus(null);
      captureNoticeTimerRef.current = null;
    }, durationMs);
  }, []);

  const refreshDevices = useCallback(async (preferredDeviceId?: string) => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setCameraDevices([]);
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === 'videoinput');
      setCameraDevices(cameras);
      setActiveDeviceId((prev) => preferredDeviceId || prev || cameras[0]?.deviceId || '');
    } catch {
      setCameraDevices([]);
    }
  }, []);

  const assignStream = useCallback((nextStream: MediaStream | null) => {
    const previousStream = streamRef.current;
    if (previousStream && previousStream !== nextStream) {
      stopMediaStream(previousStream);
    }
    streamRef.current = nextStream;
    if (!unmountedRef.current) {
      setStream(nextStream);
    }
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string): Promise<boolean> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermissionState('error');
        setErrorText('Camera API is not available in this environment.');
        return false;
      }

      const requestId = ++startRequestIdRef.current;
      setIsStarting(true);
      setErrorText('');
      setPermissionState('checking');

      let nextStream: MediaStream | null = null;

      try {
        const preferredId = String(deviceId || '').trim();
        const initialVideoConstraints: MediaTrackConstraints =
          preferredId.length > 0
            ? { deviceId: { exact: preferredId } }
            : { facingMode: 'user' };

        try {
          nextStream = await navigator.mediaDevices.getUserMedia({
            video: initialVideoConstraints,
            audio: false,
          });
        } catch (error) {
          if (!preferredId) throw error;
          nextStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        if (unmountedRef.current || requestId !== startRequestIdRef.current) {
          stopMediaStream(nextStream);
          return false;
        }

        setPermissionState('granted');
        const selectedTrack = nextStream.getVideoTracks()[0];
        const selectedDeviceId = String(selectedTrack?.getSettings?.().deviceId || preferredId || '');
        setActiveDeviceId(selectedDeviceId);
        assignStream(nextStream);
        await refreshDevices(selectedDeviceId);
        return true;
      } catch (error) {
        if (nextStream) {
          stopMediaStream(nextStream);
        }
        if (unmountedRef.current || requestId !== startRequestIdRef.current) {
          return false;
        }
        assignStream(null);
        const normalized = getCameraErrorMessage(error);
        setPermissionState(normalized.state);
        setErrorText(normalized.message);
        return false;
      } finally {
        if (!unmountedRef.current && requestId === startRequestIdRef.current) {
          setIsStarting(false);
        }
      }
    },
    [assignStream, refreshDevices]
  );

  const closeCamera = useCallback(() => {
    assignStream(null);
    onClose();
  }, [assignStream, onClose]);

  const handleSwitchCamera = useCallback(async () => {
    if (cameraDevices.length <= 1 || isStarting) {
      showCaptureStatus({ kind: 'neutral', text: 'Only one camera is available.' }, 2200);
      return;
    }

    const currentIndex = cameraDevices.findIndex((device) => device.deviceId === activeDeviceId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cameraDevices.length : 0;
    const nextDevice = cameraDevices[nextIndex];
    if (!nextDevice?.deviceId) return;
    await startCamera(nextDevice.deviceId);
  }, [activeDeviceId, cameraDevices, isStarting, showCaptureStatus, startCamera]);

  const handleFlipCamera = useCallback(() => {
    setIsHorizontallyFlipped((prev) => !prev);
  }, []);

  const handleOpenLastCapture = useCallback(async () => {
    const target = String(lastCapturedPath || '').trim();
    if (!target) {
      showCaptureStatus({ kind: 'neutral', text: 'No capture available yet.' }, 2200);
      return;
    }
    const opened = await window.electron.openUrl(target, 'Preview');
    if (!opened) {
      showCaptureStatus({ kind: 'neutral', text: 'Failed to open capture in Preview.' }, 2200);
    }
    refocusCameraRoot();
  }, [lastCapturedPath, refocusCameraRoot, showCaptureStatus]);

  const handleTakePicture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !stream) return;

    const width = Math.max(1, video.videoWidth || 1280);
    const height = Math.max(1, video.videoHeight || 720);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return;
    if (isHorizontallyFlipped) {
      context.save();
      context.translate(width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, width, height);
      context.restore();
    } else {
      context.drawImage(video, 0, 0, width, height);
    }

    setCapturePreviewDataUrl(canvas.toDataURL('image/png'));
    setCapturePreviewVisible(true);
    if (capturePreviewFadeTimerRef.current != null) {
      window.clearTimeout(capturePreviewFadeTimerRef.current);
    }
    if (capturePreviewClearTimerRef.current != null) {
      window.clearTimeout(capturePreviewClearTimerRef.current);
    }
    capturePreviewFadeTimerRef.current = window.setTimeout(() => {
      setCapturePreviewVisible(false);
      capturePreviewFadeTimerRef.current = null;
    }, 5000);
    capturePreviewClearTimerRef.current = window.setTimeout(() => {
      setCapturePreviewDataUrl(null);
      setCapturePreviewClearTimerRef.current = null;
    }, 5300);
    setFlashVisible(true);
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashVisible(false);
      flashTimerRef.current = null;
    }, 140);

    const homeDir = String((window.electron as any)?.homeDir || '').trim();
    const saveDir = homeDir ? `${homeDir}/Pictures/SuperCmd Captures` : '/tmp/SuperCmd Captures';
    const now = new Date();
    const two = (value: number) => String(value).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
    const savePath = `${saveDir}/supercmd-capture-${timestamp}.png`;

    let captureBlob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });

    let savedToDisk = false;
    if (captureBlob) {
      try {
        await window.electron.execCommand('/bin/mkdir', ['-p', saveDir], {});
        const bytes = new Uint8Array(await captureBlob.arrayBuffer());
        await window.electron.fsWriteBinaryFile(savePath, bytes);
        savedToDisk = true;
        setLastCapturedPath(savePath);
      } catch {}
    }
    if (!savedToDisk) {
      showCaptureStatus({ kind: 'neutral', text: 'Failed to save picture.' }, 3000);
      refocusCameraRoot();
      return;
    }
    let copiedToClipboard = false;
    try {
      copiedToClipboard = Boolean(await window.electron.clipboardWrite({ file: savePath }));
    } catch {}

    if (copiedToClipboard) {
      showCaptureStatus(
        { kind: 'success', text: 'Picture captured and copied to clipboard.' },
        3000
      );
    } else {
      showCaptureStatus({ kind: 'neutral', text: 'Failed to copy picture to clipboard.' }, 3000);
    }
    refocusCameraRoot();
  }, [isHorizontallyFlipped, refocusCameraRoot, showCaptureStatus, stream]);

  const openSystemCameraSettings = useCallback(async () => {
    try {
      await window.electron.openUrl('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
    } catch {}
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      unmountedRef.current = true;
      startRequestIdRef.current += 1;
      clearTransientUi();
      const currentStream = streamRef.current;
      streamRef.current = null;
      stopMediaStream(currentStream);
    };
  }, [clearTransientUi, startCamera]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!stream) {
      video.srcObject = null;
      return;
    }

    video.srcObject = stream;
    void video.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const cleanupWindowHidden = window.electron.onWindowHidden(() => {
      closeCamera();
    });
    return cleanupWindowHidden;
  }, [closeCamera]);

  useEffect(() => {
    refocusCameraRoot();
  }, [refocusCameraRoot]);

  useEffect(() => {
    if (!showActions) {
      refocusCameraRoot();
      return;
    }
    setSelectedActionIndex(0);
    window.setTimeout(() => actionMenuRef.current?.focus(), 0);
  }, [refocusCameraRoot, showActions]);

  const selectedCameraLabel = useMemo(() => {
    if (cameraDevices.length === 0) return 'No camera';
    const active = cameraDevices.find((device) => device.deviceId === activeDeviceId);
    return active?.label || `Camera ${Math.max(1, cameraDevices.findIndex((d) => d.deviceId === activeDeviceId) + 1)}`;
  }, [activeDeviceId, cameraDevices]);

  const actions = useMemo<CameraAction[]>(
    () => [
      {
        title: 'Take Picture',
        icon: <Camera className="w-4 h-4" />,
        shortcut: ['↩'],
        execute: () => {
          void handleTakePicture();
        },
        disabled: permissionState !== 'granted' || isStarting,
      },
      {
        title: 'Flip Camera',
        icon: <RotateCcw className="w-4 h-4" />,
        shortcut: ['⌘', 'F'],
        execute: () => {
          handleFlipCamera();
        },
        disabled: permissionState !== 'granted' || isStarting,
      },
      {
        title: 'Switch Camera',
        icon: <RefreshCw className="w-4 h-4" />,
        shortcut: ['⌘', '⇧', 'F'],
        execute: () => {
          void handleSwitchCamera();
        },
        disabled: permissionState !== 'granted' || cameraDevices.length <= 1 || isStarting,
      },
      {
        title: 'Open Last Capture in Preview',
        icon: <Image className="w-4 h-4" />,
        shortcut: ['⌘', 'O'],
        execute: () => {
          void handleOpenLastCapture();
        },
        disabled: !lastCapturedPath,
      },
      {
        title: 'Close',
        icon: <X className="w-4 h-4" />,
        shortcut: ['⌘', 'W'],
        execute: closeCamera,
        style: 'destructive',
      },
    ],
    [cameraDevices.length, closeCamera, handleFlipCamera, handleOpenLastCapture, handleSwitchCamera, handleTakePicture, isStarting, lastCapturedPath, permissionState]
  );

  const captureAction = actions[0];
  const footerPrimaryAction: {
    label: string;
    onClick: () => void;
    disabled: boolean;
    shortcut: string[];
  } = {
    label: captureAction.title,
    onClick: () => executeAction(captureAction),
    disabled: Boolean(captureAction.disabled),
    shortcut: captureAction.shortcut || ['↩'],
  };

  const executeAction = useCallback(
    (action: CameraAction) => {
      if (action.disabled) return;
      setShowActions(false);
      void Promise.resolve(action.execute());
      refocusCameraRoot();
    },
    [refocusCameraRoot]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent | React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const key = String(event.key || '').toLowerCase();
      const isPlainEnter =
        (event.key === 'Enter' || event.code === 'NumpadEnter') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey;

      if (event.metaKey && key === 'k' && !event.repeat) {
        event.preventDefault();
        setShowActions((prev) => !prev);
        return;
      }

      if (showActions) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSelectedActionIndex((prev) => Math.min(prev + 1, actions.length - 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSelectedActionIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowActions(false);
          return;
        }
        if (isPlainEnter && actions[selectedActionIndex]) {
          event.preventDefault();
          executeAction(actions[selectedActionIndex]);
          return;
        }
      }

      if (event.metaKey && key === 'f' && !event.repeat) {
        event.preventDefault();
        if (event.shiftKey) {
          void handleSwitchCamera();
        } else {
          handleFlipCamera();
        }
        return;
      }

      if (event.metaKey && key === 'o' && !event.repeat) {
        event.preventDefault();
        void handleOpenLastCapture();
        return;
      }

      if (event.metaKey && key === 'w' && !event.repeat) {
        event.preventDefault();
        closeCamera();
        return;
      }

      if (isPlainEnter && !showActions) {
        event.preventDefault();
        if (!captureAction.disabled) {
          executeAction(captureAction);
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeCamera();
      }
    },
    [actions, captureAction, closeCamera, executeAction, handleFlipCamera, handleOpenLastCapture, handleSwitchCamera, selectedActionIndex, showActions]
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      handleKeyDown(event);
    };
    window.addEventListener('keydown', onWindowKeyDown, true);
    return () => window.removeEventListener('keydown', onWindowKeyDown, true);
  }, [handleKeyDown]);

  const renderMainContent = () => {
    if (permissionState === 'granted') {
      return (
        <div className="h-full">
          <div className="relative flex-1 min-h-0 overflow-hidden bg-black">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={isHorizontallyFlipped ? { transform: 'scaleX(-1)' } : undefined}
              playsInline
              autoPlay
              muted
            />

            {flashVisible ? <div className="absolute inset-0 bg-white/80 pointer-events-none" /> : null}

            <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/55 text-white/85 text-xs flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5" />
              <span className="truncate max-w-[240px]">{selectedCameraLabel}</span>
            </div>

            {capturePreviewDataUrl ? (
              <div
                className={`absolute right-3 bottom-3 w-28 h-20 rounded-lg border border-white/20 overflow-hidden bg-black/80 shadow-xl transition-opacity duration-300 ${
                  capturePreviewVisible ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <img
                  src={capturePreviewDataUrl}
                  alt="Latest capture"
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    const loading = permissionState === 'checking' || isStarting;
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md text-center space-y-3 px-8">
          <div className="w-12 h-12 rounded-full bg-[var(--overlay-item-hover-bg)] mx-auto flex items-center justify-center">
            {loading ? (
              <div className="w-5 h-5 border-2 border-[var(--surface-tint-6)] border-t-[var(--text-primary)] rounded-full animate-spin" />
            ) : (
              <Camera className="w-5 h-5 text-[var(--text-muted)]" />
            )}
          </div>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            {loading ? 'Starting Camera...' : 'Camera Access Required'}
          </h3>
          <p className="text-xs text-[var(--text-subtle)] leading-relaxed">
            {loading
              ? 'SuperCmd is requesting camera access.'
              : errorText || 'Allow camera permission to view your camera feed in SuperCmd.'}
          </p>
          {!loading ? (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void startCamera(activeDeviceId);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--overlay-item-hover-bg)] text-[var(--text-primary)] hover:bg-[var(--overlay-item-hover-active-bg)] transition-colors"
              >
                Retry Permission
              </button>
              <button
                type="button"
                onClick={() => {
                  void openSystemCameraSettings();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--ui-divider)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors inline-flex items-center gap-1.5"
              >
                <Settings className="w-3.5 h-3.5" />
                Open Settings
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className="relative w-full h-full flex flex-col"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <button
        type="button"
        onClick={closeCamera}
        className="absolute left-3 top-3 z-20 w-9 h-9 rounded-full bg-black/55 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-md transition-colors ring-1 ring-white/25 shadow-[0_6px_18px_rgba(0,0,0,0.65)]"
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7))' }}
        aria-label="Back"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>

      <div className="flex-1 min-h-0">
        {renderMainContent()}
      </div>

      <ExtensionActionFooter
        leftContent={
          captureStatus ? (
            <span className="inline-flex items-center gap-2 min-w-0 max-w-[760px]">
              {captureStatus.kind === 'success' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/90 shadow-[0_0_0_3px_rgba(52,211,153,0.18)] flex-shrink-0" />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{captureStatus.text}</span>
              {captureStatus.kind === 'success' && lastCapturedPath ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleOpenLastCapture();
                  }}
                  className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
                >
                  <span className="text-xs font-normal">Open</span>
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">⌘</kbd>
                  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">O</kbd>
                </button>
              ) : null}
            </span>
          ) : (
            <span className="truncate">{permissionState === 'granted' ? selectedCameraLabel : 'Camera'}</span>
          )
        }
        primaryAction={{
          label: footerPrimaryAction.label,
          onClick: footerPrimaryAction.onClick,
          disabled: footerPrimaryAction.disabled,
          shortcut: footerPrimaryAction.shortcut,
        }}
        actionsButton={{
          label: 'Actions',
          onClick: () => setShowActions(true),
          shortcut: ['⌘', 'K'],
        }}
      />

      {showActions ? (
        <div
          className="fixed inset-0 z-50"
          style={{ background: 'var(--bg-scrim)' }}
          onClick={() => setShowActions(false)}
        >
          <div
            ref={actionMenuRef}
            className="absolute bottom-12 right-3 w-72 rounded-xl border border-[var(--ui-divider)] bg-[var(--card-bg)] backdrop-blur-xl shadow-2xl p-1 outline-none"
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
          >
            {actions.map((action, index) => {
              const selected = index === selectedActionIndex;
              return (
                <button
                  key={action.title}
                  type="button"
                  disabled={action.disabled}
                  onMouseMove={() => setSelectedActionIndex(index)}
                  onClick={() => executeAction(action)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 transition-colors ${
                    selected
                      ? 'bg-[var(--action-menu-selected-bg)] border border-[var(--action-menu-selected-border)]'
                      : 'hover:bg-[var(--overlay-item-hover-bg)] border border-transparent'
                  } ${
                    action.disabled
                      ? 'opacity-45 cursor-not-allowed'
                      : ''
                  }`}
                >
                  <span className={action.style === 'destructive' ? 'text-red-400' : 'text-[var(--text-muted)]'}>
                    {action.icon}
                  </span>
                  <span
                    className={`flex-1 text-[13px] ${
                      action.style === 'destructive' ? 'text-red-400' : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {action.title}
                  </span>
                  <span className="flex items-center gap-0.5 text-[var(--text-subtle)]">
                    {(action.shortcut || []).map((shortcutKey) => (
                      <kbd
                        key={`${action.title}-${shortcutKey}`}
                        className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-[var(--kbd-bg)] text-[10px] font-medium"
                      >
                        {shortcutKey}
                      </kbd>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CameraExtension;
