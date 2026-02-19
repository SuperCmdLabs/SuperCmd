import { useEffect } from 'react';
import { useDetachedPortalWindow } from '../useDetachedPortalWindow';

interface UseCameraPreviewManagerOptions {
  showCameraPreview: boolean;
  setShowCameraPreview: React.Dispatch<React.SetStateAction<boolean>>;
}

interface UseCameraPreviewManagerReturn {
  cameraPortalTarget: HTMLElement | null;
}

export function useCameraPreviewManager({
  showCameraPreview,
  setShowCameraPreview,
}: UseCameraPreviewManagerOptions): UseCameraPreviewManagerReturn {
  const cameraPortalTarget = useDetachedPortalWindow(showCameraPreview, {
    name: 'supercmd-camera-window',
    title: 'Camera Preview',
    width: 320,
    height: 300,
    anchor: 'center',
    onClosed: () => setShowCameraPreview(false),
  });

  // Keep main process in sync with overlay visibility
  useEffect(() => {
    window.electron.setDetachedOverlayState('camera', showCameraPreview);
  }, [showCameraPreview]);

  return { cameraPortalTarget };
}
