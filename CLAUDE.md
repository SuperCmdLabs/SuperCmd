# SuperCmd - Open Source Raycast Alternative

## Project Overview

SuperCmd is an open-source alternative to Raycast, designed to provide a similar launcher experience while maintaining full compatibility with Raycast extensions. The project aims to achieve feature parity with Raycast while remaining open-source and community-driven.

### Core Principles

1. **Extension Compatibility**: The app must be compatible with existing Raycast extensions without requiring modifications to extension code
2. **Runtime Control**: All changes and enhancements must be implemented in SuperCmd itself, not in extensions, since we cannot control extension code at runtime
3. **API Parity**: Keep APIs in sync with `@raycast/api` and track implementation status against the official Raycast API
4. **Progressive Enhancement**: Gradually implement all Raycast APIs to achieve full parity

## Architecture

### Project Structure

```
launcher/
├── src/
│   ├── main/                          # Electron main process
│   │   ├── main.ts                    # Entry point; IPC handlers, window management, global shortcuts
│   │   ├── preload.ts                 # contextBridge — exposes window.electron API to renderer
│   │   ├── commands.ts                # App/settings/extension/script discovery; getAvailableCommands() with cache
│   │   ├── extension-runner.ts        # Extension execution engine (esbuild bundle + require shim)
│   │   ├── extension-registry.ts      # Extension catalog, install, uninstall, update
│   │   ├── script-command-runner.ts   # Raycast-compatible script command execution
│   │   ├── ai-provider.ts             # AI streaming (OpenAI / Anthropic / Ollama) via Node http/https
│   │   └── settings-store.ts          # JSON settings persistence (AppSettings, cached in memory)
│   ├── renderer/                      # Electron renderer process (UI)
│   │   ├── types/
│   │   │   └── electron.d.ts          # TypeScript types for window.electron IPC bridge
│   │   └── src/
│   │       ├── App.tsx                # Root component — composes all hooks, routes to view components
│   │       ├── raycast-api/            # @raycast/api + @raycast/utils compatibility runtime modules
│   │       │   ├── index.tsx          # Integration/export surface (wires runtime modules)
│   │       │   ├── action-runtime*.tsx # Action/ActionPanel registry + overlay runtime
│   │       │   ├── list-runtime*.tsx   # List runtime (item registry, renderers, detail)
│   │       │   ├── form-runtime*.tsx   # Form runtime (container + fields + context)
│   │       │   ├── grid-runtime*.tsx   # Grid runtime (item registry + renderer + container)
│   │       │   ├── detail-runtime.tsx  # Detail runtime
│   │       │   └── menubar-runtime*.tsx # MenuBarExtra runtime
│   │       ├── hooks/                 # Feature hooks (state + logic, no JSX)
│   │       │   ├── useAppViewManager.ts      # View state machine — which screen is active
│   │       │   ├── useAiChat.ts              # AI chat mode state + streaming
│   │       │   ├── useCursorPrompt.ts        # Inline AI cursor prompt state + streaming
│   │       │   ├── useMenuBarExtensions.ts   # Menu-bar extension lifecycle
│   │       │   ├── useBackgroundRefresh.ts   # Interval-based background refresh for extensions/scripts
│   │       │   ├── useSpeakManager.ts        # TTS (Read) overlay state + portal
│   │       │   └── useWhisperManager.ts      # Whisper STT overlay state + portals
│   │       ├── views/                 # Full-screen view components (pure UI, state from hooks)
│   │       │   ├── AiChatView.tsx                  # Full-screen AI chat panel
│   │       │   ├── CursorPromptView.tsx             # Inline/portal AI cursor prompt UI
│   │       │   ├── ScriptCommandSetupView.tsx       # Script argument collection form
│   │       │   ├── ScriptCommandOutputView.tsx      # Script stdout/stderr output viewer
│   │       │   └── ExtensionPreferenceSetupView.tsx # Extension preference/argument form
│   │       ├── utils/                 # Pure utility modules (no side-effects)
│   │       │   ├── constants.ts              # localStorage keys, magic numbers, error strings
│   │       │   ├── command-helpers.tsx        # filterCommands, icon renderers, display helpers
│   │       │   └── extension-preferences.ts  # localStorage helpers, preference hydration, missing-pref checks
│   │       ├── ExtensionView.tsx      # Renders a live Raycast extension inside the launcher
│   │       ├── settings/              # Settings window UI (AITab, ExtensionsTab, GeneralTab, etc.)
│   │       └── useDetachedPortalWindow.ts    # Hook to open/manage a detached Electron overlay window
│   └── native/                        # Native Swift modules
└── dist/                              # Build output
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

The `src/renderer/src/raycast-api/` runtime modules (wired by `index.tsx`) provide a comprehensive compatibility shim that implements Raycast APIs. This shim:

- Intercepts all `@raycast/api` and `@raycast/utils` imports from extensions
- Provides React-compatible implementations of Raycast components
- Bridges to Electron main process for system-level operations
- Maintains API compatibility while allowing internal enhancements

## API Implementation Status

### @raycast/api - Core Components

| Component | Status | Notes |
|-----------|--------|-------|
| `List` | ✅ Implemented | Full support with filtering, pagination, accessories, List.Item.Detail with Metadata |
| `Detail` | ✅ Implemented | With Metadata support (Label, Link, TagList, Separator) |
| `Form` | ✅ Implemented | All field types; DatePicker.Type enum; FilePicker with showHiddenFiles; LinkAccessory; enableDrafts |
| `Grid` | ✅ Implemented | Grid.Fit/Inset enums; Section with aspectRatio/columns/fit/inset; Item.accessory |
| `ActionPanel` | ✅ Implemented | Full action panel; Submenu with filtering/isLoading/onOpen/shortcut |
| `Action` | ✅ Implemented | Open, OpenInBrowser, Push (onPop), CopyToClipboard (concealed), ToggleQuickLook, PickDate.Type |
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
| `open` | ✅ Implemented | Open URLs/applications; supports `application` parameter |
| `closeMainWindow` | ✅ Implemented | Window management |
| `popToRoot` | ✅ Implemented | Navigation reset |
| `launchCommand` | ✅ Implemented | Command launching |
| `getSelectedText` | ⚠️ Partial | May need macOS permissions |
| `getSelectedFinderItems` | ⚠️ Partial | May need macOS permissions |
| `getApplications` | ✅ Implemented | Application listing; optional directory path filter |
| `getDefaultApplication` | ✅ Implemented | Get default app for a file path |
| `getFrontmostApplication` | ✅ Implemented | Active app detection |
| `captureException` | ✅ Implemented | Logs exception to console (error reporting) |
| `trash` | ✅ Implemented | File deletion |
| `openExtensionPreferences` | ✅ Implemented | Opens settings window |
| `openCommandPreferences` | ✅ Implemented | Opens settings window |
| `updateCommandMetadata` | ✅ Implemented | Dynamic metadata updates |
| `clearSearchBar` | ✅ Implemented | Search bar control |
| `getPreferenceValues` | ✅ Implemented | Returns extension preferences from context |
| `showInFinder` | ✅ Implemented | Opens Finder at file path |

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
| `PopToRootType` | ✅ Implemented | Enum for pop-to-root behavior |
| `DeeplinkType` | ✅ Implemented | Enum for deeplink types (Extension, ScriptCommand) |
| `FormValidation` | ✅ Implemented | Enum for form validation (Required) |
| `Preferences` | ✅ Implemented | Type export |
| `LaunchContext` | ✅ Implemented | Type export |
| `Preference` | ✅ Implemented | Interface with all preference type properties |
| `PreferenceValues` | ✅ Implemented | Record type for preference values |
| `Application` | ✅ Implemented | Type export |
| `FileSystemItem` | ✅ Implemented | Type export |
| `LaunchProps` | ✅ Implemented | Type export |
| `LaunchOptions` | ✅ Implemented | Type export |
| `Tool` | ✅ Implemented | Tool namespace with Confirmation<T> type |
| `BrowserExtension` | ⚠️ Stub | Typed stub (Tab, ContentOptions); getContent/getTabs return empty defaults — needs browser extension integration |
| `OAuth` | ⚠️ Stub | OAuth stub (needs implementation) |

### @raycast/utils - Hooks

| Hook | Status | Notes |
|------|--------|-------|
| `useFetch` | ✅ Implemented | HTTP fetching with pagination, optimistic mutate |
| `useCachedPromise` | ✅ Implemented | Promise caching with abortable, onWillExecute |
| `useCachedState` | ✅ Implemented | State with persistence, cacheNamespace support |
| `usePromise` | ✅ Implemented | Promise handling with mutate/revalidate |
| `useForm` | ✅ Implemented | Form state with FormValidation enum |
| `useExec` | ✅ Implemented | Command execution with stripFinalNewline, timeout, two overloads |
| `useSQL` | ✅ Implemented | SQLite queries with permissionView, full callbacks |
| `useStreamJSON` | ✅ Implemented | Streaming JSON with filter/transform/dataPath/pageSize |
| `useAI` | ✅ Implemented | AI streaming with onError/onData/onWillExecute callbacks |
| `useFrecencySorting` | ✅ Implemented | Frecency sorting with localStorage persistence |
| `useLocalStorage` | ✅ Implemented | LocalStorage hook |

### @raycast/utils - Functions

| Function | Status | Notes |
|----------|--------|-------|
| `getFavicon` | ✅ Implemented | Favicon fetching |
| `getAvatarIcon` | ✅ Implemented | SVG avatar from name initials with deterministic colors |
| `getProgressIcon` | ✅ Implemented | SVG circular progress indicator |
| `runAppleScript` | ✅ Implemented | AppleScript execution |
| `showFailureToast` | ✅ Implemented | Error toast helper |
| `createDeeplink` | ✅ Implemented | Generate deeplink URIs for extensions/scripts |
| `executeSQL` | ✅ Implemented | Standalone SQLite query execution |
| `withCache` | ✅ Implemented | Cache wrapper for async functions with maxAge/validate |

### Missing or Incomplete APIs

The following APIs from `@raycast/api` may need additional work or verification:

1. **OAuth** - Currently stubbed, needs full OAuth flow implementation
2. **BrowserExtension** - Basic stub, may need browser extension integration
3. **getSelectedText** / **getSelectedFinderItems** - May require additional macOS permissions handling
4. **openExtensionPreferences** / **openCommandPreferences** - Currently console.log stubs, need real settings navigation
5. **Advanced Window Management** - Some edge cases may need testing
6. **Image Asset Loading** - Asset path resolution may need refinement

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
- **System Integration**: Electron IPC handlers in `src/main/main.ts`; IPC bridge in `src/main/preload.ts`
- **Extension Management**: Extension registry and installation in `src/main/extension-registry.ts`
- **View State**: Which screen is shown is owned by `src/renderer/src/hooks/useAppViewManager.ts`
- **Feature Logic**: Each major feature has a dedicated hook in `src/renderer/src/hooks/`
- **View Components**: Full-screen UI panels live in `src/renderer/src/views/` (pure UI, no business logic)
- **Shared Utilities**: Pure helpers in `src/renderer/src/utils/` — import from here, not inline in components
- **App.tsx** is the orchestrator: it wires hooks together and routes to the correct view; avoid adding business logic directly to it

### API Version Tracking

- **Current Raycast Version**: Tracked in `environment.raycastVersion` (currently `1.80.0`)
- **API Reference**: https://developers.raycast.com/api-reference/
- **Breaking Changes**: Monitor Raycast releases for API changes that may affect compatibility

## Extension Registry Integration

SuperCmd integrates with the Raycast extension registry to:

1. **Browse Extensions**: Access the full catalog of Raycast extensions
2. **Install Extensions**: Download and install extensions from the registry
3. **Manage Extensions**: Enable/disable installed extensions
4. **Update Extensions**: Keep extensions up to date

Extensions are stored locally and executed through the compatibility shim.

## AI Integration

SuperCmd supports AI features through:

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

- The Raycast compatibility layer is being modularized; keep logic in focused runtime files and keep `index.tsx` as an integration/export surface.
- Extensions share React with the host app to ensure proper React context and hooks work correctly.
- All system operations go through Electron IPC for security and isolation.
- Extension code is bundled to CommonJS for compatibility with Node.js-style requires.

## Raycast API File Map

Use this map when working in the Raycast compatibility layer:

- `src/renderer/src/raycast-api/index.tsx`
  Purpose: Main compatibility integration entrypoint and export surface for `@raycast/api` + `@raycast/utils`.
  Use for: top-level wiring between component runtimes, hook runtimes, and shared API exports.

- `src/renderer/src/raycast-api/action-runtime.tsx`
  Purpose: Action runtime entrypoint.
  Use for: wiring `Action`, `ActionPanel`, action registry hooks, shortcut helpers, and action overlay extraction.

- `src/renderer/src/raycast-api/action-runtime-registry.tsx`
  Purpose: Action registration + execution semantics.
  Use for: `ActionRegistryContext`, `useCollectedActions`, `useActionRegistration`, and action executor behavior.

- `src/renderer/src/raycast-api/action-runtime-overlay.tsx`
  Purpose: Action overlay rendering and static action extraction.
  Use for: `ActionPanelOverlay` UI and `extractActionsFromElement` fallback.

- `src/renderer/src/raycast-api/action-runtime-components.tsx`
  Purpose: `Action` / `ActionPanel` component surface.
  Use for: action component registration wrappers (`CopyToClipboard`, `SubmitForm`, `Push`, etc.).

- `src/renderer/src/raycast-api/action-runtime-shortcuts.tsx`
  Purpose: Shortcut matching/rendering helpers.
  Use for: `matchesShortcut`, `isMetaK`, and shortcut badge rendering.

- `src/renderer/src/raycast-api/form-runtime.tsx`
  Purpose: Form container runtime.
  Use for: form action handling, footer/actions UI, keyboard shortcuts, and context wiring.

- `src/renderer/src/raycast-api/form-runtime-fields.tsx`
  Purpose: Form field component implementations.
  Use for: `Form.TextField`, `TextArea`, `Dropdown`, `DatePicker`, `FilePicker`, etc.

- `src/renderer/src/raycast-api/form-runtime-context.tsx`
  Purpose: Form context and global form snapshots.
  Use for: `getFormValues`/`getFormErrors` data used by `Action.SubmitForm`.

- `src/renderer/src/raycast-api/list-runtime.tsx`
  Purpose: List container runtime.
  Use for: selection/filtering/grouping logic, action overlay integration, and `List` surface wiring.

- `src/renderer/src/raycast-api/list-runtime-hooks.ts`
  Purpose: List registry/grouping helper hooks.
  Use for: list item registry snapshots, emoji-grid heuristics, and grouped-section derivation.

- `src/renderer/src/raycast-api/list-runtime-renderers.tsx`
  Purpose: List row renderers and list subcomponents.
  Use for: `List.Item` registration, row visuals, emoji grid cells, `List.EmptyView`, `List.Dropdown`.

- `src/renderer/src/raycast-api/list-runtime-detail.tsx`
  Purpose: `List.Item.Detail` runtime helpers.
  Use for: markdown detail rendering and image source normalization.

- `src/renderer/src/raycast-api/list-runtime-types.tsx`
  Purpose: List runtime types + contexts.
  Use for: list registry contracts and empty-view registry context.

- `src/renderer/src/raycast-api/grid-runtime.tsx`
  Purpose: Grid container runtime.
  Use for: grid selection/filter/action handling and `Grid` surface wiring.

- `src/renderer/src/raycast-api/grid-runtime-hooks.ts`
  Purpose: Grid registry/grouping helper hooks.
  Use for: grid registry snapshots and grouped-section derivation.

- `src/renderer/src/raycast-api/grid-runtime-items.tsx`
  Purpose: Grid item registration and cell renderer primitives.
  Use for: `Grid.Item`, `Grid.Section`, and grid cell image rendering behavior.

- `src/renderer/src/raycast-api/icon-runtime.tsx`
  Purpose: Public barrel for icon runtime exports.
  Use for: `configureIconRuntime`, `Icon`, `Color`, `Image`, `Keyboard`, `renderIcon`, `resolveIconSrc`.

- `src/renderer/src/raycast-api/icon-runtime-config.ts`
  Purpose: Shared runtime configuration for icon resolution.
  Use for: wiring `getExtensionContext` into icon asset resolution.

- `src/renderer/src/raycast-api/icon-runtime-phosphor.tsx`
  Purpose: Raycast icon-name to Phosphor icon mapping/resolution.
  Use for: adding or fixing icon token mappings and fallback icon behavior.

- `src/renderer/src/raycast-api/icon-runtime-assets.tsx`
  Purpose: Asset path normalization and icon source/tint helpers.
  Use for: `sc-asset://` handling, local asset existence checks, icon tint masking.

- `src/renderer/src/raycast-api/icon-runtime-render.tsx`
  Purpose: Icon renderer implementation.
  Use for: object/string icon rendering, file icon fallback, `Color`/`Image`/`Keyboard` constants.

- `src/renderer/src/raycast-api/platform-runtime.ts`
  Purpose: Platform-facing runtime helpers.
  Use for: `WindowManagement`, `BrowserExtension` stubs, `Tool` types, `executeSQL`, `withCache`.

- `src/renderer/src/raycast-api/misc-runtime.ts`
  Purpose: Misc API exports extracted from index.
  Use for: preferences proxy/types, command metadata updates, deeplink creation.

- `src/renderer/src/raycast-api/utility-runtime.ts`
  Purpose: Shared utility helpers extracted from index.
  Use for: favicon/avatar/progress icons, AppleScript execution, failure toasts.

- `src/renderer/src/raycast-api/storage-events.ts`
  Purpose: Extension storage change event bridge.
  Use for: emitting `sc-extension-storage-changed` from shared storage mutations.

- `src/renderer/src/raycast-api/context-scope-runtime.ts`
  Purpose: Extension context snapshot/scope runtime.
  Use for: safely running async callbacks with the extension context they were created with.

- `src/renderer/src/raycast-api/oauth/index.ts`
  Purpose: Public OAuth barrel.
  Use for: `OAuth`, `OAuthService`, `withAccessToken`, token access helpers.

- `src/renderer/src/raycast-api/oauth/runtime-config.ts`
  Purpose: OAuth runtime dependency injection.
  Use for: wiring `getExtensionContext`, `open`, and icon resolution into OAuth modules.

- `src/renderer/src/raycast-api/oauth/oauth-bridge.ts`
  Purpose: OAuth callback bridge and callback parsing/wait helpers.
  Use for: callback URL parsing, callback queue/waiters, redirect URI generation.

- `src/renderer/src/raycast-api/oauth/oauth-client.ts`
  Purpose: PKCE client/token compatibility helpers.
  Use for: provider token persistence, PKCE request generation, OAuth compatibility objects.

- `src/renderer/src/raycast-api/oauth/oauth-service-core.ts`
  Purpose: OAuthService core authorization flow.
  Use for: authorize URL handling, token exchange, stored-token retrieval.

- `src/renderer/src/raycast-api/oauth/oauth-service.ts`
  Purpose: OAuthService public class + provider factory methods.
  Use for: provider presets (`linear`, `spotify`, `jira`, etc.).

- `src/renderer/src/raycast-api/oauth/with-access-token.tsx`
  Purpose: `withAccessToken` HOC and runtime auth gate UI.
  Use for: auth-required rendering, callback refresh flow, token state accessors.

- `src/renderer/src/raycast-api/hooks/use-cached-state.ts`
  Purpose: Extracted `useCachedState` hook.
  Use for: persistent local state backed by localStorage.

- `src/renderer/src/raycast-api/hooks/use-promise.ts`
  Purpose: Extracted `usePromise` hook.
  Use for: async execution lifecycle (`data/isLoading/error`) and mutate/revalidate support.

- `src/renderer/src/raycast-api/hooks/use-fetch.ts`
  Purpose: Extracted `useFetch` hook.
  Use for: HTTP requests with optional pagination accumulation and mutate/revalidate behavior.

- `src/renderer/src/raycast-api/hooks/use-cached-promise.ts`
  Purpose: Extracted `useCachedPromise` hook.
  Use for: cached async execution with optional cursor/page pagination pattern.

- `src/renderer/src/raycast-api/hooks/use-form.ts`
  Purpose: Extracted `FormValidation` + `useForm`.
  Use for: form state, validation, and generated field props.

- `src/renderer/src/raycast-api/hooks/use-exec.ts`
  Purpose: Extracted `useExec` hook.
  Use for: running shell commands through Electron IPC.

- `src/renderer/src/raycast-api/hooks/use-sql.ts`
  Purpose: Extracted `useSQL` hook.
  Use for: running sqlite queries through Electron IPC.

- `src/renderer/src/raycast-api/hooks/use-stream-json.ts`
  Purpose: Extracted `useStreamJSON` hook.
  Use for: fetch + transform/filter + client-side pagination for JSON APIs.

- `src/renderer/src/raycast-api/hooks/use-ai.ts`
  Purpose: Extracted `useAI` hook.
  Use for: prompt execution with streaming/non-streaming result handling.

- `src/renderer/src/raycast-api/hooks/use-frecency-sorting.ts`
  Purpose: Extracted `useFrecencySorting` hook.
  Use for: frequency+recency ranking and visit tracking.

- `src/renderer/src/raycast-api/hooks/use-local-storage.ts`
  Purpose: Extracted `useLocalStorage` hook.
  Use for: synchronized localStorage state with extension storage-change events.

- `src/renderer/src/raycast-api/raycast-icon-enum.ts`
  Purpose: Canonical Raycast icon enum/value mapping used by icon resolution (auto-generated).
  Use for: adding/fixing icon names and legacy icon token compatibility.
