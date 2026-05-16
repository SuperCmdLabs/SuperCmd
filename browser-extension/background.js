const SUPERCMD_ENDPOINT = 'http://127.0.0.1:17373/browser-tabs/snapshot';
const SUPERCMD_COMMANDS_ENDPOINT = 'http://127.0.0.1:17373/browser-tabs/commands';
const SUPERCMD_COMMAND_RESULT_ENDPOINT = 'http://127.0.0.1:17373/browser-tabs/command-result';
const SNAPSHOT_DEBOUNCE_MS = 250;
const REPAIR_ALARM_NAME = 'supercmd-repair-snapshot';

// Development default. For now, edit these values when loading this unpacked
// extension into a different browser/profile. Production enrollment should be
// driven by native messaging plus a published browser extension.
const PROFILE = {
  browserId: 'helium',
  browserName: 'Helium',
  profileId: 'Default',
  profileSourceId: 'helium:Default',
  profileName: 'Default',
};

let snapshotTimer = null;
let lastSnapshotHash = '';
let commandLoopRunning = false;
const windowLastFocusedAt = new Map();

function scheduleSnapshot(reason) {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
  }
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void sendSnapshot(reason);
  }, SNAPSHOT_DEBOUNCE_MS);
}

async function sendSnapshot(reason) {
  let tabs;
  let windows = [];
  try {
    tabs = await chrome.tabs.query({});
    windows = await chrome.windows.getAll({});
  } catch {
    return;
  }
  const now = Date.now();
  for (const window of windows) {
    if (window.focused) {
      windowLastFocusedAt.set(window.id, now);
    } else if (!windowLastFocusedAt.has(window.id)) {
      windowLastFocusedAt.set(window.id, 0);
    }
  }

  const payload = {
    ...PROFILE,
    reason,
    tabs: tabs
      .filter((tab) => isSupportedUrl(tab.url || tab.pendingUrl || ''))
      .map((tab) => ({
        windowId: tab.windowId,
        tabId: tab.id,
        title: tab.title || '',
        url: tab.url || tab.pendingUrl || '',
        active: Boolean(tab.active),
        windowLastFocusedAt: windowLastFocusedAt.get(tab.windowId) || 0,
      })),
  };

  const snapshotHash = JSON.stringify(payload.tabs);
  if (snapshotHash === lastSnapshotHash) return;
  lastSnapshotHash = snapshotHash;

  try {
    await fetch(SUPERCMD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch {
    // SuperCmd may not be running yet. The periodic repair snapshot will retry.
  }
}

async function commandLoop() {
  if (commandLoopRunning) return;
  commandLoopRunning = true;
  while (true) {
    try {
      const url = `${SUPERCMD_COMMANDS_ENDPOINT}?profileSourceId=${encodeURIComponent(PROFILE.profileSourceId)}`;
      const response = await fetch(url, { cache: 'no-store' });
      const payload = await response.json();
      if (payload && payload.command) {
        await executeCommand(payload.command);
      }
    } catch {
      await delay(1000);
    }
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
    await fetch(SUPERCMD_COMMAND_RESULT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
      cache: 'no-store',
    });
  } catch {}
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSupportedUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
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
    scheduleSnapshot('repair');
  }
});
scheduleSnapshot('loaded');
void commandLoop();
