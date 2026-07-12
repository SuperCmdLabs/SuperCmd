export interface CapturePreviewUrlApi {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (objectUrl: string) => void;
}

export interface CapturePreviewUrlManager {
  getCurrentUrl: () => string | null;
  show: (blob: Blob) => string | null;
  clear: () => void;
  dispose: () => void;
}

function getCapturePreviewUrlApi(): CapturePreviewUrlApi | null {
  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    return null;
  }
  return URL;
}

export function createCapturePreviewUrlManager(
  urlApi: CapturePreviewUrlApi | null = getCapturePreviewUrlApi()
): CapturePreviewUrlManager {
  let currentUrl: string | null = null;

  const clear = () => {
    const urlToRevoke = currentUrl;
    currentUrl = null;
    if (!urlToRevoke || !urlApi) return;
    try {
      urlApi.revokeObjectURL(urlToRevoke);
    } catch {}
  };

  return {
    getCurrentUrl: () => currentUrl,
    show: (blob: Blob) => {
      let nextUrl: string | null = null;
      if (urlApi) {
        try {
          nextUrl = urlApi.createObjectURL(blob);
        } catch {
          nextUrl = null;
        }
      }
      clear();
      currentUrl = nextUrl;
      return currentUrl;
    },
    clear,
    dispose: clear,
  };
}

export function createCapturePreview(
  blob: Blob,
  previewUrlManager: CapturePreviewUrlManager
): { url: string | null; visible: boolean } {
  const url = previewUrlManager.show(blob);
  return {
    url,
    visible: Boolean(url),
  };
}

export function encodeCanvasAsPngBlob(canvas: Pick<HTMLCanvasElement, 'toBlob'>): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
