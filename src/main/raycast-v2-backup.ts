/**
 * Raycast 2.x (`RAYCFG3`) backup reader.
 *
 * Raycast 1.x wrote a headerless, salt-less AES-256-CBC blob whose key was
 * derived straight from the password, and `raycast-config-import.ts` still
 * reads those. Raycast 2.x replaced both the container and the payload schema:
 *
 *   file = "RAYCFG3\n" | UInt32LE(headerLength) | gzip(headerJSON) | ciphertext | tag(16)
 *   body = AES-256-GCM(gzip(payloadJSON))
 *   key  = scrypt(password, salt, N=16384, r=8, p=1, dkLen=32)
 *
 * The gzipped header carries `schemaVersion`, plus a hex `iv` and `salt` of 16
 * bytes each. There is no integrity check other than the GCM tag, so a wrong
 * password surfaces as a tag mismatch.
 *
 * The payload is category-keyed (`settings`, `quicklinks`, `notes`, ...) rather
 * than the 1.x `builtin_package_*` keys, so `convertRaycastV2Backup` maps it
 * back onto the 1.x shape and every existing importer keeps working unchanged.
 *
 * This module deliberately imports nothing from Electron so the test harness
 * can bundle it standalone.
 */
import * as crypto from 'crypto';
import * as zlib from 'zlib';

import type { RaycastBackup } from './raycast-config-import';

const RAYCFG_MAGIC = Buffer.from('RAYCFG3\n', 'utf8');
const FIXED_HEADER_LENGTH = 12; // magic (8 bytes) + UInt32LE header length
const MAX_HEADER_LENGTH = 1024 * 1024;
const AUTH_TAG_LENGTH = 16;
const IV_LENGTH = 16;
const SALT_LENGTH = 16;
const CONTAINER_SCHEMA_VERSION = 3;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;

/** Matched verbatim by the retry loop in `selectAndLoadRaycastBackup`. */
export const INVALID_PASSWORD_MESSAGE = 'Failed to read import data; password is not valid.';
const CORRUPT_CONTAINER_MESSAGE = 'This file is not a readable Raycast backup.';

type RaycastV2Header = {
  appVersion?: string;
  schemaVersion?: number;
  encryption?: { iv?: string; salt?: string };
};

/** True when the buffer opens with the Raycast 2.x container signature. */
export function isRaycastV2Backup(raw: Buffer): boolean {
  return raw.length >= FIXED_HEADER_LENGTH && raw.subarray(0, RAYCFG_MAGIC.length).equals(RAYCFG_MAGIC);
}

function readHexField(value: unknown, expectedLength: number): Buffer | null {
  const text = String(value || '').trim();
  if (!/^[0-9a-fA-F]+$/.test(text) || text.length !== expectedLength * 2) return null;
  return Buffer.from(text, 'hex');
}

function readRaycastV2Header(raw: Buffer): { header: RaycastV2Header; payloadStart: number } {
  const headerLength = raw.readUInt32LE(RAYCFG_MAGIC.length);
  if (
    headerLength <= 0 ||
    headerLength > MAX_HEADER_LENGTH ||
    FIXED_HEADER_LENGTH + headerLength + AUTH_TAG_LENGTH > raw.length
  ) {
    throw new Error(CORRUPT_CONTAINER_MESSAGE);
  }
  let header: RaycastV2Header;
  try {
    header = JSON.parse(
      zlib.gunzipSync(raw.subarray(FIXED_HEADER_LENGTH, FIXED_HEADER_LENGTH + headerLength)).toString('utf8')
    );
  } catch {
    throw new Error(CORRUPT_CONTAINER_MESSAGE);
  }
  if (Number(header?.schemaVersion) !== CONTAINER_SCHEMA_VERSION) {
    throw new Error(
      `This Raycast backup uses container version ${String(header?.schemaVersion ?? 'unknown')}, which SuperCmd cannot read yet.`
    );
  }
  return { header, payloadStart: FIXED_HEADER_LENGTH + headerLength };
}

/**
 * Decrypts a `RAYCFG3` buffer. Throws `INVALID_PASSWORD_MESSAGE` when the GCM
 * tag does not verify, so the caller's retry prompt fires; anything else is a
 * malformed file and reports as such rather than blaming the password.
 */
export function decryptRaycastV2Backup(
  raw: Buffer,
  password: string
): { appVersion?: string; payload: Record<string, any> } {
  const { header, payloadStart } = readRaycastV2Header(raw);
  const iv = readHexField(header?.encryption?.iv, IV_LENGTH);
  const salt = readHexField(header?.encryption?.salt, SALT_LENGTH);
  if (!iv || !salt) throw new Error(CORRUPT_CONTAINER_MESSAGE);

  const payloadEnd = raw.length - AUTH_TAG_LENGTH;
  if (payloadEnd <= payloadStart) throw new Error(CORRUPT_CONTAINER_MESSAGE);

  const key = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // 128 * N * r is 16 MB here, above Node's 32 MB default only once headroom
    // is counted, so raise it rather than depend on the default.
    maxmem: 64 * 1024 * 1024,
  });

  let compressed: Buffer;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(raw.subarray(payloadEnd));
    compressed = Buffer.concat([decipher.update(raw.subarray(payloadStart, payloadEnd)), decipher.final()]);
  } catch {
    // The tag is the only wrong-password signal the container offers.
    throw new Error(INVALID_PASSWORD_MESSAGE);
  }

  try {
    // Past the tag the bytes are authenticated, so a failure here is corruption
    // rather than a bad password.
    return { appVersion: header?.appVersion, payload: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
  } catch {
    throw new Error(CORRUPT_CONTAINER_MESSAGE);
  }
}

// ---------------------------------------------------------------------------
// Payload conversion: Raycast 2.x categories -> the 1.x shape the importer reads
// ---------------------------------------------------------------------------

const MODIFIER_ALIASES: Record<string, string> = {
  meta: 'command',
  cmd: 'command',
  command: 'command',
  ctrl: 'control',
  control: 'control',
  alt: 'option',
  option: 'option',
  shift: 'shift',
  fn: 'fn',
  function: 'fn',
};

// `decodeRaycastHotkey` emits modifiers in the order it reads them, and
// `normalizeAccelerator` canonicalises to Command, Control, Alt, Shift, Fn.
const MODIFIER_ORDER = ['command', 'control', 'option', 'shift', 'fn'];

const NODE_COMMAND_PATTERN = /^c:n:([0-9a-fA-F-]{8,})::-::(.+)$/;
const INTERNAL_COMMAND_PATTERN = /^c:r:([a-zA-Z0-9-]+)::-::(.+)$/;
const APPLICATION_COMMAND_PATTERN = /^c:r:applications::\*::application::=::(.+)$/;
const NODE_EXTENSION_ID_PATTERN = /^e:n:([0-9a-fA-F-]{8,})$/;

/** AI-tool entry points Raycast synthesises per extension; they have no SuperCmd command. */
function isAiPseudoCommand(commandName: string): boolean {
  return commandName === '__ai_extension' || /aiExtension$/i.test(commandName);
}

/**
 * Turns Raycast 2.x's structured hotkey into the 1.x `modifier-...-keycode`
 * string so `decodeRaycastHotkey` stays the single decoder. The virtual key
 * codes are unchanged between the two formats.
 */
export function encodeLegacyHotkey(hotkey: unknown): string | null {
  const record = hotkey as any;
  const kind = record?.kind;
  if (!kind || (kind.type && kind.type !== 'SingleStep')) return null;
  const shortcut = kind.shortcut;
  const key = shortcut?.key;
  if (!key || (key.type && key.type !== 'LayoutIndependent')) return null;
  const code = Number(key.code);
  if (!Number.isFinite(code)) return null;

  const present = new Set<string>();
  for (const entry of Array.isArray(shortcut?.modifiers) ? shortcut.modifiers : []) {
    const name = MODIFIER_ALIASES[String((entry as any)?.modifier || '').trim().toLowerCase()];
    if (name) present.add(name);
  }
  return [...MODIFIER_ORDER.filter((modifier) => present.has(modifier)), String(code)].join('-');
}

/**
 * Raycast 2.x built-in command ids that have a direct SuperCmd counterpart.
 * Ids without a clean equivalent are left out on purpose: an approximate match
 * would silently bind a hotkey to the wrong command.
 */
export const RAYCAST_V2_BUILTIN_COMMAND_IDS: Record<string, string> = {
  'c:r:calendar::-::mySchedule': 'system-my-schedule',
  'c:r:clipboard-history::-::history': 'system-clipboard-manager',
  'c:r:developer::-::manageExtensions': 'system-open-extensions-settings',
  'c:r:emoji-picker::-::searchEmoji': 'system-emoji-picker',
  'c:r:file-search::-::searchFiles': 'system-search-files',
  'c:r:navigation::-::searchMenuItems': 'system-menu-item-search',
  'c:r:notes::-::create': 'system-create-note',
  'c:r:notes::-::open': 'system-search-notes',
  'c:r:notes::-::search': 'system-search-notes',
  'c:r:quicklinks::-::create': 'system-create-quicklink',
  'c:r:quicklinks::-::search': 'system-search-quicklinks',
  'c:r:raycast-core::-::checkForUpdates': 'system-check-for-updates',
  'c:r:raycast-core::-::openCamera': 'system-camera',
  'c:r:raycast-core::-::openSearchStore': 'system-open-extension-store',
  'c:r:raycast-core::-::quitApp': 'system-quit-launcher',
  'c:r:raycast-core::-::resetPosition': 'system-reset-launcher-position',
  'c:r:raycast-settings::-::openLauncherSettings': 'system-open-settings',
  'c:r:script-commands::-::createScriptCommand': 'system-create-script-command',
  'c:r:snippets::-::createSnippet': 'system-create-snippet',
  'c:r:snippets::-::exportSnippets': 'system-export-snippets',
  'c:r:snippets::-::importSnippets': 'system-import-snippets',
  'c:r:snippets::-::searchSnippets': 'system-search-snippets',
  'c:r:system::-::emptyTrash': 'system-empty-trash',
  'c:r:system::-::lockScreen': 'system-lock-screen',
  'c:r:system::-::logOut': 'system-logout',
  'c:r:system::-::quitAllApplications': 'system-close-all-apps',
  'c:r:system::-::restart': 'system-restart',
  'c:r:system::-::shutDown': 'system-shutdown',
  'c:r:system::-::sleep': 'system-sleep',
  // Window management: only placements SuperCmd implements with the same geometry.
  'c:r:window-management::-::bottomCenterSixth': 'system-window-management-bottom-center-sixth',
  'c:r:window-management::-::bottomHalf': 'system-window-management-bottom',
  'c:r:window-management::-::bottomLeftQuarter': 'system-window-management-bottom-left',
  'c:r:window-management::-::bottomLeftSixth': 'system-window-management-bottom-left-sixth',
  'c:r:window-management::-::bottomRightQuarter': 'system-window-management-bottom-right',
  'c:r:window-management::-::bottomRightSixth': 'system-window-management-bottom-right-sixth',
  'c:r:window-management::-::center': 'system-window-management-center',
  'c:r:window-management::-::centerThird': 'system-window-management-center-third',
  'c:r:window-management::-::centerThreeFourth': 'system-window-management-center-three-fourths',
  'c:r:window-management::-::centerTwoThird': 'system-window-management-center-two-thirds',
  'c:r:window-management::-::firstFourth': 'system-window-management-first-fourth',
  'c:r:window-management::-::firstThird': 'system-window-management-first-third',
  'c:r:window-management::-::firstThreeFourth': 'system-window-management-first-three-fourths',
  'c:r:window-management::-::firstTwoThird': 'system-window-management-first-two-thirds',
  'c:r:window-management::-::lastFourth': 'system-window-management-last-fourth',
  'c:r:window-management::-::lastThird': 'system-window-management-last-third',
  'c:r:window-management::-::lastThreeFourth': 'system-window-management-last-three-fourths',
  'c:r:window-management::-::lastTwoThird': 'system-window-management-last-two-thirds',
  'c:r:window-management::-::leftHalf': 'system-window-management-left',
  'c:r:window-management::-::makeLarger': 'system-window-management-increase-size-10',
  'c:r:window-management::-::makeSmaller': 'system-window-management-decrease-size-10',
  'c:r:window-management::-::maximize': 'system-window-management-fill',
  'c:r:window-management::-::maximizeAlmost': 'system-window-management-center-80',
  'c:r:window-management::-::maximizeHeight': 'system-window-management-maximize-height',
  'c:r:window-management::-::maximizeWidth': 'system-window-management-maximize-width',
  'c:r:window-management::-::rightHalf': 'system-window-management-right',
  'c:r:window-management::-::secondFourth': 'system-window-management-second-fourth',
  'c:r:window-management::-::thirdFourth': 'system-window-management-third-fourth',
  'c:r:window-management::-::topCenterSixth': 'system-window-management-top-center-sixth',
  'c:r:window-management::-::topHalf': 'system-window-management-top',
  'c:r:window-management::-::topLeftQuarter': 'system-window-management-top-left',
  'c:r:window-management::-::topLeftSixth': 'system-window-management-top-left-sixth',
  'c:r:window-management::-::topRightQuarter': 'system-window-management-top-right',
  'c:r:window-management::-::topRightSixth': 'system-window-management-top-right-sixth',
};

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function trimmed(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * Joins `ai.messages` onto `ai.chats` by `chatId`. Raycast 2.x splits them into
 * sibling arrays, whereas the 1.x importer expects each chat to carry its own
 * messages. Tool-call turns are dropped: SuperCmd's chat store has no
 * representation for them.
 */
function convertAiChats(ai: Record<string, any>): any[] {
  const messagesByChat = new Map<string, any[]>();
  for (const message of asArray(ai.messages)) {
    const role = trimmed(message?.role).toLowerCase();
    if (role !== 'user' && role !== 'assistant') continue;
    const text = trimmed(message?.content?.text);
    if (!text) continue;
    const chatId = trimmed(message?.chatId);
    if (!chatId) continue;
    const bucket = messagesByChat.get(chatId);
    const entry = { role, content: text, createdAt: message?.createdAt ?? message?.updatedAt };
    if (bucket) bucket.push(entry);
    else messagesByChat.set(chatId, [entry]);
  }

  const chats: any[] = [];
  for (const chat of asArray(ai.chats)) {
    const id = trimmed(chat?.id);
    const messages = messagesByChat.get(id) || [];
    if (messages.length === 0) continue;
    chats.push({
      id,
      title: trimmed(chat?.title),
      createdAt: chat?.createdAt,
      updatedAt: chat?.updatedAt,
      model: trimmed(chat?.modelId) || undefined,
      messages,
    });
  }
  return chats;
}

/**
 * Rebuilds the 1.x per-extension records from the two places 2.x splits them
 * across: `nodeExtensions.extensions` holds identity, `settings.nodeExtensions`
 * holds the enabled flag and preference values, and `settings.commands` holds
 * each command's enabled flag.
 *
 * OAuth tokens (`settings.nodeExtensions[].oauthTokens`) are never read: they
 * are live credentials and SuperCmd has nothing to do with them.
 */
function convertExtensions(payload: Record<string, any>): { extensions: any[]; extensionNameByUuid: Map<string, string> } {
  const extensionNameByUuid = new Map<string, string>();
  for (const entry of asArray(payload?.nodeExtensions?.extensions)) {
    const uuid = trimmed(entry?.uuid);
    const name = trimmed(entry?.name);
    if (uuid && name) extensionNameByUuid.set(uuid, name);
  }

  const settingsByUuid = new Map<string, Record<string, any>>();
  for (const entry of asArray(payload?.settings?.nodeExtensions)) {
    const match = NODE_EXTENSION_ID_PATTERN.exec(trimmed(entry?.id));
    if (match) settingsByUuid.set(match[1], asObject(entry));
  }

  const commandsByUuid = new Map<string, Array<{ name: string; enabled: boolean }>>();
  for (const command of asArray(payload?.settings?.commands)) {
    const match = NODE_COMMAND_PATTERN.exec(trimmed(command?.id));
    if (!match) continue;
    const [, uuid, commandName] = match;
    if (isAiPseudoCommand(commandName)) continue;
    const bucket = commandsByUuid.get(uuid) || [];
    bucket.push({ name: commandName, enabled: command?.enabled !== false });
    commandsByUuid.set(uuid, bucket);
  }

  const extensions: any[] = [];
  for (const entry of asArray(payload?.nodeExtensions?.extensions)) {
    const uuid = trimmed(entry?.uuid);
    const name = trimmed(entry?.name);
    if (!uuid || !name) continue;
    const extensionSettings = settingsByUuid.get(uuid) || {};
    const preferenceValues = asObject(extensionSettings.meta);
    const prefs = asArray(extensionSettings.preferenceTypes)
      .map((type) => ({ name: trimmed(type?.name), type: trimmed(type?.type) }))
      .filter((type) => type.name && Object.prototype.hasOwnProperty.call(preferenceValues, type.name))
      .map((type) => ({ ...type, value: preferenceValues[type.name] }));

    extensions.push({
      name,
      owner: trimmed(entry?.owner) || trimmed(entry?.author),
      title: name,
      commands: commandsByUuid.get(uuid) || [],
      ...(prefs.length > 0 ? { prefs } : {}),
    });
  }
  return { extensions, extensionNameByUuid };
}

/**
 * Flattens `settings.commands` into 1.x root-search records. Only the kinds
 * whose SuperCmd command id can actually be resolved are emitted: store
 * extension commands (by extension name), applications (by path) and mapped
 * built-ins. Quicklink, Apple Shortcut and AI-tool entries are skipped because
 * SuperCmd mints its own ids for those and a guess would bind the wrong thing.
 */
function convertRootSearch(
  payload: Record<string, any>,
  extensionNameByUuid: Map<string, string>
): { rootSearch: any[]; unmapped: number } {
  const rootSearch: any[] = [];
  let unmapped = 0;

  for (const command of asArray(payload?.settings?.commands)) {
    const id = trimmed(command?.id);
    if (!id) continue;
    const hotkey = encodeLegacyHotkey(command?.macosHotkey);
    // Raycast stores an alias's trailing space to mean "alias then space".
    const alias = trimmed(command?.alias);
    if (!hotkey && !alias) continue;

    const applicationMatch = APPLICATION_COMMAND_PATTERN.exec(id);
    if (applicationMatch) {
      rootSearch.push({ path: applicationMatch[1], ...(hotkey ? { hotkey } : {}), ...(alias ? { alias } : {}) });
      continue;
    }

    const nodeMatch = NODE_COMMAND_PATTERN.exec(id);
    if (nodeMatch) {
      const [, uuid, commandName] = nodeMatch;
      const extensionName = extensionNameByUuid.get(uuid);
      if (!extensionName || isAiPseudoCommand(commandName)) {
        unmapped += 1;
        continue;
      }
      rootSearch.push({
        key: `extension_${extensionName}.${commandName}`,
        ...(hotkey ? { hotkey } : {}),
        ...(alias ? { alias } : {}),
      });
      continue;
    }

    const internalMatch = INTERNAL_COMMAND_PATTERN.exec(id);
    if (internalMatch && RAYCAST_V2_BUILTIN_COMMAND_IDS[id]) {
      rootSearch.push({ key: id, ...(hotkey ? { hotkey } : {}), ...(alias ? { alias } : {}) });
      continue;
    }

    unmapped += 1;
  }

  return { rootSearch, unmapped };
}

/**
 * Maps a decrypted Raycast 2.x payload onto the 1.x `builtin_package_*` shape.
 *
 * Categories with no SuperCmd destination (emoji frecency, focus categories,
 * window layouts, usage activity) are dropped; clipboard history and MCP
 * servers are passed through as counts only so the preview can keep reporting
 * them as unsupported.
 */
export function convertRaycastV2Backup(payload: Record<string, any>, appVersion?: string): RaycastBackup {
  const source = asObject(payload);
  const { extensions, extensionNameByUuid } = convertExtensions(source);
  const { rootSearch } = convertRootSearch(source, extensionNameByUuid);
  const general = asObject(source?.settings?.general);

  const quicklinks = asArray(source?.quicklinks?.quicklinks)
    .map((quicklink) => ({
      uuid: trimmed(quicklink?.id),
      name: trimmed(quicklink?.name),
      url: trimmed(quicklink?.link),
      isEnabled: true,
    }))
    .filter((quicklink) => quicklink.name && quicklink.url);

  const snippets = asArray(source?.snippets?.snippets)
    .map((snippet) => ({
      name: trimmed(snippet?.name) || trimmed(snippet?.title),
      text: trimmed(snippet?.text) || trimmed(snippet?.content),
      keyword: trimmed(snippet?.keyword),
    }))
    .filter((snippet) => snippet.name && snippet.text);

  const notes = asArray(source?.notes?.notes)
    .map((note) => ({ title: trimmed(note?.title), text: trimmed(note?.text) }))
    .filter((note) => note.title || note.text);

  return {
    raycast_version: trimmed(appVersion) || undefined,
    builtin_package_raycastPreferences: {
      preferencesGeneral: {
        raycastGlobalHotkey: encodeLegacyHotkey(general.globalHotkey) || undefined,
      },
      preferencesAppearance: {
        raycastPreferredWindowMode: trimmed(general.windowMode) || undefined,
      },
      preferencesAdvanced: {
        navigationCommandStyleIdentifierKey: trimmed(general.navigationBindings) || undefined,
        popToRootTimeout: Number.isFinite(Number(general.popToRootTimeout))
          ? Number(general.popToRootTimeout)
          : undefined,
      },
    },
    builtin_package_quicklinks: { quicklinks },
    builtin_package_snippets: { snippets },
    builtin_package_raycastNotes: { notes },
    builtin_package_raycastExtensions: { extensions },
    builtin_package_rootSearch: { rootSearch },
    'builtin_package_open-ai': { aiChats: convertAiChats(asObject(source?.ai)) },
    builtin_package_clipboardHistory: {
      clipboardHistoryRecords: asArray(source?.clipboardHistory?.clipboardEntries),
    },
    builtin_package_mcp: { mcpServers: asArray(source?.mcpServers?.servers) },
  };
}

/** Reads a `RAYCFG3` file end to end: decrypt, then map onto the 1.x shape. */
export function loadRaycastV2Backup(raw: Buffer, password: string): RaycastBackup {
  const { appVersion, payload } = decryptRaycastV2Backup(raw, password);
  return convertRaycastV2Backup(payload, appVersion);
}
