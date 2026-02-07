# SuperCommand - Open Source Raycast Alternative

## Project Overview

SuperCommand is an open-source alternative to Raycast, designed to provide a similar launcher experience while maintaining full compatibility with Raycast extensions. The project aims to achieve feature parity with Raycast while remaining open-source and community-driven.

### Core Principles

1. **Extension Compatibility**: The app must be compatible with existing Raycast extensions without requiring modifications to extension code
2. **Runtime Control**: All changes and enhancements must be implemented in SuperCommand itself, not in extensions, since we cannot control extension code at runtime
3. **API Parity**: Keep APIs in sync with `@raycast/api` and track implementation status against the official Raycast API
4. **Progressive Enhancement**: Gradually implement all Raycast APIs to achieve full parity

## Architecture

### Project Structure

```
launcher/
├── src/
│   ├── main/              # Electron main process
│   │   ├── extension-runner.ts    # Extension execution engine
│   │   ├── extension-registry.ts  # Extension catalog & management
│   │   ├── commands.ts            # Command management
│   │   └── ...
│   ├── renderer/          # Electron renderer process (UI)
│   │   └── src/
│   │       ├── raycast-api/       # @raycast/api compatibility shim
│   │       ├── ExtensionView.tsx  # Extension rendering component
│   │       └── ...
│   └── native/            # Native Swift modules
└── dist/                  # Build output
```

### Extension Execution Model

1. **Extension Loading**: Extensions are loaded from the Raycast extension registry
2. **Code Bundling**: Extension code is bundled using esbuild to CommonJS
3. **Runtime Shim**: A custom `require()` function provides:
   - React (shared instance with host app)
   - `@raycast/api` shim (our compatibility layer)
   - `@raycast/utils` shim (utility hooks and functions)
4. **Isolation**: Extensions run in isolated contexts but share React with the host

### API Compatibility Layer

The `src/renderer/src/raycast-api/index.tsx` file provides a comprehensive compatibility shim that implements Raycast APIs. This shim:

- Intercepts all `@raycast/api` and `@raycast/utils` imports from extensions
- Provides React-compatible implementations of Raycast components
- Bridges to Electron main process for system-level operations
- Maintains API compatibility while allowing internal enhancements

## API Implementation Status

### @raycast/api - Core Components

| Component | Status | Notes |
|-----------|--------|-------|
| `List` | ✅ Implemented | Full support with filtering, pagination, accessories |
| `Detail` | ✅ Implemented | With Metadata support |
| `Form` | ✅ Implemented | All form field types supported |
| `Grid` | ✅ Implemented | Grid layout with actions |
| `ActionPanel` | ✅ Implemented | Full action panel system |
| `Action` | ✅ Implemented | All action types including Push, CopyToClipboard, etc. |
| `MenuBarExtra` | ✅ Implemented | Menu bar integration |

### @raycast/api - Hooks

| Hook | Status | Notes |
|------|--------|-------|
| `useNavigation` | ✅ Implemented | Push/pop navigation stack |

### @raycast/api - Functions

| Function | Status | Notes |
|----------|--------|-------|
| `showToast` | ✅ Implemented | Toast notifications |
| `showHUD` | ✅ Implemented | HUD overlay |
| `confirmAlert` | ✅ Implemented | Alert dialogs |
| `open` | ✅ Implemented | Open URLs/applications |
| `closeMainWindow` | ✅ Implemented | Window management |
| `popToRoot` | ✅ Implemented | Navigation reset |
| `launchCommand` | ✅ Implemented | Command launching |
| `getSelectedText` | ⚠️ Partial | May need macOS permissions |
| `getSelectedFinderItems` | ⚠️ Partial | May need macOS permissions |
| `getApplications` | ✅ Implemented | Application listing |
| `getFrontmostApplication` | ✅ Implemented | Active app detection |
| `trash` | ✅ Implemented | File deletion |
| `openExtensionPreferences` | ✅ Implemented | Settings navigation |
| `openCommandPreferences` | ✅ Implemented | Command settings |
| `updateCommandMetadata` | ✅ Implemented | Dynamic metadata updates |
| `clearSearchBar` | ✅ Implemented | Search bar control |

### @raycast/api - Objects & Utilities

| Object/Utility | Status | Notes |
|----------------|--------|-------|
| `environment` | ✅ Implemented | Extension context & system info |
| `Clipboard` | ✅ Implemented | Clipboard operations |
| `LocalStorage` | ✅ Implemented | Persistent storage |
| `Cache` | ✅ Implemented | Caching system |
| `Toast` | ✅ Implemented | Toast class with styles |
| `Icon` | ✅ Implemented | Icon mapping (emoji fallback) |
| `Color` | ✅ Implemented | Color constants |
| `Image` | ✅ Implemented | Image utilities |
| `Keyboard` | ✅ Implemented | Keyboard shortcuts |
| `AI` | ✅ Implemented | AI integration (Ollama/OpenAI) |
| `LaunchType` | ✅ Implemented | Launch type enum |
| `Alert` | ✅ Implemented | Alert namespace |
| `WindowManagement` | ✅ Implemented | Window management API |
| `BrowserExtension` | ⚠️ Stub | Basic stub implementation |
| `OAuth` | ⚠️ Stub | OAuth stub (needs implementation) |

### @raycast/utils - Hooks

| Hook | Status | Notes |
|------|--------|-------|
| `useFetch` | ✅ Implemented | HTTP fetching with caching |
| `useCachedPromise` | ✅ Implemented | Promise caching |
| `useCachedState` | ✅ Implemented | State with persistence |
| `usePromise` | ✅ Implemented | Promise handling |
| `useForm` | ✅ Implemented | Form state management |
| `useExec` | ✅ Implemented | Command execution |
| `useSQL` | ✅ Implemented | SQLite queries |
| `useStreamJSON` | ✅ Implemented | Streaming JSON |
| `useAI` | ✅ Implemented | AI integration hook |
| `useFrecencySorting` | ✅ Implemented | Frecency-based sorting |
| `useLocalStorage` | ✅ Implemented | LocalStorage hook |

### @raycast/utils - Functions

| Function | Status | Notes |
|----------|--------|-------|
| `getFavicon` | ✅ Implemented | Favicon fetching |
| `runAppleScript` | ✅ Implemented | AppleScript execution |
| `showFailureToast` | ✅ Implemented | Error toast helper |

### Missing or Incomplete APIs

The following APIs from `@raycast/api` may need additional work or verification:

1. **OAuth** - Currently stubbed, needs full OAuth flow implementation
2. **BrowserExtension** - Basic stub, may need browser extension integration
3. **getSelectedText** / **getSelectedFinderItems** - May require additional macOS permissions handling
4. **Advanced Window Management** - Some edge cases may need testing
5. **Image Asset Loading** - Asset path resolution may need refinement

## Development Guidelines

### Adding New API Support

When implementing a new Raycast API:

1. **Check Official Documentation**: Reference https://developers.raycast.com/api-reference/
2. **Implement in `raycast-api/index.tsx`**: Add the API to the compatibility shim
3. **Bridge to Main Process**: If system-level operations are needed, add IPC handlers in `main.ts` and `preload.ts`
4. **Test with Extensions**: Verify compatibility with real Raycast extensions
5. **Update This Document**: Mark the API as implemented in the status table above

### Extension Compatibility Testing

1. **Test Popular Extensions**: Regularly test with popular Raycast extensions from the store
2. **Report Incompatibilities**: Document any extensions that don't work and identify missing APIs
3. **Progressive Enhancement**: Prioritize APIs used by popular extensions

### Code Organization

- **API Shim**: All Raycast API implementations go in `src/renderer/src/raycast-api/index.tsx`
- **Extension Loading**: Extension execution logic in `src/renderer/src/ExtensionView.tsx`
- **System Integration**: Electron IPC handlers in `src/main/main.ts` and `src/main/preload.ts`
- **Extension Management**: Extension registry and installation in `src/main/extension-registry.ts`

### API Version Tracking

- **Current Raycast Version**: Tracked in `environment.raycastVersion` (currently `1.80.0`)
- **API Reference**: https://developers.raycast.com/api-reference/
- **Breaking Changes**: Monitor Raycast releases for API changes that may affect compatibility

## Extension Registry Integration

SuperCommand integrates with the Raycast extension registry to:

1. **Browse Extensions**: Access the full catalog of Raycast extensions
2. **Install Extensions**: Download and install extensions from the registry
3. **Manage Extensions**: Enable/disable installed extensions
4. **Update Extensions**: Keep extensions up to date

Extensions are stored locally and executed through the compatibility shim.

## AI Integration

SuperCommand supports AI features through:

- **Ollama**: Local AI models via Ollama
- **OpenAI**: Cloud-based AI via OpenAI API
- **AI API Compatibility**: Full `AI.ask()` and `useAI()` hook support

AI availability is checked via `environment.canAccess(AI)` and cached for performance.

## System Integration

### macOS Features

- **Global Hotkeys**: System-wide keyboard shortcuts
- **Window Management**: Overlay window with transparency
- **Application Detection**: Get running applications and frontmost app
- **File System**: Trash operations, file access
- **AppleScript**: Execute AppleScript commands
- **Clipboard**: Read/write clipboard contents

### Electron Architecture

- **Main Process**: Handles system operations, extension management, IPC
- **Renderer Process**: UI rendering, extension execution, API shim
- **Preload Script**: Secure IPC bridge between main and renderer

## Testing Strategy

1. **Unit Tests**: Test individual API implementations
2. **Integration Tests**: Test extension loading and execution
3. **Compatibility Tests**: Test with real Raycast extensions
4. **System Tests**: Test macOS integration features

## Contributing

When contributing:

1. **Maintain API Compatibility**: Ensure all changes maintain compatibility with `@raycast/api`
2. **Document Changes**: Update this file when adding new APIs
3. **Test Extensions**: Verify changes don't break existing extensions
4. **Follow Patterns**: Use existing code patterns for consistency

## Roadmap

### Short Term
- [ ] Complete OAuth implementation
- [ ] Enhance BrowserExtension API
- [ ] Improve asset loading for extensions
- [ ] Add comprehensive test suite

### Long Term
- [ ] Achieve 100% API parity with `@raycast/api`
- [ ] Performance optimizations
- [ ] Enhanced extension debugging tools
- [ ] Community extension store (optional)

## Resources

- **Raycast API Docs**: https://developers.raycast.com/api-reference/
- **Raycast Extensions**: https://www.raycast.com/store
- **Project Repository**: [Add repository URL]

## Notes

- The compatibility shim is a single large file (`raycast-api/index.tsx`) for simplicity, but this could be refactored into modules as it grows
- Extensions share React with the host app to ensure proper React context and hooks work correctly
- All system operations go through Electron IPC for security and isolation
- Extension code is bundled to CommonJS for compatibility with Node.js-style requires

