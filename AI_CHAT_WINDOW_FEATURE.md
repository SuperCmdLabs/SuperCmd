# AI Chat Window — Feature Execution Plan

## Overview

Add a full ChatGPT-like chat experience to SuperCmd. After getting an AI response in the launcher's inline AI panel, the user can click "Continue in Chat" in the bottom action bar. This opens a dedicated detached Electron window with:

- **Left sidebar**: List of all past conversations (searchable, with timestamps)
- **Right chat area**: Multi-turn message thread with rendered markdown
- **Bottom input box**: Text input to continue the conversation (like ChatGPT)
- **Persistent history**: All conversations saved to disk and survive app restarts
- **Session continuity**: Conversations maintain context via full message history sent to the Responses API with `prompt_cache_key` for efficient caching

---

## Architecture Reference

### How Notes Detached Window Works (pattern to follow)

The Notes feature is a full Electron `BrowserWindow` managed by the main process:

1. **Window creation** in `main.ts`: `new BrowserWindow(config)` with `titleBarStyle: 'hiddenInset'`, `vibrancy: 'hud'`, `alwaysOnTop: true`, transparent background
2. **Singleton pattern**: Only one Notes window at a time. If already open, reuses via IPC `notes-mode-changed`
3. **Separate app entry**: `NotesApp.tsx` is the root React component for the Notes window, loaded via URL hash `/notes?mode=...`
4. **Data persistence**: `notes-store.ts` in main process — JSON file at `{userData}/notes/notes.json`, in-memory cache, CRUD via IPC
5. **IPC bridge**: Dedicated channels (`note-get-all`, `note-create`, `note-update`, etc.) exposed via `preload.ts`
6. **Liquid Glass styling**: `applyLiquidGlassToWindow()` for macOS vibrancy

### How ChatMock Handles Multi-Turn Conversations

ChatMock is a **stateless proxy**. Multi-turn works by:

1. **Full history per request**: Each API call includes the ENTIRE conversation in `input_items` — all user messages AND all assistant responses
2. **Session IDs for caching**: `prompt_cache_key` is a SHA256 hash of `(instructions + first user message)`. Same prefix = cache hit at OpenAI, reducing latency and cost
3. **No previous_response_id**: The Responses API does NOT use delta references. Full context is resent every turn
4. **Message format**: Each message is `{type: "message", role: "user"|"assistant", content: [{type: "input_text"|"output_text", text: "..."}]}`

### Current AI Chat (what exists today)

- **Single-turn only**: Each query clears previous response, no history
- **Inline in launcher**: Replaces main view via `aiMode` flag
- **Footer is informational**: Just "Enter / Ask" and "Esc / Back" hints — no action buttons
- **No markdown rendering**: Plain text with `white-space: pre-wrap`
- **Streaming**: Real-time via IPC request ID routing (`ai-stream-chunk/done/error`)

---

## Implementation Plan

### Phase 1: Conversation Data Model & Persistence (Main Process)

#### 1.1 Create `src/main/ai-chat-store.ts`

Follows the same pattern as `notes-store.ts`.

**Storage location**: `{userData}/ai-chats/conversations.json`

**Data model**:

```typescript
interface ChatMessage {
  id: string;                    // UUID
  role: 'user' | 'assistant';
  content: string;               // markdown text
  timestamp: number;             // ms since epoch
}

interface Conversation {
  id: string;                    // UUID
  title: string;                 // auto-generated from first user message (first ~50 chars)
  messages: ChatMessage[];
  model: string;                 // e.g. 'chatgpt-gpt-5', 'openai-gpt-4o'
  provider: string;              // e.g. 'chatgpt-account', 'openai'
  systemPrompt?: string;         // system prompt used (if any)
  sessionId: string;             // SHA256 fingerprint for prompt caching (from instructions + first message)
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}
```

**Functions to implement**:

| Function | Purpose |
|----------|---------|
| `getAllConversations()` | Return all conversations sorted by `updatedAt` desc, pinned first |
| `getConversation(id)` | Return single conversation by ID |
| `createConversation(data)` | Create with first user message, auto-generate title |
| `updateConversation(id, patch)` | Update title, add messages, pin/unpin |
| `deleteConversation(id)` | Remove conversation |
| `deleteAllConversations()` | Clear all history |
| `addMessage(conversationId, message)` | Append a message and update `updatedAt` |
| `searchConversations(query)` | Search by title and message content |

**Title generation**: Take first user message, truncate to ~50 chars, strip markdown. Example: `"How do I implement OAuth in Node.js?"` → `"How do I implement OAuth in Node.js?"`

**Session ID generation** (matches ChatMock's `session.py`):
```typescript
function generateSessionId(systemPrompt: string | undefined, firstUserMessage: string): string {
  const canonical = JSON.stringify({
    instructions: systemPrompt || '',
    firstMessage: firstUserMessage.slice(0, 1000),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
```

This ensures the same conversation always sends the same `prompt_cache_key`, enabling OpenAI's server-side prompt caching.

---

#### 1.2 Create multi-turn streaming IPC handler

Add a new IPC channel `ai-chat-send` that:
1. Accepts `{ conversationId, message, model?, systemPrompt? }`
2. Loads conversation history from store
3. Converts ALL messages to the provider's format (for ChatGPT Account: Responses API `input_items`)
4. Streams response via `ai-chat-stream-chunk/done/error` events (separate channels from the inline AI to avoid routing conflicts)
5. After stream completes, saves both user message and assistant response to the conversation store

**Why a separate handler from `ai-ask`?**
- `ai-ask` is single-turn (prompt string only, no history)
- `ai-chat-send` is multi-turn (loads full conversation, converts to appropriate format)
- Separate stream channels prevent cross-talk with inline AI and cursor prompt

**Multi-turn message conversion for each provider**:

| Provider | Conversion |
|----------|------------|
| `chatgpt-account` | Convert to Responses API `input_items` format: `{type: "message", role, content: [{type: "input_text"/"output_text", text}]}` with `prompt_cache_key: sessionId` |
| `openai` | Standard OpenAI chat format: `{role, content}` array |
| `anthropic` | Anthropic messages format: `{role, content}` with `system` field |
| `gemini` | Gemini `contents` array: `{role: "user"/"model", parts: [{text}]}` |
| `ollama` | Ollama `/api/chat` format: `{messages: [{role, content}]}` |
| `openai-compatible` | Same as OpenAI format |

**For ChatGPT Account specifically** — update `src/main/chatgpt-upstream.ts`:

The current `streamChatGPTAccount()` only takes a single `prompt` string. Create a new function:

```typescript
export async function* streamChatGPTAccountMultiTurn(
  modelId: string,
  messages: Array<{role: 'user' | 'assistant', content: string}>,
  systemPrompt?: string,
  sessionId?: string,
  signal?: AbortSignal
): AsyncGenerator<string>
```

This converts the full message array to `input_items` format (matching `convert_chat_messages_to_responses_input()` from ChatMock's `utils.py`):

```typescript
function convertMessagesToResponsesInput(
  messages: Array<{role: string, content: string}>
): ResponsesInput[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      type: 'message',
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{
        type: m.role === 'assistant' ? 'output_text' : 'input_text',
        text: m.content,
      }],
    }));
}
```

The payload includes:
- `instructions`: system prompt (or default)
- `input`: full message history converted to Responses format
- `prompt_cache_key`: `sessionId` (constant for the conversation's lifetime)
- `session_id` header: same value

---

### Phase 2: IPC Bridge & Preload (Main Process)

#### 2.1 Add IPC handlers to `src/main/main.ts`

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `ai-chat-get-all` | renderer → main | Get all conversations |
| `ai-chat-get` | renderer → main | Get single conversation |
| `ai-chat-create` | renderer → main | Create conversation with first message |
| `ai-chat-update` | renderer → main | Update conversation metadata (title, pin) |
| `ai-chat-delete` | renderer → main | Delete conversation |
| `ai-chat-delete-all` | renderer → main | Delete all conversations |
| `ai-chat-search` | renderer → main | Search conversations |
| `ai-chat-send` | renderer → main | Send message in conversation (triggers streaming) |
| `ai-chat-cancel` | renderer → main | Cancel in-flight stream |
| `ai-chat-stream-chunk` | main → renderer | Push text chunk |
| `ai-chat-stream-done` | main → renderer | Stream completed |
| `ai-chat-stream-error` | main → renderer | Stream error |
| `open-ai-chat-window` | renderer → main | Open/focus the AI chat window |

#### 2.2 Update `src/main/preload.ts`

Expose all new IPC methods under `window.electron`:

```typescript
// AI Chat Window
aiChatGetAll: () => Promise<Conversation[]>
aiChatGet: (id: string) => Promise<Conversation | null>
aiChatCreate: (data: { message: string; model?: string; systemPrompt?: string }) => Promise<Conversation>
aiChatUpdate: (id: string, patch: Partial<Conversation>) => Promise<Conversation | null>
aiChatDelete: (id: string) => Promise<boolean>
aiChatDeleteAll: () => Promise<number>
aiChatSearch: (query: string) => Promise<Conversation[]>
aiChatSend: (requestId: string, conversationId: string, message: string) => Promise<void>
aiChatCancel: (requestId: string) => Promise<void>
openAiChatWindow: (conversationId?: string) => Promise<void>
onAiChatStreamChunk: (callback: (data: { requestId: string; chunk: string }) => void) => void
onAiChatStreamDone: (callback: (data: { requestId: string }) => void) => void
onAiChatStreamError: (callback: (data: { requestId: string; error: string }) => void) => void
onAiChatConversationChanged: (callback: (conversationId: string) => void) => () => void
```

#### 2.3 Update `src/renderer/types/electron.d.ts`

Add type declarations for `Conversation`, `ChatMessage`, and all new bridge methods.

---

### Phase 3: AI Chat Detached Window (Main Process)

#### 3.1 Add window management to `src/main/main.ts`

Follow the Notes window pattern:

```typescript
let aiChatWindow: BrowserWindow | null = null;
let pendingAiChatConversationId: string | null = null;

function openAiChatWindow(conversationId?: string) {
  if (aiChatWindow && !aiChatWindow.isDestroyed()) {
    aiChatWindow.focus();
    if (conversationId) {
      pendingAiChatConversationId = conversationId;
      aiChatWindow.webContents.send('ai-chat-open-conversation', conversationId);
    }
    return;
  }

  // Create new BrowserWindow
  aiChatWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 450,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#00000000',
    transparent: true,
    vibrancy: 'hud',
    hasShadow: false,
    alwaysOnTop: false,  // Chat window should NOT be always-on-top (unlike Notes)
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
    },
  });

  // Load the AI chat app
  aiChatWindow.loadURL(`${mainWindowUrl}#/ai-chat?conversationId=${conversationId || ''}`);

  // Apply liquid glass
  applyLiquidGlassToWindow(aiChatWindow, { cornerRadius: 14, fallbackVibrancy: 'hud' });

  aiChatWindow.on('closed', () => {
    aiChatWindow = null;
  });
}
```

**Key differences from Notes window**:
- Wider default size (900x650 vs 520x420) — chat needs more horizontal space for sidebar + content
- `alwaysOnTop: false` — user might keep it open while working
- URL hash `#/ai-chat` instead of `#/notes`

---

### Phase 4: AI Chat Window UI (Renderer)

#### 4.1 Create `src/renderer/src/AiChatApp.tsx`

Root component for the AI chat window (like `NotesApp.tsx`).

**Responsibilities**:
- Load settings (fontSize, uiStyle, baseColor) on mount
- Listen for settings updates
- Apply glass-effect container styling
- Render `AiChatManager`

#### 4.2 Create `src/renderer/src/views/AiChatManager.tsx`

Main state machine with two panels.

**Layout** (CSS Grid or Flexbox):
```
┌──────────────────────────────────────────────────────┐
│ [traffic light padding]              AI Chat          │
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│  Sidebar     │  Chat Area                            │
│  (240px)     │                                       │
│              │  ┌───────────────────────────────────┐│
│  [+ New]     │  │ User message bubble               ││
│              │  │ Assistant response (markdown)      ││
│  Conv 1  ●   │  │ User message bubble               ││
│  Conv 2      │  │ Assistant response (streaming...)  ││
│  Conv 3      │  │                                    ││
│  ...         │  └───────────────────────────────────┘│
│              │                                       │
│              │  ┌───────────────────────────────────┐│
│              │  │ Type a message...          [Send]  ││
│              │  └───────────────────────────────────┘│
├──────────────┴───────────────────────────────────────┤
│ Model: GPT-5 ▾                          ⚙ Settings   │
└──────────────────────────────────────────────────────┘
```

#### 4.3 Sidebar Component

**Features**:
- "New Chat" button at top
- Search input to filter conversations
- Scrollable list of conversations sorted by `updatedAt` desc (pinned first)
- Each item shows: title (truncated), timestamp (relative: "2 min ago", "Yesterday"), unread indicator
- Click to switch conversation
- Right-click context menu: Rename, Pin/Unpin, Delete
- Active conversation highlighted

#### 4.4 Chat Area Component

**Features**:
- Message list with user/assistant bubbles
  - User messages: right-aligned, accent background
  - Assistant messages: left-aligned, subtle background, **rendered as markdown** (use existing `renderSimpleMarkdown` from `detail-markdown.tsx`)
- Auto-scroll to bottom on new messages
- Streaming indicator (pulsing dots) when assistant is responding
- Empty state: "Start a new conversation" prompt

**Input box at bottom**:
- Multi-line textarea (auto-grows, max ~4 lines, then scrolls)
- Enter to send, Shift+Enter for new line
- Send button on right
- Disabled while streaming
- Focus on mount and after each response completes

**Model selector in footer**:
- Dropdown showing current model
- Can switch models mid-conversation (new messages use new model)

---

### Phase 5: "Continue in Chat" Action (Launcher Integration)

#### 5.1 Update `src/renderer/src/views/AiChatView.tsx`

Add a "Continue in Chat" button to the footer action bar:

```tsx
<div className="sc-glass-footer px-4 py-2.5 flex items-center justify-between">
  <span className="text-xs text-[var(--text-subtle)]">
    {aiStreaming ? 'Streaming...' : 'AI Response'}
  </span>
  <div className="flex items-center gap-3">
    {!aiStreaming && aiResponse && (
      <button
        onClick={handleContinueInChat}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--accent)] ..."
      >
        <MessageSquare className="w-3 h-3" />
        Continue in Chat
      </button>
    )}
    <div className="flex items-center gap-2 text-xs text-[var(--text-subtle)]">
      <kbd>Enter</kbd> <span>Ask</span>
      <kbd>Esc</kbd> <span>Back</span>
    </div>
  </div>
</div>
```

#### 5.2 "Continue in Chat" handler

```typescript
const handleContinueInChat = async () => {
  // 1. Create a new conversation with the current Q&A
  const conversation = await window.electron.aiChatCreate({
    message: aiQuery,
  });
  // 2. Add the assistant response as a message
  await window.electron.aiChatAddMessage(conversation.id, {
    role: 'assistant',
    content: aiResponse,
  });
  // 3. Open the AI Chat window focused on this conversation
  await window.electron.openAiChatWindow(conversation.id);
  // 4. Hide launcher
  window.electron.hideWindow();
  // 5. Exit AI mode
  exitAiMode();
};
```

---

### Phase 6: Multi-Turn Streaming for All Providers

#### 6.1 Update `src/main/ai-provider.ts`

Add a new multi-turn streaming function:

```typescript
export async function* streamAIMultiTurn(
  config: AISettings,
  messages: Array<{role: 'user' | 'assistant', content: string}>,
  options: {
    model?: string;
    systemPrompt?: string;
    sessionId?: string;
    signal?: AbortSignal;
  }
): AsyncGenerator<string>
```

This function routes to provider-specific multi-turn implementations:

| Provider | Multi-turn approach |
|----------|-------------------|
| `chatgpt-account` | `streamChatGPTAccountMultiTurn()` — converts to Responses API `input_items` with `prompt_cache_key` |
| `openai` | Standard `/v1/chat/completions` with `messages` array |
| `anthropic` | `/v1/messages` with `messages` array + `system` field |
| `gemini` | `generateContent` with `contents` array (role: user/model) |
| `ollama` | `/api/chat` with `messages` array |
| `openai-compatible` | Same as OpenAI |

For providers other than `chatgpt-account`, multi-turn is straightforward — just pass the full `messages` array instead of a single prompt.

#### 6.2 Update `src/main/chatgpt-upstream.ts`

Add `streamChatGPTAccountMultiTurn()`:

```typescript
export async function* streamChatGPTAccountMultiTurn(
  modelId: string,
  messages: Array<{role: 'user' | 'assistant', content: string}>,
  systemPrompt?: string,
  sessionId?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const tokens = await loadChatGPTTokens();
  if (!tokens) throw new Error('ChatGPT session expired...');

  const modelConfig = CHATGPT_MODELS[modelId] || { upstreamId: modelId };
  const inputItems = convertMessagesToResponsesInput(messages);
  const effectiveSessionId = sessionId || generateSessionId(systemPrompt, messages[0]?.content || '');

  const payload = {
    model: modelConfig.upstreamId,
    instructions: systemPrompt || 'You are a helpful assistant.',
    input: inputItems,
    store: false,
    stream: true,
    prompt_cache_key: effectiveSessionId,
    // reasoning config if applicable...
  };

  // POST to Responses API with session_id header
  // Parse SSE stream, yield text deltas
}
```

**Message conversion** (port from `ChatMock/chatmock/utils.py:convert_chat_messages_to_responses_input`):

```typescript
function convertMessagesToResponsesInput(
  messages: Array<{role: string, content: string}>
): ResponsesInput[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      type: 'message',
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{
        type: m.role === 'assistant' ? 'output_text' : 'input_text',
        text: m.content,
      }],
    }));
}
```

---

### Phase 7: Session Continuity & Prompt Caching

**How session continuity works (matching ChatMock)**:

1. When a conversation is created, a `sessionId` is computed from `SHA256(instructions + first_user_message)` and stored in the `Conversation` record
2. Every subsequent turn in that conversation sends the same `prompt_cache_key: sessionId` and `session_id` header
3. OpenAI's Responses API caches the prompt prefix server-side, so repeated turns are faster and cheaper
4. The full message history is always sent (not deltas), but the cached prefix means only new tokens are processed

**This matches ChatMock's `session.py` approach exactly.**

---

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/main/ai-chat-store.ts` | **New** | Conversation persistence (CRUD, JSON file, in-memory cache) |
| `src/main/chatgpt-upstream.ts` | Edit | Add `streamChatGPTAccountMultiTurn()`, `convertMessagesToResponsesInput()` |
| `src/main/ai-provider.ts` | Edit | Add `streamAIMultiTurn()` router for all providers |
| `src/main/main.ts` | Edit | Add AI chat window management + IPC handlers (13 new channels) |
| `src/main/preload.ts` | Edit | Expose AI chat IPC methods |
| `src/renderer/types/electron.d.ts` | Edit | Add `Conversation`, `ChatMessage` types and bridge method declarations |
| `src/renderer/src/AiChatApp.tsx` | **New** | Root component for AI chat detached window |
| `src/renderer/src/views/AiChatManager.tsx` | **New** | Sidebar + chat area layout, conversation switching, streaming state |
| `src/renderer/src/views/AiChatView.tsx` | Edit | Add "Continue in Chat" button to footer action bar |
| `src/renderer/src/hooks/useAiChat.ts` | Edit | Add `handleContinueInChat` callback |

---

## Implementation Order

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 6 ──► Phase 4 ──► Phase 5 ──► Phase 7
  Store       IPC         Window     Multi-turn    UI        Launcher     Session
                                     Streaming               Integration  Caching
```

**Recommended build order**:

1. `ai-chat-store.ts` — get persistence working (test via manual IPC calls)
2. `chatgpt-upstream.ts` — add multi-turn streaming + message conversion
3. `ai-provider.ts` — add `streamAIMultiTurn()` for all providers
4. `main.ts` + `preload.ts` + `electron.d.ts` — wire up all IPC channels
5. `main.ts` — add AI chat window creation (follow Notes pattern)
6. `AiChatApp.tsx` + `AiChatManager.tsx` — build the detached window UI
7. `AiChatView.tsx` + `useAiChat.ts` — add "Continue in Chat" action
8. Test end-to-end: inline AI → Continue in Chat → multi-turn conversation

---

## Edge Cases & Considerations

### Conversation Size
- Conversations grow unbounded. For very long conversations, the full history sent to the API may exceed context limits
- **v1**: No trimming. Let the API return errors for too-long contexts, surface as error message
- **v2**: Implement a sliding window or summarization strategy

### Provider Switching
- A conversation stores its original `provider` and `model`
- If user switches provider in settings, existing conversations continue with their original provider
- New conversations use the current provider
- If the original provider credentials are removed, show an error when trying to continue

### Concurrent Streams
- Only one stream per conversation at a time
- Use `activeAiChatRequests: Map<requestId, AbortController>` (separate from inline AI map)
- Cancel in-flight when user sends a new message

### Window Lifecycle
- Singleton: only one AI chat window at a time
- Not always-on-top (unlike Notes) — user may keep it open alongside other apps
- Closing the window does NOT delete conversations
- Re-opening the window restores last-viewed conversation

### Offline / Credential Expiry
- If ChatGPT tokens expire mid-conversation, auto-refresh transparently (already implemented in `loadChatGPTTokens`)
- If refresh fails, show "Session expired. Please sign in again." with a button to open Settings

### Memory Integration
- The existing `buildMemoryContextSystemPrompt()` from `memory.ts` is called in the `ai-ask` handler
- Apply the same memory context injection in the `ai-chat-send` handler
- Memory context appended to the system prompt, enhancing all multi-turn responses

---

## Testing Checklist

- [ ] Create new conversation from chat window
- [ ] Multi-turn: send 3+ messages, verify full context is maintained
- [ ] "Continue in Chat" from inline AI creates conversation with Q&A preserved
- [ ] Sidebar lists all conversations in correct order
- [ ] Search conversations by title and content
- [ ] Rename, pin, delete conversations
- [ ] Streaming works with animated loading indicator
- [ ] Markdown renders correctly in assistant responses (code blocks, bold, lists)
- [ ] Session ID stays constant across turns (verify via logging)
- [ ] Prompt caching works (verify 2nd turn is faster than 1st)
- [ ] Works with all providers: ChatGPT Account, OpenAI, Anthropic, Gemini, Ollama
- [ ] Window opens/closes/reopens correctly (singleton)
- [ ] Conversations persist across app restarts
- [ ] Long conversations don't crash (context limit error handled gracefully)
- [ ] Cancel in-flight stream works
- [ ] Model selector changes model for subsequent messages
- [ ] Empty state shows "Start a new conversation" prompt
- [ ] Keyboard shortcuts: Enter to send, Shift+Enter for newline, Escape to close input
