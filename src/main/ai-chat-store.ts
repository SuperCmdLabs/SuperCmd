import { app } from 'electron';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface AiChatMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  cancelled?: boolean;
}

export interface AiChatConversationRecord {
  id: string;
  title: string;
  messages: AiChatMessageRecord[];
  createdAt: number;
  updatedAt: number;
  source?: 'local' | 'raycast';
  sourceConversationId?: string;
  metadata?: Record<string, any>;
}

export interface AiChatStoreData {
  version: 1;
  conversations: AiChatConversationRecord[];
}

const DEFAULT_STORE: AiChatStoreData = {
  version: 1,
  conversations: [],
};

let cache: AiChatStoreData | null = null;

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'ai-chat-conversations.json');
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e11) return Math.round(value);
    if (value > 1e9) return Math.round(value * 1000);
    if (value > 5e8) return Math.round((value + 978307200) * 1000);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      const parsedNumber = Number(trimmed);
      if (Number.isFinite(parsedNumber)) {
        return normalizeTimestamp(parsedNumber, fallback);
      }
      const parsedDate = Date.parse(trimmed);
      if (Number.isFinite(parsedDate)) return parsedDate;
    }
  }
  return fallback;
}

function normalizeMessage(value: unknown, index: number, fallbackTimestamp: number): AiChatMessageRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, any>;
  const content = typeof raw.content === 'string' ? raw.content : '';
  if (!content.trim()) return null;
  const role = raw.role === 'user' ? 'user' : 'assistant';
  const createdAt = normalizeTimestamp(raw.createdAt, fallbackTimestamp + index);
  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id.trim()
    : `msg-${createdAt}-${index}-${createHash('sha1').update(`${role}:${content}`).digest('hex').slice(0, 8)}`;
  return {
    id,
    role,
    content,
    createdAt,
    ...(raw.cancelled ? { cancelled: true } : {}),
  };
}

function stableConversationId(raw: {
  id?: unknown;
  source?: unknown;
  sourceConversationId?: unknown;
  title?: unknown;
  messages?: Array<{ role: string; content: string }>;
}): string {
  const provided = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (provided) return provided;
  const source = typeof raw.source === 'string' ? raw.source.trim() : '';
  const sourceConversationId = typeof raw.sourceConversationId === 'string' ? raw.sourceConversationId.trim() : '';
  if (source && sourceConversationId) {
    return `${source}-${sourceConversationId}`;
  }
  const title = typeof raw.title === 'string' ? raw.title.trim() : 'Imported Chat';
  const body = JSON.stringify({
    source,
    sourceConversationId,
    title,
    messages: Array.isArray(raw.messages) ? raw.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })) : [],
  });
  return `conv-${createHash('sha1').update(body).digest('hex').slice(0, 16)}`;
}

function normalizeConversation(value: unknown): AiChatConversationRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, any>;
  const now = Date.now();
  const normalizedMessages = Array.isArray(raw.messages)
    ? raw.messages
        .map((message, index) => normalizeMessage(message, index, now))
        .filter((message): message is AiChatMessageRecord => Boolean(message))
    : [];
  if (normalizedMessages.length === 0) return null;
  const createdAt = normalizeTimestamp(
    raw.createdAt,
    normalizedMessages[0]?.createdAt || now
  );
  const updatedAt = normalizeTimestamp(
    raw.updatedAt,
    normalizedMessages[normalizedMessages.length - 1]?.createdAt || createdAt
  );
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim()
    : 'New Chat';
  const source = raw.source === 'raycast' ? 'raycast' : raw.source === 'local' ? 'local' : undefined;
  const sourceConversationId = typeof raw.sourceConversationId === 'string' && raw.sourceConversationId.trim()
    ? raw.sourceConversationId.trim()
    : undefined;
  const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
    ? { ...(raw.metadata as Record<string, any>) }
    : undefined;
  return {
    id: stableConversationId({
      id: raw.id,
      source,
      sourceConversationId,
      title,
      messages: normalizedMessages,
    }),
    title,
    messages: normalizedMessages,
    createdAt,
    updatedAt,
    ...(source ? { source } : {}),
    ...(sourceConversationId ? { sourceConversationId } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeStore(value: unknown): AiChatStoreData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_STORE, conversations: [] };
  }
  const raw = value as Partial<AiChatStoreData>;
  const conversations = Array.isArray(raw.conversations)
    ? raw.conversations
        .map((conversation) => normalizeConversation(conversation))
        .filter((conversation): conversation is AiChatConversationRecord => Boolean(conversation))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    : [];
  return {
    version: 1,
    conversations,
  };
}

function loadStore(): AiChatStoreData {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    cache = normalizeStore(JSON.parse(raw));
  } catch {
    cache = normalizeStore(DEFAULT_STORE);
  }
  return cache;
}

function saveStore(next: AiChatStoreData): void {
  cache = {
    version: 1,
    conversations: [...next.conversations].sort((a, b) => b.updatedAt - a.updatedAt),
  };
  fs.writeFileSync(getStorePath(), JSON.stringify(cache, null, 2), 'utf8');
}

function mergeConversation(existing: AiChatConversationRecord | undefined, incoming: AiChatConversationRecord): AiChatConversationRecord {
  if (!existing) return incoming;
  if (incoming.updatedAt > existing.updatedAt) return incoming;
  if (incoming.updatedAt < existing.updatedAt) return existing;
  if (incoming.messages.length > existing.messages.length) return incoming;
  return existing;
}

export function getAiChatSnapshot(): AiChatStoreData {
  const store = loadStore();
  return {
    version: 1,
    conversations: store.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message })),
      ...(conversation.metadata ? { metadata: { ...conversation.metadata } } : {}),
    })),
  };
}

export function upsertAiChatConversation(conversation: unknown): AiChatConversationRecord | null {
  const normalized = normalizeConversation(conversation);
  if (!normalized) return null;
  const store = loadStore();
  const nextConversations = store.conversations.filter((entry) => entry.id !== normalized.id);
  nextConversations.unshift(normalized);
  saveStore({ version: 1, conversations: nextConversations });
  return normalized;
}

export function deleteAiChatConversation(id: string): boolean {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return false;
  const store = loadStore();
  const nextConversations = store.conversations.filter((conversation) => conversation.id !== normalizedId);
  if (nextConversations.length === store.conversations.length) return false;
  saveStore({ version: 1, conversations: nextConversations });
  return true;
}

export function mergeAiChatSnapshot(snapshot: Partial<AiChatStoreData>): AiChatStoreData {
  const store = loadStore();
  const incoming = normalizeStore(snapshot);
  const mergedById = new Map<string, AiChatConversationRecord>();
  for (const conversation of store.conversations) {
    mergedById.set(conversation.id, conversation);
  }
  for (const conversation of incoming.conversations) {
    mergedById.set(
      conversation.id,
      mergeConversation(mergedById.get(conversation.id), conversation)
    );
  }
  const next = {
    version: 1 as const,
    conversations: [...mergedById.values()].sort((a, b) => b.updatedAt - a.updatedAt),
  };
  saveStore(next);
  return getAiChatSnapshot();
}
