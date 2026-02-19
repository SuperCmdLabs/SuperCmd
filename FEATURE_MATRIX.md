# SuperCmd — Feature Matrix
> Complete audit of SuperCmd vs PowerToys vs Raycast.
> Use this as the master testing checklist. Work through each section, mark status, then build missing features one by one.

**Status legend:**
- ✅ Built & working
- 🟡 Built — untested / needs verification
- 🔴 Missing — needs to be built
- ⬜ N/A — not applicable to Windows or this app's scope

---

## 1. SUPERCMD — Complete Feature Inventory

### 1.1 Core Launcher

| Feature | Command ID | Description | Status |
|---|---|---|---|
| Global hotkey (open/close) | — | Configurable global shortcut, default `Ctrl+Space` | ✅ |
| Fuzzy search across all commands | — | Scored search across title, keywords, subtitle | ✅ |
| Recent commands | — | Most-used commands float to top | ✅ |
| Pinned commands | — | Pin any command to keep it at top | ✅ |
| Disable commands | — | Hide any command from results | ✅ |
| Per-command hotkeys | — | Assign a global hotkey to any command | ✅ |
| Launcher window show/hide | — | Window hides on blur and on Escape | ✅ |
| Settings window | `system-open-settings` | Full settings UI | ✅ |
| Onboarding wizard | `system-open-onboarding` | Multi-step setup flow | ✅ |
| Quit | `system-quit-launcher` | Exits the app | ✅ |
| Auto-launch at login | — | Toggle in settings | 🔵 test on packaged .exe |
| App updater | — | Auto-update via electron-updater | 🔵 test on packaged .exe |

### 1.2 App & Settings Discovery

| Feature | Description | Status |
|---|---|---|
| Windows apps (Start Menu) | Scans Start Menu `.lnk` shortcuts → resolves `.exe` targets | 🟡 |
| Windows app icons | Extracted via `System.Drawing.Icon` (PowerShell batch) | 🟡 |
| Windows Settings panels | 37 pre-defined `ms-settings:` URIs | 🟡 |
| UWP / Store apps | **NOT discovered** — shortcuts don't point to `.exe` | 🔴 |
| macOS apps | Spotlight + filesystem scan | ⬜ |
| macOS System Settings | `.prefPane` + `.appex` scan | ⬜ |

### 1.3 Built-in Utilities

| Feature | Command ID | Description | Status |
|---|---|---|---|
| **Color Picker** | `system-color-picker` | Native `<input type="color">` window, copies hex to clipboard | 🟡 |
| **Calculator** | `system-calculator` | Inline math + unit conversion as you type | 🟡 |
| **Toggle Dark / Light Mode** | `system-toggle-dark-mode` | Writes Windows registry + sets Electron `nativeTheme` | 🟡 |
| **Awake / Prevent Sleep** | `system-awake-toggle` | Electron `powerSaveBlocker`; subtitle shows Active state | 🟡 |
| **Hosts File Editor** | `system-hosts-editor` | Opens hosts file in elevated Notepad via `Start-Process -Verb RunAs` | 🟡 |
| **Environment Variables** | `system-env-variables` | Opens `sysdm.cpl` Environment Variables dialog via `rundll32` | 🟡 |
| **Shortcut Guide** | `system-shortcut-guide` | In-launcher overlay listing all keyboard shortcuts | 🟡 |
| **File Search** | `system-search-files` | Search files on disk | 🟡 |
| **Clipboard History** | `system-clipboard-manager` | Full clipboard monitor with search, copy, delete | 🟡 |
| **Snippets / Text Expansion** | `system-create-snippet`, `system-search-snippets` | Create, search, pin, import/export text snippets | 🟡 |
| **Script Commands** | `system-create-script-command`, `system-open-script-commands` | Raycast-compatible shell scripts | 🟡 |
| **AI Chat** | Tab key | Streaming AI chat (OpenAI / Anthropic / Ollama) | 🟡 |
| **Cursor / Inline AI Prompt** | `system-cursor-prompt` | Caret-anchored AI prompt, applies result to editor | 🟡 |
| **Whisper Dictation** | `system-supercmd-whisper` | Push-to-talk voice dictation (Fn key hold) | 🟡 |
| **Text-to-Speech (Read)** | `system-supercmd-speak` | Reads selected text aloud (Edge-TTS / ElevenLabs) | 🟡 |
| **Memory** | `system-add-to-memory` | Saves selected text to Supermemory API | 🟡 |
| **Extensions (Raycast-compatible)** | — | Installs & runs community Raycast extensions | 🟡 |
| **Extension Store** | `system-open-extensions-settings` | Browse + install extensions | 🟡 |

### 1.4 Windows Settings Panels (all 37)

| Panel | `ms-settings:` URI | Status |
|---|---|---|
| Display | `ms-settings:display` | 🟡 |
| Night Light | `ms-settings:nightlight` | 🟡 |
| Sound | `ms-settings:sound` | 🟡 |
| Bluetooth & Devices | `ms-settings:bluetooth` | 🟡 |
| Network & Internet | `ms-settings:network-status` | 🟡 |
| Wi-Fi | `ms-settings:network-wifi` | 🟡 |
| VPN | `ms-settings:network-vpn` | 🟡 |
| Personalization | `ms-settings:personalization` | 🟡 |
| Background | `ms-settings:personalization-background` | 🟡 |
| Colors & Themes | `ms-settings:colors` | 🟡 |
| Taskbar | `ms-settings:taskbar` | 🟡 |
| Apps & Features | `ms-settings:appsfeatures` | 🟡 |
| Default Apps | `ms-settings:defaultapps` | 🟡 |
| Startup Apps | `ms-settings:startupapps` | 🟡 |
| Accounts | `ms-settings:accounts` | 🟡 |
| Sign-in Options | `ms-settings:signinoptions` | 🟡 |
| Date & Time | `ms-settings:dateandtime` | 🟡 |
| Language & Region | `ms-settings:regionformatting` | 🟡 |
| Notifications | `ms-settings:notifications` | 🟡 |
| Battery & Power | `ms-settings:batterysaver` | 🟡 |
| Storage | `ms-settings:storagesense` | 🟡 |
| Multitasking | `ms-settings:multitasking` | 🟡 |
| Privacy & Security | `ms-settings:privacy` | 🟡 |
| Microphone Privacy | `ms-settings:privacy-microphone` | 🟡 |
| Camera Privacy | `ms-settings:privacy-webcam` | 🟡 |
| Location | `ms-settings:privacy-location` | 🟡 |
| Windows Update | `ms-settings:windowsupdate` | 🟡 |
| Troubleshoot | `ms-settings:troubleshoot` | 🟡 |
| Recovery | `ms-settings:recovery` | 🟡 |
| Activation | `ms-settings:activation` | 🟡 |
| Developer Mode | `ms-settings:developers` | 🟡 |
| Mouse | `ms-settings:mousetouchpad` | 🟡 |
| Keyboard | `ms-settings:keyboard` | 🟡 |
| Printers & Scanners | `ms-settings:printers` | 🟡 |
| Gaming | `ms-settings:gaming-gamebar` | 🟡 |
| Optional Features | `ms-settings:optionalfeatures` | 🟡 |
| About This PC | `ms-settings:about` | 🟡 |

---

## 2. POWERTOYS — Full Feature List vs SuperCmd

> PowerToys is a suite of standalone Windows utilities. PowerToys Run is its launcher component.

### 2.1 PowerToys Run (the Launcher)

| PT Run Plugin / Feature | What It Does | SuperCmd Equivalent | SuperCmd Status |
|---|---|---|---|
| Application launcher | Launch installed apps | App discovery (Start Menu) | 🟡 |
| File search | Search files by name | `system-search-files` | 🟡 |
| Calculator | Evaluate math expressions | `system-calculator` (inline) | 🟡 |
| Unit converter | Convert units (km→mi, °C→°F, etc.) | `system-calculator` (smart-calculator.ts) | 🟡 |
| Currency converter | Convert currencies | 🔴 | 🔴 |
| Windows Settings search | Open specific settings panels | 37 `win-settings-*` commands | 🟡 |
| Shell / Terminal command | Run `>cmd` to execute shell commands | 🔴 Script Commands exist but no `>` prefix | 🔴 |
| Web search | `?query` prefix to web search | 🔴 | 🔴 |
| Window Walker | Switch to any open window | 🔴 | 🔴 |
| Process kill | Kill a running process by name | 🔴 | 🔴 |
| Registry search | Browse Windows registry | 🔴 | 🔴 |
| VS Code workspaces | Open recent VS Code workspaces | 🔴 | 🔴 |
| OneNote search | Search OneNote pages | 🔴 | 🔴 |
| GUID / hash generator | Generate random GUIDs, hashes | 🔴 | 🔴 |
| Indexer / Everything | Fast file search via Windows Search | 🔴 (uses own file search) | 🔴 |
| Clipboard history | Access recent clipboard items | `system-clipboard-manager` | 🟡 |
| URI handler (`raycast://`) | Deep link protocol | ✅ `raycast://` deep links | ✅ |
| Result copy-to-clipboard | Copy any result without executing | 🔴 | 🔴 |

### 2.2 PowerToys Standalone Utilities

| PT Utility | What It Does | SuperCmd Equivalent | SuperCmd Status |
|---|---|---|---|
| **Always on Top** | Pin any window to stay above all others (Win+Ctrl+T) | 🔴 | 🔴 |
| **Awake** | Prevent system sleep (tray icon with timer options) | `system-awake-toggle` (no timer) | 🟡 (no timer) |
| **Color Picker** | Screen eyedropper — click any pixel to copy its color | `system-color-picker` (picker dialog, not screen eyedropper) | 🟡 (dialog only, not pixel picker) |
| **Crop & Lock** | Crop or lock a region of another window into a mini window | 🔴 | 🔴 |
| **Environment Variables** | GUI editor for system/user env vars (add/edit/delete) | `system-env-variables` (opens sysdm.cpl) | 🟡 (no built-in editor) |
| **FancyZones** | Snap windows into custom grid layouts | 🔴 | 🔴 |
| **File Explorer Add-ons** | Preview panels for SVG, Markdown, PDF, GCODE, etc. | 🔴 | 🔴 |
| **File Locksmith** | Right-click → "What's locking this file?" | 🔴 | 🔴 |
| **Hosts File Editor** | GUI table editor for `/etc/hosts` with add/disable/delete | `system-hosts-editor` (opens Notepad) | 🟡 (no GUI editor) |
| **Image Resizer** | Right-click images → resize to presets | 🔴 | 🔴 |
| **Keyboard Manager** | Remap any key to another key or shortcut, system-wide | 🔴 | 🔴 |
| **Mouse Highlighter** | Visual ring around mouse cursor (Win+Shift+H) | 🔴 | 🔴 |
| **Mouse Jump** | Teleport mouse across multiple monitors | 🔴 | 🔴 |
| **Mouse Pointer Crosshairs** | Draw crosshair lines centered on mouse | 🔴 | 🔴 |
| **Mouse Without Borders** | Control multiple PCs with one mouse/keyboard | 🔴 | 🔴 |
| **Paste as Plain Text** | Strip formatting on paste (Win+Ctrl+Alt+V) | 🔴 | 🔴 |
| **Peek** | Quick Look–style file previewer (Space to preview) | 🔴 | 🔴 |
| **PowerRename** | Bulk rename files with regex, search-replace, case | 🔴 | 🔴 |
| **Quick Accent** | Hold a key to show accent variants (é ê ë…) | 🔴 | 🔴 |
| **Registry Preview** | Visualize and diff `.reg` files | 🔴 | 🔴 |
| **Screen Ruler** | Measure pixel distances/areas on screen | 🔴 | 🔴 |
| **Shortcut Guide** | Hold Win to show all Win+key shortcuts overlay | `system-shortcut-guide` (SuperCmd shortcuts, not Win keys) | 🟡 (SuperCmd only) |
| **Text Extractor** | Screen OCR — drag to select region, copy text | 🔴 | 🔴 |
| **Video Conference Mute** | Global mic/camera mute toggle across any app | 🔴 | 🔴 |
| **Workspaces** | Save and restore window layouts (which apps, where) | 🔴 | 🔴 |

---

## 3. RAYCAST (macOS) — Full Feature List vs SuperCmd

> Raycast is the primary inspiration for SuperCmd's architecture.

### 3.1 Core Launcher Features

| Raycast Feature | What It Does | SuperCmd Equivalent | SuperCmd Status |
|---|---|---|---|
| App launcher | Launch apps with fuzzy search | App discovery | 🟡 |
| Recent commands | Recently used commands | ✅ | ✅ |
| Aliases | Set short aliases for any command | 🔴 | 🔴 |
| Fallback commands | Run a search in browser/app if no result found | 🔴 | 🔴 |
| Quicklinks | Saved URLs/bookmarks, optionally with `{query}` placeholder | 🔴 | 🔴 |
| Navigation history | Back/forward through views | 🔴 | 🔴 |
| Action Panel (⌘K) | Context menu of actions for selected item | 🟡 (partial) | 🟡 |
| Raycast deep links | `raycast://` URI scheme | ✅ | ✅ |

### 3.2 Built-in Utilities

| Raycast Utility | What It Does | SuperCmd Equivalent | SuperCmd Status |
|---|---|---|---|
| **Calculator** | Inline math (TypeScript-based, shows result under query) | `system-calculator` | 🟡 |
| **Unit Converter** | Convert km↔mi, °C↔°F, l↔gal, etc. inline | `system-calculator` (smart-calculator.ts) | 🟡 |
| **Currency Converter** | Live exchange rates | 🔴 | 🔴 |
| **Color Picker** | Screen eyedropper → copies hex/rgb/hsl | `system-color-picker` (dialog only) | 🟡 (not screen eyedropper) |
| **Clipboard History** | Full clipboard history with search | `system-clipboard-manager` | 🟡 |
| **Snippets / Text Expansion** | Create shortcuts that expand to text | `system-create-snippet` | 🟡 |
| **File Search** | Search files on disk | `system-search-files` | 🟡 |
| **System Commands** | Sleep, restart, shut down, lock screen, empty trash | 🔴 most | 🔴 |
| **Window Management** | Resize/position windows (halves, quarters, maximize) | 🔴 | 🔴 |
| **Focus Mode / Do Not Disturb** | Pause notifications for a set time | 🔴 | 🔴 |
| **Floating Notes** | Always-on-top scratchpad (Cmd+Shift+N) | 🔴 | 🔴 |
| **Confetti** | Celebration animation (just for fun) | 🔴 | 🔴 |
| **Emoji Search** | Search and insert emoji | 🔴 | 🔴 |
| **Screen OCR** | Capture a region and extract text | 🔴 | 🔴 |
| **Dictionary** | Look up word definitions | 🔴 | 🔴 |
| **Translation** | Translate text using DeepL/Google | 🔴 | 🔴 |

### 3.3 AI Features (Raycast AI)

| Raycast AI Feature | What It Does | SuperCmd Equivalent | SuperCmd Status |
|---|---|---|---|
| AI Chat | Chat with AI models | Tab → AI Chat | ✅ |
| AI Commands | Pre-built prompts (summarize, improve writing, etc.) | 🔴 | 🔴 |
| AI Inline Cursor | Apply AI to selected text in any app | `system-cursor-prompt` | 🟡 |
| AI Extensions | Extensions can call AI with `useAI` | ✅ (`use-ai.ts` shim) | ✅ |
| Multiple AI providers | OpenAI, Anthropic, etc. | ✅ | ✅ |
| Raycast AI (cloud) | Raycast's own managed AI | 🔴 | 🔴 |

### 3.4 Extensions System

| Feature | What It Does | SuperCmd Equivalent | SuperCmd Status |
|---|---|---|---|
| Extensions marketplace | Browse/install community extensions | ✅ Extension Store | ✅ |
| Extension preferences | Per-extension settings UI | ✅ | ✅ |
| Extension deep links | `raycast://extensions/...` | ✅ | ✅ |
| List view | Extensions render a searchable list | ✅ | ✅ |
| Detail view | Extensions render rich markdown detail | ✅ | ✅ |
| Form view | Extensions collect user input | ✅ | ✅ |
| Grid view | Extensions render an icon grid | ✅ | ✅ |
| Menu bar extras | Extensions render in the macOS menu bar | ✅ (Windows tray stub) | 🟡 |
| Script commands | Shell scripts with metadata headers | ✅ | ✅ |
| No-view commands | Run and hide immediately | ✅ | ✅ |
| `@raycast/api` shim | Full API surface for extension compat | ✅ | ✅ |
| OAuth for extensions | PKCE OAuth flow | ✅ | ✅ |
| `useFetch` / `useCachedPromise` hooks | Async data hooks | ✅ | ✅ |
| `useAI` hook | AI integration in extensions | ✅ | ✅ |
| `useSQL` hook | Query SQLite databases | ✅ | ✅ |
| `BrowserExtension` API | Read browser tabs/content | 🟡 stub | 🟡 |

### 3.5 Productivity / Workflow

| Feature | What It Does | SuperCmd Equivalent | SuperCmd Status |
|---|---|---|---|
| Whisper / Dictation | Voice input (Raycast Pro) | `system-supercmd-whisper` | 🟡 |
| Text-to-Speech / Read | Read text aloud (Raycast Pro) | `system-supercmd-speak` | 🟡 |
| Memory / Notes | Save context across sessions | `system-add-to-memory` | 🟡 |
| Raycast for Teams | Shared snippets, quicklinks across org | 🔴 | 🔴 |
| Calendar events | Show today's calendar events | 🔴 | 🔴 |
| Contacts | Search and call/message contacts | 🔴 | 🔴 |
| Browser history search | Search browser history | 🔴 | 🔴 |
| Browser bookmarks | Search browser bookmarks | 🔴 | 🔴 |

---

## 4. MISSING FEATURES — Priority Build List

### Tier 1: Easy wins (small scope, high value)

| Feature | Effort | Reference | Notes |
|---|---|---|---|
| **Shell command runner** (`>` prefix) | Small | PT Run, Raycast | Type `>ipconfig` to run a shell command inline |
| **Web search** (`?` or custom prefix) | Small | PT Run, Raycast | Type `? cats` → opens browser with search |
| **Window Walker** (switch windows) | Medium | PT Run | Enumerate open windows, click to focus |
| **Process kill** | Small | PT Run | List running processes, kill selected |
| **UWP / Store app discovery** | Small | PT | `Get-StartApps` PowerShell to enumerate pinned/UWP apps |
| **System power commands** | Trivial | Raycast | Sleep, restart, shut down, lock screen, hibernate |
| **Emoji picker** | Small | Raycast | Search emoji by name, click to copy |
| **Aliases** | Small | Raycast | Short keyword that maps to any command |
| **Quicklinks** | Small | Raycast | Saved URL with optional `{query}` placeholder |
| **Fallback commands** | Small | Raycast | "Search Google for this" when no results |
| **Screen color eyedropper** | Medium | PT, Raycast | Click any pixel on screen (not just a dialog) |
| **Awake with timer** | Small | PT Awake | Set duration before sleep re-enables |

### Tier 2: Medium effort (meaningful features)

| Feature | Effort | Reference | Notes |
|---|---|---|---|
| **Window management** | Medium | Raycast | Snap to halves/quarters/maximize via keyboard |
| **AI prompt library** | Medium | Raycast AI | Curated prompts: summarize, improve writing, translate, explain |
| **Hosts File GUI editor** | Medium | PT | Table editor inside the launcher (add/disable/delete entries) |
| **Image resizer** | Medium | PT | Drop image → select preset → resize |
| **Bulk rename (PowerRename)** | Medium | PT | Regex rename of multiple files |
| **Floating notes** | Medium | Raycast | Always-on-top scratchpad window |
| **Screen OCR / Text Extractor** | Medium | PT, Raycast | Select region → copy text |
| **Focus mode / DND** | Small | Raycast | Pause Windows notifications for N minutes |
| **Dictionary / word lookup** | Small | Raycast | Define word inline |
| **Translation** | Small | Raycast | Translate text via DeepL/LibreTranslate |
| **Currency converter** | Small | Raycast, PT Run | Live rates from an API |
| **GUID / hash generator** | Small | PT Run | `guid`, `md5 sometext`, `sha256 sometext` |
| **Browser history/bookmarks** | Medium | Raycast | Search Chrome/Edge/Firefox history |
| **Always on Top** | Small | PT | Toggle always-on-top for frontmost window |
| **Paste as Plain Text** | Small | PT | Strip formatting on paste (global shortcut) |

### Tier 3: Large / complex

| Feature | Effort | Reference | Notes |
|---|---|---|---|
| **FancyZones / Window layouts** | Large | PT | Custom zone grid layout manager |
| **Keyboard Manager** | Large | PT | System-wide key remapping |
| **Video Conference Mute** | Medium | PT | Global mic/camera toggle overlay |
| **Workspaces** | Large | PT | Save/restore app window layouts |
| **Screen Ruler** | Medium | PT | Pixel measurement tool |
| **Calendar integration** | Medium | Raycast | Show today's events from Google/Outlook |
| **Contacts** | Medium | Raycast | Search system/Google contacts |
| **Raycast for Teams (multi-user sync)** | Large | Raycast | Shared snippets/quicklinks per org |

---

## 5. TESTING CHECKLIST

Use this section when running through each feature manually.

### How to run the dev build
```
npm run dev
```
(inside `C:\Users\elice\OneDrive\Desktop\SuperCmd\SuperCmd`)

### Core launcher
- [ ] Open with `Ctrl+Space`
- [ ] Close with `Escape` or `Ctrl+Space`
- [ ] Type to search — results appear instantly
- [ ] Arrow keys navigate up/down
- [ ] Enter executes selected command
- [ ] Tab opens AI chat
- [ ] `Cmd+K` opens action panel for selected command
- [ ] Pin command with `Cmd+Shift+P`
- [ ] Disable command with `Cmd+Shift+D`

### Built-in utilities (new — all need testing)
- [ ] **Pick Color** — search "color", press Enter → color dialog opens → pick → hex in clipboard
- [ ] **Calculator** — search "calculator", press Enter → search clears → type `5 * 8` → shows `40` below
- [ ] **Calculator inline** — type `10 km in miles` directly → shows result card
- [ ] **Toggle Dark/Light Mode** — search "dark", press Enter → system theme flips
- [ ] **Awake** — search "awake", press Enter → subtitle shows "Active" → run again → subtitle returns to "Keep display awake"
- [ ] **Hosts File Editor** — search "hosts", press Enter → UAC prompt → Notepad opens with hosts file
- [ ] **Environment Variables** — search "env", press Enter → Environment Variables dialog opens
- [ ] **Shortcut Guide** — search "shortcut", press Enter → overlay appears with keyboard shortcuts → Escape closes

### Windows Settings panels
- [ ] Search "display" → "Display" result appears → Enter → Windows Display settings opens
- [ ] Search "bluetooth" → Opens Bluetooth settings
- [ ] Search "wifi" → Opens Wi-Fi settings
- [ ] (spot-check 5 more from the list)

### App launch
- [ ] Type an app name (e.g. "notepad") → app appears → Enter → opens
- [ ] App icon shows (not blank)

### Clipboard Manager
- [ ] Copy several items to clipboard
- [ ] Search "clipboard" → open Clipboard Manager
- [ ] Items appear in list
- [ ] Click an item or press Enter → item copied to clipboard
- [ ] Delete item with `Cmd+Delete`

### Snippets
- [ ] Search "create snippet" → snippet creator opens
- [ ] Type keyword + content → save
- [ ] Search "search snippets" → snippet list appears
- [ ] Expand snippet in a text field

### AI Chat
- [ ] Type a query → press Tab → AI chat opens
- [ ] Response streams in
- [ ] Follow-up questions work

### Whisper Dictation
- [ ] Hold configured hotkey (default `Fn`) → listening state → speak → text typed into focused app

### Text-to-Speech
- [ ] Select text in any app → search "read" → Enter → text is read aloud

### Script Commands
- [ ] Search "create script" → opens script template in editor
- [ ] Add a sample script with `# @raycast.title` metadata
- [ ] Script appears in launcher and executes

### Extensions
- [ ] Open Extension Store → browse extensions
- [ ] Install an extension → its commands appear in launcher
- [ ] Execute an extension command → renders correctly
