const SUPERCMD_BASE_URL = 'http://127.0.0.1:17373';
const SNAPSHOT_ENDPOINT = `${SUPERCMD_BASE_URL}/browser-tabs/snapshot`;
const HELLO_ENDPOINT = `${SUPERCMD_BASE_URL}/browser-tabs/hello`;
const COMMANDS_ENDPOINT = `${SUPERCMD_BASE_URL}/browser-tabs/commands`;
const COMMAND_RESULT_ENDPOINT = `${SUPERCMD_BASE_URL}/browser-tabs/command-result`;
const SNAPSHOT_DEBOUNCE_MS = 250;
const REPAIR_ALARM_NAME = 'supercmd-repair-snapshot';

let snapshotTimer = null;
let lastSnapshotHash = '';
let commandLoopRunning = false;
let supercmdConnected = false;
let currentIdentity = null;
let reconnectDelayMs = 500;
const windowLastFocusedAt = new Map();

function scheduleSnapshot(reason) {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void sendSnapshot(reason);
  }, SNAPSHOT_DEBOUNCE_MS);
}

async function discoverProfileIdentity() {
  const stored = await chrome.storage.local.get([
    'supercmdBrowserId',
    'supercmdBrowserName',
    'supercmdProfileId',
    'supercmdProfileName',
  ]);
  const browser = detectBrowser();
  const browserId = cleanIdentifier(stored.supercmdBrowserId || browser.browserId || 'chrome');
  const browserName = cleanName(stored.supercmdBrowserName || browser.browserName || browserId);
  const profileId = cleanIdentifier(stored.supercmdProfileId || 'Default');
  const profileName = cleanName(stored.supercmdProfileName || profileId);
  return {
    browserId,
    browserName,
    profileId,
    profileSourceId: `${browserId}:${profileId}`,
    profileName,
  };
}

function detectBrowser() {
  const ua = navigator.userAgent || '';
  const brands = ((navigator.userAgentData && navigator.userAgentData.brands) || [])
    .map((brand) => brand.brand)
    .join(' ');
  const haystack = `${brands} ${ua}`;
  if (/Edg\//i.test(haystack) || /Microsoft Edge/i.test(haystack)) return { browserId: 'edge', browserName: 'Microsoft Edge' };
  if (/Brave/i.test(haystack)) return { browserId: 'brave', browserName: 'Brave Browser' };
  if (/Vivaldi/i.test(haystack)) return { browserId: 'vivaldi', browserName: 'Vivaldi' };
  if (/Helium/i.test(haystack)) return { browserId: 'helium', browserName: 'Helium' };
  return { browserId: 'chrome', browserName: 'Google Chrome' };
}

async function post(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.json().catch(() => ({}));
}

async function sendSnapshot(reason) {
  const identity = currentIdentity || await discoverProfileIdentity();
  currentIdentity = identity;
  let tabs;
  let windows = [];
  try {
    tabs = await chrome.tabs.query({});
    windows = await chrome.windows.getAll({});
  } catch {
    return;
  }

  const now = Date.now();
  const windowOrdinalById = new Map();
  windows.forEach((window, index) => {
    windowOrdinalById.set(window.id, index + 1);
  });
  for (const window of windows) {
    if (window.focused) {
      windowLastFocusedAt.set(window.id, now);
    } else if (!windowLastFocusedAt.has(window.id)) {
      windowLastFocusedAt.set(window.id, 0);
    }
  }

  const payload = {
    ...identity,
    reason,
    tabs: tabs
      .filter((tab) => isSupportedUrl(tab.url || tab.pendingUrl || ''))
      .map((tab) => ({
        windowId: tab.windowId,
        windowOrdinal: windowOrdinalById.get(tab.windowId) || 0,
        tabId: tab.id,
        tabIndex: Number.isFinite(tab.index) ? tab.index : 0,
        favIconUrl: tab.favIconUrl || '',
        title: tab.title || '',
        url: tab.url || tab.pendingUrl || '',
        active: Boolean(tab.active),
        windowLastFocusedAt: windowLastFocusedAt.get(tab.windowId) || 0,
      })),
  };

  const snapshotHash = JSON.stringify(payload.tabs);
  if (supercmdConnected && snapshotHash === lastSnapshotHash) return;

  try {
    await post(SNAPSHOT_ENDPOINT, payload);
    lastSnapshotHash = snapshotHash;
    supercmdConnected = true;
  } catch {
    supercmdConnected = false;
  }
}

async function connectLoop() {
  if (commandLoopRunning) return;
  commandLoopRunning = true;
  while (true) {
    try {
      currentIdentity = await discoverProfileIdentity();
      await post(HELLO_ENDPOINT, currentIdentity);
      supercmdConnected = true;
      reconnectDelayMs = 500;
      lastSnapshotHash = '';
      await sendSnapshot('connected');
      await pollCommands(currentIdentity.profileSourceId);
    } catch {
      supercmdConnected = false;
      await delay(nextBackoffWithJitter());
    }
  }
}

async function pollCommands(profileSourceId) {
  const url = `${COMMANDS_ENDPOINT}?profileSourceId=${encodeURIComponent(profileSourceId)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`commands_failed_${response.status}`);
  const payload = await response.json();
  if (payload && payload.command) {
    await executeCommand(payload.command);
  }
}

async function executeCommand(command) {
  if (!command || command.type !== 'focus-tab') return;
  let result = { id: command.id, ok: false };
  try {
    const windowId = Number(command.windowId);
    const tabId = Number(command.tabId);
    await chrome.windows.update(windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
    result = { id: command.id, ok: true };
    scheduleSnapshot('focused-tab');
  } catch (error) {
    result = { id: command.id, ok: false, error: String(error && error.message ? error.message : error) };
  }
  try {
    await post(COMMAND_RESULT_ENDPOINT, result);
  } catch {}
}

function nextBackoffWithJitter() {
  const base = reconnectDelayMs;
  reconnectDelayMs = Math.min(30000, Math.round(reconnectDelayMs * 1.8));
  return base + Math.floor(Math.random() * Math.min(1000, base));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSupportedUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function cleanIdentifier(value) {
  return String(value || '').trim().slice(0, 160).replace(/[^A-Za-z0-9 _.:/-]/g, '') || 'Default';
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

chrome.runtime.onInstalled.addListener(() => scheduleSnapshot('installed'));
chrome.runtime.onStartup.addListener(() => scheduleSnapshot('startup'));

chrome.tabs.onCreated.addListener(() => scheduleSnapshot('tab-created'));
chrome.tabs.onRemoved.addListener(() => scheduleSnapshot('tab-removed'));
chrome.tabs.onActivated.addListener(() => scheduleSnapshot('tab-activated'));
chrome.tabs.onMoved.addListener(() => scheduleSnapshot('tab-moved'));
chrome.tabs.onAttached.addListener(() => scheduleSnapshot('tab-attached'));
chrome.tabs.onDetached.addListener(() => scheduleSnapshot('tab-detached'));
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (
    changeInfo.url !== undefined ||
    changeInfo.title !== undefined ||
    changeInfo.status !== undefined ||
    changeInfo.pinned !== undefined
  ) {
    scheduleSnapshot('tab-updated');
  }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    windowLastFocusedAt.set(windowId, Date.now());
  }
  scheduleSnapshot('window-focus-changed');
});
chrome.windows.onRemoved.addListener(() => scheduleSnapshot('window-removed'));

chrome.alarms.create(REPAIR_ALARM_NAME, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REPAIR_ALARM_NAME) {
    lastSnapshotHash = '';
    scheduleSnapshot('repair');
  }
});

scheduleSnapshot('loaded');
void connectLoop();
