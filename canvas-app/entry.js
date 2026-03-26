/**
 * Entry point for the Excalidraw UMD bundle.
 * Explicitly assigns to window.ExcalidrawBundle so the host app can access it.
 */

import './node_modules/@excalidraw/excalidraw/dist/prod/index.css';
import { Excalidraw, exportToSvg, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw';

window.ExcalidrawBundle = {
  Excalidraw,
  exportToSvg,
  exportToBlob,
  serializeAsJSON,
};
