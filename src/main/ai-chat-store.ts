/**
 * AI Chat Store
 *
 * Persistent storage for AI chat conversations.
 * Stored at ~/Library/Application Support/SuperCmd/ai-chats/conversations.json
 * Follows the same pattern as notes-store.ts.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  provider: string;
  systemPrompt?: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

// ─── Cache ──────────────────────────────────────────────────────────

let conversationsCache: Conversation[] | null = null;

// ─── Paths ──────────────────────────────────────────────────────────

function getStoreDir(): string {
  const dir = path.join(app.getPath('userData'), 'ai-chats');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getStoreFilePath(): string {
  return path.join(getStoreDir(), 'conversations.json');
}

// ─── Persistence ────────────────────────────────────────────────────

function loadFromDisk(): Conversation[] {
  try {
    const filePath = getStoreFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          id: String(item.id || crypto.randomUUID()),
          title: String(item.title || 'New Chat'),
          messages: Array.isArray(item.messages) ? item.messages.map((m: any) => ({
            id: String(m.id || crypto.randomUUID()),
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || ''),
            timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
          })) : [],
          model: String(item.model || ''),
          provider: String(item.provider || ''),
          systemPrompt: typeof item.systemPrompt === 'string' ? item.systemPrompt : undefined,
          sessionId: String(item.sessionId || ''),
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
          pinned: Boolean(item.pinned),
        }));
      }
    }
  } catch (e) {
    console.error('[AI Chat Store] Failed to load from disk:', e);
  }
  return [];
}

function saveToDisk(): void {
  try {
    const filePath = getStoreFilePath();
    fs.writeFileSync(filePath, JSON.stringify(conversationsCache || [], null, 2));
  } catch (e) {
    console.error('[AI Chat Store] Failed to save to disk:', e);
  }
}

function ensureLoaded(): Conversation[] {
  if (!conversationsCache) {
    conversationsCache = loadFromDisk();
  }
  return conversationsCache;
}

// ─── Session ID ─────────────────────────────────────────────────────

export function generateConversationSessionId(
  systemPrompt: string | undefined,
  firstUserMessage: string
): string {
  const canonical = JSON.stringify({
    instructions: systemPrompt || '',
    firstMessage: firstUserMessage.slice(0, 1000),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

// ─── Title generation ───────────────────────────────────────────────

function generateTitle(message: string): string {
  const cleaned = message
    .replace(/[#*_~`>\[\]()!]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  if (cleaned.length <= 60) return cleaned || 'New Chat';
  return cleaned.slice(0, 57) + '...';
}

// ─── Public API ─────────────────────────────────────────────────────

export function initAiChatStore(): void {
  ensureLoaded();
}

export function getAllConversations(): Conversation[] {
  const convos = ensureLoaded();
  return [...convos].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function getConversation(id: string): Conversation | null {
  const convos = ensureLoaded();
  return convos.find((c) => c.id === id) || null;
}

export function createConversation(data: {
  firstMessage: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
}): Conversation {
  const convos = ensureLoaded();
  const now = Date.now();
  const id = crypto.randomUUID();
  const sessionId = generateConversationSessionId(data.systemPrompt, data.firstMessage);

  const firstMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: data.firstMessage,
    timestamp: now,
  };

  const conversation: Conversation = {
    id,
    title: generateTitle(data.firstMessage),
    messages: [firstMsg],
    model: data.model || '',
    provider: data.provider || '',
    systemPrompt: data.systemPrompt,
    sessionId,
    createdAt: now,
    updatedAt: now,
    pinned: false,
  };

  convos.unshift(conversation);
  saveToDisk();
  return conversation;
}

export function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, 'title' | 'pinned' | 'model' | 'provider'>>
): Conversation | null {
  const convos = ensureLoaded();
  const convo = convos.find((c) => c.id === id);
  if (!convo) return null;

  if (patch.title !== undefined) convo.title = patch.title;
  if (patch.pinned !== undefined) convo.pinned = patch.pinned;
  if (patch.model !== undefined) convo.model = patch.model;
  if (patch.provider !== undefined) convo.provider = patch.provider;
  convo.updatedAt = Date.now();

  saveToDisk();
  return convo;
}

export function addMessageToConversation(
  conversationId: string,
  message: { role: 'user' | 'assistant'; content: string }
): ChatMessage | null {
  const convos = ensureLoaded();
  const convo = convos.find((c) => c.id === conversationId);
  if (!convo) return null;

  const msg: ChatMessage = {
    id: crypto.randomUUID(),
    role: message.role,
    content: message.content,
    timestamp: Date.now(),
  };

  convo.messages.push(msg);
  convo.updatedAt = Date.now();
  saveToDisk();
  return msg;
}

export function deleteConversation(id: string): boolean {
  const convos = ensureLoaded();
  const idx = convos.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  convos.splice(idx, 1);
  saveToDisk();
  return true;
}

export function deleteAllConversations(): number {
  const convos = ensureLoaded();
  const count = convos.length;
  conversationsCache = [];
  saveToDisk();
  return count;
}

export function searchConversations(query: string): Conversation[] {
  if (!query.trim()) return getAllConversations();
  const q = query.toLowerCase();
  const convos = ensureLoaded();
  return convos
    .filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q))
    )
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}
