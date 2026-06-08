/**
 * Settings Store
 *
 * Simple JSON-file persistence for app settings.
 * Stored at ~/Library/Application Support/SuperCmd/settings.json
 */

import { app } from 'electron';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getNativeBinaryPath } from './native-binary';
import { getSecret, setSecret, deleteSecret } from './safe-storage';

// AI settings fields whose values should never live in plain text on disk.
// Read/written through the safe-storage vault. Legacy plain-text values still
// present in settings.json are migrated into the vault on first load.
const SENSITIVE_AI_KEYS = [
  'openaiApiKey',
  'anthropicApiKey',
  'geminiApiKey',
  'elevenlabsApiKey',
  'mistralApiKey',
  'supermemoryApiKey',
  'lmStudioApiKey',
  'openaiCompatibleApiKey',
] as const;

type SensitiveAIKey = (typeof SENSITIVE_AI_KEYS)[number];

function aiVaultKey(field: SensitiveAIKey): string {
  return `ai.${field}`;
}

function oauthVaultKey(provider: string): string {
  return `oauth.${provider}`;
}

export interface AISettings {
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openai-compatible' | 'lm-studio';
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  elevenlabsApiKey: string;
  mistralApiKey: string;
  supermemoryApiKey: string;
  supermemoryClient: string;
  supermemoryBaseUrl: string;
  supermemoryLocalMode: boolean;
  ollamaBaseUrl: string;
  defaultModel: string;
  speechCorrectionModel: string;
  speechToTextModel: string;
  speechLanguage: string;
  textToSpeechModel: string;
  edgeTtsVoice: string;
  speechCorrectionEnabled: boolean;
  enabled: boolean;
  llmEnabled: boolean;
  whisperEnabled: boolean;
  readEnabled: boolean;
  openaiCompatibleAppendV1: boolean;
  openaiCompatibleBaseUrl: string;
  openaiCompatibleApiKey: string;
  openaiCompatibleModel: string;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioApiKey: string;
}

export type HyperKeySourceKey =
  | 'caps-lock'
  | 'left-control'
  | 'left-shift'
  | 'left-option'
  | 'left-command'
  | 'right-control'
  | 'right-shift'
  | 'right-option'
  | 'right-command';

export type HyperKeyCapsLockTapBehavior = 'escape' | 'nothing' | 'toggle';

export interface HyperKeySettings {
  enabled: boolean;
  sourceKey: HyperKeySourceKey;
  capsLockTapBehavior: HyperKeyCapsLockTapBehavior;
}

export interface BrowserSearchSettings {
  /** When false, Cmd+Enter does not trigger browser search and inline ghost-text autocomplete is suppressed. */
  enabled: boolean;
  /** Enables the alpha Chromium profile/root-result integration without replacing the legacy browser-search path by default. */
  alphaChromiumRootSearchEnabled: boolean;
  /** Auto-prune browser-search history older than N days. `null` = never prune. */
  historyRetentionDays: number | null;
  /** Browser/profile sources enabled for SuperCmd browser history. */
  profileSourceIds: string[];
  /** Ordered Chromium profiles used for browser search and profile-aware opens. */
  profiles: BrowserProfileSetting[];
  /** Persisted per-category source profile filters. Undefined means all profiles are enabled. */
  profileFilters: BrowserProfileFilters;
  /** Legacy fallback for the number of rows to show per browser result group in root search. */
  resultLimitPerGroup: number;
  /** Ordered browser result providers and row counts for the root Browser section. */
  resultGroups: BrowserSearchResultGroupSetting[];
  /** User-assigned bookmark nicknames keyed by browser/profile URL. */
  nicknames: BrowserSearchNicknameSetting[];
  /** Default web-search provider key, used for favicons and direct search rows. */
  webSearchDefaultBangKey: string;
  /** User overrides for bang aliases. Defaults come from the fetched catalog. */
  webSearchBangOverrides: WebSearchBangOverrideSetting[];
  /** Personal bang usage/frecency keyed by canonical bang key. */
  webSearchBangUsage: Record<string, WebSearchBangUsageSetting>;
  /** Bang keys hidden from normal root/search-web surfaces. */
  webSearchDisabledBangKeys: string[];
  /** User-defined bang providers that do not exist in the catalog. */
  webSearchBangCustomProviders: WebSearchBangCustomProviderSetting[];
  /** Whether the bang manager is currently showing hidden bangs. */
  webSearchShowHiddenBangs?: boolean;
  /** Show web suggestions and bang/provider rows in root query-mode. */
  webSearchSuggestionsEnabled: boolean;
}

export type BrowserProfileFilterKind = 'open-tab' | 'bookmark' | 'history';

export type BrowserProfileFilters = Partial<Record<BrowserProfileFilterKind, string[]>>;

export interface BrowserProfileSetting {
  id: string;
  browserId: BrowserSearchSource;
  browserName: string;
  profileId: string;
  detectedName: string;
  displayName: string;
  order: number;
}

export interface RootSearchRankingInputHistorySetting {
  useCount: number;
  lastUsedAt: number;
  score: number;
}

export interface RootSearchRankingSetting {
  useCount: number;
  lastUsedAt: number;
  frecencyScore: number;
  inputHistory: Record<string, RootSearchRankingInputHistorySetting>;
}

export type BrowserSearchResultKind = 'open-tab' | 'bookmark' | 'history';

export type BrowserSearchSource =
  | 'user'
  | 'helium'
  | 'chrome'
  | 'arc'
  | 'brave'
  | 'edge'
  | 'vivaldi'
  | 'safari'
  | 'firefox';

export interface BrowserSearchResultGroupSetting {
  kind: BrowserSearchResultKind;
  limit: number;
}

export interface BrowserSearchNicknameSetting {
  source: string;
  sourceProfileId?: string;
  url: string;
  nickname: string;
}

export interface WebSearchBangOverrideSetting {
  key: string;
  aliases: string[];
}

export interface WebSearchBangUsageSetting {
  useCount: number;
  lastUsedAt: number;
  frecencyScore: number;
}

export interface WebSearchBangCustomProviderSetting {
  key: string;
  aliases: string[];
  name: string;
  host: string;
  template: string;
}

export type AppFontSize = 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large';
export type AppUiStyle = 'default' | 'glassy';
export type LauncherViewMode = 'expanded' | 'compact';
export type AppNavigationStyle = 'vim' | 'macos';
export type AppLanguage =
  | 'system'
  | 'en'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'it';

export interface AppSettings {
  globalShortcut: string;
  openAtLogin: boolean;
  disabledCommands: string[];
  enabledCommands: string[];
  customExtensionFolders: string[];
  scriptCommandFolders: string[];
  commandHotkeys: Record<string, string>;
  commandAliases: Record<string, string>;
  pinnedCommands: string[];
  pinnedFiles: string[];
  recentCommands: string[];
  recentCommandLaunchCounts: Record<string, number>;
  hasSeenOnboarding: boolean;
  hasSeenWhisperOnboarding: boolean;
  fileSearchProtectedRootsEnabled: boolean;
  disableFileSearchResults: boolean;
  showMenuBarIcon: boolean;
  ai: AISettings;
  commandMetadata?: Record<string, { subtitle?: string }>;
  debugMode: boolean;
  appLanguage: AppLanguage;
  fontSize: AppFontSize;
  uiStyle: AppUiStyle;
  baseColor: string;
  launcherBackgroundImagePath: string;
  launcherBackgroundImageEverywhere: boolean;
  launcherBackgroundImageBlurPercent: number;
  launcherBackgroundImageOpacityPercent: number;
  appUpdaterLastCheckedAt: number;
  updateBannerDismissedAt?: number;
  updateBannerDismissedVersion?: string;
  hyperKey: HyperKeySettings;
  launcherViewMode: LauncherViewMode;
  navigationStyle: AppNavigationStyle;
  // Auto-prune clipboard items older than N days. `null` = never prune.
  clipboardHistoryRetentionDays: number | null;
  // Bundle IDs of applications whose clipboard copies should NOT be saved to
  // SuperCmd's clipboard history. Clipboard content copied while one of these
  // apps is frontmost is simply ignored. The system pasteboard is untouched.
  clipboardAppBlacklist: string[];
  emojiPickerEnabled: boolean;
  emojiPickerTriggerPrefix: string;
  // Bundle IDs of applications where the inline emoji picker should NOT appear.
  // Useful for apps with their own emoji pickers (Slack, Telegram, …).
  emojiPickerExcludedAppBundleIds: string[];
  browserSearch: BrowserSearchSettings;
  rootSearchRanking: Record<string, RootSearchRankingSetting>;
  /** Show inline ghost-text autocomplete in the launcher search bar (commands, files, browser). */
  rootSearchAutocompleteEnabled: boolean;
  // Number of seconds the launcher waits after closing before resetting the
  // active view (extension or internal view like Clipboard) back to root
  // search. `0` resets immediately on every reopen.
  popToRootSearchTimeoutSeconds: number;
  // Names (extension directory names, matching getInstalledExtensionNames())
  // that the user has installed. Synced across Macs; the filesystem stays
  // authoritative for "is X installed right now". On launch, missing entries
  // are auto-installed in the background.
  installedExtensions: string[];
  // Synced uninstall intent by extension name. Prevents another Mac that still
  // has a stale managed extension folder from re-adding it to installedExtensions.
  extensionUninstallTombstones: Record<string, number>;
  // Per-extension preference values (from `getPreferenceValues()`).
  // Key: extension name. Value: { prefName: value, ... }.
  extensionPreferences: Record<string, Record<string, unknown>>;
  // Per-command preference values, for prefs declared at command scope.
  // Key: "extName/cmdName". Value: { prefName: value, ... }.
  extensionCommandPreferences: Record<string, Record<string, unknown>>;
  // Per-command argument values (from launch arguments).
  // Key: "extName/cmdName". Value: { argName: value, ... }.
  extensionCommandArguments: Record<string, Record<string, unknown>>;
  // Auto Quit: list of apps that should be auto-quit after inactivity
  autoQuitApps: { bundleId: string; appName: string; appPath: string; timeoutSeconds: number }[];
  // Auto Quit: default timeout in seconds (used when adding new apps)
  autoQuitDefaultTimeoutSeconds: number;
}

const DEFAULT_HYPER_KEY_SETTINGS: HyperKeySettings = {
  enabled: false,
  sourceKey: 'caps-lock',
  capsLockTapBehavior: 'nothing',
};

const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',
  elevenlabsApiKey: '',
  mistralApiKey: '',
  supermemoryApiKey: '',
  supermemoryClient: '',
  supermemoryBaseUrl: 'https://api.supermemory.ai',
  supermemoryLocalMode: false,
  ollamaBaseUrl: 'http://localhost:11434',
  defaultModel: '',
  speechCorrectionModel: '',
  speechToTextModel: 'whispercpp',
  speechLanguage: 'en-US',
  textToSpeechModel: 'edge-tts',
  edgeTtsVoice: 'en-US-EricNeural',
  speechCorrectionEnabled: false,
  enabled: true,
  llmEnabled: true,
  whisperEnabled: true,
  readEnabled: true,
  openaiCompatibleAppendV1: true,
  openaiCompatibleBaseUrl: '',
  openaiCompatibleApiKey: '',
  openaiCompatibleModel: '',
  lmStudioBaseUrl: 'http://127.0.0.1:1234/v1',
  lmStudioModel: '',
  lmStudioApiKey: '',
};

const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: 'Alt+Space',
  openAtLogin: false,
  disabledCommands: [],
  enabledCommands: [],
  customExtensionFolders: [],
  scriptCommandFolders: [],
  commandHotkeys: {
    'system-supercmd-whisper': 'Command+Shift+W',
    'system-supercmd-whisper-speak-toggle': 'Fn',
    'system-supercmd-speak': 'Command+Shift+S',
    'system-window-management-left': 'Control+Alt+Left',
    'system-window-management-right': 'Control+Alt+Right',
    'system-window-management-top': 'Control+Alt+Up',
    'system-window-management-bottom': 'Control+Alt+Down',
    'system-window-management-top-left': 'Control+Alt+U',
    'system-window-management-top-right': 'Control+Alt+I',
    'system-window-management-bottom-left': 'Control+Alt+J',
    'system-window-management-bottom-right': 'Control+Alt+K',
    'system-window-management-first-third': 'Control+Alt+D',
    'system-window-management-center-third': 'Control+Alt+F',
    'system-window-management-last-third': 'Control+Alt+G',
    'system-window-management-first-two-thirds': 'Control+Alt+E',
    'system-window-management-center-two-thirds': 'Control+Alt+R',
    'system-window-management-last-two-thirds': 'Control+Alt+T',
    'system-window-management-center': 'Control+Alt+C',
    'system-window-management-fill': 'Control+Alt+Return',
    'system-window-management-increase-size-10': 'Control+Alt+=',
    'system-window-management-decrease-size-10': 'Control+Alt+-',
  },
  commandAliases: {},
  pinnedCommands: ['system-open-settings'],
  pinnedFiles: [],
  recentCommands: [],
  recentCommandLaunchCounts: {},
  hasSeenOnboarding: false,
  hasSeenWhisperOnboarding: false,
  fileSearchProtectedRootsEnabled: false,
  disableFileSearchResults: false,
  showMenuBarIcon: true,
  ai: { ...DEFAULT_AI_SETTINGS },
  debugMode: false,
  appLanguage: 'system',
  fontSize: 'medium',
  uiStyle: 'glassy',
  baseColor: '#101113',
  launcherBackgroundImagePath: '',
  launcherBackgroundImageEverywhere: false,
  launcherBackgroundImageBlurPercent: 25,
  launcherBackgroundImageOpacityPercent: 45,
  appUpdaterLastCheckedAt: 0,
  hyperKey: { ...DEFAULT_HYPER_KEY_SETTINGS },
  launcherViewMode: 'expanded',
  navigationStyle: 'vim',
  clipboardHistoryRetentionDays: null,
  clipboardAppBlacklist: [],
  emojiPickerEnabled: true,
  emojiPickerTriggerPrefix: ':',
  emojiPickerExcludedAppBundleIds: [],
  browserSearch: {
    enabled: true,
    alphaChromiumRootSearchEnabled: false,
    historyRetentionDays: 90,
    profileSourceIds: [],
    profiles: [],
    profileFilters: {},
    resultLimitPerGroup: 2,
    resultGroups: [
      { kind: 'bookmark', limit: 2 },
      { kind: 'open-tab', limit: 2 },
      { kind: 'history', limit: 2 },
    ],
    nicknames: [],
    webSearchDefaultBangKey: 'g',
    webSearchBangOverrides: [],
    webSearchBangUsage: {},
    webSearchDisabledBangKeys: [],
    webSearchBangCustomProviders: [],
    webSearchShowHiddenBangs: false,
    webSearchSuggestionsEnabled: true,
  },
  rootSearchRanking: {},
  rootSearchAutocompleteEnabled: true,
  popToRootSearchTimeoutSeconds: 90,
  installedExtensions: [],
  extensionUninstallTombstones: {},
  extensionPreferences: {},
  extensionCommandPreferences: {},
  extensionCommandArguments: {},
  autoQuitApps: [],
  autoQuitDefaultTimeoutSeconds: 180,
};

let settingsCache: AppSettings | null = null;
let didMigrateAISecrets = false;
// True when the most recent loadSettings could not read the synced file
// AND the file appears to be iCloud-evicted. Blocks writes to the synced
// file so we don't overwrite the cloud copy with defaults.
let settingsLoadDegraded = false;

/**
 * Merge the AI settings parsed from settings.json with the encrypted vault.
 *
 * Resolution rules per field:
 *  - both empty                       → empty
 *  - vault only                       → use vault (steady state)
 *  - disk only                        → use disk (pending migration)
 *  - both set, equal                  → use either
 *  - both set, differ                 → prefer disk plaintext, since a non-empty
 *    plaintext value is evidence that an older app version (post-redaction
 *    downgrade) wrote it after the vault entry was created. Migration will
 *    forward this newer value into the vault.
 *
 * The returned object always reflects the *effective* values the app should
 * use at runtime — never empty just because something migrated.
 */
function hydrateAISettings(raw: any): AISettings {
  const merged: AISettings = { ...DEFAULT_AI_SETTINGS, ...(raw || {}) };
  for (const field of SENSITIVE_AI_KEYS) {
    const fromVault = getSecret(aiVaultKey(field));
    const fromDisk = typeof merged[field] === 'string' ? (merged[field] as string) : '';
    if (fromDisk && fromDisk !== fromVault) {
      merged[field] = fromDisk;
    } else {
      merged[field] = fromVault || fromDisk || '';
    }
  }
  return merged;
}

function normalizeFontSize(value: any): AppFontSize {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'x-small') return 'extra-small';
  if (normalized === 'x-large') return 'extra-large';
  if (
    normalized === 'extra-small' ||
    normalized === 'small' ||
    normalized === 'medium' ||
    normalized === 'large' ||
    normalized === 'extra-large'
  ) {
    return normalized;
  }
  return 'medium';
}

function normalizeUiStyle(value: any): AppUiStyle {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'glassy') return 'glassy';
  return 'default';
}

function normalizeNavigationStyle(value: any): AppNavigationStyle {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'macos') return 'macos';
  return 'vim';
}

function normalizeBundleIdList(value: any): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const normalized = String(entry || '').trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

const ALLOWED_CLIPBOARD_RETENTION_DAYS = new Set([1, 7, 30, 90, 180, 365]);

const ALLOWED_POP_TO_ROOT_TIMEOUTS = new Set([0, 5, 15, 30, 60, 90, 120]);

function normalizePopToRootSearchTimeoutSeconds(value: any): number {
  if (value === undefined || value === null) {
    return DEFAULT_SETTINGS.popToRootSearchTimeoutSeconds;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.popToRootSearchTimeoutSeconds;
  const int = Math.trunc(num);
  if (ALLOWED_POP_TO_ROOT_TIMEOUTS.has(int)) return int;
  return DEFAULT_SETTINGS.popToRootSearchTimeoutSeconds;
}

function normalizeClipboardHistoryRetentionDays(value: any): number | null {
  if (value === null) return null;
  if (value === undefined) return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
  const int = Math.trunc(num);
  if (ALLOWED_CLIPBOARD_RETENTION_DAYS.has(int)) return int;
  return DEFAULT_SETTINGS.clipboardHistoryRetentionDays;
}

const ALLOWED_BROWSER_SEARCH_RETENTION_DAYS = new Set([7, 30, 90, 180, 365]);

function normalizeBrowserSearchRetentionDays(value: any): number | null {
  if (value === null) return null;
  if (value === undefined) return DEFAULT_SETTINGS.browserSearch.historyRetentionDays;
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.browserSearch.historyRetentionDays;
  const int = Math.trunc(num);
  if (ALLOWED_BROWSER_SEARCH_RETENTION_DAYS.has(int)) return int;
  return DEFAULT_SETTINGS.browserSearch.historyRetentionDays;
}

function normalizeBrowserSearchProfileSourceIds(value: any): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const id = String(item || '').trim();
    if (!/^[a-z]+:.+$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const BROWSER_SEARCH_SOURCE_NAMES: Record<BrowserSearchSource, string> = {
  user: 'Browser',
  helium: 'Helium',
  chrome: 'Google Chrome',
  arc: 'Arc',
  brave: 'Brave Browser',
  edge: 'Microsoft Edge',
  vivaldi: 'Vivaldi',
  safari: 'Safari',
  firefox: 'Firefox',
};

function normalizeBrowserSearchSource(value: any): BrowserSearchSource | null {
  const id = String(value || '').trim().toLowerCase() as BrowserSearchSource;
  return id in BROWSER_SEARCH_SOURCE_NAMES ? id : null;
}

function profileLabelFromId(profileId: string): string {
  if (profileId === 'Default') return 'Default';
  const match = /^Profile\s+(\d+)$/i.exec(profileId);
  return match ? `Profile ${match[1]}` : profileId;
}

function normalizeBrowserSearchProfiles(value: any, legacyProfileSourceIds: string[]): BrowserProfileSetting[] {
  const byId = new Map<string, BrowserProfileSetting>();
  const addProfile = (raw: any, fallbackOrder: number) => {
    if (!raw || typeof raw !== 'object') return;
    const rawId = String(raw.id || '').trim();
    const browserId = normalizeBrowserSearchSource(raw.browserId || rawId.split(':')[0]);
    const profileId = String(raw.profileId || rawId.split(':').slice(1).join(':') || '').trim();
    if (!browserId || !profileId || browserId === 'user') return;
    const id = `${browserId}:${profileId}`;
    if (!/^[a-z]+:.+$/.test(id) || byId.has(id)) return;
    const browserName = String(raw.browserName || BROWSER_SEARCH_SOURCE_NAMES[browserId]).trim() || BROWSER_SEARCH_SOURCE_NAMES[browserId];
    const detectedName = String(raw.detectedName || raw.profileName || profileLabelFromId(profileId)).trim() || profileLabelFromId(profileId);
    const displayName = String(raw.displayName || detectedName).replace(/\s+/g, ' ').trim().slice(0, 120) || detectedName;
    const order = Number.isFinite(Number(raw.order)) ? Math.max(0, Math.floor(Number(raw.order))) : fallbackOrder;
    byId.set(id, {
      id,
      browserId,
      browserName,
      profileId,
      detectedName,
      displayName,
      order,
    });
  };

  if (Array.isArray(value)) {
    value.forEach((item, index) => addProfile(item, index));
  }

  if (byId.size === 0) {
    legacyProfileSourceIds.forEach((id, index) => {
      const [browserId, ...profileParts] = String(id || '').split(':');
      const source = normalizeBrowserSearchSource(browserId);
      const profileId = profileParts.join(':').trim();
      if (!source || !profileId || source === 'user') return;
      const detectedName = profileLabelFromId(profileId);
      addProfile({
        id: `${source}:${profileId}`,
        browserId: source,
        browserName: BROWSER_SEARCH_SOURCE_NAMES[source],
        profileId,
        detectedName,
        displayName: detectedName,
        order: index,
      }, index);
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.order - b.order || a.browserName.localeCompare(b.browserName) || a.displayName.localeCompare(b.displayName))
    .map((profile, index) => ({ ...profile, order: index }));
}

function normalizeBrowserProfileFilterIds(value: any): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = normalizeBrowserSearchProfileSourceIds(value);
  return ids;
}

function normalizeBrowserProfileFilters(value: any): BrowserProfileFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: BrowserProfileFilters = {};
  for (const kind of ['open-tab', 'bookmark', 'history'] as BrowserProfileFilterKind[]) {
    const ids = normalizeBrowserProfileFilterIds(value[kind]);
    if (ids !== undefined) out[kind] = ids;
  }
  return out;
}

const BROWSER_SEARCH_RESULT_KINDS: BrowserSearchResultKind[] = ['bookmark', 'open-tab', 'history'];

function normalizeBrowserSearchResultLimit(value: any, fallback: number): number {
  const limit = Math.floor(Number(value));
  return Number.isFinite(limit) ? Math.max(0, Math.min(8, limit)) : fallback;
}

function normalizeBrowserSearchResultGroups(value: any, legacyLimit: number): BrowserSearchResultGroupSetting[] {
  const fallback = DEFAULT_SETTINGS.browserSearch.resultGroups;
  const seen = new Set<BrowserSearchResultKind>();
  const groups: BrowserSearchResultGroupSetting[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      const kind = String(item?.kind || '') as BrowserSearchResultKind;
      if (!BROWSER_SEARCH_RESULT_KINDS.includes(kind)) continue;
      if (seen.has(kind)) continue;
      seen.add(kind);
      const fallbackLimit = fallback.find((group) => group.kind === kind)?.limit ?? legacyLimit;
      groups.push({ kind, limit: normalizeBrowserSearchResultLimit(item?.limit, fallbackLimit) });
    }
  }

  const shouldUseLegacyLimit = groups.length === 0;
  for (const kind of BROWSER_SEARCH_RESULT_KINDS) {
    if (seen.has(kind)) continue;
    const fallbackLimit = shouldUseLegacyLimit
      ? legacyLimit
      : fallback.find((group) => group.kind === kind)?.limit ?? legacyLimit;
    groups.push({ kind, limit: fallbackLimit });
  }

  return groups;
}

function normalizeBrowserSearchNicknames(value: any): BrowserSearchNicknameSetting[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, BrowserSearchNicknameSetting>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = String(item.source || '').trim();
    const sourceProfileId = String(item.sourceProfileId || '').trim();
    const url = String(item.url || '').trim();
    const nickname = normalizeBrowserSearchNickname(item.nickname);
    if (!source || !url || !nickname) continue;
    const key = [source, sourceProfileId, normalizeBrowserSearchNicknameUrl(url)].join(':');
    byKey.set(key, {
      source,
      sourceProfileId: sourceProfileId || undefined,
      url,
      nickname,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.nickname.localeCompare(b.nickname));
}

function normalizeWebSearchDefaultBangKey(value: any): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/^!+/, '');
  if (/^[a-z0-9][a-z0-9-]{0,31}$/.test(normalized)) return normalized;
  return DEFAULT_SETTINGS.browserSearch.webSearchDefaultBangKey;
}

function normalizeWebSearchBangKey(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^!+/, '').replace(/[^a-z0-9.+_-]/g, '').slice(0, 64);
}

function normalizeWebSearchBangOverrides(value: any): WebSearchBangOverrideSetting[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, WebSearchBangOverrideSetting>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const key = normalizeWebSearchBangKey(item.key);
    if (!key) continue;
    const aliases: string[] = Array.isArray(item.aliases)
      ? item.aliases.map((alias: unknown) => String(alias || ''))
      : String(item.aliases || '').split(',');
    const cleanAliases: string[] = Array.from(new Set<string>(
      aliases
        .map((alias) => normalizeWebSearchBangKey(alias))
        .filter(Boolean)
    ));
    if (cleanAliases.length === 0) continue;
    byKey.set(key, { key, aliases: cleanAliases });
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeWebSearchBangUsage(value: any): Record<string, WebSearchBangUsageSetting> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, WebSearchBangUsageSetting> = {};
  for (const [rawKey, rawUsage] of Object.entries(value)) {
    const key = normalizeWebSearchBangKey(rawKey);
    if (!key || !rawUsage || typeof rawUsage !== 'object' || Array.isArray(rawUsage)) continue;
    const usage = rawUsage as Record<string, unknown>;
    const useCount = Math.max(0, Math.floor(Number(usage.useCount) || 0));
    const lastUsedAt = Math.max(0, Math.floor(Number(usage.lastUsedAt) || 0));
    const frecencyScore = Math.max(0, Number(usage.frecencyScore) || 0);
    if (useCount <= 0 && frecencyScore <= 0) continue;
    result[key] = { useCount, lastUsedAt, frecencyScore };
  }
  return result;
}

function normalizeWebSearchDisabledBangKeys(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeWebSearchBangKey(item)).filter(Boolean))).sort();
}

function normalizeWebSearchBangTemplate(value: any): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.includes('{query}') ? raw : raw.replace(/\{\{\{s\}\}\}/g, '{query}');
}

function normalizeWebSearchBangCustomProviders(value: any): WebSearchBangCustomProviderSetting[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, WebSearchBangCustomProviderSetting>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const key = normalizeWebSearchBangKey(item.key);
    if (!key) continue;
    const aliases: string[] = Array.isArray(item.aliases)
      ? item.aliases.map((alias: unknown) => String(alias || ''))
      : String(item.aliases || '').split(',');
    const cleanAliases = Array.from(new Set(aliases.map((alias) => normalizeWebSearchBangKey(alias)).filter((alias) => alias && alias !== key)));
    const name = String(item.name || key).trim().slice(0, 120);
    const host = String(item.host || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').slice(0, 200);
    const template = normalizeWebSearchBangTemplate(item.template || item.urlTemplate);
    if (!name || !host || !template) continue;
    byKey.set(key, { key, aliases: cleanAliases, name, host, template });
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeBrowserSearchNickname(value: any): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);
}

function normalizeBrowserSearchNicknameUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return String(value || '').trim().toLowerCase().replace(/\/+$/, '');
  }
}

function normalizeBrowserSearchSettings(value: any): BrowserSearchSettings {
  const fallback = DEFAULT_SETTINGS.browserSearch;
  const resultLimit = normalizeBrowserSearchResultLimit(value?.resultLimitPerGroup, fallback.resultLimitPerGroup);
  if (!value || typeof value !== 'object') return { ...fallback };
  const profileSourceIds = normalizeBrowserSearchProfileSourceIds(value.profileSourceIds);
  const hasProfilesField = Array.isArray(value.profiles);
  const profiles = normalizeBrowserSearchProfiles(value.profiles, hasProfilesField ? [] : profileSourceIds);
  const effectiveProfileSourceIds = profiles.map((profile) => profile.id);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    alphaChromiumRootSearchEnabled: typeof value.alphaChromiumRootSearchEnabled === 'boolean'
      ? value.alphaChromiumRootSearchEnabled
      : fallback.alphaChromiumRootSearchEnabled,
    historyRetentionDays: normalizeBrowserSearchRetentionDays(value.historyRetentionDays),
    profileSourceIds: effectiveProfileSourceIds,
    profiles,
    profileFilters: normalizeBrowserProfileFilters(value.profileFilters),
    resultLimitPerGroup: resultLimit,
    resultGroups: normalizeBrowserSearchResultGroups(value.resultGroups, resultLimit || fallback.resultLimitPerGroup),
    nicknames: normalizeBrowserSearchNicknames(value.nicknames),
    webSearchDefaultBangKey: normalizeWebSearchDefaultBangKey(value.webSearchDefaultBangKey),
    webSearchBangOverrides: normalizeWebSearchBangOverrides(value.webSearchBangOverrides),
    webSearchBangUsage: normalizeWebSearchBangUsage(value.webSearchBangUsage),
    webSearchDisabledBangKeys: normalizeWebSearchDisabledBangKeys(value.webSearchDisabledBangKeys),
    webSearchBangCustomProviders: normalizeWebSearchBangCustomProviders(value.webSearchBangCustomProviders),
    webSearchShowHiddenBangs: Boolean(value.webSearchShowHiddenBangs),
    webSearchSuggestionsEnabled: typeof value.webSearchSuggestionsEnabled === 'boolean'
      ? value.webSearchSuggestionsEnabled
      : fallback.webSearchSuggestionsEnabled,
  };
}

function normalizeRootSearchRanking(value: any): Record<string, RootSearchRankingSetting> {
  if (!value || typeof value !== 'object') return {};
  const now = Date.now();
  const result: Record<string, RootSearchRankingSetting> = {};
  for (const [rawKey, rawEntry] of Object.entries(value)) {
    const key = String(rawKey || '').trim();
    const entry = rawEntry as any;
    if (!key || !entry || typeof entry !== 'object') continue;
    const lastUsedAt = Math.max(0, Number(entry.lastUsedAt || 0));
    const frecencyScore = Math.max(0, Number(entry.frecencyScore || 0));
    const ageDays = lastUsedAt ? Math.max(0, (now - lastUsedAt) / (24 * 60 * 60 * 1000)) : Number.MAX_SAFE_INTEGER;
    if (ageDays > 120 && frecencyScore < 0.05) continue;
    const inputHistory: Record<string, RootSearchRankingInputHistorySetting> = {};
    if (entry.inputHistory && typeof entry.inputHistory === 'object') {
      for (const [rawInputKey, rawInput] of Object.entries(entry.inputHistory)) {
        const inputKey = String(rawInputKey || '').trim().slice(0, 120);
        const input = rawInput as any;
        if (!inputKey || !input || typeof input !== 'object') continue;
        inputHistory[inputKey] = {
          useCount: Math.max(0, Math.floor(Number(input.useCount || 0))),
          lastUsedAt: Math.max(0, Number(input.lastUsedAt || 0)),
          score: Math.max(0, Number(input.score || 0)),
        };
      }
    }
    result[key] = {
      useCount: Math.max(0, Math.floor(Number(entry.useCount || 0))),
      lastUsedAt,
      frecencyScore,
      inputHistory,
    };
  }
  return result;
}

function normalizeAppLanguage(value: any): AppLanguage {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === 'system' || normalized === 'auto') return 'system';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (
    normalized === 'zh' ||
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized === 'zh-hans' ||
    normalized.startsWith('zh-hans-')
  ) {
    return 'zh-Hans';
  }
  if (
    normalized === 'zh-tw' ||
    normalized === 'zh-hk' ||
    normalized === 'zh-mo' ||
    normalized === 'zh-hant' ||
    normalized.startsWith('zh-hant-')
  ) {
    return 'zh-Hant';
  }
  if (normalized === 'ja' || normalized === 'jp' || normalized.startsWith('ja-')) return 'ja';
  if (normalized === 'ko' || normalized === 'kr' || normalized.startsWith('ko-')) return 'ko';
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr';
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de';
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es';
  if (normalized === 'ru' || normalized.startsWith('ru-')) return 'ru';
  if (normalized === 'it' || normalized.startsWith('it-')) return 'it';
  return DEFAULT_SETTINGS.appLanguage;
}

function normalizeBaseColor(value: any): string {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const short = raw.slice(1).split('').map((ch) => `${ch}${ch}`).join('');
    return `#${short}`.toLowerCase();
  }
  return DEFAULT_SETTINGS.baseColor;
}

function normalizeLauncherBackgroundImagePath(value: any): string {
  return String(value || '').trim();
}

function normalizePercentage(value: any, fallback: number): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsedValue)));
}

function normalizeBoolean(value: any, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeInstalledExtensions(value: any): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const name = String(entry || '').trim();
    if (!name) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function normalizeExtensionUninstallTombstones(value: any): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, rawTimestamp] of Object.entries(value as Record<string, unknown>)) {
    const name = String(key || '').trim();
    if (!name) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    const timestamp = Number(rawTimestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    out[name] = Math.floor(timestamp);
  }
  return out;
}

/**
 * Defensive shape-check for extension preferences / arguments. Returns
 * { [extName]: { [prefName]: unknown } } shape, dropping invalid keys.
 */
function normalizeExtensionStorageMap(value: any): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, payload] of Object.entries(value as Record<string, unknown>)) {
    const trimmed = String(key || '').trim();
    if (!trimmed) continue;
    if (!payload || typeof payload !== 'object') continue;
    const inner: Record<string, unknown> = {};
    for (const [prefName, prefValue] of Object.entries(payload as Record<string, unknown>)) {
      const prefKey = String(prefName || '').trim();
      if (!prefKey) continue;
      inner[prefKey] = prefValue;
    }
    out[trimmed] = inner;
  }
  return out;
}

function normalizeRecentCommandLaunchCounts(value: any): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const normalized: Record<string, number> = {};
  for (const [commandId, launchCount] of Object.entries(value as Record<string, any>)) {
    const id = String(commandId || '').trim();
    if (!id) continue;
    const parsedCount = Number(launchCount);
    if (!Number.isFinite(parsedCount) || parsedCount <= 0) continue;
    normalized[id] = Math.floor(parsedCount);
  }
  return normalized;
}

// ─── Settings Location Pointer ────────────────────────────────────
// A tiny pointer file in userData that records where settings.json
// actually lives. Empty/missing → use the userData default. This is
// a chicken-and-egg requirement: the location of settings.json
// cannot itself be stored inside settings.json.

const SETTINGS_FILENAME = 'settings.json';
const LOCAL_SETTINGS_FILENAME = 'settings.local.json';
const LOCATION_FILENAME = 'settings-location.json';

// Fields that must NEVER sync between Macs. They're routed to settings.local.json
// on save and stripped from settings.json's payload — each piece of data has
// exactly one home on disk. Reasons in code comments next to each entry below.
const NEVER_SYNC: ReadonlySet<keyof AppSettings> = new Set<keyof AppSettings>([
  // Absolute paths — won't resolve on the other Mac.
  'customExtensionFolders',
  'pinnedFiles',
  'launcherBackgroundImagePath',
  // Tied to a per-machine TCC (macOS file-access) permission grant.
  'fileSearchProtectedRootsEnabled',
  // Per-machine timing / dismissal state.
  'appUpdaterLastCheckedAt',
  'updateBannerDismissedAt',
  'updateBannerDismissedVersion',
  // Extensions write per-machine state (e.g. unread counts) here.
  'commandMetadata',
]);

let settingsLocationCache: string | null | undefined = undefined; // undefined = not loaded
let lastSelfWriteMtimeMs = 0;
function getLocalSettingsPath(): string {
  return path.join(app.getPath('userData'), LOCAL_SETTINGS_FILENAME);
}

// ─── iCloud Drive coordination ─────────────────────────────────────
// iCloud Drive's "Optimize Mac Storage" can evict the synced settings
// file, replacing it with a tiny `.<basename>.icloud` placeholder.
// Reading the path then either returns garbage or fails — and writing
// defaults over the placeholder destroys the cloud copy.
//
// To avoid that, when we detect the settings file is in iCloud Drive
// we shell out to a tiny Swift helper that wraps NSFileCoordinator's
// coordinated read, which forces iCloud to materialize the file before
// we touch it. For all other paths (Dropbox, Nextcloud, plain disk) we
// skip the spawn entirely — those services don't evict.

const MOBILE_DOCS_PREFIX = path.join(app.getPath('home'), 'Library', 'Mobile Documents');

/**
 * Detect whether `targetPath` lives inside iCloud Drive (or a per-app
 * iCloud container). Resolves symlinks so users who symlink a sync
 * folder into iCloud are still detected. Cheap — just a stat + string
 * compare.
 */
function isPathInICloud(targetPath: string): boolean {
  if (process.platform !== 'darwin') return false;
  const tryResolve = (p: string): string | null => {
    try { return fs.realpathSync(p); } catch { return null; }
  };
  // Try the file first; if it doesn't exist (fresh sync target), fall
  // back to the parent directory which always does.
  const resolved = tryResolve(targetPath) ?? tryResolve(path.dirname(targetPath));
  if (!resolved) return false;
  return resolved === MOBILE_DOCS_PREFIX || resolved.startsWith(MOBILE_DOCS_PREFIX + path.sep);
}

/** Returns the path of the iCloud sentinel file iCloud writes when it
 *  evicts the real file. e.g. `.../settings.json` → `.../.settings.json.icloud`. */
function getICloudSentinelPath(targetPath: string): string {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.icloud`);
}

/** True if iCloud has evicted the file (sentinel exists, real file may
 *  or may not be present in placeholder form). */
function hasICloudSentinel(targetPath: string): boolean {
  try {
    return fs.existsSync(getICloudSentinelPath(targetPath));
  } catch {
    return false;
  }
}

export function settingsFileExistsOrICloudPlaceholder(targetPath: string): boolean {
  try {
    return fs.existsSync(targetPath) || hasICloudSentinel(targetPath);
  } catch {
    return false;
  }
}

/**
 * If `targetPath` lives in iCloud Drive, ask iCloud to materialize it
 * (download from the cloud, evict no longer applicable) before we read.
 * No-op for non-iCloud paths so Dropbox/Nextcloud/plain disk users pay
 * zero spawn overhead.
 *
 * Returns true iff materialization is *not needed* OR succeeded. Returns
 * false only when we tried to materialize and the helper failed — caller
 * can use that as a signal that the read is about to fail.
 *
 * Synchronous by design: settings reads at startup must complete before
 * the rest of the app runs. The 5-second timeout caps the worst case
 * if iCloud is offline.
 */
function materializeICloudFileIfNeeded(targetPath: string): boolean {
  if (!isPathInICloud(targetPath)) return true;
  const binary = getNativeBinaryPath('settings-coordinator');
  if (!fs.existsSync(binary)) {
    console.warn(`[Settings] iCloud helper binary not found at ${binary}; skipping materialization. Run \`npm run build:native\`.`);
    return true;
  }
  try {
    const result = spawnSync(binary, [targetPath], {
      timeout: 5000,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (result.status === 0) return true;
    const stderr = result.stderr?.toString().trim() || '(no stderr)';
    const exitInfo = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    console.warn(`[Settings] iCloud materialization failed (${exitInfo}): ${stderr}`);
    return false;
  } catch (e: any) {
    console.warn(`[Settings] iCloud materialization spawn failed: ${e?.message || e}`);
    return false;
  }
}

/**
 * Read the per-machine local-overrides file. Always at userData; never moves.
 * Missing/malformed file → empty object (no overrides).
 */
function loadLocalSettings(): Partial<AppSettings> {
  try {
    const raw = fs.readFileSync(getLocalSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Partial<AppSettings>;
  } catch {
    // missing file is fine
  }
  return {};
}

function getSettingsLocationPath(): string {
  return path.join(app.getPath('userData'), LOCATION_FILENAME);
}

function getDefaultSettingsDir(): string {
  return app.getPath('userData');
}

export function getDefaultSettingsPath(): string {
  return path.join(getDefaultSettingsDir(), SETTINGS_FILENAME);
}

export function loadSettingsLocation(): string | null {
  if (settingsLocationCache !== undefined) return settingsLocationCache;
  try {
    const raw = fs.readFileSync(getSettingsLocationPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const candidate = typeof parsed?.path === 'string' ? parsed.path.trim() : '';
    if (candidate && fs.existsSync(candidate)) {
      settingsLocationCache = candidate;
    } else {
      if (candidate) {
        console.warn(`settings-location: configured path missing, falling back to default: ${candidate}`);
      }
      settingsLocationCache = null;
    }
  } catch {
    settingsLocationCache = null;
  }
  return settingsLocationCache ?? null;
}

function writeSettingsLocation(absoluteDir: string | null): void {
  const target = getSettingsLocationPath();
  if (absoluteDir) {
    const payload = JSON.stringify({ path: absoluteDir }, null, 2);
    fs.writeFileSync(target, payload);
  } else {
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (e) {
      console.error('Failed to clear settings-location pointer:', e);
    }
  }
  settingsLocationCache = absoluteDir;
  // The degraded flag is keyed to the previous path; a location change
  // invalidates it. The next loadSettings will re-evaluate against the
  // new path.
  settingsLoadDegraded = false;
}

function getSettingsPath(): string {
  const configured = loadSettingsLocation();
  if (configured) return path.join(configured, SETTINGS_FILENAME);
  return getDefaultSettingsPath();
}

export function loadSettings(): AppSettings {
  if (settingsCache) return { ...settingsCache };

  const settingsPath = getSettingsPath();
  // For iCloud paths, ask iCloud to materialize before we read.
  // No-op for non-iCloud paths.
  materializeICloudFileIfNeeded(settingsPath);

  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    settingsLoadDegraded = false;
    const parsedSync = JSON.parse(raw);
    // Local-overrides file. Any key here wins over the synced file — both
    // for NEVER_SYNC fields (which are routed here on save) and for any
    // arbitrary keys a power user might add by hand.
    const parsedLocal = loadLocalSettings();
    const parsed: any = { ...parsedSync, ...parsedLocal };
    const parsedHotkeys = { ...(parsed.commandHotkeys || {}) };
    const parsedAliases = { ...(parsed.commandAliases || {}) } as Record<string, any>;
    const hasParsedHotkey = (key: string) => Object.prototype.hasOwnProperty.call(parsedHotkeys, key);
    if (!hasParsedHotkey('system-supercmd-whisper-speak-toggle')) {
      if (parsedHotkeys['system-supercmd-whisper-start']) {
        parsedHotkeys['system-supercmd-whisper-speak-toggle'] = parsedHotkeys['system-supercmd-whisper-start'];
      } else if (parsedHotkeys['system-supercmd-whisper-stop']) {
        parsedHotkeys['system-supercmd-whisper-speak-toggle'] = parsedHotkeys['system-supercmd-whisper-stop'];
      }
    }
    if (hasParsedHotkey('system-supercmd-whisper-toggle')) {
      if (!hasParsedHotkey('system-supercmd-whisper-start')) {
        parsedHotkeys['system-supercmd-whisper-start'] = parsedHotkeys['system-supercmd-whisper-toggle'];
      }
      if (!hasParsedHotkey('system-supercmd-whisper')) {
        parsedHotkeys['system-supercmd-whisper'] = parsedHotkeys['system-supercmd-whisper-toggle'];
      }
    }
    delete parsedHotkeys['system-supercmd-whisper-toggle'];
    delete parsedHotkeys['system-supercmd-whisper-start'];
    delete parsedHotkeys['system-supercmd-whisper-stop'];
    const normalizedAliases: Record<string, string> = {};
    for (const [commandId, aliasValue] of Object.entries(parsedAliases)) {
      const normalizedCommandId = String(commandId || '').trim();
      const normalizedAlias = String(aliasValue || '').trim();
      if (!normalizedCommandId || !normalizedAlias) continue;
      normalizedAliases[normalizedCommandId] = normalizedAlias;
    }
    settingsCache = {
      globalShortcut: parsed.globalShortcut ?? DEFAULT_SETTINGS.globalShortcut,
      openAtLogin: parsed.openAtLogin ?? DEFAULT_SETTINGS.openAtLogin,
      disabledCommands: parsed.disabledCommands ?? DEFAULT_SETTINGS.disabledCommands,
      enabledCommands: parsed.enabledCommands ?? DEFAULT_SETTINGS.enabledCommands,
      customExtensionFolders: Array.isArray(parsed.customExtensionFolders)
        ? parsed.customExtensionFolders
            .map((value: any) => String(value || '').trim())
            .filter(Boolean)
        : DEFAULT_SETTINGS.customExtensionFolders,
      scriptCommandFolders: Array.isArray(parsed.scriptCommandFolders)
        ? parsed.scriptCommandFolders
            .map((value: any) => String(value || '').trim())
            .filter(Boolean)
        : DEFAULT_SETTINGS.scriptCommandFolders,
      commandHotkeys: {
        ...DEFAULT_SETTINGS.commandHotkeys,
        ...parsedHotkeys,
      },
      commandAliases: {
        ...DEFAULT_SETTINGS.commandAliases,
        ...normalizedAliases,
      },
      pinnedCommands: parsed.pinnedCommands ?? DEFAULT_SETTINGS.pinnedCommands,
      pinnedFiles: Array.isArray(parsed.pinnedFiles)
        ? parsed.pinnedFiles
            .map((value: any) => String(value || '').trim())
            .filter(Boolean)
        : DEFAULT_SETTINGS.pinnedFiles,
      recentCommands: parsed.recentCommands ?? DEFAULT_SETTINGS.recentCommands,
      recentCommandLaunchCounts: normalizeRecentCommandLaunchCounts(parsed.recentCommandLaunchCounts),
      // Existing users with older settings should not be forced into onboarding.
      hasSeenOnboarding:
        parsed.hasSeenOnboarding ?? true,
      hasSeenWhisperOnboarding:
        parsed.hasSeenWhisperOnboarding ?? false,
      fileSearchProtectedRootsEnabled:
        parsed.fileSearchProtectedRootsEnabled ?? DEFAULT_SETTINGS.fileSearchProtectedRootsEnabled,
      disableFileSearchResults: normalizeBoolean(
        parsed.disableFileSearchResults,
        DEFAULT_SETTINGS.disableFileSearchResults
      ),
      showMenuBarIcon: normalizeBoolean(
        parsed.showMenuBarIcon,
        DEFAULT_SETTINGS.showMenuBarIcon
      ),
      ai: hydrateAISettings(parsed.ai),
      hyperKey: { ...DEFAULT_HYPER_KEY_SETTINGS, ...parsed.hyperKey },
      commandMetadata: parsed.commandMetadata ?? {},
      debugMode: parsed.debugMode ?? DEFAULT_SETTINGS.debugMode,
      appLanguage: normalizeAppLanguage(parsed.appLanguage),
      fontSize: normalizeFontSize(parsed.fontSize),
      uiStyle: normalizeUiStyle(parsed.uiStyle),
      baseColor: normalizeBaseColor(parsed.baseColor),
      launcherBackgroundImagePath: normalizeLauncherBackgroundImagePath(parsed.launcherBackgroundImagePath),
      launcherBackgroundImageEverywhere: normalizeBoolean(
        parsed.launcherBackgroundImageEverywhere,
        DEFAULT_SETTINGS.launcherBackgroundImageEverywhere
      ),
      launcherBackgroundImageBlurPercent: normalizePercentage(
        parsed.launcherBackgroundImageBlurPercent,
        DEFAULT_SETTINGS.launcherBackgroundImageBlurPercent
      ),
      launcherBackgroundImageOpacityPercent: normalizePercentage(
        parsed.launcherBackgroundImageOpacityPercent,
        DEFAULT_SETTINGS.launcherBackgroundImageOpacityPercent
      ),
      appUpdaterLastCheckedAt: Number.isFinite(Number(parsed.appUpdaterLastCheckedAt))
        ? Math.max(0, Number(parsed.appUpdaterLastCheckedAt))
        : DEFAULT_SETTINGS.appUpdaterLastCheckedAt,
      updateBannerDismissedAt: Number.isFinite(Number(parsed.updateBannerDismissedAt))
        ? Math.max(0, Number(parsed.updateBannerDismissedAt))
        : undefined,
      updateBannerDismissedVersion: typeof parsed.updateBannerDismissedVersion === 'string'
        ? parsed.updateBannerDismissedVersion
        : undefined,
      launcherViewMode: (parsed.launcherViewMode === 'compact' ? 'compact' : 'expanded'),
      navigationStyle: normalizeNavigationStyle(parsed.navigationStyle),
      clipboardHistoryRetentionDays: normalizeClipboardHistoryRetentionDays(parsed.clipboardHistoryRetentionDays),
      clipboardAppBlacklist: normalizeBundleIdList(parsed.clipboardAppBlacklist),
      emojiPickerEnabled: typeof parsed.emojiPickerEnabled === 'boolean' ? parsed.emojiPickerEnabled : DEFAULT_SETTINGS.emojiPickerEnabled,
      emojiPickerTriggerPrefix: typeof parsed.emojiPickerTriggerPrefix === 'string' && parsed.emojiPickerTriggerPrefix.length > 0
        ? parsed.emojiPickerTriggerPrefix
        : DEFAULT_SETTINGS.emojiPickerTriggerPrefix,
      emojiPickerExcludedAppBundleIds: normalizeBundleIdList(parsed.emojiPickerExcludedAppBundleIds),
      browserSearch: normalizeBrowserSearchSettings(parsed.browserSearch),
      rootSearchRanking: normalizeRootSearchRanking(parsed.rootSearchRanking),
      rootSearchAutocompleteEnabled: typeof parsed.rootSearchAutocompleteEnabled === 'boolean'
        ? parsed.rootSearchAutocompleteEnabled
        : DEFAULT_SETTINGS.rootSearchAutocompleteEnabled,
      popToRootSearchTimeoutSeconds: normalizePopToRootSearchTimeoutSeconds(parsed.popToRootSearchTimeoutSeconds),
      installedExtensions: normalizeInstalledExtensions(parsed.installedExtensions),
      extensionUninstallTombstones: normalizeExtensionUninstallTombstones(parsed.extensionUninstallTombstones),
      extensionPreferences: normalizeExtensionStorageMap(parsed.extensionPreferences),
      extensionCommandPreferences: normalizeExtensionStorageMap(parsed.extensionCommandPreferences),
      extensionCommandArguments: normalizeExtensionStorageMap(parsed.extensionCommandArguments),
      autoQuitApps: Array.isArray(parsed.autoQuitApps) ? parsed.autoQuitApps : DEFAULT_SETTINGS.autoQuitApps,
      autoQuitDefaultTimeoutSeconds: typeof parsed.autoQuitDefaultTimeoutSeconds === 'number' ? parsed.autoQuitDefaultTimeoutSeconds : DEFAULT_SETTINGS.autoQuitDefaultTimeoutSeconds,
    };
  } catch {
    // settings.json missing or malformed (fresh install, sync not yet
    // delivered, iCloud evicted, etc.). Still honor settings.local.json
    // so the user's per-machine fields aren't wiped just because the
    // synced file is briefly absent.
    settingsCache = { ...DEFAULT_SETTINGS, ...loadLocalSettings() };
    // Decide whether the missing/unreadable file represents a genuine
    // empty-state (fresh install at the default location) or a sync
    // delivery gap that we must not paper over with defaults:
    //   - iCloud + sentinel present → evicted; cloud copy is real.
    //   - Custom sync location configured → relocateSettingsFile always
    //     writes settings.json into the target before pointing at it,
    //     so its later absence means the cloud client hasn't delivered
    //     (or was uninstalled/replaced). Block writes so we don't
    //     clobber the synced copy with defaults.
    //   - Default userData path → no file means fresh install; defaults
    //     are correct.
    const inICloudWithSentinel = isPathInICloud(settingsPath) && hasICloudSentinel(settingsPath);
    const usingCustomSyncLocation = loadSettingsLocation() !== null;
    settingsLoadDegraded = inICloudWithSentinel || usingCustomSyncLocation;
    if (inICloudWithSentinel) {
      console.warn(`[Settings] iCloud-evicted settings could not be materialized at ${settingsPath}; writes to the synced file are blocked until iCloud delivers the bytes.`);
    } else if (usingCustomSyncLocation) {
      console.warn(`[Settings] Configured sync location at ${settingsPath} has no readable settings.json; writes are blocked until the sync client delivers the file.`);
    }
  }

  migrateAISecretsToVaultIfNeeded();
  return { ...settingsCache };
}

/**
 * One-shot migration: lift any plain-text AI keys out of settings.json into
 * the safe-storage vault. Disk plaintext is only redacted *per field* once
 * we've confirmed the vault write succeeded — a failed vault write must not
 * destroy the only durable copy of the user's key. Any field whose vault
 * write fails stays as plaintext on disk and will be retried next launch.
 *
 * If disk plaintext differs from vault for a field, disk wins and overwrites
 * vault (downgrade-then-upgrade conflict resolution).
 *
 * The in-memory `settingsCache` keeps the decrypted values so runtime
 * behaviour is unchanged.
 */
function migrateAISecretsToVaultIfNeeded(): void {
  if (didMigrateAISecrets) return;
  didMigrateAISecrets = true;
  if (!settingsCache) return;

  const diskValues = readSensitiveAIKeysFromDisk();
  const safelyRedactable = new Set<SensitiveAIKey>();
  let needsRedaction = false;

  for (const field of SENSITIVE_AI_KEYS) {
    const fromDisk = diskValues[field] || '';
    if (!fromDisk) continue;
    needsRedaction = true;
    const fromVault = getSecret(aiVaultKey(field));
    if (fromDisk === fromVault) {
      // Already consistent — safe to redact disk without another vault write.
      safelyRedactable.add(field);
      continue;
    }
    // Disk plaintext is authoritative (newer or first-time migration).
    if (setSecret(aiVaultKey(field), fromDisk)) {
      settingsCache.ai[field] = fromDisk;
      safelyRedactable.add(field);
    } else {
      console.warn(`safe-storage: vault write failed for ai.${field}; leaving plaintext on disk.`);
    }
  }

  if (needsRedaction && safelyRedactable.size > 0) {
    redactSensitiveAIKeysOnDisk(safelyRedactable);
  }
}

function readSensitiveAIKeysFromDisk(): Partial<Record<SensitiveAIKey, string>> {
  const out: Partial<Record<SensitiveAIKey, string>> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
    for (const field of SENSITIVE_AI_KEYS) {
      const value = parsed?.ai?.[field];
      if (typeof value === 'string' && value.length > 0) out[field] = value;
    }
  } catch {
    // missing or malformed file — nothing to migrate
  }
  return out;
}

/**
 * Rewrite settings.json with the given sensitive fields blanked out. Reads
 * the current file as-is (rather than serialising `settingsCache`) so we
 * never overwrite unrelated fields written by a concurrent process.
 */
function redactSensitiveAIKeysOnDisk(fields: Set<SensitiveAIKey>): void {
  if (fields.size === 0) return;
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  parsed.ai = parsed.ai || {};
  for (const field of fields) parsed.ai[field] = '';
  try {
    const target = getSettingsPath();
    fs.writeFileSync(target, JSON.stringify(parsed, null, 2));
    try {
      lastSelfWriteMtimeMs = fs.statSync(target).mtimeMs;
    } catch {
      // best-effort
    }
  } catch (e) {
    console.error('Failed to redact sensitive keys on disk:', e);
  }
}

/**
 * Write settings to disk, splitting NEVER_SYNC fields into a separate
 * per-machine file. Sensitive AI fields whose vault writes succeeded
 * (`safelyRedactable`) are blanked on disk; any others retain their
 * plaintext value as a durable fallback.
 *
 * On-disk shape:
 *   settings.json       – everything EXCEPT NEVER_SYNC keys (the synced file)
 *   settings.local.json – ONLY NEVER_SYNC keys (always at userData)
 *
 * Each piece of data has exactly one home. Inspecting either file shows
 * exactly what belongs there.
 */
interface PersistSettingsOptions {
  throwOnSyncedWriteFailure?: boolean;
}

function persistSettingsToDisk(
  settings: AppSettings,
  safelyRedactable: Set<SensitiveAIKey>,
  options: PersistSettingsOptions = {}
): void {
  const onDisk: AppSettings = {
    ...settings,
    ai: { ...settings.ai },
  };
  for (const field of SENSITIVE_AI_KEYS) {
    if (safelyRedactable.has(field)) onDisk.ai[field] = '';
  }

  const syncedOnDisk: Record<string, unknown> = { ...onDisk };
  const localOnDisk: Record<string, unknown> = {};
  for (const key of NEVER_SYNC) {
    if (key in syncedOnDisk) {
      const value = (syncedOnDisk as Record<string, unknown>)[key];
      if (value !== undefined) {
        localOnDisk[key] = value;
      }
      delete syncedOnDisk[key];
    }
  }

  // Refuse to write the synced file when the last load fell back to
  // defaults because the synced source wasn't readable (iCloud-evicted,
  // or a configured sync folder whose settings.json hadn't been
  // delivered yet). Writing now would propagate (mostly) default values
  // to every other Mac on this sync account and silently overwrite the
  // cloud copy. The local file is fine to keep updating — it's
  // per-machine and never evicted.
  if (settingsLoadDegraded) {
    const message = '[Settings] Refusing to write synced settings.json — last load was degraded (sync source unreadable). Local overrides will still be saved.';
    console.warn(message);
    if (options.throwOnSyncedWriteFailure) {
      throw new Error(message);
    }
  } else {
    try {
      const target = getSettingsPath();
      writeFileAtomic(target, JSON.stringify(syncedOnDisk, null, 2));
      try {
        lastSelfWriteMtimeMs = fs.statSync(target).mtimeMs;
      } catch {
        // best-effort — watcher will simply not skip this write
      }
    } catch (e) {
      console.error('Failed to save settings:', e);
      if (options.throwOnSyncedWriteFailure) {
        throw e;
      }
    }
  }

  try {
    writeFileAtomic(getLocalSettingsPath(), JSON.stringify(localOnDisk, null, 2));
  } catch (e) {
    console.error('Failed to save local settings:', e);
  }
}

interface SaveSettingsOptions {
  throwOnSyncedWriteFailure?: boolean;
}

function saveSettingsInternal(
  patch: Partial<AppSettings>,
  options: SaveSettingsOptions = {}
): AppSettings {
  const current = loadSettings();
  const updated = {
    ...current,
    ...patch,
    customExtensionFolders: Array.isArray(patch.customExtensionFolders ?? current.customExtensionFolders)
      ? (patch.customExtensionFolders ?? current.customExtensionFolders)
          .map((value: any) => String(value || '').trim())
          .filter(Boolean)
      : [],
    scriptCommandFolders: Array.isArray(patch.scriptCommandFolders ?? current.scriptCommandFolders)
      ? (patch.scriptCommandFolders ?? current.scriptCommandFolders)
          .map((value: any) => String(value || '').trim())
          .filter(Boolean)
      : [],
    appLanguage: normalizeAppLanguage(patch.appLanguage ?? current.appLanguage),
    launcherBackgroundImagePath: normalizeLauncherBackgroundImagePath(
      patch.launcherBackgroundImagePath ?? current.launcherBackgroundImagePath
    ),
    launcherBackgroundImageEverywhere: normalizeBoolean(
      patch.launcherBackgroundImageEverywhere ?? current.launcherBackgroundImageEverywhere,
      current.launcherBackgroundImageEverywhere
    ),
    launcherBackgroundImageBlurPercent: normalizePercentage(
      patch.launcherBackgroundImageBlurPercent ?? current.launcherBackgroundImageBlurPercent,
      current.launcherBackgroundImageBlurPercent
    ),
    launcherBackgroundImageOpacityPercent: normalizePercentage(
      patch.launcherBackgroundImageOpacityPercent ?? current.launcherBackgroundImageOpacityPercent,
      current.launcherBackgroundImageOpacityPercent
    ),
    clipboardHistoryRetentionDays: normalizeClipboardHistoryRetentionDays(
      'clipboardHistoryRetentionDays' in patch
        ? patch.clipboardHistoryRetentionDays
        : current.clipboardHistoryRetentionDays
    ),
    clipboardAppBlacklist: normalizeBundleIdList(
      'clipboardAppBlacklist' in patch
        ? patch.clipboardAppBlacklist
        : current.clipboardAppBlacklist
    ),
    emojiPickerEnabled: typeof (patch.emojiPickerEnabled ?? current.emojiPickerEnabled) === 'boolean'
      ? (patch.emojiPickerEnabled ?? current.emojiPickerEnabled)!
      : DEFAULT_SETTINGS.emojiPickerEnabled,
    emojiPickerTriggerPrefix: typeof (patch.emojiPickerTriggerPrefix ?? current.emojiPickerTriggerPrefix) === 'string'
      && (patch.emojiPickerTriggerPrefix ?? current.emojiPickerTriggerPrefix)!.length > 0
      ? (patch.emojiPickerTriggerPrefix ?? current.emojiPickerTriggerPrefix)!
      : DEFAULT_SETTINGS.emojiPickerTriggerPrefix,
    emojiPickerExcludedAppBundleIds: normalizeBundleIdList(
      'emojiPickerExcludedAppBundleIds' in patch
        ? patch.emojiPickerExcludedAppBundleIds
        : current.emojiPickerExcludedAppBundleIds
    ),
    browserSearch: normalizeBrowserSearchSettings(
      'browserSearch' in patch ? patch.browserSearch : current.browserSearch
    ),
    rootSearchRanking: normalizeRootSearchRanking(
      'rootSearchRanking' in patch ? patch.rootSearchRanking : current.rootSearchRanking
    ),
    rootSearchAutocompleteEnabled: typeof patch.rootSearchAutocompleteEnabled === 'boolean'
      ? patch.rootSearchAutocompleteEnabled
      : current.rootSearchAutocompleteEnabled,
    popToRootSearchTimeoutSeconds: normalizePopToRootSearchTimeoutSeconds(
      'popToRootSearchTimeoutSeconds' in patch
        ? patch.popToRootSearchTimeoutSeconds
        : current.popToRootSearchTimeoutSeconds
    ),
    installedExtensions: normalizeInstalledExtensions(
      'installedExtensions' in patch ? patch.installedExtensions : current.installedExtensions
    ),
    extensionUninstallTombstones: normalizeExtensionUninstallTombstones(
      'extensionUninstallTombstones' in patch
        ? patch.extensionUninstallTombstones
        : current.extensionUninstallTombstones
    ),
    extensionPreferences: normalizeExtensionStorageMap(
      'extensionPreferences' in patch ? patch.extensionPreferences : current.extensionPreferences
    ),
    extensionCommandPreferences: normalizeExtensionStorageMap(
      'extensionCommandPreferences' in patch
        ? patch.extensionCommandPreferences
        : current.extensionCommandPreferences
    ),
    extensionCommandArguments: normalizeExtensionStorageMap(
      'extensionCommandArguments' in patch
        ? patch.extensionCommandArguments
        : current.extensionCommandArguments
    ),
  };

  const safelyRedactable = new Set<SensitiveAIKey>();
  for (const field of SENSITIVE_AI_KEYS) {
    if (setSecret(aiVaultKey(field), updated.ai[field] || '')) {
      safelyRedactable.add(field);
    } else {
      console.warn(`safe-storage: vault write failed for ai.${field}; keeping plaintext on disk.`);
    }
  }

  persistSettingsToDisk(updated, safelyRedactable, {
    throwOnSyncedWriteFailure: options.throwOnSyncedWriteFailure,
  });

  settingsCache = updated;
  return { ...updated };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  return saveSettingsInternal(patch);
}

export function resetSettingsCache(): void {
  settingsCache = null;
}

// ─── Settings File Relocation ─────────────────────────────────────
// Lets the user point settings.json at any directory (typically a
// Dropbox / iCloud Drive folder). The directory containing the file
// is what's stored in the pointer file; the filename is fixed.

export type RelocateMode = 'move' | 'adopt' | 'replace';

export interface RelocateResult {
  ok: boolean;
  settings?: AppSettings;
  /** Resolved settings.json path after relocation. */
  path?: string;
  /** Error message suitable for display. */
  error?: string;
}

function writeFileAtomic(target: string, contents: string): void {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

/**
 * Relocate the settings file to a different directory.
 *
 *   move  – write current in-memory settings into an empty targetDir, update pointer,
 *           then delete the old file. Order matters: a crash mid-flight
 *           leaves both copies rather than zero. Refuses to overwrite an
 *           existing settings.json or iCloud placeholder.
 *   adopt – validate that targetDir already contains a parseable settings.json,
 *           update the pointer, then re-load so cache reflects the adopted file.
 *   replace – same write path as move, but explicitly allowed to overwrite an
 *           existing settings.json or iCloud placeholder after user confirmation.
 */
export function relocateSettingsFile(targetDir: string, mode: RelocateMode): RelocateResult {
  const dir = String(targetDir || '').trim();
  if (!dir) return { ok: false, error: 'No folder selected.' };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch (e: any) {
    return { ok: false, error: `Folder is not accessible: ${e?.message || e}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: 'Selected path is not a folder.' };
  }
  // Test writability up front so we surface permission errors before
  // touching the live settings file.
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return { ok: false, error: 'Folder is not writable.' };
  }

  const oldPath = getSettingsPath();
  const newPath = path.join(dir, SETTINGS_FILENAME);

  if (path.resolve(oldPath) === path.resolve(newPath)) {
    return { ok: true, settings: loadSettings(), path: newPath };
  }

  if (mode === 'adopt') {
    if (!materializeICloudFileIfNeeded(newPath)) {
      return { ok: false, error: 'Could not download settings.json from iCloud. Make sure iCloud Drive is online, then try again.' };
    }
    let raw: string;
    try {
      raw = fs.readFileSync(newPath, 'utf-8');
    } catch (e: any) {
      return { ok: false, error: `Could not read settings.json in this folder: ${e?.message || e}` };
    }
    try {
      JSON.parse(raw);
    } catch (e: any) {
      return { ok: false, error: `settings.json in this folder is not valid JSON: ${e?.message || e}` };
    }
    writeSettingsLocation(dir);
    settingsCache = null;
    didMigrateAISecrets = false;
    const adopted = loadSettings();
    rearmSettingsWatcher();
    return { ok: true, settings: adopted, path: newPath };
  }

  if (mode === 'move' && settingsFileExistsOrICloudPlaceholder(newPath)) {
    return { ok: false, error: 'This folder already contains settings.json. Choose whether to use it or replace it.' };
  }

  // mode === 'move' | 'replace'
  const current = loadSettings();
  // If the source load was degraded (iCloud-evicted, or a configured
  // sync folder whose settings.json hasn't been delivered yet),
  // `current` is DEFAULT_SETTINGS plus local overrides — not the
  // user's actual data. Proceeding would write defaults to the new
  // location and (in 'move') unlink the source, silently destroying
  // the synced copy.
  if (settingsLoadDegraded) {
    return {
      ok: false,
      error: 'Settings could not be read from the current sync location — the file appears to be missing or undelivered. Make sure the sync client is online and settings.json has finished syncing, then try again.',
    };
  }
  // Use the same on-disk shape `persistSettingsToDisk` produces so the
  // sensitive-key redaction stays consistent. Easiest way: write through
  // the existing pipeline by temporarily flipping the configured path.
  const previousLocation = settingsLocationCache;
  try {
    writeSettingsLocation(dir);
    // Re-persist current settings into the new location.
    saveSettingsInternal({ ...current }, { throwOnSyncedWriteFailure: true });
  } catch (e: any) {
    // Roll back the pointer if the write failed.
    settingsLocationCache = previousLocation;
    try {
      writeSettingsLocation(previousLocation || null);
    } catch {
      // ignore
    }
    return { ok: false, error: `Failed to write settings to new folder: ${e?.message || e}` };
  }

  // Delete the old file last. Failure here is non-fatal: settings live
  // in the new location; the orphan can be cleaned up manually.
  try {
    if (fs.existsSync(oldPath) && path.resolve(oldPath) !== path.resolve(newPath)) {
      fs.unlinkSync(oldPath);
    }
  } catch (e) {
    console.warn('Failed to delete old settings file after move:', e);
  }

  rearmSettingsWatcher();
  return { ok: true, settings: loadSettings(), path: newPath };
}

/**
 * Move settings back to the userData default location. Symmetric with
 * relocateSettingsFile('move'). The synced copy in the previous folder
 * is left in place — we never silently delete user data outside our
 * own data directory.
 */
export function resetSettingsLocation(): RelocateResult {
  const configured = loadSettingsLocation();
  if (!configured) {
    return { ok: true, settings: loadSettings(), path: getSettingsPath() };
  }
  const oldPath = getSettingsPath();
  const current = loadSettings();
  // Same guard as relocateSettingsFile: a degraded load means we'd be
  // writing DEFAULT_SETTINGS to userData and abandoning the synced
  // copy in the configured sync folder.
  if (settingsLoadDegraded) {
    return {
      ok: false,
      error: 'Settings could not be read from the current sync location — the file appears to be missing or undelivered. Make sure the sync client is online and settings.json has finished syncing, then try again.',
    };
  }
  try {
    writeSettingsLocation(null);
    saveSettingsInternal({ ...current }, { throwOnSyncedWriteFailure: true });
  } catch (e: any) {
    // Roll back
    writeSettingsLocation(configured);
    return { ok: false, error: `Failed to write settings to default location: ${e?.message || e}` };
  }
  // Don't touch the synced copy at oldPath — user data outside our
  // userData folder is off-limits for automatic deletion.
  void oldPath;
  rearmSettingsWatcher();
  return { ok: true, settings: loadSettings(), path: getSettingsPath() };
}

// ─── Settings File Watcher ─────────────────────────────────────────
// Reloads in-memory settings and broadcasts to all renderer windows
// when the settings file changes on disk (typically because a cloud
// sync client wrote a copy from another machine).

type SettingsBroadcastFn = (settings: AppSettings) => void;
let broadcastSettingsUpdated: SettingsBroadcastFn | null = null;
type ExternalSettingsChangeFn = (settings: AppSettings) => void;
let externalSettingsChangeHandler: ExternalSettingsChangeFn | null = null;
let activeSettingsWatcher: fs.FSWatcher | null = null;
let watcherPath = '';
let watcherDebounceTimer: NodeJS.Timeout | null = null;
let watcherReattachTimer: NodeJS.Timeout | null = null;
let watcherReattachAttempts = 0;
const WATCHER_DEBOUNCE_MS = 400;
const WATCHER_REATTACH_MAX_ATTEMPTS = 10;

export function setSettingsBroadcaster(fn: SettingsBroadcastFn | null): void {
  broadcastSettingsUpdated = fn;
}

// Fires only when the on-disk settings file changed externally (cloud sync
// from another Mac), after the in-memory cache has been refreshed. Lets the
// main process re-run side effects that were originally wired up at startup —
// hotkey registration, extension reconciliation, etc. In-app saves bypass
// this because handleWatcherEvent skips writes we just made ourselves.
export function setExternalSettingsChangeHandler(fn: ExternalSettingsChangeFn | null): void {
  externalSettingsChangeHandler = fn;
}

function clearWatcherTimers(): void {
  if (watcherDebounceTimer) {
    clearTimeout(watcherDebounceTimer);
    watcherDebounceTimer = null;
  }
  if (watcherReattachTimer) {
    clearTimeout(watcherReattachTimer);
    watcherReattachTimer = null;
  }
}

function handleWatcherEvent(): void {
  const target = watcherPath;
  if (!target) return;
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(target).mtimeMs;
  } catch {
    // file briefly missing during cloud rewrite — let debounce + reattach handle it
  }
  // Skip writes we just made ourselves. Allow a tiny tolerance for fs jitter.
  if (mtimeMs && Math.abs(mtimeMs - lastSelfWriteMtimeMs) < 2) return;
  if (watcherDebounceTimer) clearTimeout(watcherDebounceTimer);
  watcherDebounceTimer = setTimeout(() => {
    watcherDebounceTimer = null;
    settingsCache = null;
    didMigrateAISecrets = false;
    const reloaded = loadSettings();
    console.log(`[Settings] External change detected, reloaded from ${target}`);
    if (broadcastSettingsUpdated) {
      try {
        broadcastSettingsUpdated(reloaded);
      } catch (e) {
        console.warn('settings-watcher: broadcast failed:', e);
      }
    }
    if (externalSettingsChangeHandler) {
      try {
        externalSettingsChangeHandler(reloaded);
      } catch (e) {
        console.warn('settings-watcher: external change handler failed:', e);
      }
    }
  }, WATCHER_DEBOUNCE_MS);
}

function scheduleWatcherReattach(): void {
  if (watcherReattachTimer) return;
  if (watcherReattachAttempts >= WATCHER_REATTACH_MAX_ATTEMPTS) {
    console.warn(`settings-watcher: gave up reattaching after ${WATCHER_REATTACH_MAX_ATTEMPTS} attempts.`);
    return;
  }
  const attempt = ++watcherReattachAttempts;
  // Linear backoff: 500ms, 1000ms, …
  const delay = 500 * attempt;
  watcherReattachTimer = setTimeout(() => {
    watcherReattachTimer = null;
    startSettingsWatcher();
  }, delay);
}

export function startSettingsWatcher(): void {
  stopSettingsWatcher();
  const target = getSettingsPath();
  watcherPath = target;
  // Watch the PARENT DIRECTORY rather than the file itself. macOS fs.watch
  // attaches to the inode, so it stops receiving events when the file is
  // replaced via rename(2) — exactly what cloud sync clients do (Nextcloud,
  // Dropbox, iCloud all write a temp file and rename it into place). A
  // directory watch survives rename and fires for every change inside it;
  // we filter to events for our basename below.
  const parentDir = path.dirname(target);
  const watchedBasename = path.basename(target);
  if (!fs.existsSync(parentDir)) {
    scheduleWatcherReattach();
    return;
  }
  try {
    activeSettingsWatcher = fs.watch(parentDir, { persistent: false }, (_eventType, filename) => {
      // `filename` is the file that changed inside the directory. Some
      // filesystems / Electron versions can pass null — in that case we
      // can't tell which file changed, so we conservatively trigger.
      if (filename && filename !== watchedBasename) return;
      handleWatcherEvent();
    });
    activeSettingsWatcher.on('error', (error: any) => {
      console.warn('settings-watcher: error:', error);
      stopSettingsWatcher();
      scheduleWatcherReattach();
    });
    watcherReattachAttempts = 0;
  } catch (error) {
    console.warn('settings-watcher: failed to start, will retry:', error);
    activeSettingsWatcher = null;
    scheduleWatcherReattach();
  }
}

export function stopSettingsWatcher(): void {
  clearWatcherTimers();
  if (activeSettingsWatcher) {
    try {
      activeSettingsWatcher.close();
    } catch {
      // ignore
    }
    activeSettingsWatcher = null;
  }
}

function rearmSettingsWatcher(): void {
  if (!watcherPath && !activeSettingsWatcher) return; // never started — leave it
  watcherReattachAttempts = 0;
  startSettingsWatcher();
}

// ─── OAuth Token Store ────────────────────────────────────────────
// Tokens are encrypted per-provider in the safe-storage vault under
// `oauth.<provider>`. `oauth-tokens.json` is kept as a provider-name index
// (no secrets) so we can still enumerate providers without decrypting, and
// so legacy plain-text token files from previous versions are automatically
// migrated into the vault on first load.

interface OAuthTokenEntry {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
  obtainedAt: string;
}

let oauthTokensCache: Record<string, OAuthTokenEntry> | null = null;
let oauthIndexCache: string[] | null = null;
// Providers whose vault writes failed; we keep their plaintext entries on
// disk verbatim until a future write succeeds. Callers must NOT rewrite
// oauth-tokens.json without merging this map back in.
let unmigratedOAuthCache: Record<string, OAuthTokenEntry> | null = null;

function getOAuthTokensPath(): string {
  return path.join(app.getPath('userData'), 'oauth-tokens.json');
}

function decodeOAuthSecret(serialized: string): OAuthTokenEntry | null {
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized);
    if (parsed && typeof parsed === 'object' && typeof parsed.accessToken === 'string') {
      return parsed as OAuthTokenEntry;
    }
  } catch {
    // fall through
  }
  return null;
}

function isLegacyPlainTextEntry(value: unknown): value is OAuthTokenEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as OAuthTokenEntry).accessToken === 'string' &&
    (value as OAuthTokenEntry).accessToken.length > 0
  );
}

function loadOAuthTokens(): Record<string, OAuthTokenEntry> {
  if (oauthTokensCache) return oauthTokensCache;

  const tokens: Record<string, OAuthTokenEntry> = {};
  const providers = new Set<string>();
  const unmigrated: Record<string, OAuthTokenEntry> = {};
  let needsIndexRewrite = false;

  let parsedFile: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(getOAuthTokensPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      parsedFile = parsed as Record<string, unknown>;
    }
  } catch {
    // missing file is fine
  }

  for (const [provider, value] of Object.entries(parsedFile)) {
    if (!provider) continue;
    if (isLegacyPlainTextEntry(value)) {
      // Plaintext on disk is authoritative — overwrite any existing vault
      // entry (downgrade-then-upgrade conflict). Only redact disk after
      // a confirmed vault write.
      const ok = setSecret(oauthVaultKey(provider), JSON.stringify(value));
      tokens[provider] = value;
      if (ok) {
        providers.add(provider);
        needsIndexRewrite = true;
      } else {
        console.warn(`safe-storage: vault write failed for oauth.${provider}; leaving plaintext on disk.`);
        unmigrated[provider] = value;
      }
    } else if (value && typeof value === 'object') {
      // New-style index entry: just remember the provider name.
      providers.add(provider);
    }
  }

  // Pull anything in the vault that isn't in the index (e.g. previous run
  // wrote to vault but index file was lost) so we never silently lose a token.
  for (const provider of providers) {
    if (tokens[provider]) continue;
    const decoded = decodeOAuthSecret(getSecret(oauthVaultKey(provider)));
    if (decoded) tokens[provider] = decoded;
  }

  oauthTokensCache = tokens;
  oauthIndexCache = [...providers];
  unmigratedOAuthCache = unmigrated;

  if (needsIndexRewrite) writeOAuthIndex();

  return oauthTokensCache;
}

/**
 * Rewrites oauth-tokens.json. Index entries (no secrets) are written for
 * providers whose tokens live in the vault; entries that failed migration
 * are written verbatim as plaintext so they remain durable until the next
 * successful vault write.
 */
function writeOAuthIndex(): void {
  const providers = oauthIndexCache || [];
  const unmigrated = unmigratedOAuthCache || {};
  const out: Record<string, unknown> = {};
  for (const provider of providers) {
    const token = oauthTokensCache?.[provider];
    out[provider] = token?.obtainedAt ? { obtainedAt: token.obtainedAt } : {};
  }
  for (const [provider, token] of Object.entries(unmigrated)) {
    if (provider in out) continue;
    out[provider] = token;
  }
  try {
    fs.writeFileSync(getOAuthTokensPath(), JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('Failed to save OAuth tokens index:', e);
  }
}

export function setOAuthToken(provider: string, token: OAuthTokenEntry): void {
  loadOAuthTokens();
  oauthTokensCache![provider] = token;
  const ok = setSecret(oauthVaultKey(provider), JSON.stringify(token));
  if (ok) {
    if (!oauthIndexCache!.includes(provider)) oauthIndexCache!.push(provider);
    delete unmigratedOAuthCache![provider];
  } else {
    // Vault write failed — preserve as plaintext on disk and keep it OUT of
    // the index so the next loadOAuthTokens() retries the migration.
    console.warn(`safe-storage: vault write failed for oauth.${provider}; preserving plaintext.`);
    unmigratedOAuthCache![provider] = token;
    oauthIndexCache = oauthIndexCache!.filter((p) => p !== provider);
  }
  writeOAuthIndex();
}

export function getOAuthToken(provider: string): OAuthTokenEntry | null {
  const tokens = loadOAuthTokens();
  if (tokens[provider]) return tokens[provider];
  const decoded = decodeOAuthSecret(getSecret(oauthVaultKey(provider)));
  if (decoded) {
    tokens[provider] = decoded;
    if (!oauthIndexCache!.includes(provider)) {
      oauthIndexCache!.push(provider);
      writeOAuthIndex();
    }
  }
  return decoded;
}

export function removeOAuthToken(provider: string): void {
  loadOAuthTokens();
  deleteSecret(oauthVaultKey(provider));
  delete oauthTokensCache![provider];
  delete unmigratedOAuthCache![provider];
  oauthIndexCache = oauthIndexCache!.filter((p) => p !== provider);
  writeOAuthIndex();
}

// ─── Window State Store ───────────────────────────────────────────
// Stores the last known position of the launcher window so it can be
// restored on the next open. Kept separate from AppSettings because
// it updates on every move and should never be part of user-facing
// settings sync.

export interface LauncherWindowState {
  /** Last saved X position of the launcher window. */
  x: number;
  /** Last saved Y position of the launcher window. */
  y: number;
}

let windowStateCache: LauncherWindowState | null | undefined = undefined; // undefined = not loaded yet

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

export function loadWindowState(): LauncherWindowState | null {
  if (windowStateCache !== undefined) return windowStateCache;
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      windowStateCache = { x: Math.round(x), y: Math.round(y) };
    } else {
      windowStateCache = null;
    }
  } catch {
    windowStateCache = null;
  }
  return windowStateCache;
}

export function saveWindowState(state: LauncherWindowState): void {
  windowStateCache = state;
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save window state:', e);
  }
}

export function clearWindowState(): void {
  windowStateCache = null;
  try {
    const p = getWindowStatePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.error('Failed to clear window state:', e);
  }
}

// ─── Notes window state ────────────────────────────────────────────
// Separate from LauncherWindowState because Notes persists width/height as
// well as position. Stored in its own JSON file so migrating/clearing one
// doesn't affect the other.

export interface NotesWindowState {
  /** Last saved X position of the notes window. */
  x: number;
  /** Last saved Y position of the notes window. */
  y: number;
  /** Last saved width of the notes window. */
  width: number;
  /** Last saved height of the notes window. */
  height: number;
}

let notesWindowStateCache: NotesWindowState | null | undefined = undefined;

function getNotesWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'notes-window-state.json');
}

export function loadNotesWindowState(): NotesWindowState | null {
  if (notesWindowStateCache !== undefined) return notesWindowStateCache;
  try {
    const raw = fs.readFileSync(getNotesWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    if (
      [x, y, width, height].every(Number.isFinite) &&
      width > 0 &&
      height > 0
    ) {
      notesWindowStateCache = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      };
    } else {
      notesWindowStateCache = null;
    }
  } catch {
    notesWindowStateCache = null;
  }
  return notesWindowStateCache;
}

export function saveNotesWindowState(state: NotesWindowState): void {
  notesWindowStateCache = state;
  try {
    fs.writeFileSync(getNotesWindowStatePath(), JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save notes window state:', e);
  }
}
