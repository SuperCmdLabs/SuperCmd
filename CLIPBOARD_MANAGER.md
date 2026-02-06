# Clipboard Manager

A Raycast-inspired clipboard history manager built into SuperCommand.

## Features

- **Automatic Monitoring**: Continuously monitors your clipboard and saves history
- **Multiple Content Types**: 
  - Text snippets
  - Images (PNG, JPG, GIF, WebP)
  - URLs
  - File paths
- **Smart Search**: Filter clipboard history by content
- **Type Filtering**: Filter by type (All, Text, Image, URL, File)
- **Preview Pane**: View full content before pasting
- **Persistent Storage**: History is saved to disk and restored on app restart
- **Clean UI**: Split-pane interface with list and preview

## Usage

1. **Open Clipboard Manager**:
   - Open SuperCommand launcher (default: `Cmd+Space`)
   - Type "Clipboard History" or just "clip"
   - Press Enter

2. **Navigate & Paste**:
   - Use `↑` / `↓` arrow keys to navigate
   - Press `Enter` to paste selected item
   - Or double-click any item

3. **Search**:
   - Type in the search bar to filter items
   - Searches through text content

4. **Delete Items**:
   - Select an item and press `Cmd+Backspace`
   - Or click the "Delete" button in preview pane
   - Click "Clear All" to remove all history

5. **Filter by Type**:
   - Click tabs at the top: All, Text, Image, URL, File

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Navigate items |
| `Enter` | Paste selected item |
| `Cmd+Backspace` | Delete selected item |
| `Esc` | Close clipboard manager |

## Technical Details

### Storage

- History metadata: `~/Library/Application Support/SuperCommand/clipboard-history/history.json`
- Image files: `~/Library/Application Support/SuperCommand/clipboard-history/images/`
- Maximum items: 1000 (older items are automatically removed)
- Maximum image size: 10MB per image
- Maximum text length: 100,000 characters

### Monitoring

- Polls clipboard every 1 second
- Automatically detects content type
- Images are saved as PNG files
- URLs are automatically detected
- File paths are validated

### Privacy

- All data is stored locally on your machine
- No cloud sync or external connections
- Clear history at any time

## Architecture

### Main Process (`clipboard-manager.ts`)
- Monitors system clipboard using Electron's clipboard API
- Saves items to disk with metadata
- Manages image file storage
- Provides IPC handlers for UI

### Renderer (`ClipboardManager.tsx`)
- Split-pane UI (list + preview)
- Real-time search and filtering
- Image preview with metadata display
- Keyboard navigation

### Integration
- Added as a system command in `commands.ts`
- IPC handlers in `main.ts`
- Types defined in `electron.d.ts`
- Exposed through preload script

## Future Enhancements

Possible future improvements:
- Pin favorite items
- Organize items into collections
- Export/import history
- Custom keyboard shortcuts per item
- Rich text formatting support
- More file format support
- Statistics and insights
- Cloud sync (optional)
