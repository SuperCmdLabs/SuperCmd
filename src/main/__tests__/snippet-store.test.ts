import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let mockUserDataPath = '';
const mockShowSaveDialog = vi.fn();
const mockShowOpenDialog = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mockUserDataPath;
      if (name === 'temp') return os.tmpdir();
      return mockUserDataPath;
    },
  },
  clipboard: {
    readText: () => '',
    writeText: () => {},
  },
  dialog: {
    showSaveDialog: (...args: any[]) => mockShowSaveDialog(...args),
    showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args),
  },
  BrowserWindow: class BrowserWindow {},
}));

import {
  createSnippet,
  deleteAllSnippets,
  exportSnippetsToFile,
  getAllSnippets,
  importSnippetsFromFile,
  initSnippetStore,
} from '../snippet-store';

describe('snippet-store import/export', () => {
  beforeEach(() => {
    mockUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-snippet-test-'));
    mockShowSaveDialog.mockReset();
    mockShowOpenDialog.mockReset();
    initSnippetStore();
    deleteAllSnippets();
  });

  afterEach(() => {
    deleteAllSnippets();
    try {
      fs.rmSync(mockUserDataPath, { recursive: true, force: true });
    } catch {}
  });

  it('exports snippets to a JSON file', async () => {
    createSnippet({
      name: 'Greeting',
      content: 'Hello {argument name="Name"}',
      keyword: 'greet',
    });
    const outputPath = path.join(mockUserDataPath, 'exported-snippets.json');
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath });

    const ok = await exportSnippetsToFile();
    expect(ok).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(true);

    const exported = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(exported.type).toBe('snippets');
    expect(Array.isArray(exported.snippets)).toBe(true);
    expect(exported.snippets[0].name).toBe('Greeting');
  });

  it('imports raycast-style snippets and skips duplicates', async () => {
    const importPath = path.join(mockUserDataPath, 'raycast-snippets.json');
    fs.writeFileSync(
      importPath,
      JSON.stringify(
        [
          { name: 'Meeting Link', text: 'https://meet.example.com', keyword: 'meet' },
          { name: 'Invalid Keyword', text: 'value', keyword: 'bad"quote' },
        ],
        null,
        2
      ),
      'utf-8'
    );
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: [importPath] });

    const first = await importSnippetsFromFile();
    expect(first.imported).toBe(2);
    expect(first.skipped).toBe(0);
    expect(getAllSnippets()).toHaveLength(2);

    const invalidKeywordSnippet = getAllSnippets().find((s) => s.name === 'Invalid Keyword');
    expect(invalidKeywordSnippet?.keyword).toBeUndefined();

    const second = await importSnippetsFromFile();
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
  });
});
