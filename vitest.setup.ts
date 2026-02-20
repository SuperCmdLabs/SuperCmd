import { beforeEach, afterEach, vi } from 'vitest';

let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
const passthroughError = console.error.bind(console);

const SUPPRESSED_PREFIXES = [
  'Failed to load snippets from disk:',
  'Failed to import snippets:',
  'Failed to save settings:',
  'Failed to save OAuth tokens:',
];

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? '');
    if (SUPPRESSED_PREFIXES.some((prefix) => first.startsWith(prefix))) {
      return;
    }
    (passthroughError as (...values: unknown[]) => void)(...args);
  });
});

afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = null;
});
