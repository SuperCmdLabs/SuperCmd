import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { shell } from 'electron';
import type { BrowserSearchEntry, BrowserSearchSource } from './browser-search-history';

export const BROWSER_TABS_DEV_SERVER_PORT = 17373;

const execFileAsync = promisify(execFile);
const PENDING_NAVIGATION_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_NAVIGATION_LIMIT = 5000;

const PROFILE_OPEN_APPS: Record<string, string> = {
  helium: 'Helium',
  chrome: 'Google Chrome',
  brave: 'Brave Browser',
  edge: 'Microsoft Edge',
  vivaldi: 'Vivaldi',
};

export interface BrowserTabSnapshotItem {
  windowId: string | number;
  tabId: string | number;
  title?: string;
  url?: string;
  active?: boolean;
  windowLastFocusedAt?: number;
}

export interface BrowserTabSnapshotPayload {
  browserId: string;
  browserName: string;
  profileId: string;
  profileSourceId: string;
  profileName: string;
  tabs: BrowserTabSnapshotItem[];
}

export interface BrowserTabEntry {
  id: string;
  browserId: string;
  browserName: string;
  profileId: string;
  profileSourceId: string;
  profileName: string;
  windowId: string;
  tabId: string;
  title: string;
  url: string;
  host: string;
  active: boolean;
  windowLastFocusedAt: number;
  updatedAt: number;
}

export interface BrowserTabRecentNavigation {
  id: string;
  browserId: string;
  browserName: string;
  profileId: string;
  profileSourceId: string;
  profileName: string;
  title: string;
  url: string;
  host: string;
  lastVisitedAt: number;
  visitCount: number;
}

export interface BrowserTabDurableHistoryEntry {
  source?: string;
  sourceProfileId?: string;
  url?: string;
}

interface BrowserTabFocusCommand {
  id: string;
  type: 'focus-tab';
  windowId: string;
  tabId: string;
}

interface BrowserTabCommandResult {
  id: string;
  ok: boolean;
  error?: string;
}

type BrowserOpenTarget = {
  browserId: string;
  profileId: string;
  url: string;
};

let tabsById = new Map<string, BrowserTabEntry>();
let recentNavigationsByKey = new Map<string, BrowserTabRecentNavigation>();
let commandSequence = 0;
const pendingCommandsByProfile = new Map<string, BrowserTabFocusCommand[]>();
const commandPollersByProfile = new Map<string, Array<(command: BrowserTabFocusCommand | null) => void>>();
const commandResultWaiters = new Map<string, (result: BrowserTabCommandResult) => void>();
let devServer: Server | null = null;

export function listBrowserTabs(): BrowserTabEntry[] {
  return Array.from(tabsById.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getBrowserTabCountsByProfile(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tab of tabsById.values()) {
    counts[tab.profileSourceId] = (counts[tab.profileSourceId] || 0) + 1;
  }
  return counts;
}

export function listBrowserTabRecentNavigations(): BrowserTabRecentNavigation[] {
  pruneRecentNavigations();
  return Array.from(recentNavigationsByKey.values()).sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
}

export function listBrowserTabRecentNavigationEntries(): BrowserSearchEntry[] {
  return listBrowserTabRecentNavigations().map((navigation) => ({
    id: navigation.id,
    type: 'url',
    query: navigation.title || navigation.host || navigation.url,
    url: navigation.url,
    host: navigation.host,
    lastUsedAt: navigation.lastVisitedAt,
    useCount: Math.max(1, navigation.visitCount),
    source: navigation.browserId as BrowserSearchSource,
    sourceProfileId: navigation.profileId,
    sourceProfileName: navigation.profileName,
  }));
}

export function clearBrowserTabRecentNavigations(): void {
  recentNavigationsByKey.clear();
}

export function flushRecentNavigationsForHistoryEntries(entries: BrowserTabDurableHistoryEntry[]): number {
  if (!Array.isArray(entries) || recentNavigationsByKey.size === 0) return 0;
  let removed = 0;
  for (const entry of entries) {
    const profileSourceId = getProfileSourceId(entry);
    const url = String(entry?.url || '').trim();
    if (!profileSourceId || !url) continue;
    const key = recentNavigationKey(profileSourceId, url);
    if (recentNavigationsByKey.delete(key)) {
      removed += 1;
    }
  }
  return removed;
}

export async function openBrowserTabForInput(rawInput: string): Promise<{
  ok: boolean;
  url: string | null;
  tab: BrowserTabEntry | null;
}> {
  const tab = findBrowserTabForInput(rawInput);
  const navigation = tab ? null : findBrowserNavigationForInput(rawInput);
  const target = tab || navigation;
  if (!target) return { ok: false, url: null, tab: null };

  try {
    await openInSourceProfile(target);
    return { ok: true, url: target.url, tab };
  } catch (e) {
    console.error('Failed to open browser tab/navigation URL:', e);
    try {
      await shell.openExternal(target.url);
      return { ok: true, url: target.url, tab };
    } catch {
      return { ok: false, url: target.url, tab };
    }
  }
}

export async function focusBrowserTabForInput(rawInput: string): Promise<{
  ok: boolean;
  url: string | null;
  tab: BrowserTabEntry | null;
  reason?: string;
}> {
  const tab = findBrowserTabForInput(rawInput);
  if (!tab) return { ok: false, url: null, tab: null, reason: 'No open tab match' };

  try {
    const result = await sendFocusTabCommand(tab);
    if (result.ok) return { ok: true, url: tab.url, tab };
    return { ok: false, url: tab.url, tab, reason: result.error || 'Failed to focus tab' };
  } catch (e: any) {
    return { ok: false, url: tab.url, tab, reason: e?.message || 'Failed to focus tab' };
  }
}

export function replaceBrowserTabsForProfile(raw: BrowserTabSnapshotPayload): BrowserTabEntry[] {
  const payload = normalizeSnapshotPayload(raw);
  const now = Date.now();
  const previousTabs = new Map<string, BrowserTabEntry>();
  for (const [id, tab] of tabsById) {
    if (tab.profileSourceId === payload.profileSourceId) {
      previousTabs.set(id, tab);
      tabsById.delete(id);
    }
  }

  const nextTabs: BrowserTabEntry[] = [];
  for (const item of payload.tabs) {
    const tab = normalizeTab(payload, item, now);
    if (!tab) continue;
    const previous = previousTabs.get(tab.id);
    recordRecentNavigation(tab, previous);
    tabsById.set(tab.id, tab);
    nextTabs.push(tab);
  }
  pruneRecentNavigations();
  return nextTabs;
}

async function sendFocusTabCommand(tab: BrowserTabEntry): Promise<BrowserTabCommandResult> {
  const command: BrowserTabFocusCommand = {
    id: `focus-${Date.now()}-${++commandSequence}`,
    type: 'focus-tab',
    windowId: tab.windowId,
    tabId: tab.tabId,
  };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      commandResultWaiters.delete(command.id);
      removePendingCommand(tab.profileSourceId, command.id);
      resolve({ id: command.id, ok: false, error: 'Timed out waiting for browser extension' });
    }, 2000);

    commandResultWaiters.set(command.id, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });

    enqueueCommand(tab.profileSourceId, command);
  });
}

function enqueueCommand(profileSourceId: string, command: BrowserTabFocusCommand): void {
  const pollers = commandPollersByProfile.get(profileSourceId) || [];
  const poller = pollers.shift();
  if (poller) {
    poller(command);
    return;
  }
  commandPollersByProfile.set(profileSourceId, pollers);
  const queue = pendingCommandsByProfile.get(profileSourceId) || [];
  queue.push(command);
  pendingCommandsByProfile.set(profileSourceId, queue.slice(-20));
}

function removePendingCommand(profileSourceId: string, commandId: string): void {
  const queue = pendingCommandsByProfile.get(profileSourceId) || [];
  pendingCommandsByProfile.set(profileSourceId, queue.filter((command) => command.id !== commandId));
}

function recordRecentNavigation(tab: BrowserTabEntry, previous: BrowserTabEntry | undefined): void {
  const key = recentNavigationKey(tab.profileSourceId, tab.url);
  const existing = recentNavigationsByKey.get(key);
  const urlChanged = !previous || previous.url !== tab.url;
  const titleChanged = Boolean(previous && previous.url === tab.url && previous.title !== tab.title);
  if (!urlChanged && !titleChanged && existing) return;

  recentNavigationsByKey.set(key, {
    id: `tab-nav:${key}`,
    browserId: tab.browserId,
    browserName: tab.browserName,
    profileId: tab.profileId,
    profileSourceId: tab.profileSourceId,
    profileName: tab.profileName,
    title: tab.title,
    url: tab.url,
    host: tab.host,
    lastVisitedAt: tab.updatedAt,
    visitCount: existing ? existing.visitCount + (urlChanged ? 1 : 0) : 1,
  });
}

function findBrowserTabForInput(rawInput: string): BrowserTabEntry | null {
  const input = String(rawInput || '').trim();
  if (input.length < 2) return null;
  const lower = input.toLowerCase();
  const stripped = lower.replace(/^https?:\/\//, '');
  let best: { tab: BrowserTabEntry; score: number } | null = null;

  for (const tab of tabsById.values()) {
    const url = tab.url || tab.host;
    const fullStripped = url.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    const host = tab.host.toLowerCase();
    const title = tab.title.toLowerCase();
    const matchesUrl =
      fullStripped.startsWith(stripped) ||
      fullStripped.replace(/^www\./, '').startsWith(stripped) ||
      (stripped.length >= 3 && fullStripped.includes(stripped));
    const matchesHost = host.startsWith(stripped) || host.replace(/^www\./, '').startsWith(stripped);
    const matchesTitle = title.startsWith(lower) || (lower.length >= 3 && title.includes(lower));
    if (!matchesUrl && !matchesHost && !matchesTitle) continue;
    const score =
      (matchesUrl ? 200 : 0) +
      (matchesHost ? 100 : 0) +
      (matchesTitle ? 80 : 0) +
      (tab.active ? 100 : 0) +
      Math.max(0, 60 - ((Date.now() - tab.updatedAt) / 1000));
    if (!best || score > best.score) best = { tab, score };
  }

  return best?.tab || null;
}

function findBrowserNavigationForInput(rawInput: string): BrowserTabRecentNavigation | null {
  const input = String(rawInput || '').trim();
  if (input.length < 2) return null;
  const lower = input.toLowerCase();
  const stripped = lower.replace(/^https?:\/\//, '');
  let best: { navigation: BrowserTabRecentNavigation; score: number } | null = null;

  for (const navigation of listBrowserTabRecentNavigations()) {
    const url = navigation.url || navigation.host;
    const fullStripped = url.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    const host = navigation.host.toLowerCase();
    const title = navigation.title.toLowerCase();
    const matchesUrl = fullStripped.startsWith(stripped) || fullStripped.replace(/^www\./, '').startsWith(stripped);
    const matchesHost = host.startsWith(stripped) || host.replace(/^www\./, '').startsWith(stripped);
    const matchesTitle = title.startsWith(lower);
    if (!matchesUrl && !matchesHost && !matchesTitle) continue;
    const ageSeconds = Math.max(0, (Date.now() - navigation.lastVisitedAt) / 1000);
    const score = navigation.visitCount * 10 + Math.max(0, 120 - ageSeconds);
    if (!best || score > best.score) best = { navigation, score };
  }

  return best?.navigation || null;
}

async function openInSourceProfile(target: BrowserOpenTarget): Promise<void> {
  const appName = PROFILE_OPEN_APPS[target.browserId];
  if (!appName) {
    await shell.openExternal(target.url);
    return;
  }
  const args = ['-a', appName, target.url];
  if (target.profileId && target.profileId !== 'Default') {
    args.push('--args', `--profile-directory=${target.profileId}`);
  }
  await execFileAsync('/usr/bin/open', args);
}

function recentNavigationKey(profileSourceId: string, url: string): string {
  return `${profileSourceId}:${url.toLowerCase()}`;
}

function pruneRecentNavigations(): void {
  const cutoff = Date.now() - PENDING_NAVIGATION_FALLBACK_TTL_MS;
  for (const [key, navigation] of recentNavigationsByKey) {
    if (navigation.lastVisitedAt < cutoff) {
      recentNavigationsByKey.delete(key);
    }
  }
  if (recentNavigationsByKey.size <= PENDING_NAVIGATION_LIMIT) return;
  const sorted = Array.from(recentNavigationsByKey.entries()).sort(
    (a, b) => b[1].lastVisitedAt - a[1].lastVisitedAt
  );
  recentNavigationsByKey = new Map(sorted.slice(0, PENDING_NAVIGATION_LIMIT));
}

function getProfileSourceId(entry: BrowserTabDurableHistoryEntry): string {
  const source = String(entry?.source || '').trim();
  const sourceProfileId = String(entry?.sourceProfileId || '').trim();
  return source && sourceProfileId ? `${source}:${sourceProfileId}` : '';
}

export function startBrowserTabsDevServer(options: {
  onChanged?: () => void;
  port?: number;
} = {}): Server {
  if (devServer) return devServer;

  const port = options.port || BROWSER_TABS_DEV_SERVER_PORT;
  devServer = createServer(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = parseRequestUrl(req);
    if (req.method === 'GET' && parsedUrl.pathname === '/browser-tabs/commands') {
      handleCommandPoll(req, res, parsedUrl);
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/browser-tabs/command-result') {
      try {
        const body = await readJsonBody(req, 64 * 1024);
        handleCommandResult(body as BrowserTabCommandResult);
        writeJson(res, 200, { ok: true });
      } catch (e: any) {
        writeJson(res, 400, { ok: false, error: e?.message || 'invalid_payload' });
      }
      return;
    }

    if (req.method !== 'POST' || parsedUrl.pathname !== '/browser-tabs/snapshot') {
      writeJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }

    try {
      const body = await readJsonBody(req, 512 * 1024);
      replaceBrowserTabsForProfile(body as BrowserTabSnapshotPayload);
      options.onChanged?.();
      writeJson(res, 200, { ok: true });
    } catch (e: any) {
      writeJson(res, 400, { ok: false, error: e?.message || 'invalid_payload' });
    }
  });

  devServer.on('error', (error) => {
    console.warn('Browser tabs dev server failed:', error);
  });

  devServer.listen(port, '127.0.0.1', () => {
    console.log(`[BrowserTabs] Dev ingest listening on http://127.0.0.1:${port}`);
  });

  return devServer;
}

function handleCommandPoll(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): void {
  const profileSourceId = cleanProfileSourceId(parsedUrl.searchParams.get('profileSourceId') || '');
  if (!profileSourceId) {
    writeJson(res, 400, { ok: false, error: 'missing_profile_source_id' });
    return;
  }

  const queue = pendingCommandsByProfile.get(profileSourceId) || [];
  const command = queue.shift();
  pendingCommandsByProfile.set(profileSourceId, queue);
  if (command) {
    writeJson(res, 200, { ok: true, command });
    return;
  }

  let settled = false;
  const complete = (nextCommand: BrowserTabFocusCommand | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    removeCommandPoller(profileSourceId, complete);
    writeJson(res, 200, { ok: true, command: nextCommand });
  };
  const timeout = setTimeout(() => complete(null), 25000);
  req.on('close', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    removeCommandPoller(profileSourceId, complete);
  });

  const pollers = commandPollersByProfile.get(profileSourceId) || [];
  pollers.push(complete);
  commandPollersByProfile.set(profileSourceId, pollers);
}

function removeCommandPoller(
  profileSourceId: string,
  poller: (command: BrowserTabFocusCommand | null) => void
): void {
  const pollers = commandPollersByProfile.get(profileSourceId) || [];
  commandPollersByProfile.set(profileSourceId, pollers.filter((candidate) => candidate !== poller));
}

function handleCommandResult(result: BrowserTabCommandResult): void {
  const id = String(result?.id || '').trim();
  if (!id) return;
  const waiter = commandResultWaiters.get(id);
  if (!waiter) return;
  commandResultWaiters.delete(id);
  waiter({
    id,
    ok: Boolean(result.ok),
    error: typeof result.error === 'string' ? result.error : undefined,
  });
}

function parseRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url || '/', `http://127.0.0.1:${BROWSER_TABS_DEV_SERVER_PORT}`);
}

function normalizeSnapshotPayload(raw: BrowserTabSnapshotPayload): BrowserTabSnapshotPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Payload must be an object');
  }
  const browserId = cleanIdentifier(raw.browserId);
  const profileId = cleanIdentifier(raw.profileId || 'Default');
  const profileSourceId = cleanProfileSourceId(raw.profileSourceId || `${browserId}:${profileId}`);
  if (!browserId || !profileId || !profileSourceId) {
    throw new Error('Payload is missing browser/profile identifiers');
  }
  const tabs = Array.isArray(raw.tabs) ? raw.tabs : [];
  return {
    browserId,
    browserName: cleanName(raw.browserName || browserId),
    profileId,
    profileSourceId,
    profileName: cleanName(raw.profileName || profileId),
    tabs,
  };
}

function normalizeTab(
  payload: BrowserTabSnapshotPayload,
  item: BrowserTabSnapshotItem,
  updatedAt: number
): BrowserTabEntry | null {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url || '').trim();
  if (!isSupportedTabUrl(url)) return null;
  const windowId = cleanIdentifier(item.windowId);
  const tabId = cleanIdentifier(item.tabId);
  if (!windowId || !tabId) return null;
  const host = extractHost(url);
  return {
    id: `${payload.profileSourceId}:${windowId}:${tabId}`,
    browserId: payload.browserId,
    browserName: payload.browserName,
    profileId: payload.profileId,
    profileSourceId: payload.profileSourceId,
    profileName: payload.profileName,
    windowId,
    tabId,
    title: cleanName(item.title || host || url),
    url,
    host,
    active: Boolean(item.active),
    windowLastFocusedAt: Number.isFinite(Number(item.windowLastFocusedAt)) ? Math.max(0, Number(item.windowLastFocusedAt)) : 0,
    updatedAt,
  };
}

function isSupportedTabUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function cleanIdentifier(value: unknown): string {
  return String(value || '').trim().slice(0, 160);
}

function cleanProfileSourceId(value: unknown): string {
  const id = cleanIdentifier(value);
  return id.includes(':') ? id : '';
}

function cleanName(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
