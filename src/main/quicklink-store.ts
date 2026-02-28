/**
 * Quick Link Store
 *
 * Persists user-defined quick links and resolves URL templates.
 */

import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractSnippetDynamicFields,
  getSnippetById,
  getSnippetByKeyword,
  renderSnippetById,
  resolveSnippetPlaceholders,
} from './snippet-store';

export type QuickLinkIcon = string;

export interface QuickLink {
  id: string;
  name: string;
  urlTemplate: string;
  applicationName?: string;
  applicationPath?: string;
  applicationBundleId?: string;
  appIconDataUrl?: string;
  icon: QuickLinkIcon;
  createdAt: number;
  updatedAt: number;
}

export interface QuickLinkDynamicField {
  key: string;
  name: string;
  defaultValue?: string;
}

export const QUICK_LINK_COMMAND_PREFIX = 'quicklink-';

let quickLinksCache: QuickLink[] | null = null;

function normalizeQuickLinkIcon(value: unknown): QuickLinkIcon {
  const normalized = String(value || '').trim();
  if (!normalized) return 'default';

  const legacy = normalized.toLowerCase();
  if (legacy === 'default') return 'default';
  if (legacy === 'link') return 'Link';
  if (legacy === 'globe') return 'Globe';
  if (legacy === 'search') return 'Search';
  if (legacy === 'bolt') return 'Bolt';

  return normalized.slice(0, 80);
}

function normalizeDataUrl(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  if (!normalized.startsWith('data:image/')) return undefined;
  return normalized;
}

function normalizeStoredQuickLink(raw: any): QuickLink | null {
  if (!raw || typeof raw !== 'object') return null;

  const name = String(raw.name || '').trim();
  const urlTemplate = String(raw.urlTemplate ?? raw.url ?? '').trim();
  if (!name || !urlTemplate) return null;

  const id = String(raw.id || crypto.randomUUID()).trim();
  if (!id) return null;

  const now = Date.now();
  const createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : now;
  const updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : createdAt;

  const applicationName = String(raw.applicationName || '').trim() || undefined;
  const applicationPath = String(raw.applicationPath || '').trim() || undefined;
  const applicationBundleId = String(raw.applicationBundleId || '').trim() || undefined;

  return {
    id,
    name,
    urlTemplate,
    applicationName,
    applicationPath,
    applicationBundleId,
    appIconDataUrl: normalizeDataUrl(raw.appIconDataUrl),
    icon: normalizeQuickLinkIcon(raw.icon),
    createdAt,
    updatedAt,
  };
}

function getQuickLinksDir(): string {
  const dir = path.join(app.getPath('userData'), 'quicklinks');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getQuickLinksFilePath(): string {
  return path.join(getQuickLinksDir(), 'quicklinks.json');
}

function loadFromDisk(): QuickLink[] {
  try {
    const filePath = getQuickLinksFilePath();
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeStoredQuickLink(item))
      .filter((item): item is QuickLink => Boolean(item));
  } catch (error) {
    console.error('Failed to load quick links from disk:', error);
    return [];
  }
}

function saveToDisk(): void {
  try {
    const filePath = getQuickLinksFilePath();
    fs.writeFileSync(filePath, JSON.stringify(quickLinksCache || [], null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save quick links to disk:', error);
  }
}

function ensureQuickLinksLoaded(): QuickLink[] {
  if (!quickLinksCache) {
    quickLinksCache = loadFromDisk();
  }
  return quickLinksCache;
}

function normalizeQuickLinkNameInput(value: unknown): string {
  return String(value || '').trim();
}

function normalizeQuickLinkUrlInput(value: unknown): string {
  return String(value || '').trim();
}

function normalizeQuickLinkApplicationNameInput(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function normalizeQuickLinkApplicationPathInput(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function normalizeQuickLinkApplicationBundleIdInput(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

export function initQuickLinkStore(): void {
  quickLinksCache = loadFromDisk();
  console.log(`[QuickLinks] Loaded ${quickLinksCache.length} quick link(s)`);
}

export function getAllQuickLinks(): QuickLink[] {
  const all = ensureQuickLinksLoaded();
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function searchQuickLinks(query: string): QuickLink[] {
  const normalized = String(query || '').trim().toLowerCase();
  const all = getAllQuickLinks();
  if (!normalized) return all;
  return all.filter((quickLink) => {
    return (
      quickLink.name.toLowerCase().includes(normalized) ||
      quickLink.urlTemplate.toLowerCase().includes(normalized) ||
      String(quickLink.applicationName || '').toLowerCase().includes(normalized)
    );
  });
}

export function getQuickLinkById(id: string): QuickLink | null {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  const all = ensureQuickLinksLoaded();
  return all.find((item) => item.id === normalizedId) || null;
}

export function getQuickLinkCommandId(quickLinkId: string): string {
  return `${QUICK_LINK_COMMAND_PREFIX}${String(quickLinkId || '').trim()}`;
}

export function isQuickLinkCommandId(commandId: string): boolean {
  return String(commandId || '').trim().startsWith(QUICK_LINK_COMMAND_PREFIX);
}

export function getQuickLinkByCommandId(commandId: string): QuickLink | null {
  const normalized = String(commandId || '').trim();
  if (!normalized.startsWith(QUICK_LINK_COMMAND_PREFIX)) return null;
  const id = normalized.slice(QUICK_LINK_COMMAND_PREFIX.length).trim();
  if (!id) return null;
  return getQuickLinkById(id);
}

export function createQuickLink(data: {
  name: string;
  urlTemplate: string;
  applicationName?: string;
  applicationPath?: string;
  applicationBundleId?: string;
  appIconDataUrl?: string;
  icon?: QuickLinkIcon;
}): QuickLink {
  const all = ensureQuickLinksLoaded();

  const name = normalizeQuickLinkNameInput(data.name);
  const urlTemplate = normalizeQuickLinkUrlInput(data.urlTemplate);

  if (!name) {
    throw new Error('Quick link name is required.');
  }
  if (!urlTemplate) {
    throw new Error('Quick link URL is required.');
  }

  const now = Date.now();
  const quickLink: QuickLink = {
    id: crypto.randomUUID(),
    name,
    urlTemplate,
    applicationName: normalizeQuickLinkApplicationNameInput(data.applicationName),
    applicationPath: normalizeQuickLinkApplicationPathInput(data.applicationPath),
    applicationBundleId: normalizeQuickLinkApplicationBundleIdInput(data.applicationBundleId),
    appIconDataUrl: normalizeDataUrl(data.appIconDataUrl),
    icon: normalizeQuickLinkIcon(data.icon),
    createdAt: now,
    updatedAt: now,
  };

  all.push(quickLink);
  saveToDisk();
  return { ...quickLink };
}

export function updateQuickLink(
  id: string,
  data: Partial<{
    name: string;
    urlTemplate: string;
    applicationName?: string;
    applicationPath?: string;
    applicationBundleId?: string;
    appIconDataUrl?: string;
    icon?: QuickLinkIcon;
  }>
): QuickLink | null {
  const all = ensureQuickLinksLoaded();
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;

  const index = all.findIndex((item) => item.id === normalizedId);
  if (index === -1) return null;

  const next = all[index];

  if (data.name !== undefined) {
    const normalizedName = normalizeQuickLinkNameInput(data.name);
    if (!normalizedName) {
      throw new Error('Quick link name is required.');
    }
    next.name = normalizedName;
  }

  if (data.urlTemplate !== undefined) {
    const normalizedUrl = normalizeQuickLinkUrlInput(data.urlTemplate);
    if (!normalizedUrl) {
      throw new Error('Quick link URL is required.');
    }
    next.urlTemplate = normalizedUrl;
  }

  if (data.applicationName !== undefined) {
    next.applicationName = normalizeQuickLinkApplicationNameInput(data.applicationName);
  }
  if (data.applicationPath !== undefined) {
    next.applicationPath = normalizeQuickLinkApplicationPathInput(data.applicationPath);
  }
  if (data.applicationBundleId !== undefined) {
    next.applicationBundleId = normalizeQuickLinkApplicationBundleIdInput(data.applicationBundleId);
  }
  if (data.appIconDataUrl !== undefined) {
    next.appIconDataUrl = normalizeDataUrl(data.appIconDataUrl);
  }
  if (data.icon !== undefined) {
    next.icon = normalizeQuickLinkIcon(data.icon);
  }

  next.updatedAt = Date.now();
  saveToDisk();
  return { ...next };
}

export function deleteQuickLink(id: string): boolean {
  const all = ensureQuickLinksLoaded();
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return false;

  const index = all.findIndex((item) => item.id === normalizedId);
  if (index === -1) return false;

  all.splice(index, 1);
  saveToDisk();
  return true;
}

export function duplicateQuickLink(id: string): QuickLink | null {
  const existing = getQuickLinkById(id);
  if (!existing) return null;

  const duplicate = createQuickLink({
    name: `${existing.name} Copy`,
    urlTemplate: existing.urlTemplate,
    applicationName: existing.applicationName,
    applicationPath: existing.applicationPath,
    applicationBundleId: existing.applicationBundleId,
    appIconDataUrl: existing.appIconDataUrl,
    icon: existing.icon,
  });
  return duplicate;
}

function decodeSnippetReference(rawReference: string): string {
  try {
    return decodeURIComponent(rawReference);
  } catch {
    return rawReference;
  }
}

function getSnippetIdByReference(rawReference: string): string | null {
  const reference = String(rawReference || '').trim();
  if (!reference) return null;

  const decodedReference = decodeSnippetReference(reference);
  if (getSnippetById(reference)) return reference;
  if (decodedReference !== reference && getSnippetById(decodedReference)) return decodedReference;

  const keywordMatch = getSnippetByKeyword(reference) || getSnippetByKeyword(decodedReference);
  if (!keywordMatch) return null;
  return keywordMatch.id;
}

function resolveSnippetReference(rawReference: string, dynamicValues?: Record<string, string>): string {
  const snippetId = getSnippetIdByReference(rawReference);
  if (!snippetId) return '';
  return renderSnippetById(snippetId, dynamicValues) || '';
}

function mergeDynamicFields(fields: QuickLinkDynamicField[]): QuickLinkDynamicField[] {
  const map = new Map<string, QuickLinkDynamicField>();
  for (const field of fields) {
    const key = String(field.key || field.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        key: String(field.key || key),
        name: String(field.name || field.key || key),
        defaultValue: field.defaultValue,
      });
    }
  }
  return Array.from(map.values());
}

export function extractQuickLinkDynamicFields(urlTemplate: string): QuickLinkDynamicField[] {
  const base = String(urlTemplate || '');
  if (!base) return [];

  const fields: QuickLinkDynamicField[] = extractSnippetDynamicFields(base).map((field) => ({
    key: field.key,
    name: field.name,
    defaultValue: field.defaultValue,
  }));

  const snippetRefRegex = /\{snippet:([^}]+)\}/gi;
  let match: RegExpExecArray | null = null;
  while ((match = snippetRefRegex.exec(base)) !== null) {
    const snippetId = getSnippetIdByReference(match[1]);
    if (!snippetId) continue;
    const snippet = getSnippetById(snippetId);
    if (!snippet) continue;
    const snippetFields = extractSnippetDynamicFields(snippet.content).map((field) => ({
      key: field.key,
      name: field.name,
      defaultValue: field.defaultValue,
    }));
    fields.push(...snippetFields);
  }

  return mergeDynamicFields(fields);
}

export function getQuickLinkDynamicFieldsById(id: string): QuickLinkDynamicField[] {
  const quickLink = getQuickLinkById(id);
  if (!quickLink) return [];
  return extractQuickLinkDynamicFields(quickLink.urlTemplate);
}

export function resolveQuickLinkUrlTemplate(urlTemplate: string, dynamicValues?: Record<string, string>): string {
  const base = String(urlTemplate || '');
  const withSnippetReferences = base.replace(/\{snippet:([^}]+)\}/gi, (_match, rawRef: string) => {
    return resolveSnippetReference(rawRef, dynamicValues);
  });
  const resolved = resolveSnippetPlaceholders(withSnippetReferences, dynamicValues);
  return String(resolved || '').trim();
}
