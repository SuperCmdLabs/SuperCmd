const SUPERCMD_ENDPOINT = 'http://127.0.0.1:17373/browser-tabs/snapshot';
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
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
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
chrome.windows.onRemoved.addListener(() => scheduleSnapshot('window-removed'));

chrome.alarms.create(REPAIR_ALARM_NAME, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REPAIR_ALARM_NAME) {
    scheduleSnapshot('repair');
  }
});
scheduleSnapshot('loaded');
