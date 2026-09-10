#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(root, 'src/main/raycast-v2-backup.ts');

async function importModule() {
  const result = await build({
    entryPoints: [modulePath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const PASSWORD = 'correct horse battery staple';
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Builds a RAYCFG3 container the same way Raycast 2.x does. */
function buildContainer(payload, { password = PASSWORD, appVersion = '2.3.0.0', schemaVersion = 3 } = {}) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const header = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({ appVersion, schemaVersion, encryption: { iv: iv.toString('hex'), salt: salt.toString('hex') } })
    )
  );
  const key = crypto.scryptSync(password, salt, 32, SCRYPT_OPTIONS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([
    cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(payload)))),
    cipher.final(),
  ]);
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(header.length);
  return Buffer.concat([Buffer.from('RAYCFG3\n'), headerLength, header, body, cipher.getAuthTag()]);
}

const EXTENSION_UUID = '10749020-4fc4-4e10-9666-ee6da3088c2d';

/** Mirrors the category layout of a real Raycast 2.3 export, trimmed to one of each. */
const PAYLOAD = {
  settings: {
    general: {
      windowMode: 'compact',
      navigationBindings: 'emacs',
      popToRootTimeout: 90,
      globalHotkey: {
        kind: {
          type: 'SingleStep',
          shortcut: { modifiers: [{ modifier: 'Meta' }], key: { type: 'LayoutIndependent', code: 49 } },
        },
        locality: 'Global',
      },
    },
    commands: [
      {
        id: `c:n:${EXTENSION_UUID}::-::search`,
        extensionId: `e:n:${EXTENSION_UUID}`,
        enabled: true,
        alias: 'ss',
      },
      { id: `c:n:${EXTENSION_UUID}::-::move`, extensionId: `e:n:${EXTENSION_UUID}`, enabled: false },
      // AI pseudo-command: no SuperCmd counterpart, must not be emitted.
      { id: `c:n:${EXTENSION_UUID}::-::__ai_extension`, enabled: false, alias: 'nope' },
      {
        id: 'c:r:clipboard-history::-::history',
        enabled: true,
        macosHotkey: {
          kind: {
            type: 'SingleStep',
            shortcut: {
              modifiers: [{ modifier: 'Shift' }, { modifier: 'Ctrl' }, { modifier: 'Alt' }, { modifier: 'Meta' }],
              key: { type: 'LayoutIndependent', code: 45 },
            },
          },
          locality: 'Global',
        },
      },
      { id: 'c:r:system::-::lockScreen', enabled: true, alias: 'lock screen ' },
      {
        id: 'c:r:applications::*::application::=::/System/Library/CoreServices/Finder.app',
        enabled: true,
        alias: 'finder',
      },
      // Quicklink aliases cannot resolve: SuperCmd mints its own quicklink ids.
      { id: 'c:r:quicklinks::*::quicklink::=::01KS27AC0ZVR3N3V4BNDH7DZVV', enabled: true, alias: 'google' },
    ],
    nodeExtensions: [
      {
        id: `e:n:${EXTENSION_UUID}`,
        enabled: true,
        meta: { maxResults: '25', openFolderAfterMove: true },
        preferenceTypes: [
          { name: 'maxResults', type: 'textfield' },
          { name: 'openFolderAfterMove', type: 'checkbox' },
          { name: 'neverSet', type: 'checkbox' },
        ],
        oauthTokens: [{ accessToken: 'must-never-be-imported' }],
      },
    ],
    internalExtensions: [{ id: 'e:r:ai', enabled: true, meta: { aiByokApiKeys: 'must-never-be-imported' } }],
  },
  nodeExtensions: {
    extensions: [{ uuid: EXTENSION_UUID, name: 'folder-search', author: 'GastroGeek', version: 'Sat Aug 29 2026' }],
  },
  quicklinks: { quicklinks: [{ id: '01KS', name: 'Google', link: 'https://google.com/search?q={Query}' }] },
  notes: { notes: [{ id: 'n1', title: 'Standup', text: 'Ship the importer.' }] },
  snippets: { snippets: [{ name: 'Sig', text: 'Best,\nNick', keyword: ';sig' }] },
  ai: {
    chats: [
      { id: 'chat-1', title: 'Rename a branch', modelId: 'openai-gpt-4o-mini', createdAt: '2026-01-14T08:54:19.489Z' },
      { id: 'chat-empty', title: 'Nothing here', modelId: 'openai-gpt-4o-mini' },
    ],
    messages: [
      { id: 'm1', chatId: 'chat-1', role: 'user', content: { type: 'text', text: 'How do I rename a branch?' } },
      { id: 'm2', chatId: 'chat-1', role: 'tool', content: { name: 'web', result: 'ignored' } },
      { id: 'm3', chatId: 'chat-1', role: 'assistant', content: { type: 'text', text: 'Use git branch -m.' } },
    ],
  },
  clipboardHistory: { clipboardEntries: [{ title: 'a' }, { title: 'b' }] },
  mcpServers: { servers: [{ name: 'local' }] },
};

const CONTAINER = buildContainer(PAYLOAD);

test('recognises the RAYCFG3 container and nothing else', async () => {
  const { isRaycastV2Backup } = await importModule();
  assert.equal(isRaycastV2Backup(CONTAINER), true);
  assert.equal(isRaycastV2Backup(Buffer.from('{"raycast_version":"1.0"}')), false);
  assert.equal(isRaycastV2Backup(Buffer.alloc(0)), false);
});

test('decrypts with the right password and reports the app version', async () => {
  const { decryptRaycastV2Backup } = await importModule();
  const { appVersion, payload } = decryptRaycastV2Backup(CONTAINER, PASSWORD);
  assert.equal(appVersion, '2.3.0.0');
  assert.equal(payload.settings.general.popToRootTimeout, 90);
});

test('a wrong password raises the exact message the retry prompt looks for', async () => {
  const { decryptRaycastV2Backup, INVALID_PASSWORD_MESSAGE } = await importModule();
  assert.equal(INVALID_PASSWORD_MESSAGE, 'Failed to read import data; password is not valid.');
  assert.throws(() => decryptRaycastV2Backup(CONTAINER, 'wrong'), (error) => {
    assert.equal(error.message, INVALID_PASSWORD_MESSAGE);
    return true;
  });
});

test('a malformed container is reported as malformed, not as a bad password', async () => {
  const { decryptRaycastV2Backup, INVALID_PASSWORD_MESSAGE } = await importModule();
  const truncated = CONTAINER.subarray(0, 40);
  assert.throws(() => decryptRaycastV2Backup(truncated, PASSWORD), (error) => {
    assert.notEqual(error.message, INVALID_PASSWORD_MESSAGE);
    return true;
  });

  const wrongLength = Buffer.from(CONTAINER);
  wrongLength.writeUInt32LE(0xfffffff, 8);
  assert.throws(() => decryptRaycastV2Backup(wrongLength, PASSWORD), (error) => {
    assert.notEqual(error.message, INVALID_PASSWORD_MESSAGE);
    return true;
  });
});

test('an unsupported container version says so', async () => {
  const { decryptRaycastV2Backup } = await importModule();
  const future = buildContainer(PAYLOAD, { schemaVersion: 4 });
  assert.throws(() => decryptRaycastV2Backup(future, PASSWORD), /container version 4/);
});

test('structured hotkeys become the 1.x keycode string', async () => {
  const { encodeLegacyHotkey } = await importModule();
  const hotkey = (modifiers, code) => ({
    kind: { type: 'SingleStep', shortcut: { modifiers, key: { type: 'LayoutIndependent', code } } },
  });
  assert.equal(encodeLegacyHotkey(hotkey([{ modifier: 'Meta' }], 49)), 'command-49');
  assert.equal(
    encodeLegacyHotkey(hotkey([{ modifier: 'Shift' }, { modifier: 'Ctrl' }, { modifier: 'Alt' }, { modifier: 'Meta' }], 45)),
    'command-control-option-shift-45'
  );
  assert.equal(encodeLegacyHotkey(null), null);
  assert.equal(encodeLegacyHotkey({ kind: { type: 'TwoStep' } }), null);
});

test('maps the 2.x payload onto the shape the 1.x importer reads', async () => {
  const { loadRaycastV2Backup } = await importModule();
  const backup = loadRaycastV2Backup(CONTAINER, PASSWORD);

  assert.equal(backup.raycast_version, '2.3.0.0');

  const preferences = backup.builtin_package_raycastPreferences;
  assert.equal(preferences.preferencesGeneral.raycastGlobalHotkey, 'command-49');
  assert.equal(preferences.preferencesAppearance.raycastPreferredWindowMode, 'compact');
  assert.equal(preferences.preferencesAdvanced.popToRootTimeout, 90);
  assert.equal(preferences.preferencesAdvanced.navigationCommandStyleIdentifierKey, 'emacs');

  assert.deepEqual(backup.builtin_package_quicklinks.quicklinks, [
    { uuid: '01KS', name: 'Google', url: 'https://google.com/search?q={Query}', isEnabled: true },
  ]);
  assert.deepEqual(backup.builtin_package_raycastNotes.notes, [{ title: 'Standup', text: 'Ship the importer.' }]);
  assert.deepEqual(backup.builtin_package_snippets.snippets, [{ name: 'Sig', text: 'Best,\nNick', keyword: ';sig' }]);

  assert.equal(backup.builtin_package_clipboardHistory.clipboardHistoryRecords.length, 2);
  assert.equal(backup.builtin_package_mcp.mcpServers.length, 1);
});

test('extension records carry identity, per-command enabled state and preference values', async () => {
  const { loadRaycastV2Backup } = await importModule();
  const [extension] = loadRaycastV2Backup(CONTAINER, PASSWORD).builtin_package_raycastExtensions.extensions;

  assert.equal(extension.name, 'folder-search');
  assert.equal(extension.owner, 'GastroGeek');
  assert.deepEqual(
    [...extension.commands].sort((a, b) => a.name.localeCompare(b.name)),
    [{ name: 'move', enabled: false }, { name: 'search', enabled: true }]
  );
  assert.deepEqual(extension.prefs, [
    { name: 'maxResults', type: 'textfield', value: '25' },
    { name: 'openFolderAfterMove', type: 'checkbox', value: true },
  ]);

  // A preference the user never set must not be invented.
  assert.equal(extension.prefs.some((pref) => pref.name === 'neverSet'), false);
  // OAuth tokens are credentials and never cross over.
  assert.equal(JSON.stringify(extension).includes('must-never-be-imported'), false);
});

test('no part of the converted backup carries secrets', async () => {
  const { loadRaycastV2Backup } = await importModule();
  const backup = loadRaycastV2Backup(CONTAINER, PASSWORD);
  assert.equal(JSON.stringify(backup).includes('must-never-be-imported'), false);
});

test('root-search records are emitted only for commands SuperCmd can resolve', async () => {
  const { loadRaycastV2Backup } = await importModule();
  const { rootSearch } = loadRaycastV2Backup(CONTAINER, PASSWORD).builtin_package_rootSearch;

  const byKey = new Map(rootSearch.filter((item) => item.key).map((item) => [item.key, item]));

  // Store extension command, addressed by extension name so `ext-<name>-<cmd>` resolves.
  assert.equal(byKey.get('extension_folder-search.search').alias, 'ss');
  // Built-in, addressed by its 2.x id and carrying the decoded hotkey.
  assert.equal(byKey.get('c:r:clipboard-history::-::history').hotkey, 'command-control-option-shift-45');
  // Trailing space in a Raycast alias is presentation, not part of the alias.
  assert.equal(byKey.get('c:r:system::-::lockScreen').alias, 'lock screen');
  // Applications resolve by path, not by key.
  const application = rootSearch.find((item) => item.path);
  assert.equal(application.path, '/System/Library/CoreServices/Finder.app');
  assert.equal(application.alias, 'finder');

  // Kinds SuperCmd cannot address are dropped rather than guessed at.
  assert.equal(rootSearch.some((item) => String(item.key || '').includes('__ai_extension')), false);
  assert.equal(rootSearch.some((item) => String(item.key || '').includes('quicklink')), false);
  // Commands with neither a hotkey nor an alias carry nothing worth importing.
  assert.equal(rootSearch.some((item) => item.key === 'extension_folder-search.move'), false);
});

test('AI chats collect their own messages and drop tool turns', async () => {
  const { loadRaycastV2Backup } = await importModule();
  const chats = loadRaycastV2Backup(CONTAINER, PASSWORD)['builtin_package_open-ai'].aiChats;

  // The chat with no messages is not carried over as an empty shell.
  assert.equal(chats.length, 1);
  assert.equal(chats[0].title, 'Rename a branch');
  assert.deepEqual(
    chats[0].messages.map((message) => [message.role, message.content]),
    [['user', 'How do I rename a branch?'], ['assistant', 'Use git branch -m.']]
  );
});
