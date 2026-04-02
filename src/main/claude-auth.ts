/**
 * Claude Account Authentication
 *
 * Syncs the user's local Claude Code login state into SuperCmd.
 * The actual account session is maintained by Claude Code; this file
 * only mirrors the locally available auth token/base URL.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);
import { shell } from 'electron';
import { loadSettings, saveSettings, type ClaudeAccountTokens } from './settings-store';

const LOGIN_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 1_500;
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const CLAUDE_AUTH_URL_PATTERN =
  /https:\/\/(?:claude\.ai\/oauth\/authorize|claude\.com\/cai\/oauth\/authorize)\?[^\s"'<>]+/i;

type ClaudeCodeSettings = {
  env?: Record<string, unknown>;
};

type ClaudeAuthStatus = {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
};

function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function readClaudeCodeSettings(): ClaudeCodeSettings | null {
  try {
    const raw = fs.readFileSync(getClaudeSettingsPath(), 'utf-8');
    return JSON.parse(raw) as ClaudeCodeSettings;
  } catch {
    return null;
  }
}

function readClaudeCodeModelAlias(name: string): string {
  const settings = readClaudeCodeSettings();
  const env = settings?.env || {};
  return getStringEnv(env[name]);
}

function getStringEnv(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, '');
}

function readClaudeCodeAuth(): ClaudeAccountTokens | null {
  const settings = readClaudeCodeSettings();
  const env = settings?.env || {};

  const authToken = getStringEnv(env.ANTHROPIC_AUTH_TOKEN);
  const baseUrl = getStringEnv(env.ANTHROPIC_BASE_URL) || DEFAULT_ANTHROPIC_BASE_URL;

  if (!authToken) return null;

  return {
    authToken,
    baseUrl,
    source: 'claude-code',
    lastSync: new Date().toISOString(),
  };
}

function persistClaudeTokens(tokens: ClaudeAccountTokens): void {
  const settings = loadSettings();
  saveSettings({
    ai: {
      ...settings.ai,
      claudeAccountTokens: tokens,
    },
  });
}

function clearClaudeTokens(): void {
  const settings = loadSettings();
  const { claudeAccountTokens, ...restAI } = settings.ai as any;
  saveSettings({
    ai: {
      ...restAI,
      claudeAccountTokens: undefined,
    },
  });
}

async function readClaudeAuthStatus(): Promise<ClaudeAuthStatus | null> {
  return new Promise<ClaudeAuthStatus | null>((resolve) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const finish = (status: ClaudeAuthStatus | null) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };

    const child = spawn('claude', ['auth', 'status', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    });

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {}
      finish(null);
    }, STATUS_TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    child.once('error', () => {
      clearTimeout(timeout);
      finish(null);
    });

    child.once('exit', () => {
      clearTimeout(timeout);
      const raw = stripAnsi(stdoutBuffer || stderrBuffer).trim();
      if (!raw) {
        finish(null);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as ClaudeAuthStatus;
        finish(parsed && typeof parsed === 'object' ? parsed : null);
      } catch {
        finish(null);
      }
    });
  });
}

function extractClaudeAuthUrl(buffer: string): string | null {
  const match = stripAnsi(buffer).match(CLAUDE_AUTH_URL_PATTERN);
  if (!match) return null;
  try {
    return new URL(match[0]).toString();
  } catch {
    return null;
  }
}

async function runClaudeAuthLogout(): Promise<{ success: boolean; message?: string }> {
  return new Promise<{ success: boolean; message?: string }>((resolve) => {
    let stderrBuffer = '';
    const child = spawn('claude', ['auth', 'logout'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    });

    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    child.once('error', (error) => {
      resolve({ success: false, message: error.message || 'Failed to log out from Claude Code.' });
    });
    child.once('exit', (code) => {
      const message = stripAnsi(stderrBuffer).trim();
      if (code === 0) {
        resolve({ success: true });
        return;
      }
      resolve({ success: false, message: message || 'Failed to log out from Claude Code.' });
    });
  });
}

async function resolveClaudeTokensFromRuntime(): Promise<ClaudeAccountTokens | null> {
  const status = await readClaudeAuthStatus();
  if (!status?.loggedIn) return null;
  return readClaudeCodeAuth();
}

// Cache tokens for 60 seconds to avoid spawning `claude auth status` on every request
let cachedTokens: ClaudeAccountTokens | null = null;
let cachedTokensExpiry = 0;

function invalidateTokenCache(): void {
  cachedTokens = null;
  cachedTokensExpiry = 0;
}

let activeLoginCancelled = false;
let activeLoginProcess: ChildProcess | null = null;
let activeLoginCleanup: (() => void) | null = null;
let activeLoginRequiresCode = false;
let activeLoginCodeSubmitted = false;
let activeLoginProgressCallback: ((status: string) => void) | null = null;

function killClaudeLoginProcess(): void {
  if (!activeLoginProcess) return;
  try {
    activeLoginProcess.kill('SIGTERM');
  } catch {}
  activeLoginProcess = null;
}

export function cancelClaudeLogin(): void {
  activeLoginCancelled = true;
  if (activeLoginCleanup) {
    activeLoginCleanup();
  }
}

export function submitClaudeLoginCode(code: string): { success: boolean; error?: string } {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) {
    return { success: false, error: 'Missing authentication code.' };
  }
  if (!activeLoginProcess || !activeLoginProcess.stdin || activeLoginProcess.stdin.destroyed) {
    return { success: false, error: 'Claude login is not active.' };
  }
  if (!activeLoginRequiresCode) {
    return { success: false, error: 'Claude login is not waiting for an authentication code.' };
  }

  try {
    activeLoginProcess.stdin.write(`${normalizedCode}\n`);
    activeLoginCodeSubmitted = true;
    activeLoginProgressCallback?.('Verifying authentication code...');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to submit authentication code.' };
  }
}

export async function startClaudeLogin(
  onProgress?: (status: string) => void
): Promise<ClaudeAccountTokens> {
  // Pre-flight: ensure `claude` CLI is available
  try {
    await execFileAsync('which', ['claude'], { timeout: 3_000 });
  } catch {
    throw new Error(
      'Claude CLI not found. Please install Claude Code first: https://docs.anthropic.com/en/docs/claude-code'
    );
  }

  cancelClaudeLogin();
  activeLoginCancelled = false;
  clearClaudeTokens();
  activeLoginRequiresCode = false;
  activeLoginCodeSubmitted = false;
  activeLoginProgressCallback = onProgress || null;

  return new Promise<ClaudeAccountTokens>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let browserOpened = false;
    let authUrl: string | null = null;
    let poller: NodeJS.Timeout | null = null;
    let timeout: NodeJS.Timeout | null = null;
    let pollInFlight = false;

    const cleanup = () => {
      if (poller) {
        clearInterval(poller);
        poller = null;
      }
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      activeLoginCleanup = null;
      activeLoginRequiresCode = false;
      activeLoginCodeSubmitted = false;
      activeLoginProgressCallback = null;
      killClaudeLoginProcess();
    };

    const finishWithError = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const finishWithSuccess = (tokens: ClaudeAccountTokens) => {
      if (settled) return;
      settled = true;
      persistClaudeTokens(tokens);
      cleanup();
      resolve(tokens);
    };

    timeout = setTimeout(() => {
      finishWithError('Claude login timed out. Please finish login and try again.');
    }, LOGIN_TIMEOUT_MS);

    activeLoginCleanup = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Claude login cancelled'));
    };

    const processLoginOutput = (chunk: string) => {
      if (!chunk) return;
      const nextUrl = extractClaudeAuthUrl(`${stdoutBuffer}\n${stderrBuffer}\n${chunk}`);
      if (nextUrl && !browserOpened) {
        authUrl = nextUrl;
        browserOpened = true;
        let requiresCode = false;
        try {
          requiresCode = new URL(nextUrl).searchParams.get('code') === 'true';
        } catch {}
        activeLoginRequiresCode = requiresCode;
        onProgress?.('Opening Claude login...');
        void shell.openExternal(nextUrl).catch(() => {
          finishWithError('Unable to open Claude authorization page.');
        });
        onProgress?.(
          requiresCode
            ? 'Paste the authentication code from the browser.'
            : 'Waiting for authorization...'
        );
      }
    };

    onProgress?.('Preparing Claude login...');
    const child = spawn('claude', ['auth', 'login'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BROWSER: 'none',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    });
    activeLoginProcess = child;

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuffer += text;
      processLoginOutput(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuffer += text;
      processLoginOutput(text);
    });

    child.once('error', (error) => {
      if (activeLoginProcess === child) {
        activeLoginProcess = null;
      }
      finishWithError(error.message || 'Failed to start Claude login');
    });

    child.once('exit', async (code) => {
      if (activeLoginProcess === child) {
        activeLoginProcess = null;
      }
      if (settled) return;

      if (activeLoginCancelled) {
        finishWithError('Claude login cancelled');
        return;
      }

      const tokens = await resolveClaudeTokensFromRuntime();
      if (code === 0 && tokens) {
        onProgress?.('Claude account connected.');
        finishWithSuccess(tokens);
        return;
      }

      const message = authUrl
        ? (stderrBuffer || stdoutBuffer || 'Claude login failed')
        : 'Unable to open Claude authorization page.';
      finishWithError(message.trim());
    });

    const checkLoginState = async () => {
      if (settled || pollInFlight) return;
      if (!browserOpened) return;
      if (activeLoginRequiresCode && !activeLoginCodeSubmitted) return;
      pollInFlight = true;
      try {
        const tokens = await resolveClaudeTokensFromRuntime();
        if (!tokens) return;
        onProgress?.('Claude account connected.');
        finishWithSuccess(tokens);
      } finally {
        pollInFlight = false;
      }
    };

    poller = setInterval(() => {
      if (settled) {
        if (poller) {
          clearInterval(poller);
          poller = null;
        }
        return;
      }
      void checkLoginState();
    }, POLL_INTERVAL_MS);
  });
}

export async function claudeLogout(): Promise<{ success: boolean; error?: string }> {
  cancelClaudeLogin();
  clearClaudeTokens();
  invalidateTokenCache();

  const result = await runClaudeAuthLogout();
  if (!result.success) {
    return { success: false, error: result.message || 'Failed to log out from Claude Code.' };
  }
  return { success: true };
}

export async function getClaudeLoginStatus(): Promise<{ loggedIn: boolean; source?: string }> {
  const persisted = loadSettings().ai?.claudeAccountTokens;
  if (persisted?.authToken) {
    return { loggedIn: true, source: persisted.source };
  }
  return { loggedIn: false };
}

export function isClaudeLoggedIn(): boolean {
  const persisted = loadSettings().ai?.claudeAccountTokens;
  return !!persisted?.authToken;
}

export async function loadClaudeAccountTokens(): Promise<ClaudeAccountTokens | null> {
  // Return cached tokens if still valid
  if (cachedTokens && Date.now() < cachedTokensExpiry) {
    return cachedTokens;
  }

  const status = await readClaudeAuthStatus();
  if (!status?.loggedIn) {
    clearClaudeTokens();
    invalidateTokenCache();
    return null;
  }

  const local = readClaudeCodeAuth();
  if (local?.authToken) {
    persistClaudeTokens(local);
    cachedTokens = local;
    cachedTokensExpiry = Date.now() + 60_000;
    return local;
  }

  const persisted = loadSettings().ai?.claudeAccountTokens;
  if (persisted?.authToken) {
    cachedTokens = persisted;
    cachedTokensExpiry = Date.now() + 60_000;
    return persisted;
  }

  clearClaudeTokens();
  invalidateTokenCache();
  return null;
}

export function resolveClaudeCodeModelAlias(modelId: string): string {
  const normalized = String(modelId || '').trim().toLowerCase();
  if (!normalized) return modelId;

  if (normalized === 'sonnet') {
    return readClaudeCodeModelAlias('ANTHROPIC_DEFAULT_SONNET_MODEL') || modelId;
  }
  if (normalized === 'opus') {
    return readClaudeCodeModelAlias('ANTHROPIC_DEFAULT_OPUS_MODEL') || modelId;
  }
  if (normalized === 'haiku') {
    return readClaudeCodeModelAlias('ANTHROPIC_DEFAULT_HAIKU_MODEL') || modelId;
  }
  return modelId;
}

export function getClaudeModelList(): Array<{ id: string; label: string }> {
  return [
    { id: 'claude-account-sonnet', label: 'Claude Sonnet' },
    { id: 'claude-account-opus', label: 'Claude Opus' },
    { id: 'claude-account-haiku', label: 'Claude Haiku' },
  ];
}
