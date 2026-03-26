/**
 * Entry point for the Excalidraw UMD bundle.
 * Exposes the Excalidraw component and export utilities on window.ExcalidrawBundle.
 */

import { Excalidraw, exportToSvg, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw';

// Re-export everything the canvas editor needs
export {
  Excalidraw,
  exportToSvg,
  exportToBlob,
  serializeAsJSON,
};
