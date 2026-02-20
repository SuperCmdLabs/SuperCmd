import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SaveDialogResult = { canceled: boolean; filePath?: string };
type OpenDialogResult = { canceled: boolean; filePaths: string[] };

const mocks = vi.hoisted(() => {
  let userDataDir = '';
  let clipboardText = '';
  let uuidCounter = 0;
  let saveDialogResult: SaveDialogResult = { canceled: true };
  let openDialogResult: OpenDialogResult = { canceled: true, filePaths: [] };

  return {
    setUserDataDir(value: string) {
      userDataDir = value;
    },
    setClipboardText(value: string) {
      clipboardText = value;
    },
    setSaveDialogResult(value: SaveDialogResult) {
      saveDialogResult = value;
    },
    setOpenDialogResult(value: OpenDialogResult) {
      openDialogResult = value;
    },
    reset() {
      clipboardText = '';
      uuidCounter = 0;
      saveDialogResult = { canceled: true };
      openDialogResult = { canceled: true, filePaths: [] };
    },
    appGetPath: vi.fn((_name: string) => userDataDir),
    clipboardReadText: vi.fn(() => clipboardText),
    clipboardWriteText: vi.fn((value: string) => {
      clipboardText = value;
    }),
    cryptoRandomUUID: vi.fn(() => {
      uuidCounter += 1;
      return `uuid-${uuidCounter}`;
    }),
    showSaveDialog: vi.fn(async () => saveDialogResult),
    showOpenDialog: vi.fn(async () => openDialogResult),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: mocks.appGetPath,
  },
  clipboard: {
    readText: mocks.clipboardReadText,
    writeText: mocks.clipboardWriteText,
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialog,
    showOpenDialog: mocks.showOpenDialog,
  },
  BrowserWindow: class {},
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomUUID: mocks.cryptoRandomUUID,
  };
});

async function loadStore() {
  return import('../snippet-store');
}

let tempDir = '';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-02T03:04:05.000Z'));
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-store-test-'));
  mocks.setUserDataDir(tempDir);
  mocks.reset();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('extractSnippetDynamicFields', () => {
  it('parses argument tokens, deduplicates by key, and keeps defaults', async () => {
    const store = await loadStore();
    const fields = store.extractSnippetDynamicFields(
      'Hello {argument name="Name" default="Guest"} {argument name="name"} {argument:Project}'
    );

    expect(fields).toEqual([
      { key: 'name', name: 'Name', defaultValue: 'Guest' },
      { key: 'project', name: 'Project', defaultValue: undefined },
    ]);
  });
});

describe('resolveSnippetPlaceholders', () => {
  it('resolves argument/date/time/clipboard/random placeholders deterministically', async () => {
    const store = await loadStore();
    mocks.setClipboardText('clip-value');

    const expectedDate = new Date().toLocaleDateString();
    const expectedTime = new Date().toLocaleTimeString();
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const expectedFormattedTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const resolved = store.resolveSnippetPlaceholders(
      'A:{argument name="Name" default="Guest"}|B:{clipboard}|C:{date}|D:{time}|E:{date:YYYY-MM-DD}|F:{time:HH:mm:ss}|G:{random:UUID}|H:{unknown}',
      { name: 'Nico' }
    );

    expect(resolved).toBe(
      `A:Nico|B:clip-value|C:${expectedDate}|D:${expectedTime}|E:2025-01-02|F:${expectedFormattedTime}|G:uuid-1|H:{unknown}`
    );
  });

  it('falls back to argument default when value is missing', async () => {
    const store = await loadStore();
    const resolved = store.resolveSnippetPlaceholders('Hello {argument name="Team" default="Core"}');
    expect(resolved).toBe('Hello Core');
  });
});

describe('snippet store CRUD and ordering', () => {
  it('supports create/update/delete/toggle pin/duplicate/search and keyword lookup', async () => {
    const store = await loadStore();

    const first = store.createSnippet({ name: 'Alpha', content: 'One', keyword: 'HELLO' });
    vi.setSystemTime(new Date('2025-01-02T03:05:05.000Z'));
    const second = store.createSnippet({ name: 'Beta', content: 'Two' });

    expect(store.searchSnippets('alpha')).toHaveLength(1);
    expect(store.searchSnippets('two')).toHaveLength(1);
    expect(store.getSnippetByKeyword('hello')?.id).toBe(first.id);

    const updated = store.updateSnippet(second.id, { content: 'Two updated', keyword: 'beta-key' });
    expect(updated?.content).toBe('Two updated');

    const duplicate = store.duplicateSnippet(first.id);
    expect(duplicate?.name).toBe('Alpha Copy');
    expect(duplicate?.pinned).toBe(false);

    const toggled = store.togglePinSnippet(first.id);
    expect(toggled?.pinned).toBe(true);

    const all = store.getAllSnippets();
    expect(all[0]?.id).toBe(first.id);

    expect(store.deleteSnippet(second.id)).toBe(true);
    expect(store.getSnippetById(second.id)).toBeNull();
  });

  it('supports render/getDynamicFields/copy helpers and deleteAllSnippets', async () => {
    const store = await loadStore();
    mocks.setClipboardText('clip');

    const snippet = store.createSnippet({
      name: 'Template',
      content: 'Hi {argument name="Name" default="Guest"} {clipboard}',
      keyword: 'tmpl',
    });

    expect(store.getSnippetDynamicFieldsById(snippet.id)).toEqual([
      { key: 'name', name: 'Name', defaultValue: 'Guest' },
    ]);
    expect(store.renderSnippetById(snippet.id, { name: 'Nico' })).toBe('Hi Nico clip');

    expect(store.copySnippetToClipboard(snippet.id)).toBe(true);
    expect(store.copySnippetToClipboardResolved(snippet.id, { name: 'Dev' })).toBe(true);
    expect(mocks.clipboardWriteText).toHaveBeenCalled();

    expect(store.copySnippetToClipboard('missing-id')).toBe(false);
    expect(store.renderSnippetById('missing-id')).toBeNull();

    const removed = store.deleteAllSnippets();
    expect(removed).toBe(1);
    expect(store.getAllSnippets()).toHaveLength(0);
  });
});

describe('snippet import/export', () => {
  it('exports snippets to a local file', async () => {
    const store = await loadStore();
    store.createSnippet({ name: 'Export Me', content: 'Body', keyword: 'ex' });

    const exportPath = path.join(tempDir, 'snippets-export.json');
    mocks.setSaveDialogResult({ canceled: false, filePath: exportPath });

    const ok = await store.exportSnippetsToFile();
    expect(ok).toBe(true);

    const raw = fs.readFileSync(exportPath, 'utf-8');
    const parsed = JSON.parse(raw) as { type: string; snippets: Array<{ name: string; content: string }> };

    expect(parsed.type).toBe('snippets');
    expect(parsed.snippets).toEqual([{ name: 'Export Me', content: 'Body', keyword: 'ex', pinned: false }]);
  });

  it('imports snippets from export format and plain array, skipping duplicates', async () => {
    const store = await loadStore();
    store.createSnippet({ name: 'Existing', content: 'One' });

    const importPath1 = path.join(tempDir, 'import-format.json');
    fs.writeFileSync(
      importPath1,
      JSON.stringify({
        type: 'snippets',
        snippets: [
          { name: 'Existing', content: 'Dup' },
          { name: 'Fresh', content: 'Two', pinned: true },
          { name: '', content: 'Invalid' },
        ],
      }),
      'utf-8'
    );

    mocks.setOpenDialogResult({ canceled: false, filePaths: [importPath1] });
    const firstImport = await store.importSnippetsFromFile();
    expect(firstImport).toEqual({ imported: 1, skipped: 2 });

    const importPath2 = path.join(tempDir, 'import-array.json');
    fs.writeFileSync(importPath2, JSON.stringify([{ name: 'Array Item', content: 'Three' }]), 'utf-8');

    mocks.setOpenDialogResult({ canceled: false, filePaths: [importPath2] });
    const secondImport = await store.importSnippetsFromFile();
    expect(secondImport).toEqual({ imported: 1, skipped: 0 });

    expect(store.searchSnippets('fresh')).toHaveLength(1);
    expect(store.searchSnippets('array item')).toHaveLength(1);
  });

  it('returns zero counts for invalid import payload', async () => {
    const store = await loadStore();

    const invalidPath = path.join(tempDir, 'invalid.json');
    fs.writeFileSync(invalidPath, JSON.stringify({ foo: 'bar' }), 'utf-8');

    mocks.setOpenDialogResult({ canceled: false, filePaths: [invalidPath] });
    const result = await store.importSnippetsFromFile();

    expect(result).toEqual({ imported: 0, skipped: 0 });
  });
});

describe('disk loading fallbacks', () => {
  it('recovers with empty store when snippets file is malformed JSON', async () => {
    const snippetsDir = path.join(tempDir, 'snippets');
    fs.mkdirSync(snippetsDir, { recursive: true });
    fs.writeFileSync(path.join(snippetsDir, 'snippets.json'), '{bad json', 'utf-8');

    const store = await loadStore();
    expect(store.getAllSnippets()).toEqual([]);
  });
});
