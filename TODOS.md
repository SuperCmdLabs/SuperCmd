# TODOS

## Canvas: Orphaned scene file cleanup on startup
**Added:** 2026-03-26 | **Branch:** supercmd-canvas | **Priority:** Low

Add a cleanup pass to `canvas-store.ts` init that removes orphaned scene files
(`data/*.excalidraw` and `data/*.thumb.svg` without a matching `canvas.json` entry).

**Why:** canvas-store writes scene data asynchronously and the index synchronously.
If the app crashes between these operations, orphaned files accumulate on disk.
A cleanup pass on canvas-store initialization prevents gradual disk waste.

**Implementation:** In `loadFromDisk()` or `initCanvasStore()`:
1. Read all files in `data/` directory
2. Extract IDs from filenames (strip `.excalidraw` / `.thumb.svg` extension)
3. Compare against IDs in `canvas.json`
4. Delete any files whose ID doesn't appear in the index

**Effort:** ~10 lines. Near-zero complexity.
**Depends on:** `canvas-store.ts` implementation.
