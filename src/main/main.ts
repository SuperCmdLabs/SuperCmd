/**
 * Main Process — SuperCmd
 *
 * Handles:
 * - Global shortcut registration (configurable)
 * - Launcher window lifecycle (create, show, hide, toggle)
 * - Settings window lifecycle
 * - IPC communication with renderer
 * - Command execution
 * - Per-command hotkey registration
 */

import * as path from 'path';
import { getAvailableCommands, executeCommand, invalidateCache } from './commands';
import { loadSettings, saveSettings } from './settings-store';
import type { AppSettings } from './settings-store';
import { streamAI, isAIAvailable, transcribeAudio } from './ai-provider';
import { addMemory, buildMemoryContextSystemPrompt } from './memory';
import {
  createScriptCommandTemplate,
  executeScriptCommand,
  getScriptCommandBySlug,
  getSuperCmdScriptCommandsDirectory,
  invalidateScriptCommandsCache,
} from './script-command-runner';
import {
  getCatalog,
  getExtensionScreenshotUrls,
  getInstalledExtensionNames,
  installExtension,
  uninstallExtension,
} from './extension-registry';
import { getExtensionBundle, buildAllCommands, discoverInstalledExtensionCommands, getInstalledExtensionsSettingsSchema } from './extension-runner';
import {
  startClipboardMonitor,
  stopClipboardMonitor,
  getClipboardHistory,
  clearClipboardHistory,
  deleteClipboardItem,
  copyItemToClipboard,
  searchClipboardHistory,
  setClipboardMonitorEnabled,
} from './clipboard-manager';
import {
  initSnippetStore,
  getAllSnippets,
  searchSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  deleteAllSnippets,
  duplicateSnippet,
  togglePinSnippet,
  getSnippetByKeyword,
  copySnippetToClipboard,
  copySnippetToClipboardResolved,
  getSnippetDynamicFieldsById,
  renderSnippetById,
  importSnippetsFromFile,
  exportSnippetsToFile,
} from './snippet-store';

const electron = require('electron');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell, Menu, Tray, nativeImage, protocol, net, dialog, clipboard: systemClipboard } = electron;

// ─── Native Binary Helpers ──────────────────────────────────────────

/**
 * Resolve the path to a pre-compiled native binary in dist/native/.
 * In packaged apps the dist/native/ directory lives in app.asar.unpacked
 * (see asarUnpack in package.json), so we swap the asar path for the
 * unpacked one — child_process.spawn is not asar-aware.
 */
function getNativeBinaryPath(name: string): string {
  const base = path.join(__dirname, '..', 'native', name);
  if (app.isPackaged) {
    return base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

// ─── Window Configuration ───────────────────────────────────────────

const DEFAULT_WINDOW_WIDTH = 860;
const DEFAULT_WINDOW_HEIGHT = 540;
const ONBOARDING_WINDOW_WIDTH = 1120;
const ONBOARDING_WINDOW_HEIGHT = 740;
const CURSOR_PROMPT_WINDOW_WIDTH = 500;
const CURSOR_PROMPT_WINDOW_HEIGHT = 90;
const CURSOR_PROMPT_LEFT_OFFSET = 20;
const WHISPER_WINDOW_WIDTH = 266;
const WHISPER_WINDOW_HEIGHT = 84;
const DETACHED_WHISPER_WINDOW_NAME = 'supercommand-whisper-window';
const DETACHED_WHISPER_ONBOARDING_WINDOW_NAME = 'supercommand-whisper-onboarding-window';
const DETACHED_SPEAK_WINDOW_NAME = 'supercommand-speak-window';
const DETACHED_PROMPT_WINDOW_NAME = 'supercommand-prompt-window';
const DETACHED_WINDOW_QUERY_KEY = 'sc_detached';
type LauncherMode = 'default' | 'onboarding' | 'whisper' | 'speak' | 'prompt';

function parsePopupFeatures(rawFeatures: string): {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
} {
  const out: { width?: number; height?: number; x?: number; y?: number } = {};
  const features = String(rawFeatures || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const entry of features) {
    const [rawKey, rawValue] = entry.split('=').map((s) => String(s || '').trim());
    if (!rawKey || rawValue === '') continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const key = rawKey.toLowerCase();
    if (key === 'width') out.width = Math.max(80, Math.round(value));
    if (key === 'height') out.height = Math.max(36, Math.round(value));
    if (key === 'left') out.x = Math.round(value);
    if (key === 'top') out.y = Math.round(value);
  }
  return out;
}

function resolveDetachedPopupName(details: any): string | null {
  const byFrameName = String(details?.frameName || '').trim();
  if (
    byFrameName === DETACHED_WHISPER_WINDOW_NAME ||
    byFrameName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME ||
    byFrameName === DETACHED_SPEAK_WINDOW_NAME ||
    byFrameName === DETACHED_PROMPT_WINDOW_NAME ||
    byFrameName.startsWith(`${DETACHED_WHISPER_WINDOW_NAME}-`) ||
    byFrameName.startsWith(`${DETACHED_WHISPER_ONBOARDING_WINDOW_NAME}-`) ||
    byFrameName.startsWith(`${DETACHED_SPEAK_WINDOW_NAME}-`) ||
    byFrameName.startsWith(`${DETACHED_PROMPT_WINDOW_NAME}-`)
  ) {
    if (byFrameName.startsWith(DETACHED_WHISPER_WINDOW_NAME)) return DETACHED_WHISPER_WINDOW_NAME;
    if (byFrameName.startsWith(DETACHED_WHISPER_ONBOARDING_WINDOW_NAME)) return DETACHED_WHISPER_ONBOARDING_WINDOW_NAME;
    if (byFrameName.startsWith(DETACHED_SPEAK_WINDOW_NAME)) return DETACHED_SPEAK_WINDOW_NAME;
    if (byFrameName.startsWith(DETACHED_PROMPT_WINDOW_NAME)) return DETACHED_PROMPT_WINDOW_NAME;
    return byFrameName;
  }
  const rawUrl = String(details?.url || '').trim();
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const byQuery = String(parsed.searchParams.get(DETACHED_WINDOW_QUERY_KEY) || '').trim();
    if (
      byQuery === DETACHED_WHISPER_WINDOW_NAME ||
      byQuery === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME ||
      byQuery === DETACHED_SPEAK_WINDOW_NAME ||
      byQuery === DETACHED_PROMPT_WINDOW_NAME
    ) {
      return byQuery;
    }
  } catch {}
  return null;
}

function computeDetachedPopupPosition(
  popupName: string,
  width: number,
  height: number
): { x: number; y: number } {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const workArea = display?.workArea || screen.getPrimaryDisplay().workArea;

  if (popupName === DETACHED_SPEAK_WINDOW_NAME) {
    return {
      x: workArea.x + workArea.width - width - 20,
      y: workArea.y + 16,
    };
  }

  if (popupName === DETACHED_PROMPT_WINDOW_NAME) {
    const caretRect = getTypingCaretRect();
    const focusedInputRect = getFocusedInputRect();
    const promptAnchorPoint = caretRect
      ? {
          x: caretRect.x,
          y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
        }
      : focusedInputRect
        ? {
            x: focusedInputRect.x + 12,
            y: focusedInputRect.y + 18,
          }
        : lastTypingCaretPoint;
    if (caretRect) {
      lastTypingCaretPoint = {
        x: caretRect.x,
        y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
      };
    } else if (focusedInputRect) {
      lastTypingCaretPoint = {
        x: focusedInputRect.x + 12,
        y: focusedInputRect.y + 18,
      };
    }
    if (!promptAnchorPoint) {
      return {
        x: workArea.x + Math.floor((workArea.width - width) / 2),
        y: workArea.y + workArea.height - height - 14,
      };
    }
    const display = screen.getDisplayNearestPoint(promptAnchorPoint);
    const area = display?.workArea || workArea;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const x = clamp(
      promptAnchorPoint.x - CURSOR_PROMPT_LEFT_OFFSET,
      area.x + 8,
      area.x + area.width - width - 8
    );
    const baseY = caretRect ? caretRect.y : focusedInputRect ? focusedInputRect.y : promptAnchorPoint.y;
    const preferred = baseY - height - 10;
    const y = preferred >= area.y + 8
      ? preferred
      : clamp(baseY + 16, area.y + 8, area.y + area.height - height - 8);
    return { x, y };
  }

  if (popupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME) {
    return {
      x: workArea.x + Math.floor((workArea.width - width) / 2),
      y: workArea.y + Math.floor((workArea.height - height) / 2),
    };
  }

  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - 14,
  };
}

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let promptWindow: InstanceType<typeof BrowserWindow> | null = null;
let settingsWindow: InstanceType<typeof BrowserWindow> | null = null;
let extensionStoreWindow: InstanceType<typeof BrowserWindow> | null = null;
let isVisible = false;
let suppressBlurHide = false; // When true, blur won't hide the window (used during file dialogs)
let currentShortcut = '';
let globalShortcutRegistrationState: {
  requestedShortcut: string;
  activeShortcut: string;
  ok: boolean;
} = {
  requestedShortcut: '',
  activeShortcut: '',
  ok: true,
};
let lastFrontmostApp: { name: string; path: string; bundleId?: string } | null = null;
const registeredHotkeys = new Map<string, string>(); // shortcut → commandId
const activeAIRequests = new Map<string, AbortController>(); // requestId → controller
const pendingOAuthCallbackUrls: string[] = [];
let snippetExpanderProcess: any = null;
let snippetExpanderStdoutBuffer = '';
let nativeSpeechProcess: any = null;
let nativeSpeechStdoutBuffer = '';
let whisperHoldWatcherProcess: any = null;
let whisperHoldWatcherStdoutBuffer = '';
let whisperHoldRequestSeq = 0;
let whisperHoldReleasedSeq = 0;
let whisperHoldWatcherSeq = 0;
let edgeTtsRuntime: { command: string; baseArgs: string[] } | null = null;
type SpeakChunkPrepared = {
  index: number;
  text: string;
  audioPath: string;
  wordCues: Array<{ start: number; end: number; wordIndex: number }>;
};
type SpeakRuntimeOptions = {
  voice: string;
  rate: string;
};
type EdgeTtsVoiceCatalogEntry = {
  id: string;
  label: string;
  languageCode: string;
  languageLabel: string;
  gender: 'female' | 'male';
  style?: string;
};
let speakStatusSnapshot: {
  state: 'idle' | 'loading' | 'speaking' | 'done' | 'error';
  text: string;
  index: number;
  total: number;
  message?: string;
  wordIndex?: number;
} = { state: 'idle', text: '', index: 0, total: 0 };
let speakRuntimeOptions: SpeakRuntimeOptions = {
  voice: 'en-US-JennyNeural',
  rate: '+0%',
};
let edgeVoiceCatalogCache: { expiresAt: number; voices: EdgeTtsVoiceCatalogEntry[] } | null = null;
let speakSessionCounter = 0;
let activeSpeakSession: {
  id: number;
  stopRequested: boolean;
  playbackGeneration: number;
  currentIndex: number;
  chunks: string[];
  tmpDir: string;
  chunkPromises: Map<number, Promise<SpeakChunkPrepared>>;
  afplayProc: any | null;
  ttsProcesses: Set<any>;
  restartFrom: (index: number) => void;
} | null = null;
let launcherMode: LauncherMode = 'default';
let lastWhisperToggleAt = 0;
let lastWhisperShownAt = 0;
let lastTypingCaretPoint: { x: number; y: number } | null = null;
let lastCursorPromptSelection = '';
let lastLauncherSelectionSnapshot = '';
let lastLauncherSelectionSnapshotAt = 0;
let whisperEscapeRegistered = false;
let whisperOverlayVisible = false;
let speakOverlayVisible = false;
let whisperChildWindow: InstanceType<typeof BrowserWindow> | null = null;
const LAUNCHER_SELECTION_SNAPSHOT_TTL_MS = 15_000;

function registerWhisperEscapeShortcut(): void {
  if (whisperEscapeRegistered) return;
  try {
    const success = globalShortcut.register('Escape', () => {
      if (isVisible && launcherMode === 'whisper') {
        mainWindow?.webContents.send('whisper-stop-and-close');
      }
    });
    whisperEscapeRegistered = success;
  } catch {
    whisperEscapeRegistered = false;
  }
}

function unregisterWhisperEscapeShortcut(): void {
  if (!whisperEscapeRegistered) return;
  try {
    globalShortcut.unregister('Escape');
  } catch {}
  whisperEscapeRegistered = false;
}

function emitWindowHidden(): void {
  try {
    mainWindow?.webContents.send('window-hidden');
  } catch {}
}

function setSpeakStatus(status: {
  state: 'idle' | 'loading' | 'speaking' | 'done' | 'error';
  text: string;
  index: number;
  total: number;
  message?: string;
  wordIndex?: number;
}): void {
  speakStatusSnapshot = status;
  try {
    mainWindow?.webContents.send('speak-status', status);
  } catch {}
}

function splitTextIntoSpeakChunks(input: string): string[] {
  const normalized = String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  // Keep chunks sentence-aligned. We do NOT split a sentence mid-way.
  const maxChunkWords = 50;
  const sentenceRegex = /[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g;
  const baseSentences = (normalized.match(sentenceRegex) || [])
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[.!?]["')\]]*$/.test(s) ? s : `${s}.`));

  const countWords = (text: string): number => {
    const t = text.trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  };

  const chunks: string[] = [];
  for (let i = 0; i < baseSentences.length; i += 1) {
    const first = baseSentences[i];
    const second = baseSentences[i + 1];
    if (second) {
      const pair = `${first} ${second}`;
      if (countWords(pair) <= maxChunkWords) {
        chunks.push(pair);
        i += 1;
        continue;
      }
    }
    chunks.push(first);
  }

  return chunks;
}

function parseCueTimeMs(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Math.max(0, Math.round(Number(raw)));
  }
  // Accept formats like "00:00:01.230" or "00:01.230"
  const parts = raw.split(':').map((p) => p.trim());
  if (parts.length >= 2) {
    const secPart = parts.pop() || '0';
    const minPart = parts.pop() || '0';
    const hrPart = parts.pop() || '0';
    const sec = Number(secPart);
    const min = Number(minPart);
    const hr = Number(hrPart);
    if (Number.isFinite(sec) && Number.isFinite(min) && Number.isFinite(hr)) {
      return Math.max(0, Math.round(((hr * 3600) + (min * 60) + sec) * 1000));
    }
  }
  return 0;
}

function resolveEdgeTtsRuntime(): { command: string; baseArgs: string[] } | null {
  if (edgeTtsRuntime) return edgeTtsRuntime;
  const fs = require('fs');
  const pathMod = require('path');
  const candidates = [
    pathMod.join(app.getAppPath(), 'node_modules', '.bin', 'node-edge-tts'),
    pathMod.join(process.cwd(), 'node_modules', '.bin', 'node-edge-tts'),
    pathMod.join(__dirname, '..', '..', 'node_modules', '.bin', 'node-edge-tts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      edgeTtsRuntime = { command: candidate, baseArgs: [] };
      return edgeTtsRuntime;
    }
  }
  edgeTtsRuntime = { command: 'npx', baseArgs: ['--no-install', 'node-edge-tts'] };
  return edgeTtsRuntime;
}

function resolveEdgeVoice(language?: string): string {
  const lang = String(language || 'en-US').toLowerCase();
  if (lang.startsWith('en-in')) return 'en-IN-NeerjaNeural';
  if (lang.startsWith('en-gb')) return 'en-GB-SoniaNeural';
  if (lang.startsWith('en-au')) return 'en-AU-NatashaNeural';
  if (lang.startsWith('es')) return 'es-ES-ElviraNeural';
  if (lang.startsWith('fr')) return 'fr-FR-DeniseNeural';
  if (lang.startsWith('de')) return 'de-DE-KatjaNeural';
  if (lang.startsWith('it')) return 'it-IT-ElsaNeural';
  if (lang.startsWith('pt')) return 'pt-BR-FranciscaNeural';
  return 'en-US-JennyNeural';
}

function resolveElevenLabsSttModel(model: string): string {
  const raw = String(model || '').trim().toLowerCase();
  if (raw.includes('scribe')) return 'scribe_v1';
  const noPrefix = raw.replace(/^elevenlabs-/, '');
  if (!noPrefix) return 'scribe_v1';
  return noPrefix.replace(/-/g, '_');
}

function normalizeApiKey(raw: any): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  // Handle accidental surrounding quotes from copy/paste.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function getElevenLabsApiKey(settings: AppSettings): string {
  const fromSettings = normalizeApiKey(settings.ai?.elevenlabsApiKey);
  if (fromSettings) return fromSettings;
  return normalizeApiKey(process.env.ELEVENLABS_API_KEY);
}

function resolveElevenLabsTtsConfig(selectedModel: string): { modelId: string; voiceId: string } {
  const raw = String(selectedModel || '').trim();
  const explicitVoice = /@([A-Za-z0-9]{8,})$/.exec(raw)?.[1];
  const modelSource = explicitVoice ? raw.replace(/@[A-Za-z0-9]{8,}$/, '') : raw;
  const normalized = modelSource.toLowerCase();
  const modelRaw = normalized.replace(/^elevenlabs-/, '');
  let modelId = modelRaw.replace(/-/g, '_');
  if (modelId === 'multilingual_v2' || modelId === 'multilingual-v2') {
    modelId = 'eleven_multilingual_v2';
  }
  if (!modelId) {
    modelId = 'eleven_multilingual_v2';
  }
  // Allow an optional explicit voice id suffix: "elevenlabs-model@voiceId"
  const voiceId = explicitVoice || 'EXAVITQu4vr4xnSDxMa';
  return { modelId, voiceId };
}

function transcribeAudioWithElevenLabs(opts: {
  audioBuffer: Buffer;
  apiKey: string;
  model: string;
  language?: string;
  mimeType?: string;
}): Promise<string> {
  const boundary = `----SuperCmdBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];
  const normalized = String(opts.mimeType || '').toLowerCase();
  const filename = normalized.includes('wav')
    ? 'audio.wav'
    : normalized.includes('mpeg') || normalized.includes('mp3')
      ? 'audio.mp3'
      : normalized.includes('mp4') || normalized.includes('m4a')
        ? 'audio.m4a'
        : normalized.includes('ogg') || normalized.includes('oga')
          ? 'audio.ogg'
          : normalized.includes('flac')
            ? 'audio.flac'
            : 'audio.webm';
  const contentType = normalized || 'audio/webm';

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  ));
  parts.push(opts.audioBuffer);
  parts.push(Buffer.from('\r\n'));

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${opts.model}\r\n`
  ));

  if (opts.language) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language_code"\r\n\r\n${opts.language}\r\n`
    ));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  return new Promise<string>((resolve, reject) => {
    try {
      const https = require('https');
      const req = https.request(
        {
          hostname: 'api.elevenlabs.io',
          path: '/v1/speech-to-text',
          method: 'POST',
          headers: {
            'xi-api-key': opts.apiKey,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode && res.statusCode >= 400) {
              if (res.statusCode === 401 && responseBody.includes('detected_unusual_activity')) {
                reject(new Error('ElevenLabs rejected this key due to account restrictions (detected_unusual_activity). Verify plan/account status in ElevenLabs dashboard.'));
                return;
              }
              reject(new Error(`ElevenLabs STT HTTP ${res.statusCode}: ${responseBody.slice(0, 500)}`));
              return;
            }
            try {
              const parsed = JSON.parse(responseBody || '{}');
              const text = String(parsed?.text || parsed?.transcript || '').trim();
              if (!text) {
                reject(new Error('ElevenLabs STT returned an empty transcript.'));
                return;
              }
              resolve(text);
            } catch {
              const text = responseBody.trim();
              if (!text) {
                reject(new Error('ElevenLabs STT returned an empty response.'));
                return;
              }
              resolve(text);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

function synthesizeElevenLabsToFile(opts: {
  text: string;
  apiKey: string;
  modelId: string;
  voiceId: string;
  audioPath: string;
  timeoutMs?: number;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      const https = require('https');
      const fs = require('fs');
      const req = https.request(
        {
          hostname: 'api.elevenlabs.io',
          path: `/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`,
          method: 'POST',
          headers: {
            'xi-api-key': opts.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              const responseText = Buffer.concat(chunks).toString('utf-8');
              if (res.statusCode === 401 && responseText.includes('detected_unusual_activity')) {
                reject(new Error('ElevenLabs rejected this key due to account restrictions (detected_unusual_activity). Verify plan/account status in ElevenLabs dashboard.'));
                return;
              }
              reject(new Error(`ElevenLabs TTS HTTP ${res.statusCode}: ${responseText.slice(0, 500)}`));
              return;
            }
            const audio = Buffer.concat(chunks);
            if (!audio.length) {
              reject(new Error('ElevenLabs TTS returned empty audio.'));
              return;
            }
            fs.writeFile(opts.audioPath, audio, (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(Math.max(5000, opts.timeoutMs || 45000), () => {
        req.destroy(new Error('ElevenLabs TTS timed out.'));
      });
      req.write(JSON.stringify({
        text: opts.text,
        model_id: opts.modelId,
      }));
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

function formatEdgeLocaleLabel(locale: string, rawLabel?: string): string {
  const map: Record<string, string> = {
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    'pt-BR': 'Portuguese (Brazil)',
    'es-ES': 'Spanish (Spain)',
    'es-MX': 'Spanish (Mexico)',
    'fr-FR': 'French (France)',
    'fr-CA': 'French (Canada)',
    'zh-CN': 'Chinese (Mandarin)',
  };
  if (map[locale]) return map[locale];
  if (rawLabel && typeof rawLabel === 'string') {
    return rawLabel
      .replace(/\bUnited States\b/i, 'US')
      .replace(/\bUnited Kingdom\b/i, 'UK');
  }
  return locale;
}

function formatEdgeVoiceLabel(shortName: string): string {
  const cleaned = String(shortName || '').replace(/Neural$/i, '');
  const parts = cleaned.split('-');
  if (parts.length >= 3) {
    return parts.slice(2).join('-');
  }
  return cleaned;
}

function fetchEdgeTtsVoiceCatalog(timeoutMs = 12000): Promise<EdgeTtsVoiceCatalogEntry[]> {
  return new Promise((resolve, reject) => {
    try {
      const https = require('https');
      const drm = require('node-edge-tts/dist/drm.js');
      const token = String(drm?.TRUSTED_CLIENT_TOKEN || '').trim();
      const version = String(drm?.CHROMIUM_FULL_VERSION || '').trim();
      const secMsGec = typeof drm?.generateSecMsGecToken === 'function'
        ? String(drm.generateSecMsGecToken() || '')
        : '';

      if (!token || !version || !secMsGec) {
        reject(new Error('Failed to initialize Edge TTS DRM values.'));
        return;
      }

      const major = version.split('.')[0] || '120';
      const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${token}`;

      const req = https.request(url, {
        method: 'GET',
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
          'Accept': 'application/json',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'Referer': 'https://edge.microsoft.com/',
          'Sec-MS-GEC': secMsGec,
          'Sec-MS-GEC-Version': `1-${version}`,
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
        },
      }, (res: any) => {
        let body = '';
        res.on('data', (chunk: Buffer | string) => { body += String(chunk || ''); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Voice catalog HTTP ${res.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            if (!Array.isArray(parsed)) {
              reject(new Error('Voice catalog response was not an array.'));
              return;
            }
            const mapped = parsed
              .map((entry: any): EdgeTtsVoiceCatalogEntry | null => {
                const shortName = String(entry?.ShortName || entry?.Name || '').trim();
                if (!shortName) return null;
                const locale = String(entry?.Locale || shortName.split('-').slice(0, 2).join('-') || '').trim();
                if (!locale) return null;
                const rawGender = String(entry?.Gender || '').toLowerCase();
                const gender: 'female' | 'male' = rawGender === 'male' ? 'male' : 'female';
                const personalities = Array.isArray(entry?.VoiceTag?.VoicePersonalities)
                  ? entry.VoiceTag.VoicePersonalities
                  : [];
                const style = personalities.length > 0 ? String(personalities[0]) : '';
                return {
                  id: shortName,
                  label: formatEdgeVoiceLabel(shortName),
                  languageCode: locale,
                  languageLabel: formatEdgeLocaleLabel(locale, String(entry?.LocaleName || '')),
                  gender,
                  style: style || undefined,
                };
              })
              .filter(Boolean) as EdgeTtsVoiceCatalogEntry[];

            mapped.sort((a, b) => {
              const langCmp = a.languageLabel.localeCompare(b.languageLabel);
              if (langCmp !== 0) return langCmp;
              const genderCmp = a.gender.localeCompare(b.gender);
              if (genderCmp !== 0) return genderCmp;
              return a.label.localeCompare(b.label);
            });
            resolve(mapped);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error: Error) => reject(error));
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Voice catalog request timed out.'));
      });
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function getSelectedTextForSpeak(): Promise<string> {
  const fromAccessibility = await (async () => {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);
      const script = `
        tell application "System Events"
          try
            set frontApp to first application process whose frontmost is true
            set focusedElement to value of attribute "AXFocusedUIElement" of frontApp
            if focusedElement is missing value then return ""
            set selectedText to value of attribute "AXSelectedText" of focusedElement
            return selectedText
          on error
            return ""
          end try
        end tell
      `;
      const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script]);
      return String(stdout || '').trim();
    } catch {
      return '';
    }
  })();
  if (fromAccessibility) return fromAccessibility;

  const previousClipboard = systemClipboard.readText();
  const sentinel = `__supercommand_speak_copy_probe__${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    // Put a probe value on clipboard so we can reliably detect whether Cmd+C
    // produced fresh selected text instead of reusing stale clipboard content.
    systemClipboard.writeText(sentinel);
    await execFileAsync('/usr/bin/osascript', [
      '-e',
      'tell application "System Events" to keystroke "c" using command down',
    ]);
    // Wait briefly for apps that populate clipboard asynchronously.
    const waitUntil = Date.now() + 380;
    let latest = '';
    while (Date.now() < waitUntil) {
      latest = String(systemClipboard.readText() || '');
      if (latest && latest !== sentinel) break;
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    const captured = String(latest || systemClipboard.readText() || '').trim();
    if (!captured || captured === sentinel) return '';
    return captured;
  } catch {
    return '';
  } finally {
    try {
      systemClipboard.writeText(previousClipboard);
    } catch {}
  }
}

function rememberSelectionSnapshot(text: string): void {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    lastLauncherSelectionSnapshot = '';
    lastLauncherSelectionSnapshotAt = 0;
    return;
  }
  lastLauncherSelectionSnapshot = raw;
  lastLauncherSelectionSnapshotAt = Date.now();
  lastCursorPromptSelection = raw;
}

function getRecentSelectionSnapshot(): string {
  if (!lastLauncherSelectionSnapshot) return '';
  if (Date.now() - lastLauncherSelectionSnapshotAt > LAUNCHER_SELECTION_SNAPSHOT_TTL_MS) {
    lastLauncherSelectionSnapshot = '';
    lastLauncherSelectionSnapshotAt = 0;
    return '';
  }
  return lastLauncherSelectionSnapshot;
}

async function captureSelectionSnapshotBeforeShow(): Promise<void> {
  if (launcherMode !== 'default') {
    rememberSelectionSnapshot('');
    return;
  }
  try {
    const selected = String(await getSelectedTextForSpeak() || '');
    rememberSelectionSnapshot(selected);
  } catch {
    rememberSelectionSnapshot('');
  }
}

function stopSpeakSession(options?: { resetStatus?: boolean; cleanupWindow?: boolean }): void {
  const session = activeSpeakSession;
  if (!session) {
    if (options?.resetStatus) {
      setSpeakStatus({ state: 'idle', text: '', index: 0, total: 0 });
    }
    if (options?.cleanupWindow) {
      try {
        mainWindow?.webContents.send('run-system-command', 'system-supercommand-speak-close');
      } catch {}
    }
    return;
  }

  session.stopRequested = true;
  if (session.afplayProc) {
    try { session.afplayProc.kill('SIGTERM'); } catch {}
    session.afplayProc = null;
  }
  for (const proc of session.ttsProcesses) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  session.ttsProcesses.clear();

  try {
    const fs = require('fs');
    fs.rmSync(session.tmpDir, { recursive: true, force: true });
  } catch {}

  if (activeSpeakSession?.id === session.id) {
    activeSpeakSession = null;
  }
  if (options?.resetStatus !== false) {
    setSpeakStatus({ state: 'idle', text: '', index: 0, total: 0 });
  }
  if (options?.cleanupWindow) {
    try {
      mainWindow?.webContents.send('run-system-command', 'system-supercommand-speak-close');
    } catch {}
  }
}

function parseSpeakRateInput(input: any): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '+0%';
  if (/^[+-]?\d+%$/.test(raw)) {
    return raw.startsWith('+') || raw.startsWith('-') ? raw : `+${raw}`;
  }
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    const pct = Math.max(-70, Math.min(150, Math.round((asNum - 1) * 100)));
    return `${pct >= 0 ? '+' : ''}${pct}%`;
  }
  return '+0%';
}

function normalizeAccelerator(shortcut: string): string {
  const raw = String(shortcut || '').trim();
  if (!raw) return raw;
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return raw;
  const key = parts[parts.length - 1];
  // Keep punctuation keys as punctuation for Electron accelerator parsing.
  if (/^period$/i.test(key)) {
    parts[parts.length - 1] = '.';
  }
  return parts.join('+');
}

function unregisterShortcutVariants(shortcut: string): void {
  const raw = String(shortcut || '').trim();
  if (!raw) return;
  const normalized = normalizeAccelerator(raw);
  try { globalShortcut.unregister(raw); } catch {}
  if (normalized !== raw) {
    try { globalShortcut.unregister(normalized); } catch {}
  }
}

function parseHoldShortcutConfig(shortcut: string): {
  keyCode: number;
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
} | null {
  const raw = normalizeAccelerator(shortcut);
  if (!raw) return null;
  const parts = raw.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;
  const keyToken = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const map: Record<string, number> = {
    a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
    b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, '1': 18, '2': 19,
    '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25, '7': 26, '-': 27,
    '8': 28, '0': 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35,
    l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44,
    n: 45, m: 46, '.': 47, '`': 50,
    period: 47, comma: 43, slash: 44, semicolon: 41, quote: 39,
    tab: 48, space: 49, return: 36, enter: 36, escape: 53,
  };
  const keyCode = map[keyToken];
  if (!Number.isFinite(keyCode)) return null;
  return {
    keyCode,
    cmd: mods.has('command') || mods.has('cmd') || mods.has('meta'),
    ctrl: mods.has('control') || mods.has('ctrl'),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
  };
}

function stopWhisperHoldWatcher(): void {
  if (!whisperHoldWatcherProcess) return;
  try { whisperHoldWatcherProcess.kill('SIGTERM'); } catch {}
  whisperHoldWatcherProcess = null;
  whisperHoldWatcherStdoutBuffer = '';
  whisperHoldWatcherSeq = 0;
}

function ensureWhisperHoldWatcherBinary(): string | null {
  const fs = require('fs');
  const binaryPath = getNativeBinaryPath('hotkey-hold-monitor');
  if (fs.existsSync(binaryPath)) return binaryPath;
  try {
    const { execFileSync } = require('child_process');
    const sourceCandidates = [
      path.join(app.getAppPath(), 'src', 'native', 'hotkey-hold-monitor.swift'),
      path.join(process.cwd(), 'src', 'native', 'hotkey-hold-monitor.swift'),
      path.join(__dirname, '..', '..', 'src', 'native', 'hotkey-hold-monitor.swift'),
    ];
    const sourcePath = sourceCandidates.find((candidate) => fs.existsSync(candidate));
    if (!sourcePath) {
      console.warn('[Whisper][hold] Source file not found for hotkey-hold-monitor.swift');
      return null;
    }
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    execFileSync('swiftc', [
      '-O',
      '-o', binaryPath,
      sourcePath,
      '-framework', 'CoreGraphics',
      '-framework', 'AppKit',
      '-framework', 'Carbon',
    ]);
    return binaryPath;
  } catch (error) {
    console.warn('[Whisper][hold] Failed to compile hotkey hold monitor:', error);
    return null;
  }
}

function startWhisperHoldWatcher(shortcut: string, holdSeq: number): void {
  if (whisperHoldWatcherProcess) return;
  const config = parseHoldShortcutConfig(shortcut);
  if (!config) {
    console.warn('[Whisper][hold] Unsupported shortcut for hold-to-talk:', shortcut);
    return;
  }
  const binaryPath = ensureWhisperHoldWatcherBinary();
  if (!binaryPath) {
    console.warn('[Whisper][hold] Hold monitor binary unavailable');
    return;
  }

  const { spawn } = require('child_process');
  whisperHoldWatcherProcess = spawn(
    binaryPath,
    [
      String(config.keyCode),
      config.cmd ? '1' : '0',
      config.ctrl ? '1' : '0',
      config.alt ? '1' : '0',
      config.shift ? '1' : '0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  whisperHoldWatcherSeq = holdSeq;
  whisperHoldWatcherStdoutBuffer = '';

  whisperHoldWatcherProcess.stdout.on('data', (chunk: Buffer | string) => {
    whisperHoldWatcherStdoutBuffer += chunk.toString();
    const lines = whisperHoldWatcherStdoutBuffer.split('\n');
    whisperHoldWatcherStdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed);
        if (payload?.released) {
          whisperHoldReleasedSeq = Math.max(whisperHoldReleasedSeq, holdSeq);
          mainWindow?.webContents.send('whisper-stop-listening');
          stopWhisperHoldWatcher();
          return;
        }
      } catch {}
    }
  });

  whisperHoldWatcherProcess.stderr.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString().trim();
    if (text) console.warn('[Whisper][hold]', text);
  });

  whisperHoldWatcherProcess.on('error', (error: any) => {
    console.warn('[Whisper][hold] Monitor process error:', error);
    whisperHoldWatcherProcess = null;
    whisperHoldWatcherStdoutBuffer = '';
    whisperHoldWatcherSeq = 0;
  });

  whisperHoldWatcherProcess.on('exit', () => {
    whisperHoldWatcherProcess = null;
    whisperHoldWatcherStdoutBuffer = '';
    if (whisperHoldWatcherSeq === holdSeq) {
      whisperHoldWatcherSeq = 0;
    }
  });
}

function handleOAuthCallbackUrl(rawUrl: string): void {
  if (!rawUrl) return;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'supercommand:') return;
    const isOAuthCallback =
      (parsed.hostname === 'oauth' && parsed.pathname === '/callback') ||
      parsed.pathname === '/oauth/callback';
    if (!isOAuthCallback) return;

    if (!mainWindow) {
      pendingOAuthCallbackUrls.push(rawUrl);
      return;
    }

    void showWindow();
    mainWindow.webContents.send('oauth-callback', rawUrl);
  } catch {
    // ignore invalid URLs
  }
}

app.on('open-url', (event: any, url: string) => {
  event.preventDefault();
  handleOAuthCallbackUrl(url);
});

// ─── Menu Bar (Tray) Management ─────────────────────────────────────

const menuBarTrays = new Map<string, InstanceType<typeof Tray>>();

// ─── URL Helpers ────────────────────────────────────────────────────

function loadWindowUrl(
  win: InstanceType<typeof BrowserWindow>,
  hash = ''
): void {
  if (process.env.NODE_ENV === 'development') {
    win.loadURL(`http://localhost:5173/#${hash}`);
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
      hash,
    });
  }
}

function parseJsonObjectParam(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseScriptArgumentsFromQuery(parsed: URL): string[] {
  const values = parsed.searchParams.getAll('arguments').map((v) => String(v || ''));
  if (values.length > 0) return values;

  const legacyObject = parseJsonObjectParam(parsed.searchParams.get('arguments'));
  if (!legacyObject || Object.keys(legacyObject).length === 0) return [];

  const out: string[] = [];
  for (const value of Object.values(legacyObject)) {
    out.push(String(value ?? ''));
  }
  return out;
}

type ParsedRaycastDeepLink =
  | {
      type: 'extension';
      ownerOrAuthorName?: string;
      extensionName: string;
      commandName: string;
      launchType?: string;
      arguments: Record<string, any>;
      fallbackText?: string | null;
    }
  | {
      type: 'scriptCommand';
      commandName: string;
      arguments: string[];
    };

function parseRaycastDeepLink(url: string): ParsedRaycastDeepLink | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'raycast:') return null;

    const parts = parsed.pathname.split('/').filter(Boolean).map((v) => decodeURIComponent(v));

    if (parsed.hostname === 'extensions') {
      const [ownerOrAuthorName = '', extensionName = '', commandName = ''] = parts;
      if (!extensionName || !commandName) return null;
      return {
        type: 'extension',
        ownerOrAuthorName,
        extensionName,
        commandName,
        launchType: parsed.searchParams.get('launchType') || undefined,
        arguments: parseJsonObjectParam(parsed.searchParams.get('arguments')),
        fallbackText: parsed.searchParams.get('fallbackText'),
      };
    }

    if (parsed.hostname === 'script-commands') {
      const [commandName = ''] = parts;
      if (!commandName) return null;
      return {
        type: 'scriptCommand',
        commandName,
        arguments: parseScriptArgumentsFromQuery(parsed),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function buildLaunchBundle(options: {
  extensionName: string;
  commandName: string;
  args?: Record<string, any>;
  type?: string;
  fallbackText?: string | null;
  context?: any;
  sourceExtensionName?: string;
  sourcePreferences?: Record<string, any>;
}) {
  const {
    extensionName,
    commandName,
    args,
    type,
    fallbackText,
    context,
    sourceExtensionName,
    sourcePreferences,
  } = options;
  const result = getExtensionBundle(extensionName, commandName);
  if (!result) {
    throw new Error(`Command "${commandName}" not found in extension "${extensionName}"`);
  }

  const mergedPreferences: Record<string, any> = {
    ...(result.preferences || {}),
  };

  if (
    sourceExtensionName &&
    sourceExtensionName === extensionName &&
    sourcePreferences &&
    typeof sourcePreferences === 'object'
  ) {
    for (const def of result.preferenceDefinitions || []) {
      if (!def?.name || def.scope !== 'extension') continue;
      if (sourcePreferences[def.name] !== undefined) {
        mergedPreferences[def.name] = sourcePreferences[def.name];
      }
    }
  }

  return {
    code: result.code,
    title: result.title,
    mode: result.mode,
    extName: extensionName,
    cmdName: commandName,
    extensionName: result.extensionName,
    extensionDisplayName: result.extensionDisplayName,
    extensionIconDataUrl: result.extensionIconDataUrl,
    commandName: result.commandName,
    assetsPath: result.assetsPath,
    supportPath: result.supportPath,
    extensionPath: result.extensionPath,
    owner: result.owner,
    preferences: mergedPreferences,
    preferenceDefinitions: result.preferenceDefinitions,
    commandArgumentDefinitions: result.commandArgumentDefinitions,
    launchArguments: args || {},
    fallbackText: fallbackText ?? null,
    launchContext: context,
    launchType: type,
  };
}

// ─── Launcher Window ────────────────────────────────────────────────

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    x: Math.floor((screenWidth - DEFAULT_WINDOW_WIDTH) / 2),
    y: Math.floor(screenHeight * 0.2),
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    hasShadow: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'fullscreen-ui',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler((details: any) => {
    const detachedPopupName = resolveDetachedPopupName(details);
    if (!detachedPopupName) {
      return { action: 'allow' };
    }

    const popupBounds = parsePopupFeatures(details?.features || '');
    const defaultWidth = detachedPopupName === DETACHED_WHISPER_WINDOW_NAME
      ? 272
      : detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME
        ? 920
      : detachedPopupName === DETACHED_PROMPT_WINDOW_NAME
        ? CURSOR_PROMPT_WINDOW_WIDTH
        : 520;
    const defaultHeight = detachedPopupName === DETACHED_WHISPER_WINDOW_NAME
      ? 52
      : detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME
        ? 640
      : detachedPopupName === DETACHED_PROMPT_WINDOW_NAME
        ? CURSOR_PROMPT_WINDOW_HEIGHT
        : 112;
    const finalWidth = typeof popupBounds.width === 'number' ? popupBounds.width : defaultWidth;
    const finalHeight = typeof popupBounds.height === 'number' ? popupBounds.height : defaultHeight;
    const popupPos = computeDetachedPopupPosition(detachedPopupName, finalWidth, finalHeight);

    return {
      action: 'allow',
      outlivesOpener: true,
      overrideBrowserWindowOptions: {
        width: finalWidth,
        height: finalHeight,
        x: popupPos.x,
        y: popupPos.y,
        title:
          detachedPopupName === DETACHED_WHISPER_WINDOW_NAME
            ? 'SuperCmd Whisper'
            : detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME
              ? 'SuperCmd Whisper Onboarding'
            : detachedPopupName === DETACHED_PROMPT_WINDOW_NAME
              ? 'SuperCmd Prompt'
              : 'SuperCmd Read',
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        transparent: true,
        backgroundColor: '#00000000',
        vibrancy: detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME ? 'fullscreen-ui' : undefined,
        visualEffectState: detachedPopupName === DETACHED_WHISPER_ONBOARDING_WINDOW_NAME ? 'active' : undefined,
        hasShadow: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: detachedPopupName !== DETACHED_WHISPER_WINDOW_NAME,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js'),
        },
      },
    };
  });

  mainWindow.webContents.on('did-create-window', (childWindow: any, details: any) => {
    const detachedPopupName = resolveDetachedPopupName(details);
    if (!detachedPopupName) return;

    const hideWindowButtons = () => {
      if (process.platform !== 'darwin') return;
      try {
        childWindow.setWindowButtonVisibility(false);
      } catch {}
    };

    hideWindowButtons();
    childWindow.once('ready-to-show', hideWindowButtons);
    childWindow.on('focus', hideWindowButtons);

    try { childWindow.setMenuBarVisibility(false); } catch {}
    try { childWindow.setSkipTaskbar(true); } catch {}
    try { childWindow.setAlwaysOnTop(true); } catch {}
    try { childWindow.setHasShadow(false); } catch {}

    if (detachedPopupName === DETACHED_WHISPER_WINDOW_NAME) {
      whisperChildWindow = childWindow;
      try { childWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
      childWindow.on('closed', () => {
        if (whisperChildWindow === childWindow) whisperChildWindow = null;
      });
    }
  });

  // Hide traffic light buttons on macOS
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false);
  }

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // NOTE: Do NOT call app.dock.hide() here. Hiding the dock before the window
  // is loaded and shown prevents macOS from granting the app foreground status,
  // causing the window to never appear on first launch from Launchpad/Finder.
  // The dock is hidden later in openLauncherFromUserEntry() after the window
  // is confirmed loaded, or deferred until onboarding completes for fresh installs.

  loadWindowUrl(mainWindow, '/');

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOAuthCallbackUrls.length > 0) {
      const urls = pendingOAuthCallbackUrls.splice(0, pendingOAuthCallbackUrls.length);
      for (const url of urls) {
        mainWindow?.webContents.send('oauth-callback', url);
      }
    }
  });

  // Open DevTools for debugging (detached so it doesn't resize the overlay)
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('blur', () => {
    if (
      isVisible &&
      !suppressBlurHide &&
      launcherMode !== 'whisper' &&
      launcherMode !== 'speak' &&
      launcherMode !== 'onboarding'
    ) {
      hideWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function computePromptWindowBounds(
  preCapturedCaretRect?: { x: number; y: number; width: number; height: number } | null,
  preCapturedInputRect?: { x: number; y: number; width: number; height: number } | null,
): { x: number; y: number; width: number; height: number } {
  const caretRect = preCapturedCaretRect !== undefined ? preCapturedCaretRect : getTypingCaretRect();
  const focusedInputRect = preCapturedInputRect !== undefined ? preCapturedInputRect : getFocusedInputRect();
  const width = CURSOR_PROMPT_WINDOW_WIDTH;
  const height = CURSOR_PROMPT_WINDOW_HEIGHT;
  const promptAnchorPoint = caretRect
    ? {
        x: caretRect.x,
        y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
      }
    : focusedInputRect
      ? {
          x: focusedInputRect.x + 12,
          y: focusedInputRect.y + 18,
        }
      : lastTypingCaretPoint;

  if (caretRect) {
    lastTypingCaretPoint = {
      x: caretRect.x,
      y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
    };
  } else if (focusedInputRect) {
    lastTypingCaretPoint = {
      x: focusedInputRect.x + 12,
      y: focusedInputRect.y + 18,
    };
  }

  if (!promptAnchorPoint) {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: area.x + Math.floor((area.width - width) / 2),
      y: area.y + Math.floor(area.height * 0.28),
      width,
      height,
    };
  }

  const display = screen.getDisplayNearestPoint(promptAnchorPoint);
  const area = display?.workArea || screen.getPrimaryDisplay().workArea;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const x = clamp(
    promptAnchorPoint.x - CURSOR_PROMPT_LEFT_OFFSET,
    area.x + 8,
    area.x + area.width - width - 8
  );
  const baseY = caretRect ? caretRect.y : focusedInputRect ? focusedInputRect.y : promptAnchorPoint.y;
  const preferred = baseY - height - 10;
  const y = preferred >= area.y + 8
    ? preferred
    : clamp(baseY + 16, area.y + 8, area.y + area.height - height - 8);
  return { x, y, width, height };
}

function createPromptWindow(): void {
  if (promptWindow && !promptWindow.isDestroyed()) return;
  const bounds = computePromptWindowBounds();
  promptWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    transparent: true,
    backgroundColor: '#10101400',
    vibrancy: 'fullscreen-ui',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (process.platform === 'darwin') {
    try { promptWindow.setWindowButtonVisibility(false); } catch {}
  }
  promptWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadWindowUrl(promptWindow, '/prompt');
  promptWindow.on('blur', () => {
    hidePromptWindow();
  });
  promptWindow.on('closed', () => {
    promptWindow = null;
  });
}

function showPromptWindow(
  preCapturedCaretRect?: { x: number; y: number; width: number; height: number } | null,
  preCapturedInputRect?: { x: number; y: number; width: number; height: number } | null,
): void {
  if (!promptWindow || promptWindow.isDestroyed()) {
    createPromptWindow();
  }
  if (!promptWindow) return;
  const bounds = computePromptWindowBounds(preCapturedCaretRect, preCapturedInputRect);
  promptWindow.setBounds(bounds);
  promptWindow.show();
  promptWindow.focus();
  promptWindow.moveTop();
  promptWindow.webContents.focus();
}

function hidePromptWindow(): void {
  if (!promptWindow || promptWindow.isDestroyed()) return;
  const win = promptWindow;
  promptWindow = null;
  lastCursorPromptSelection = '';
  try {
    win.close();
  } catch {
    try {
      win.destroy();
    } catch {}
  }
}

function getLauncherSize(mode: LauncherMode) {
  if (mode === 'prompt') {
    return { width: CURSOR_PROMPT_WINDOW_WIDTH, height: CURSOR_PROMPT_WINDOW_HEIGHT, topFactor: 0.2 };
  }
  if (mode === 'whisper') {
    return { width: WHISPER_WINDOW_WIDTH, height: WHISPER_WINDOW_HEIGHT, topFactor: 0.28 };
  }
  if (mode === 'speak') {
    return { width: 530, height: 300, topFactor: 0.03 };
  }
  if (mode === 'onboarding') {
    return { width: ONBOARDING_WINDOW_WIDTH, height: ONBOARDING_WINDOW_HEIGHT, topFactor: 0.12 };
  }
  return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT, topFactor: 0.2 };
}

function getTypingCaretRect():
  | { x: number; y: number; width: number; height: number }
  | null {
  try {
    const { execFileSync } = require('child_process');
    const script = `
      ObjC.import('ApplicationServices');

      function copyAttributeValue(element, attribute) {
        const valueRef = Ref();
        const error = $.AXUIElementCopyAttributeValue(element, attribute, valueRef);
        if (error !== 0) return null;
        return valueRef[0];
      }

      function copyParameterizedAttributeValue(element, attribute, parameter) {
        const valueRef = Ref();
        const error = $.AXUIElementCopyParameterizedAttributeValue(element, attribute, parameter, valueRef);
        if (error !== 0) return null;
        return valueRef[0];
      }

      function decodeCFRange(axValue) {
        const rangeRef = Ref();
        rangeRef[0] = $.CFRangeMake(0, 0);
        const ok = $.AXValueGetValue(axValue, $.kAXValueCFRangeType, rangeRef);
        if (!ok) return null;
        return rangeRef[0];
      }

      function decodeCGRect(axValue) {
        const rectRef = Ref();
        rectRef[0] = $.CGRectMake(0, 0, 0, 0);
        const ok = $.AXValueGetValue(axValue, $.kAXValueCGRectType, rectRef);
        if (!ok) return null;
        return rectRef[0];
      }

      function main() {
        const systemWide = $.AXUIElementCreateSystemWide();
        if (!systemWide) return '';

        const focusedElement = copyAttributeValue(systemWide, $.kAXFocusedUIElementAttribute);
        if (!focusedElement) return '';

        const selectedRangeValue = copyAttributeValue(focusedElement, $.kAXSelectedTextRangeAttribute);
        if (!selectedRangeValue) return '';

        const selectedRange = decodeCFRange(selectedRangeValue);
        if (!selectedRange) return '';

        const caretRange = $.CFRangeMake(selectedRange.location + selectedRange.length, 0);
        const caretRangeValue = $.AXValueCreate($.kAXValueCFRangeType, caretRange);
        if (!caretRangeValue) return '';

        const caretBoundsValue = copyParameterizedAttributeValue(
          focusedElement,
          $.kAXBoundsForRangeParameterizedAttribute,
          caretRangeValue
        );
        if (!caretBoundsValue) return '';

        const caretRect = decodeCGRect(caretBoundsValue);
        if (!caretRect) return '';

        return [
          String(caretRect.origin.x),
          String(caretRect.origin.y),
          String(caretRect.size.width),
          String(caretRect.size.height),
        ].join(',');
      }

      try {
        const result = main();
        if (result) console.log(result);
      } catch (_) {
        console.log('');
      }
    `;
    const out = String(
      execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
        encoding: 'utf-8',
        timeout: 320,
      }) || ''
    ).trim();
    if (!out) return null;
    const [rawX, rawY, rawW, rawH] = out.split(',').map((part) => Number(String(part || '').trim()));
    if (![rawX, rawY, rawW, rawH].every((n) => Number.isFinite(n))) return null;
    return {
      x: Math.round(rawX),
      y: Math.round(rawY),
      width: Math.max(1, Math.round(rawW)),
      height: Math.max(1, Math.round(rawH)),
    };
  } catch {
    return null;
  }
}

function getFocusedInputRect():
  | { x: number; y: number; width: number; height: number }
  | null {
  try {
    const { execFileSync } = require('child_process');
    const script = `
      tell application "System Events"
        try
          set frontApp to first application process whose frontmost is true
          set focusedElement to value of attribute "AXFocusedUIElement" of frontApp
          if focusedElement is missing value then return ""
          set pos to value of attribute "AXPosition" of focusedElement
          set siz to value of attribute "AXSize" of focusedElement
          if pos is missing value or siz is missing value then return ""
          set ex to item 1 of pos
          set ey to item 2 of pos
          set ew to item 1 of siz
          set eh to item 2 of siz
          return (ex as string) & "," & (ey as string) & "," & (ew as string) & "," & (eh as string)
        on error
          return ""
        end try
      end tell
    `;
    const out = String(
      execFileSync('/usr/bin/osascript', ['-e', script], {
        encoding: 'utf-8',
        timeout: 220,
      }) || ''
    ).trim();
    if (!out) return null;
    const [rawX, rawY, rawW, rawH] = out.split(',').map((part) => Number(String(part || '').trim()));
    if (![rawX, rawY, rawW, rawH].every((n) => Number.isFinite(n))) return null;
    return {
      x: Math.round(rawX),
      y: Math.round(rawY),
      width: Math.max(1, Math.round(rawW)),
      height: Math.max(1, Math.round(rawH)),
    };
  } catch {
    return null;
  }
}

function applyLauncherBounds(mode: LauncherMode): void {
  if (!mainWindow) return;
  const cursorPoint = screen.getCursorScreenPoint();
  const caretRect = mode === 'prompt' ? getTypingCaretRect() : null;
  const focusedInputRect = mode === 'prompt' ? getFocusedInputRect() : null;
  if (caretRect) {
    lastTypingCaretPoint = {
      x: caretRect.x,
      y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
    };
  } else if (focusedInputRect) {
    lastTypingCaretPoint = {
      x: focusedInputRect.x + 12,
      y: focusedInputRect.y + 18,
    };
  }
  const promptAnchorPoint = caretRect
    ? {
        x: caretRect.x,
        y: caretRect.y + Math.max(1, Math.floor(caretRect.height * 0.5)),
      }
    : focusedInputRect
      ? {
          x: focusedInputRect.x + 12,
          y: focusedInputRect.y + 18,
        }
      : (mode === 'prompt' && lastTypingCaretPoint)
        ? lastTypingCaretPoint
        : null;
  const currentDisplay = mode === 'prompt'
    ? (promptAnchorPoint
      ? screen.getDisplayNearestPoint(promptAnchorPoint)
      : screen.getPrimaryDisplay())
    : screen.getDisplayNearestPoint(cursorPoint);
  const {
    x: displayX,
    y: displayY,
    width: displayWidth,
    height: displayHeight,
  } = currentDisplay.workArea;
  const size = getLauncherSize(mode);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const promptFallbackX = displayX + Math.floor((displayWidth - size.width) / 2);
  const promptFallbackY = displayY + Math.floor(displayHeight * 0.32);
  const windowX = mode === 'speak'
    ? displayX + displayWidth - size.width - 20
    : mode === 'prompt'
      ? clamp(
          (promptAnchorPoint?.x ?? promptFallbackX) - CURSOR_PROMPT_LEFT_OFFSET,
          displayX + 8,
          displayX + displayWidth - size.width - 8
        )
      : displayX + Math.floor((displayWidth - size.width) / 2);
  const windowY = mode === 'whisper'
    ? displayY + displayHeight - size.height - 18
    : mode === 'speak'
      ? displayY + 16
      : mode === 'prompt'
        ? (() => {
            const baseY = caretRect
              ? caretRect.y
              : focusedInputRect
                ? focusedInputRect.y
                : (promptAnchorPoint?.y ?? promptFallbackY);
            const preferred = baseY - size.height - 10;
            if (preferred >= displayY + 8) return preferred;
            return clamp(baseY + 16, displayY + 8, displayY + displayHeight - size.height - 8);
          })()
        : displayY + Math.floor(displayHeight * size.topFactor);
  mainWindow.setBounds({
    x: windowX,
    y: windowY,
    width: size.width,
    height: size.height,
  });
}

function setLauncherMode(mode: LauncherMode): void {
  const prevMode = launcherMode;
  launcherMode = mode;
  if (mainWindow) {
    try {
      if (process.platform === 'darwin') {
        if (mode === 'whisper' || mode === 'speak') {
          mainWindow.setVibrancy(null as any);
          mainWindow.setHasShadow(false);
          mainWindow.setFocusable(true);
          mainWindow.setBackgroundColor('#00000000');
        } else {
          mainWindow.setVibrancy('fullscreen-ui');
          mainWindow.setHasShadow(true);
          mainWindow.setFocusable(true);
          mainWindow.setBackgroundColor('#10101400');
        }
      }
      if (mode === 'onboarding') {
        mainWindow.setAlwaysOnTop(false);
        mainWindow.setVisibleOnAllWorkspaces(false);
      } else {
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
    } catch {}
  }
  if (mainWindow && isVisible && prevMode !== mode) {
    applyLauncherBounds(mode);
  }
  if (isVisible) {
    if (mode === 'whisper') {
      registerWhisperEscapeShortcut();
    } else {
      unregisterWhisperEscapeShortcut();
    }
  }
}

function captureFrontmostAppContext(): void {
  try {
    const { execSync } = require('child_process');
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set appPath to POSIX path of (file of frontApp as alias)
        set appId to bundle identifier of frontApp
        return appName & "|||" & appPath & "|||" & appId
      end tell
    `;
    const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
    const [name, appPath, bundleId] = result.split('|||');
    if (bundleId !== 'com.supercommand' && name !== 'SuperCmd' && name !== 'Electron') {
      lastFrontmostApp = { name, path: appPath, bundleId };
    }
  } catch {
    // keep previously captured value
  }
}

async function showWindow(): Promise<void> {
  if (!mainWindow) return;

  // Capture the frontmost app BEFORE showing our window
  captureFrontmostAppContext();
  await captureSelectionSnapshotBeforeShow();

  applyLauncherBounds(launcherMode);

  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  isVisible = true;

  if (launcherMode === 'whisper') {
    registerWhisperEscapeShortcut();
  } else {
    unregisterWhisperEscapeShortcut();
  }

  mainWindow.webContents.send('window-shown', { mode: launcherMode });
  if (launcherMode === 'whisper') {
    lastWhisperShownAt = Date.now();
  }
}

function hideWindow(): void {
  if (!mainWindow) return;
  emitWindowHidden();
  mainWindow.hide();
  isVisible = false;
  unregisterWhisperEscapeShortcut();
  try {
    mainWindow.setFocusable(true);
  } catch {}
  setLauncherMode('default');
}

async function activateLastFrontmostApp(): Promise<boolean> {
  if (!lastFrontmostApp) return false;
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    if (lastFrontmostApp.bundleId) {
      await execFileAsync('osascript', [
        '-e',
        `tell application id "${lastFrontmostApp.bundleId}" to activate`,
      ]);
      return true;
    }
  } catch {}

  try {
    if (lastFrontmostApp.name) {
      await execFileAsync('osascript', [
        '-e',
        `tell application "${lastFrontmostApp.name}" to activate`,
      ]);
      return true;
    }
  } catch {}

  try {
    if (lastFrontmostApp.path) {
      await execFileAsync('open', ['-a', lastFrontmostApp.path]);
      return true;
    }
  } catch {}

  try {
    if (lastFrontmostApp.bundleId) {
      await execFileAsync('open', ['-b', lastFrontmostApp.bundleId]);
      return true;
    }
  } catch {}

  return false;
}

async function typeTextDirectly(text: string): Promise<boolean> {
  const value = String(text || '');
  if (!value) return false;

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n');

  try {
    await execFileAsync('osascript', [
      '-e',
      `tell application "System Events" to keystroke "${escaped}"`,
    ]);
    return true;
  } catch (error) {
    console.error('Direct keystroke fallback failed:', error);
    return false;
  }
}

async function pasteTextToActiveApp(text: string): Promise<boolean> {
  const value = String(text || '');
  if (!value) return false;

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const previousClipboardText = systemClipboard.readText();

  try {
    systemClipboard.writeText(value);
    await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to keystroke "v" using command down',
    ]);
    setTimeout(() => {
      try {
        systemClipboard.writeText(previousClipboardText);
      } catch {}
    }, 250);
    return true;
  } catch (error) {
    console.error('pasteTextToActiveApp failed:', error);
    return false;
  }
}

async function replaceTextDirectly(previousText: string, nextText: string): Promise<boolean> {
  const prev = String(previousText || '');
  const next = String(nextText || '');

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    if (prev.length > 0) {
      const script = `
        tell application "System Events"
          repeat ${prev.length} times
            key code 51
          end repeat
        end tell
      `;
      await execFileAsync('osascript', ['-e', script]);
    }
    if (next.length > 0) {
      return await typeTextDirectly(next);
    }
    return true;
  } catch (error) {
    console.error('replaceTextDirectly failed:', error);
    return false;
  }
}

async function replaceTextViaBackspaceAndPaste(previousText: string, nextText: string): Promise<boolean> {
  const prev = String(previousText || '');
  const next = String(nextText || '');

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    if (prev.length > 0) {
      const script = `
        tell application "System Events"
          repeat ${prev.length} times
            key code 51
          end repeat
        end tell
      `;
      await execFileAsync('osascript', ['-e', script]);
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
    if (next.length > 0) {
      return await pasteTextToActiveApp(next);
    }
    return true;
  } catch (error) {
    console.error('replaceTextViaBackspaceAndPaste failed:', error);
    return false;
  }
}

/**
 * Hide the launcher, re-activate the previous frontmost app, and simulate Cmd+V.
 * Used by both clipboard-paste-item and snippet-paste.
 */
async function hideAndPaste(): Promise<boolean> {
  // Hide the window first
  if (mainWindow && isVisible) {
    emitWindowHidden();
    mainWindow.hide();
    isVisible = false;
    setLauncherMode('default');
  }

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  // Re-activate the previous frontmost app explicitly
  await activateLastFrontmostApp();

  // Small delay to let the target app gain focus
  await new Promise(resolve => setTimeout(resolve, 200));

  try {
    await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    return true;
  } catch (e) {
    console.error('Failed to simulate paste keystroke:', e);
    // Fallback with extra delay
    try {
      await new Promise(resolve => setTimeout(resolve, 200));
      await execFileAsync('osascript', ['-e', `
        delay 0.1
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `]);
      return true;
    } catch (e2) {
      console.error('Fallback paste also failed:', e2);
      return false;
    }
  }
}

async function expandSnippetKeywordInPlace(keyword: string, delimiter: string): Promise<void> {
  try {
    console.log(`[SnippetExpander] trigger keyword="${keyword}" delimiter="${delimiter}"`);
    const snippet = getSnippetByKeyword(keyword);
    if (!snippet) return;

    const resolved = renderSnippetById(snippet.id, {});
    if (!resolved) return;

    const fullText = `${resolved}${delimiter || ''}`;
    const backspaceCount = keyword.length + (delimiter ? 1 : 0);
    if (backspaceCount <= 0) return;

    const originalClipboard = electron.clipboard.readText();
    electron.clipboard.writeText(fullText);

    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    const script = `
      tell application "System Events"
        repeat ${backspaceCount} times
          key code 51
        end repeat
        keystroke "v" using command down
      end tell
    `;

    await execFileAsync('osascript', ['-e', script]);

    // Restore user's clipboard after insertion.
    setTimeout(() => {
      electron.clipboard.writeText(originalClipboard);
    }, 80);
  } catch (error) {
    console.error('[SnippetExpander] Failed to expand keyword:', error);
  }
}

function stopSnippetExpander(): void {
  if (!snippetExpanderProcess) return;
  try {
    snippetExpanderProcess.kill();
  } catch {}
  snippetExpanderProcess = null;
  snippetExpanderStdoutBuffer = '';
}

function refreshSnippetExpander(): void {
  if (process.platform !== 'darwin') return;
  stopSnippetExpander();

  const keywords = getAllSnippets()
    .map((s) => (s.keyword || '').trim().toLowerCase())
    .filter((s) => Boolean(s));

  if (keywords.length === 0) return;

  const expanderPath = getNativeBinaryPath('snippet-expander');
  const fs = require('fs');
  if (!fs.existsSync(expanderPath)) {
    try {
      const { execFileSync } = require('child_process');
      const sourcePath = path.join(app.getAppPath(), 'src', 'native', 'snippet-expander.swift');
      execFileSync('swiftc', ['-O', '-o', expanderPath, sourcePath, '-framework', 'AppKit']);
    } catch (error) {
      console.warn('[SnippetExpander] Native helper not found and compile failed:', error);
      return;
    }
  }

  const { spawn } = require('child_process');
  try {
    snippetExpanderProcess = spawn(expanderPath, [JSON.stringify(keywords)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.warn('[SnippetExpander] Failed to spawn native helper:', error);
    return;
  }
  console.log(`[SnippetExpander] Started with ${keywords.length} keyword(s)`);

  snippetExpanderProcess.stdout.on('data', (chunk: Buffer | string) => {
    snippetExpanderStdoutBuffer += chunk.toString();
    const lines = snippetExpanderStdoutBuffer.split('\n');
    snippetExpanderStdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed) as { keyword?: string; delimiter?: string };
        if (payload.keyword) {
          void expandSnippetKeywordInPlace(payload.keyword, payload.delimiter || '');
        }
      } catch {
        // ignore malformed helper lines
      }
    }
  });

  snippetExpanderProcess.stderr.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString().trim();
    if (text) console.warn('[SnippetExpander]', text);
  });

  snippetExpanderProcess.on('exit', () => {
    snippetExpanderProcess = null;
    snippetExpanderStdoutBuffer = '';
  });
}

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow();
    mainWindow?.once('ready-to-show', () => {
      void openLauncherFromUserEntry();
    });
    return;
  }

  if (isVisible && launcherMode === 'whisper') {
    void openLauncherFromUserEntry();
    return;
  }

  if (isVisible) {
    hideWindow();
  } else {
    void openLauncherFromUserEntry();
  }
}

async function openLauncherFromUserEntry(): Promise<void> {
  const settings = loadSettings();
  if (!settings.hasSeenOnboarding) {
    // Fresh install — show onboarding. Keep dock visible so the user can see
    // the app is running and can click the dock icon to get back if needed.
    await openLauncherAndRunSystemCommand('system-open-onboarding', {
      showWindow: true,
      mode: 'onboarding',
    });
    return;
  }

  // Returning user — hide dock for overlay-only behaviour, then show window.
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
  setLauncherMode('default');
  await showWindow();
}

async function openLauncherAndRunSystemCommand(
  commandId: string,
  options?: {
    showWindow?: boolean;
    mode?: LauncherMode;
    preserveFocusWhenHidden?: boolean;
  }
): Promise<boolean> {
  if (!mainWindow) {
    createWindow();
  }
  if (!mainWindow) return false;

  const showLauncher = options?.showWindow !== false;
  const preserveFocusWhenHidden = options?.preserveFocusWhenHidden ?? !showLauncher;

  if (preserveFocusWhenHidden) {
    captureFrontmostAppContext();
  }
  setLauncherMode(options?.mode || 'default');

  const sendCommand = async () => {
    if (showLauncher) {
      await showWindow();
    }
    mainWindow?.webContents.send('run-system-command', commandId);
    if (preserveFocusWhenHidden && !showLauncher) {
      // Detached overlays can temporarily activate SuperCmd; restore the editor app.
      [50, 180, 360].forEach((delayMs) => {
        setTimeout(() => {
          if (isVisible) return;
          void activateLastFrontmostApp();
        }, delayMs);
      });
    }
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', () => {
      void sendCommand();
    });
  } else {
    await sendCommand();
  }

  return true;
}

async function runCommandById(commandId: string, source: 'launcher' | 'hotkey' = 'launcher'): Promise<boolean> {
  const isWhisperOpenCommand =
    commandId === 'system-supercommand-whisper' ||
    commandId === 'system-supercommand-whisper-toggle';
  const isWhisperSpeakToggleCommand = commandId === 'system-supercommand-whisper-speak-toggle';
  const isWhisperCommand = isWhisperOpenCommand || isWhisperSpeakToggleCommand;
  const isSpeakCommand = commandId === 'system-supercommand-speak';
  const isCursorPromptCommand = commandId === 'system-cursor-prompt';

  if (isWhisperOpenCommand && source === 'hotkey') {
    const now = Date.now();
    if (now - lastWhisperToggleAt < 450) {
      return true;
    }
    lastWhisperToggleAt = now;
  }

  if (isWhisperCommand) {
    const settings = loadSettings();
    if (!settings.hasSeenWhisperOnboarding) {
      whisperHoldRequestSeq += 1;
      stopWhisperHoldWatcher();
      return await openLauncherAndRunSystemCommand('system-whisper-onboarding', {
        showWindow: true,
        mode: 'default',
      });
    }
  }

  if (isWhisperSpeakToggleCommand) {
    const speakToggleHotkey = String(loadSettings().commandHotkeys?.['system-supercommand-whisper-speak-toggle'] || 'Command+.');
    const holdSeq = ++whisperHoldRequestSeq;
    if (whisperOverlayVisible) {
      // Reposition whisper window to the current cursor's screen
      if (whisperChildWindow && !whisperChildWindow.isDestroyed()) {
        const bounds = whisperChildWindow.getBounds();
        const pos = computeDetachedPopupPosition(DETACHED_WHISPER_WINDOW_NAME, bounds.width, bounds.height);
        whisperChildWindow.setPosition(pos.x, pos.y);
      }
      startWhisperHoldWatcher(speakToggleHotkey, holdSeq);
      mainWindow?.webContents.send('whisper-start-listening');
      return true;
    }
    startWhisperHoldWatcher(speakToggleHotkey, holdSeq);
    await openLauncherAndRunSystemCommand('system-supercommand-whisper', {
      showWindow: false,
      mode: 'default',
    });
    lastWhisperShownAt = Date.now();
    // Opening detached whisper can race with renderer listener binding;
    // send explicit "start listening" with short retries.
    const startDelays = [180, 340, 520];
    startDelays.forEach((delay) => {
      setTimeout(() => {
        if (holdSeq !== whisperHoldRequestSeq) return;
        if (whisperHoldReleasedSeq >= holdSeq) return;
        mainWindow?.webContents.send('whisper-start-listening');
      }, delay);
    });
    return true;
  }

  if (isSpeakCommand) {
    if (activeSpeakSession || speakOverlayVisible) {
      stopSpeakSession({ resetStatus: true, cleanupWindow: true });
      return true;
    }
    const started = await startSpeakFromSelection();
    if (!started) return false;
    await openLauncherAndRunSystemCommand('system-supercommand-speak', {
      showWindow: false,
      mode: 'default',
    });
    return started;
  }

  if (
    isWhisperOpenCommand &&
    source === 'hotkey' &&
    whisperOverlayVisible
  ) {
    const now = Date.now();
    if (now - lastWhisperShownAt < 650) {
      return true;
    }
    mainWindow?.webContents.send('whisper-stop-and-close');
    whisperHoldRequestSeq += 1;
    stopWhisperHoldWatcher();
    return true;
  }
  if (isCursorPromptCommand) {
    lastCursorPromptSelection = '';
    captureFrontmostAppContext();
    // Capture caret position NOW, before async work shifts focus
    const earlyCaretRect = getTypingCaretRect();
    const earlyInputRect = earlyCaretRect ? null : getFocusedInputRect();
    try {
      const selectedBeforeOpen = String(await getSelectedTextForSpeak() || '').trim();
      if (selectedBeforeOpen) {
        lastCursorPromptSelection = selectedBeforeOpen;
      }
    } catch {}
    if (source === 'hotkey' && isVisible && launcherMode === 'prompt') {
      hideWindow();
      return true;
    }
    if (isVisible) hideWindow();
    if (promptWindow && promptWindow.isVisible()) {
      hidePromptWindow();
      return true;
    }
    showPromptWindow(earlyCaretRect, earlyInputRect);
    return true;
  }
  if (commandId === 'system-add-to-memory') {
    const selectedTextRaw = String(await getSelectedTextForSpeak() || getRecentSelectionSnapshot() || '');
    const selectedText = selectedTextRaw.trim();
    if (!selectedText) return false;
    rememberSelectionSnapshot(selectedTextRaw);
    const result = await addMemory(loadSettings(), {
      text: selectedText,
      source: source === 'hotkey' ? 'hotkey' : 'launcher',
    });
    if (!result.success) {
      console.warn('[Mem0] add memory failed:', result.error || 'Unknown error');
      return false;
    }
    if (source === 'launcher') {
      setTimeout(() => hideWindow(), 50);
    }
    return true;
  }

  if (commandId === 'system-open-settings') {
    openSettingsWindow();
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (commandId === 'system-open-ai-settings') {
    openSettingsWindow({ tab: 'ai' });
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (commandId === 'system-open-extensions-settings') {
    openSettingsWindow({ tab: 'extensions' });
    if (source === 'launcher') hideWindow();
    return true;
  }
  if (
    commandId === 'system-clipboard-manager' ||
    commandId === 'system-search-snippets' ||
    commandId === 'system-create-snippet' ||
    commandId === 'system-search-files' ||
    commandId === 'system-whisper-onboarding'
  ) {
    return await openLauncherAndRunSystemCommand(commandId, {
      showWindow: true,
      mode: 'default',
    });
  }
  if (commandId === 'system-open-onboarding') {
    return await openLauncherAndRunSystemCommand(commandId, {
      showWindow: true,
      mode: 'onboarding',
    });
  }
  if (isWhisperOpenCommand) {
    lastWhisperShownAt = Date.now();
    whisperHoldRequestSeq += 1;
    stopWhisperHoldWatcher();
    return await openLauncherAndRunSystemCommand('system-supercommand-whisper', {
      showWindow: source === 'launcher',
      mode: 'default',
    });
  }
  if (commandId === 'system-import-snippets') {
    await importSnippetsFromFile(mainWindow || undefined);
    return true;
  }
  if (commandId === 'system-export-snippets') {
    await exportSnippetsToFile(mainWindow || undefined);
    return true;
  }
  if (commandId === 'system-create-script-command') {
    try {
      const created = createScriptCommandTemplate();
      invalidateScriptCommandsCache();
      invalidateCache();
      try {
        await shell.openPath(created.scriptPath);
      } catch {}
      console.log(`[ScriptCommand] Created: ${path.basename(created.scriptPath)}`);
      if (source === 'launcher') {
        setTimeout(() => hideWindow(), 50);
      }
      return true;
    } catch (error: any) {
      console.error('Failed to create script command:', error);
      console.error('[ScriptCommand] Failed to create script command.');
      return false;
    }
  }
  if (commandId === 'system-open-script-commands') {
    try {
      const dir = getSuperCmdScriptCommandsDirectory();
      await shell.openPath(dir);
      if (source === 'launcher') {
        setTimeout(() => hideWindow(), 50);
      }
      return true;
    } catch (error: any) {
      console.error('Failed to open script command directory:', error);
      console.error('[ScriptCommand] Failed to open script commands folder.');
      return false;
    }
  }

  const success = await executeCommand(commandId);
  if (success && source === 'launcher') {
    setTimeout(() => hideWindow(), 50);
  }
  return success;
}

async function startSpeakFromSelection(): Promise<boolean> {
  stopSpeakSession({ resetStatus: true });
  setSpeakStatus({ state: 'loading', text: '', index: 0, total: 0, message: 'Getting selected text...' });

  const selectedText = await getSelectedTextForSpeak();
  const chunks = splitTextIntoSpeakChunks(selectedText);
  if (chunks.length === 0) {
    setSpeakStatus({
      state: 'error',
      text: '',
      index: 0,
      total: 0,
      message: 'No selected text found.',
    });
    return false;
  }

  const settings = loadSettings();
  const selectedTtsModel = String(settings.ai?.textToSpeechModel || 'edge-tts');
  const usingElevenLabsTts = selectedTtsModel.startsWith('elevenlabs-');
  const elevenLabsApiKey = getElevenLabsApiKey(settings);
  if (usingElevenLabsTts && !elevenLabsApiKey) {
    setSpeakStatus({
      state: 'error',
      text: '',
      index: 0,
      total: chunks.length,
      message: 'ElevenLabs API key not configured. Set it in Settings -> AI (or ELEVENLABS_API_KEY env var).',
    });
    return false;
  }
  const elevenLabsTts = usingElevenLabsTts ? resolveElevenLabsTtsConfig(selectedTtsModel) : null;
  const configuredEdgeVoice = String(settings.ai?.edgeTtsVoice || '').trim();
  if (!usingElevenLabsTts && configuredEdgeVoice) {
    speakRuntimeOptions.voice = configuredEdgeVoice;
  }

  const runtime = usingElevenLabsTts ? null : resolveEdgeTtsRuntime();
  if (!usingElevenLabsTts) {
    if (!runtime) {
      setSpeakStatus({
        state: 'error',
        text: '',
        index: 0,
        total: chunks.length,
        message: 'Node edge-tts is not installed. Run: npm i node-edge-tts',
      });
      return false;
    }
  }

  const fs = require('fs');
  const os = require('os');
  const pathMod = require('path');
  const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'supercommand-speak-'));
  const sessionId = ++speakSessionCounter;
  const session = {
    id: sessionId,
    stopRequested: false,
    playbackGeneration: 0,
    currentIndex: 0,
    chunks,
    tmpDir,
    chunkPromises: new Map<number, Promise<SpeakChunkPrepared>>(),
    afplayProc: null as any,
    ttsProcesses: new Set<any>(),
    restartFrom: (_index: number) => {},
  };
  activeSpeakSession = session;

  const configuredVoice = String(speakRuntimeOptions.voice || '');
  const voiceLangMatch = /^([a-z]{2}-[A-Z]{2})-/.exec(configuredVoice);
  const fallbackLanguage = String(settings.ai?.speechLanguage || 'en-US');
  const lang = voiceLangMatch?.[1] || (fallbackLanguage.includes('-') ? fallbackLanguage : `${fallbackLanguage}-US`);
  if (!usingElevenLabsTts && !speakRuntimeOptions.voice) {
    speakRuntimeOptions.voice = resolveEdgeVoice(settings.ai?.speechLanguage || 'en-US');
  }

  const ensureChunkPrepared = (index: number): Promise<SpeakChunkPrepared> => {
    if (index < 0 || index >= chunks.length) {
      return Promise.reject(new Error('Chunk index out of range'));
    }
    const existing = session.chunkPromises.get(index);
    if (existing) return existing;

    const promise = new Promise<SpeakChunkPrepared>((resolve, reject) => {
      if (session.stopRequested) {
        reject(new Error('Speak session stopped'));
        return;
      }
      const audioPath = pathMod.join(tmpDir, `chunk-${index}.mp3`);
      const synthesizeChunkWithRetry = async (): Promise<void> => {
        const { spawn } = require('child_process');
        const maxAttempts = 3;
        let lastErr: Error | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (session.stopRequested) {
            throw new Error('Speak session stopped');
          }

          const attemptError = await new Promise<Error | null>((attemptResolve) => {
            if (usingElevenLabsTts) {
              if (!elevenLabsTts || !elevenLabsApiKey) {
                attemptResolve(new Error('ElevenLabs TTS configuration is missing.'));
                return;
              }
              synthesizeElevenLabsToFile({
                text: session.chunks[index],
                audioPath,
                apiKey: elevenLabsApiKey,
                modelId: elevenLabsTts.modelId,
                voiceId: elevenLabsTts.voiceId,
                timeoutMs: 45000,
              }).then(() => attemptResolve(null)).catch((err: any) => {
                const message = String(err?.message || err || 'ElevenLabs TTS failed');
                attemptResolve(new Error(message));
              });
              return;
            }

            if (!runtime) {
              attemptResolve(new Error('Edge TTS runtime is unavailable.'));
              return;
            }
            const args = [
              ...runtime.baseArgs,
              '-t', session.chunks[index],
              '-f', audioPath,
              '-v', speakRuntimeOptions.voice,
              '-l', lang,
              '-r', speakRuntimeOptions.rate,
              '--saveSubtitles',
              '--timeout', '45000',
            ];
            const proc = spawn(runtime.command, args, {
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            session.ttsProcesses.add(proc);

            let stderr = '';
            proc.stderr.on('data', (chunk: Buffer | string) => {
              stderr += String(chunk || '');
            });
            proc.on('error', (err: Error) => {
              session.ttsProcesses.delete(proc);
              attemptResolve(err);
            });
            proc.on('close', (code: number | null) => {
              session.ttsProcesses.delete(proc);
              if (session.stopRequested) {
                attemptResolve(new Error('Speak session stopped'));
                return;
              }
              if (code !== 0) {
                const text = stderr.trim() || `node-edge-tts exited with ${code}`;
                attemptResolve(new Error(text));
                return;
              }
              attemptResolve(null);
            });
          });

          if (!attemptError) return;
          lastErr = attemptError;

          const isTimeout = /timed out|timeout/i.test(String(attemptError.message || ''));
          const canRetry = attempt < maxAttempts;
          if (!canRetry || !isTimeout) {
            break;
          }

          const waitMs = 450 * attempt;
          await new Promise((r) => setTimeout(r, waitMs));
        }

        throw lastErr || new Error('node-edge-tts failed');
      };

      synthesizeChunkWithRetry().then(() => {
        let wordCues: Array<{ start: number; end: number; wordIndex: number }> = [];
        try {
          const subtitleCandidates = [
            audioPath.replace(/\.mp3$/i, '.json'),
            `${audioPath}.json`,
            audioPath.replace(/\.[a-z0-9]+$/i, '.json'),
          ];
          for (const subtitlePath of subtitleCandidates) {
            if (!fs.existsSync(subtitlePath)) continue;
            const raw = fs.readFileSync(subtitlePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) continue;
            let wordIndex = 0;
            for (const entry of parsed) {
              const part = String(entry?.part || '').trim();
              const start = parseCueTimeMs(entry?.start);
              const endRaw = parseCueTimeMs(entry?.end);
              const end = Math.max(start + 1, endRaw);
              const words = part.split(/\s+/g).filter(Boolean);
              if (words.length === 0) continue;
              const span = Math.max(1, end - start);
              const step = span / words.length;
              for (let i = 0; i < words.length; i += 1) {
                wordCues.push({
                  start: Math.max(0, Math.round(start + i * step)),
                  end: Math.max(1, Math.round(start + (i + 1) * step)),
                  wordIndex,
                });
                wordIndex += 1;
              }
            }
            if (wordCues.length > 0) break;
          }
        } catch {}
        resolve({ index, text: session.chunks[index], audioPath, wordCues });
      }).catch((err: any) => {
        const message = String(err?.message || err || 'node-edge-tts failed');
        if (/timed out|timeout/i.test(message)) {
          reject(new Error('Speech request timed out. Please try again.'));
          return;
        }
        reject(err instanceof Error ? err : new Error(message));
      });
    });

    session.chunkPromises.set(index, promise);
    return promise;
  };

  const playAudioFile = (prepared: SpeakChunkPrepared): Promise<void> =>
    new Promise((resolve, reject) => {
      if (session.stopRequested) {
        resolve();
        return;
      }
      const { spawn } = require('child_process');
      const proc = spawn('/usr/bin/afplay', [prepared.audioPath], { stdio: ['ignore', 'ignore', 'pipe'] });
      session.afplayProc = proc;
      let stderr = '';
      const startedAt = Date.now();
      let lastWordIndex = -1;
      const wordsInText = prepared.text.split(/\s+/g).filter(Boolean).length;
      const fallbackMsPerWord = 165;
      const cueTimer = setInterval(() => {
        if (session.stopRequested || activeSpeakSession?.id !== sessionId) return;
        const elapsed = Date.now() - startedAt;
        let nextWordIndex = -1;
        if (prepared.wordCues.length > 0) {
          for (const cue of prepared.wordCues) {
            if (elapsed >= cue.start && elapsed <= cue.end) {
              nextWordIndex = cue.wordIndex;
              break;
            }
            if (elapsed > cue.end) {
              nextWordIndex = cue.wordIndex;
            }
          }
        } else if (wordsInText > 0) {
          nextWordIndex = Math.min(wordsInText - 1, Math.floor(elapsed / fallbackMsPerWord));
        }
        if (nextWordIndex !== lastWordIndex && nextWordIndex >= 0) {
          lastWordIndex = nextWordIndex;
          setSpeakStatus({
            state: 'speaking',
            text: prepared.text,
            index: prepared.index + 1,
            total: session.chunks.length,
            message: '',
            wordIndex: nextWordIndex,
          });
        }
      }, 70);
      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk || '');
      });
      proc.on('error', (err: Error) => {
        clearInterval(cueTimer);
        if (session.afplayProc === proc) session.afplayProc = null;
        reject(err);
      });
      proc.on('close', (code: number | null) => {
        clearInterval(cueTimer);
        if (session.afplayProc === proc) session.afplayProc = null;
        if (session.stopRequested) {
          resolve();
          return;
        }
        if (code && code !== 0) {
          reject(new Error(stderr.trim() || `afplay exited with ${code}`));
          return;
        }
        resolve();
      });
    });

  setSpeakStatus({ state: 'loading', text: '', index: 0, total: session.chunks.length, message: 'Preparing speech...' });

  const runPlayback = (startIndex: number) => {
    const generation = ++session.playbackGeneration;
    const safeStart = Math.max(0, Math.min(startIndex, session.chunks.length - 1));
    session.currentIndex = safeStart;
    session.chunkPromises.clear();
    if (session.afplayProc) {
      try { session.afplayProc.kill('SIGTERM'); } catch {}
      session.afplayProc = null;
    }
    for (const proc of session.ttsProcesses) {
      try { proc.kill('SIGTERM'); } catch {}
    }
    session.ttsProcesses.clear();
    setSpeakStatus({
      state: 'loading',
      text: '',
      index: safeStart + 1,
      total: session.chunks.length,
      message: 'Preparing speech...',
      wordIndex: undefined,
    });

    // Prime first and second chunks for lower startup latency.
    void ensureChunkPrepared(safeStart).catch(() => {});
    if (safeStart + 1 < session.chunks.length) {
      void ensureChunkPrepared(safeStart + 1).catch(() => {});
    }

    (async () => {
    try {
      for (let index = safeStart; index < session.chunks.length; index += 1) {
        if (
          generation !== session.playbackGeneration ||
          session.stopRequested ||
          activeSpeakSession?.id !== sessionId
        ) return;
        session.currentIndex = index;
        const prepared = await ensureChunkPrepared(index);
        if (
          generation !== session.playbackGeneration ||
          session.stopRequested ||
          activeSpeakSession?.id !== sessionId
        ) return;

        const nextIndex = index + 1;
        if (nextIndex < session.chunks.length) {
          // Prefetch the next chunk while current chunk is being played.
          void ensureChunkPrepared(nextIndex).catch(() => {});
        }

        setSpeakStatus({
          state: 'speaking',
          text: prepared.text,
          index: index + 1,
          total: session.chunks.length,
          message: '',
          wordIndex: 0,
        });
        await playAudioFile(prepared);
      }

      if (activeSpeakSession?.id !== sessionId) return;
      setSpeakStatus({
        state: 'done',
        text: '',
        index: session.chunks.length,
        total: session.chunks.length,
        message: 'Done',
      });
      setTimeout(() => {
        if (activeSpeakSession?.id === sessionId) {
          stopSpeakSession({ resetStatus: true, cleanupWindow: true });
        }
      }, 520);
    } catch (error: any) {
      if (
        generation !== session.playbackGeneration ||
        session.stopRequested ||
        activeSpeakSession?.id !== sessionId
      ) return;
      setSpeakStatus({
        state: 'error',
        text: '',
        index: 0,
        total: session.chunks.length,
        message: error?.message || 'Speech playback failed.',
      });
    }
    })();
  };

  session.restartFrom = (index: number) => {
    if (session.stopRequested || activeSpeakSession?.id !== sessionId) return;
    runPlayback(index);
  };

  runPlayback(0);

  return true;
}

function normalizeTranscriptText(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .trim();
}

function extractRefinedTranscriptOnly(raw: string): string {
  let cleaned = String(raw || '').trim();
  if (!cleaned) return '';

  // Remove markdown fences if the model wraps the answer.
  cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/g, '').replace(/```$/g, '').trim();

  // Strip common prefixes the model may add despite instructions.
  cleaned = cleaned.replace(/^(?:final(?:\s+answer)?|output|corrected(?:\s+sentence)?|rewritten)\s*:\s*/i, '').trim();
  cleaned = cleaned.replace(/^[-*]\s+/g, '').trim();

  // Keep only the first non-empty line if the model returns extras.
  const firstLine = cleaned
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  cleaned = firstLine || cleaned;

  // If wrapped in quotes, unwrap once.
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '').trim();

  return normalizeTranscriptText(cleaned);
}

function applyWhisperHeuristicCorrection(input: string): string {
  const normalized = normalizeTranscriptText(input);
  if (!normalized) return '';

  const correctionPattern = /\b(?:no|i mean|actually|sorry|correction|rather|make that)\b\s+(.+)$/i;
  const match = correctionPattern.exec(normalized);
  if (!match || typeof match.index !== 'number') return normalized;

  const correction = normalizeTranscriptText(match[1]);
  if (!correction) return normalized;

  const before = normalizeTranscriptText(
    normalized
      .slice(0, match.index)
      .replace(/[,:;\-]+$/g, '')
  );
  if (!before) return correction;

  const prepMatch = /\b(for|at|on|in|to|from|with)\s+([^\s]+(?:\s+[^\s]+)?)$/i.exec(before);
  if (prepMatch && typeof prepMatch.index === 'number') {
    const preposition = prepMatch[1];
    const stem = normalizeTranscriptText(before.slice(0, prepMatch.index));
    const correctionHasPrep = new RegExp(`^${preposition}\\b`, 'i').test(correction);
    return normalizeTranscriptText(`${stem} ${correctionHasPrep ? correction : `${preposition} ${correction}`}`);
  }

  const beforeWords = before.split(/\s+/);
  const correctionWords = correction.split(/\s+/);
  const dropCount = Math.min(4, Math.max(1, correctionWords.length));
  const prefix = beforeWords.slice(0, Math.max(0, beforeWords.length - dropCount)).join(' ');
  return normalizeTranscriptText(`${prefix} ${correction}`) || normalized;
}

async function refineWhisperTranscript(input: string): Promise<{ correctedText: string; source: 'ai' | 'heuristic' | 'raw' }> {
  const normalized = normalizeTranscriptText(input);
  if (!normalized) {
    return { correctedText: '', source: 'raw' };
  }

  const settings = loadSettings();
  if (settings.ai.speechCorrectionEnabled && isAIAvailable(settings.ai)) {
    try {
      let corrected = '';
      const systemPrompt = [
        'You are a transcript post-processor for dictated user text.',
        'Your job is to rewrite noisy speech-to-text into one clean final sentence while preserving the user intent.',
        'Rules:',
        '1) Preserve original meaning and tense; do not add new facts.',
        '2) Apply explicit self-corrections in the utterance. Example: "3am no 5am" => "5am".',
        '3) Remove filler/disfluencies: uh, um, uhh, er, like (when filler), you know, i mean (if filler), repeated stutters.',
        '4) Resolve immediate restarts/repetitions and keep the latest valid phrase.',
        '5) Keep wording natural and concise; fix basic grammar/punctuation only when needed for readability.',
        '6) Keep first-person voice if present.',
        '7) Output exactly one cleaned sentence only.',
        '8) Output plain text only. No quotes, no markdown, no labels, no explanations.',
      ].join(' ');
      const prompt = [
        'Raw transcript:',
        normalized,
        '',
        'Return exactly one cleaned sentence.',
      ].join('\n');
      const gen = streamAI(settings.ai, {
        prompt,
        model: settings.ai.speechCorrectionModel || undefined,
        creativity: 0,
        systemPrompt,
      });
      for await (const chunk of gen) {
        corrected += chunk;
      }
      const cleaned = extractRefinedTranscriptOnly(corrected);
      if (cleaned) {
        return { correctedText: cleaned, source: 'ai' };
      }
    } catch (error) {
      console.warn('[Whisper] AI transcript correction failed:', error);
      const message = String((error as any)?.message || '').toLowerCase();
      if (message.includes('econnrefused') || message.includes('connection refused')) {
        return { correctedText: normalized, source: 'raw' };
      }
    }
  }

  const heuristicallyCorrected = applyWhisperHeuristicCorrection(normalized);
  if (heuristicallyCorrected) {
    return { correctedText: heuristicallyCorrected, source: 'heuristic' };
  }

  return { correctedText: normalized, source: 'raw' };
}

// ─── Settings Window ────────────────────────────────────────────────

type SettingsTabId = 'general' | 'ai' | 'extensions';
type SettingsPanelTarget = {
  extensionName?: string;
  commandName?: string;
};
type SettingsNavigationPayload = {
  tab: SettingsTabId;
  target?: SettingsPanelTarget;
};

function normalizeSettingsTabId(input: any): SettingsTabId | undefined {
  if (input === 'general' || input === 'ai' || input === 'extensions') return input;
  return undefined;
}

function normalizeSettingsTarget(input: any): SettingsPanelTarget | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const extensionName = typeof input.extensionName === 'string' ? input.extensionName.trim() : '';
  const commandName = typeof input.commandName === 'string' ? input.commandName.trim() : '';
  if (!extensionName && !commandName) return undefined;
  return {
    ...(extensionName ? { extensionName } : {}),
    ...(commandName ? { commandName } : {}),
  };
}

function resolveSettingsNavigationPayload(
  input: any,
  maybeTarget?: any
): SettingsNavigationPayload | undefined {
  if (typeof input === 'string') {
    const tab = normalizeSettingsTabId(input);
    if (!tab) return undefined;
    return {
      tab,
      target: normalizeSettingsTarget(maybeTarget),
    };
  }
  if (input && typeof input === 'object') {
    const tab = normalizeSettingsTabId(input.tab);
    if (!tab) return undefined;
    return {
      tab,
      target: normalizeSettingsTarget(input.target),
    };
  }
  return undefined;
}

function buildSettingsHash(payload?: SettingsNavigationPayload): string {
  if (!payload) return '/settings';
  const params = new URLSearchParams();
  params.set('tab', payload.tab);
  if (payload.target?.extensionName) {
    params.set('extension', payload.target.extensionName);
  }
  if (payload.target?.commandName) {
    params.set('command', payload.target.commandName);
  }
  const query = params.toString();
  return query ? `/settings?${query}` : '/settings';
}

function openSettingsWindow(payload?: SettingsNavigationPayload): void {
  if (settingsWindow) {
    if (payload) {
      settingsWindow.webContents.send('settings-tab-changed', payload);
    }
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  if (process.platform === 'darwin') {
    app.dock.show();
  }

  const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = (() => {
    if (mainWindow) {
      const b = mainWindow.getBounds();
      const center = {
        x: b.x + Math.floor(b.width / 2),
        y: b.y + Math.floor(b.height / 2),
      };
      return screen.getDisplayNearestPoint(center).workArea;
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  })();
  const settingsWidth = Math.max(1180, Math.min(1460, displayWidth - 64));
  const settingsHeight = Math.max(760, Math.min(920, displayHeight - 64));
  const settingsX = displayX + Math.floor((displayWidth - settingsWidth) / 2);
  const settingsY = displayY + Math.floor((displayHeight - settingsHeight) / 2);

  settingsWindow = new BrowserWindow({
    width: settingsWidth,
    height: settingsHeight,
    x: settingsX,
    y: settingsY,
    minWidth: 1180,
    minHeight: 760,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'hud',
    visualEffectState: 'active',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const hash = buildSettingsHash(payload);
  loadWindowUrl(settingsWindow, hash);

  settingsWindow.once('ready-to-show', () => {
    if (payload) {
      settingsWindow?.webContents.send('settings-tab-changed', payload);
    }
    settingsWindow?.show();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // Hide dock again when no settings/store windows are open
    if (process.platform === 'darwin' && !extensionStoreWindow) {
      app.dock.hide();
    }
  });
}

function openExtensionStoreWindow(): void {
  if (extensionStoreWindow) {
    extensionStoreWindow.show();
    extensionStoreWindow.focus();
    return;
  }

  if (process.platform === 'darwin') {
    app.dock.show();
  }

  const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = (() => {
    if (mainWindow) {
      const b = mainWindow.getBounds();
      const center = {
        x: b.x + Math.floor(b.width / 2),
        y: b.y + Math.floor(b.height / 2),
      };
      return screen.getDisplayNearestPoint(center).workArea;
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  })();
  const storeWidth = 980;
  const storeHeight = 700;
  const storeX = displayX + Math.floor((displayWidth - storeWidth) / 2);
  const storeY = displayY + Math.floor((displayHeight - storeHeight) / 2);

  extensionStoreWindow = new BrowserWindow({
    width: storeWidth,
    height: storeHeight,
    x: storeX,
    y: storeY,
    minWidth: 860,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'hud',
    visualEffectState: 'active',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  loadWindowUrl(extensionStoreWindow, '/extension-store');

  extensionStoreWindow.once('ready-to-show', () => {
    extensionStoreWindow?.show();
  });

  extensionStoreWindow.on('closed', () => {
    extensionStoreWindow = null;
    if (process.platform === 'darwin' && !settingsWindow) {
      app.dock.hide();
    }
  });
}

// ─── Shortcut Management ────────────────────────────────────────────

function applyOpenAtLogin(enabled: boolean): boolean {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true,
    });
    return true;
  } catch (error) {
    console.warn('[LoginItems] Failed to update open-at-login:', error);
    return false;
  }
}

function disableMacSpotlightShortcuts(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const { execFileSync } = require('child_process');
    execFileSync('/usr/bin/defaults', [
      'write',
      'com.apple.symbolichotkeys',
      'AppleSymbolicHotKeys',
      '-dict-add',
      '64',
      '{enabled = 0;}',
    ]);
    execFileSync('/usr/bin/defaults', [
      'write',
      'com.apple.symbolichotkeys',
      'AppleSymbolicHotKeys',
      '-dict-add',
      '65',
      '{enabled = 0;}',
    ]);
    try { execFileSync('/usr/bin/killall', ['cfprefsd']); } catch {}
    try { execFileSync('/usr/bin/killall', ['SystemUIServer']); } catch {}
    return true;
  } catch (error) {
    console.warn('[Spotlight] Failed to disable Spotlight shortcuts:', error);
    return false;
  }
}

function replaceSpotlightWithSuperCmdShortcut(): boolean {
  const disabled = disableMacSpotlightShortcuts();
  const targetShortcut = 'Command+Space';
  const registered = registerGlobalShortcut(targetShortcut);
  if (!registered) return false;
  saveSettings({ globalShortcut: targetShortcut });
  if (!disabled && process.platform === 'darwin') {
    console.warn('[Spotlight] Spotlight shortcut might still be enabled.');
  }
  return true;
}

function registerGlobalShortcut(shortcut: string): boolean {
  const normalizedShortcut = normalizeAccelerator(shortcut);
  globalShortcutRegistrationState.requestedShortcut = normalizedShortcut;
  // Unregister the previous global shortcut
  if (currentShortcut) {
    try {
      unregisterShortcutVariants(currentShortcut);
    } catch {}
  }

  try {
    const success = globalShortcut.register(normalizedShortcut, () => {
      toggleWindow();
    });
    if (success) {
      currentShortcut = normalizedShortcut;
      globalShortcutRegistrationState.activeShortcut = normalizedShortcut;
      globalShortcutRegistrationState.ok = true;
      console.log(`Global shortcut registered: ${normalizedShortcut}`);
      return true;
    } else {
      console.error(`Failed to register shortcut: ${normalizedShortcut}`);
      // Re-register old one
      if (currentShortcut && currentShortcut !== normalizedShortcut) {
        try {
          globalShortcut.register(currentShortcut, () => toggleWindow());
        } catch {}
      }
      globalShortcutRegistrationState.ok = false;
      return false;
    }
  } catch (e) {
    console.error(`Error registering shortcut: ${e}`);
    globalShortcutRegistrationState.ok = false;
    return false;
  }
}

function registerCommandHotkeys(hotkeys: Record<string, string>): void {
  // Unregister all existing command hotkeys
  for (const [shortcut] of registeredHotkeys) {
    try {
      unregisterShortcutVariants(shortcut);
    } catch {}
  }
  registeredHotkeys.clear();

  for (const [commandId, shortcut] of Object.entries(hotkeys)) {
    if (!shortcut) continue;
    const normalizedShortcut = normalizeAccelerator(shortcut);
    try {
      const success = globalShortcut.register(normalizedShortcut, async () => {
        await runCommandById(commandId, 'hotkey');
      });
      if (success) {
        registeredHotkeys.set(normalizedShortcut, commandId);
      }
    } catch {}
  }
}

// ─── App Initialization ─────────────────────────────────────────────

async function rebuildExtensions() {
  const installed = getInstalledExtensionNames();
  if (installed.length > 0) {
    console.log(`Checking ${installed.length} installed extensions for rebuilds...`);
    for (const name of installed) {
      // We can't easily check if it needs rebuild here without fs access logic
      // but buildAllCommands is fast enough if we just run it.
      // Or we can rely on buildAllCommands to handle caching?
      // For now, let's just trigger it. It will overwrite existing builds.
      // This ensures we always have fresh builds on startup.
      console.log(`Rebuilding extension: ${name}`);
      try {
        await buildAllCommands(name);
      } catch (e) {
        console.error(`Failed to rebuild ${name}:`, e);
      }
    }
    console.log('Extensions rebuild complete.');
    invalidateCache();
  }
}

// Register custom protocol for serving extension assets (images etc.)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'sc-asset', privileges: { bypassCSP: true, supportFetchAPI: true, stream: true } }
]);

app.whenReady().then(async () => {
  app.setAsDefaultProtocolClient('supercommand');

  // Register the sc-asset:// protocol handler to serve extension asset files
  protocol.handle('sc-asset', (request: any) => {
    // URL format: sc-asset://ext-asset/path/to/file
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    // Use net.fetch with file:// to serve the actual file
    return net.fetch(`file://${filePath}`);
  });

  // Set a minimal application menu that only keeps essential Edit commands
  // (copy/paste/undo). Without this, Electron's default menu can intercept
  // keyboard shortcuts (⌘D, ⌘T, etc.) at the native level before the
  // renderer's JavaScript keydown handlers see them.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ])
  );

  const settings = loadSettings();
  applyOpenAtLogin(Boolean((settings as any).openAtLogin));

  // Start clipboard monitor
  startClipboardMonitor();

  // Initialize snippet store
  initSnippetStore();
  try { refreshSnippetExpander(); } catch (e) {
    console.warn('[SnippetExpander] Failed to start:', e);
  }

  // Rebuild extensions in background
  rebuildExtensions().catch(console.error);

  // ─── IPC: Launcher ──────────────────────────────────────────────

  ipcMain.handle('get-commands', async () => {
    const s = loadSettings();
    const commands = await getAvailableCommands();
    const disabled = new Set(s.disabledCommands || []);
    const enabled = new Set((s as any).enabledCommands || []);
    return commands.filter((c: any) => {
      if (disabled.has(c.id)) return false;
      if (c?.disabledByDefault && !enabled.has(c.id)) return false;
      return true;
    });
  });

  ipcMain.handle(
    'execute-command',
    async (_event: any, commandId: string) => {
      return await runCommandById(commandId, 'launcher');
    }
  );

  ipcMain.handle('hide-window', () => {
    hideWindow();
  });

  ipcMain.handle('close-prompt-window', () => {
    hidePromptWindow();
  });

  ipcMain.handle('set-launcher-mode', (_event: any, mode: LauncherMode) => {
    if (mode !== 'default' && mode !== 'onboarding' && mode !== 'whisper' && mode !== 'speak' && mode !== 'prompt') return;
    setLauncherMode(mode);
  });

  ipcMain.on('set-detached-overlay-state', (_event: any, payload?: { overlay?: 'whisper' | 'speak'; visible?: boolean }) => {
    const overlay = payload?.overlay;
    const visible = Boolean(payload?.visible);
    if (overlay === 'whisper') {
      whisperOverlayVisible = visible;
      if (visible) {
        lastWhisperShownAt = Date.now();
      } else {
        whisperHoldRequestSeq += 1;
        stopWhisperHoldWatcher();
      }
      return;
    }
    if (overlay === 'speak') {
      speakOverlayVisible = visible;
    }
  });

  ipcMain.handle('get-last-frontmost-app', () => {
    return lastFrontmostApp;
  });

  ipcMain.handle('restore-last-frontmost-app', async () => {
    return await activateLastFrontmostApp();
  });

  ipcMain.handle('speak-stop', () => {
    stopSpeakSession({ resetStatus: true, cleanupWindow: true });
    return true;
  });

  ipcMain.handle('speak-get-status', () => {
    return speakStatusSnapshot;
  });

  ipcMain.handle('speak-get-options', () => {
    return { ...speakRuntimeOptions };
  });

  ipcMain.handle(
    'speak-update-options',
    (_event: any, patch: { voice?: string; rate?: string; restartCurrent?: boolean }) => {
      if (patch?.voice && typeof patch.voice === 'string') {
        speakRuntimeOptions.voice = patch.voice.trim() || speakRuntimeOptions.voice;
      }
      if (patch?.rate !== undefined) {
        speakRuntimeOptions.rate = parseSpeakRateInput(patch.rate);
      }

      if (patch?.restartCurrent && activeSpeakSession) {
        const currentIdx = Math.max(0, activeSpeakSession.currentIndex || 0);
        activeSpeakSession.restartFrom(currentIdx);
      }

      return { ...speakRuntimeOptions };
    }
  );

  ipcMain.handle(
    'speak-preview-voice',
    async (_event: any, payload?: { voice: string; text?: string; rate?: string }) => {
      const runtime = resolveEdgeTtsRuntime();
      if (!runtime) return false;

      const voice = String(payload?.voice || speakRuntimeOptions.voice || 'en-US-JennyNeural').trim();
      const rate = parseSpeakRateInput(payload?.rate ?? speakRuntimeOptions.rate);
      const sampleTextRaw = String(payload?.text || 'Hi, this is my voice in SuperCmd.');
      const sampleText = sampleTextRaw.trim().slice(0, 240) || 'Hi, this is my voice in SuperCmd.';

      const langMatch = /^([a-z]{2}-[A-Z]{2})-/.exec(voice);
      const lang = langMatch?.[1] || String(loadSettings().ai?.speechLanguage || 'en-US');

      const fs = require('fs');
      const os = require('os');
      const pathMod = require('path');
      const { spawn } = require('child_process');

      const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'supercommand-voice-preview-'));
      const audioPath = pathMod.join(tmpDir, 'preview.mp3');

      try {
        const synthesizeErr = await new Promise<Error | null>((resolve) => {
          const args = [
            ...runtime.baseArgs,
            '-t', sampleText,
            '-f', audioPath,
            '-v', voice,
            '-l', lang,
            '-r', rate,
            '--timeout', '45000',
          ];
          const proc = spawn(runtime.command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
          let stderr = '';
          proc.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk || ''); });
          proc.on('error', (err: Error) => resolve(err));
          proc.on('close', (code: number | null) => {
            if (code !== 0) {
              resolve(new Error(stderr.trim() || `node-edge-tts exited with ${code}`));
              return;
            }
            resolve(null);
          });
        });

        if (synthesizeErr) throw synthesizeErr;

        const playErr = await new Promise<Error | null>((resolve) => {
          const proc = spawn('/usr/bin/afplay', [audioPath], { stdio: ['ignore', 'ignore', 'pipe'] });
          let stderr = '';
          proc.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk || ''); });
          proc.on('error', (err: Error) => resolve(err));
          proc.on('close', (code: number | null) => {
            if (code && code !== 0) {
              resolve(new Error(stderr.trim() || `afplay exited with ${code}`));
              return;
            }
            resolve(null);
          });
        });

        if (playErr) throw playErr;
        return true;
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
  );

  ipcMain.handle('edge-tts-list-voices', async () => {
    const now = Date.now();
    if (edgeVoiceCatalogCache && edgeVoiceCatalogCache.expiresAt > now) {
      return edgeVoiceCatalogCache.voices;
    }

    try {
      const voices = await fetchEdgeTtsVoiceCatalog(12000);
      if (voices.length > 0) {
        edgeVoiceCatalogCache = {
          voices,
          expiresAt: now + (1000 * 60 * 60 * 12),
        };
      }
      return voices;
    } catch (error) {
      if (edgeVoiceCatalogCache?.voices?.length) {
        return edgeVoiceCatalogCache.voices;
      }
      console.warn('[Speak] Failed to fetch Edge voice catalog:', error);
      return [];
    }
  });

  // ─── IPC: Settings ──────────────────────────────────────────────

  ipcMain.handle('get-settings', () => {
    return loadSettings();
  });

  ipcMain.handle('get-global-shortcut-status', () => {
    return { ...globalShortcutRegistrationState };
  });

  ipcMain.handle(
    'save-settings',
    (_event: any, patch: Partial<AppSettings>) => {
      const result = saveSettings(patch);
      if (patch.openAtLogin !== undefined) {
        applyOpenAtLogin(Boolean(patch.openAtLogin));
      }
      // When onboarding completes, hide the dock so the app becomes an overlay.
      if (patch.hasSeenOnboarding === true && process.platform === 'darwin') {
        app.dock.hide();
      }
      return result;
    }
  );

  ipcMain.handle('get-all-commands', async () => {
    // Return ALL commands (ignoring disabled filter) for the settings page
    return await getAvailableCommands();
  });

  ipcMain.handle(
    'update-global-shortcut',
    (_event: any, newShortcut: string) => {
      const success = registerGlobalShortcut(newShortcut);
      if (success) {
        saveSettings({ globalShortcut: newShortcut });
      }
      return success;
    }
  );

  ipcMain.handle('set-open-at-login', (_event: any, enabled: boolean) => {
    const applied = applyOpenAtLogin(Boolean(enabled));
    if (applied) {
      saveSettings({ openAtLogin: Boolean(enabled) } as Partial<AppSettings>);
    }
    return applied;
  });

  ipcMain.handle('replace-spotlight-with-supercmd', () => {
    return replaceSpotlightWithSuperCmdShortcut();
  });

  ipcMain.handle(
    'update-command-hotkey',
    async (_event: any, commandId: string, hotkey: string) => {
      const s = loadSettings();
      const hotkeys = { ...s.commandHotkeys };
      const normalizedHotkey = hotkey ? normalizeAccelerator(hotkey) : '';

      // Unregister old hotkey for this command
      const oldHotkey = hotkeys[commandId];
      if (oldHotkey) {
        try {
          unregisterShortcutVariants(oldHotkey);
          registeredHotkeys.delete(normalizeAccelerator(oldHotkey));
        } catch {}
      }

      if (hotkey) {
        // Prevent two commands from sharing the same accelerator.
        for (const [otherCommandId, otherHotkey] of Object.entries(hotkeys)) {
          if (otherCommandId === commandId) continue;
          if (normalizeAccelerator(otherHotkey) === normalizedHotkey) {
            return { success: false, error: 'duplicate' as const };
          }
        }

        // Register the new one
        try {
          const success = globalShortcut.register(normalizedHotkey, async () => {
            await runCommandById(commandId, 'hotkey');
          });
          if (!success) {
            // Attempt to restore old mapping if the new one failed.
            if (oldHotkey) {
              const normalizedOldHotkey = normalizeAccelerator(oldHotkey);
              try {
                const restored = globalShortcut.register(normalizedOldHotkey, async () => {
                  await runCommandById(commandId, 'hotkey');
                });
                if (restored) {
                  registeredHotkeys.set(normalizedOldHotkey, commandId);
                }
              } catch {}
            }
            return { success: false, error: 'unavailable' as const };
          }
          hotkeys[commandId] = hotkey;
          registeredHotkeys.set(normalizedHotkey, commandId);
        } catch {
          return { success: false, error: 'unavailable' as const };
        }
      } else {
        delete hotkeys[commandId];
      }

      saveSettings({ commandHotkeys: hotkeys });
      return { success: true as const };
    }
  );

  ipcMain.handle(
    'toggle-command-enabled',
    (_event: any, commandId: string, enabled: boolean) => {
      const s = loadSettings();
      let disabled = [...s.disabledCommands];
      let explicitlyEnabled = [...(s.enabledCommands || [])];

      if (enabled) {
        disabled = disabled.filter((id) => id !== commandId);
        if (!explicitlyEnabled.includes(commandId)) {
          explicitlyEnabled.push(commandId);
        }
      } else {
        if (!disabled.includes(commandId)) {
          disabled.push(commandId);
        }
        explicitlyEnabled = explicitlyEnabled.filter((id) => id !== commandId);
      }

      saveSettings({ disabledCommands: disabled, enabledCommands: explicitlyEnabled });
      return true;
    }
  );

  ipcMain.handle('open-settings', () => {
    openSettingsWindow();
  });

  ipcMain.handle('open-settings-tab', (_event: any, payloadOrTab: any, maybeTarget?: any) => {
    const payload = resolveSettingsNavigationPayload(payloadOrTab, maybeTarget);
    if (!payload) {
      openSettingsWindow({ tab: 'general' });
      return;
    }
    openSettingsWindow(payload);
  });

  ipcMain.handle('open-extension-store-window', () => {
    openExtensionStoreWindow();
  });

  // ─── IPC: Open URL (for extensions) ─────────────────────────────

  ipcMain.handle('open-url', async (_event: any, url: string) => {
    if (!url) return false;

    if (url.startsWith('raycast://')) {
      const deepLink = parseRaycastDeepLink(url);
      if (!deepLink) {
        console.warn(`Unsupported Raycast deep link: ${url}`);
        return false;
      }

      if (deepLink.type === 'scriptCommand') {
        const script = getScriptCommandBySlug(deepLink.commandName);
        if (!script) {
          console.warn(`Script command deeplink target not found: ${deepLink.commandName}`);
          return false;
        }
        try {
          await showWindow();
          const payload = JSON.stringify({
            commandId: script.id,
            arguments: deepLink.arguments || [],
            source: 'deeplink',
          });
          await mainWindow?.webContents.executeJavaScript(
            `window.dispatchEvent(new CustomEvent('sc-run-script-command', { detail: ${payload} }));`,
            true
          );
          return true;
        } catch (e) {
          console.error(`Failed to launch script command deeplink: ${url}`, e);
          return false;
        }
      }

      try {
        const bundle = buildLaunchBundle({
          extensionName: deepLink.extensionName,
          commandName: deepLink.commandName,
          args: deepLink.arguments,
          type: deepLink.launchType || 'userInitiated',
          fallbackText: deepLink.fallbackText || null,
        });
        await showWindow();
        const payload = JSON.stringify({
          bundle,
          launchOptions: { type: bundle.launchType || 'userInitiated' },
          source: {
            commandMode: 'deeplink',
            extensionName: bundle.extensionName,
            commandName: bundle.commandName,
          },
        });
        await mainWindow?.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent('sc-launch-extension-bundle', { detail: ${payload} }));`,
          true
        );
        return true;
      } catch (e) {
        console.error(`Failed to launch Raycast deep link: ${url}`, e);
        return false;
      }
    }

    try {
      await shell.openExternal(url);
      return true;
    } catch (e) {
      console.error(`Failed to open URL: ${url}`, e);
      return false;
    }
  });

  // ─── IPC: Extension Runner ───────────────────────────────────────

  ipcMain.handle(
    'run-extension',
    (_event: any, extName: string, cmdName: string) => {
      try {
        // Just read the pre-built bundle (built at install time)
        const result = getExtensionBundle(extName, cmdName);
        if (!result) {
          return { error: `No pre-built bundle for ${extName}/${cmdName}. Try reinstalling the extension.` };
        }
        return {
          code: result.code,
          title: result.title,
          mode: result.mode,
          extName,
          cmdName,
          // Additional metadata for @raycast/api
          extensionName: result.extensionName,
          extensionDisplayName: result.extensionDisplayName,
          extensionIconDataUrl: result.extensionIconDataUrl,
          commandName: result.commandName,
          assetsPath: result.assetsPath,
          supportPath: result.supportPath,
          extensionPath: result.extensionPath,
          owner: result.owner,
          preferences: result.preferences,
          preferenceDefinitions: result.preferenceDefinitions,
          commandArgumentDefinitions: result.commandArgumentDefinitions,
        };
      } catch (e: any) {
        console.error(`run-extension error for ${extName}/${cmdName}:`, e);
        return { error: e?.message || 'Unknown error' };
      }
    }
  );

  // Run Raycast-style script command.
  ipcMain.handle(
    'run-script-command',
    async (
      _event: any,
      payload: {
        commandId: string;
        arguments?: Record<string, any>;
        background?: boolean;
      }
    ) => {
      try {
        const commandId = String(payload?.commandId || '').trim();
        if (!commandId) {
          return { success: false, error: 'commandId is required' };
        }

        const argumentValues =
          payload?.arguments && typeof payload.arguments === 'object'
            ? payload.arguments
            : {};
        const background = Boolean(payload?.background);

        const executed = await executeScriptCommand(commandId, argumentValues);
        if ('missingArguments' in executed) {
          return {
            success: false,
            needsArguments: true,
            commandId,
            argumentDefinitions: executed.command.arguments.map((arg) => ({
              name: arg.name,
              required: arg.required,
              type: arg.type,
              placeholder: arg.placeholder,
              title: arg.placeholder,
              data: arg.data,
            })),
            missingArguments: executed.missingArguments.map((arg) => arg.name),
            mode: executed.command.mode,
            title: executed.command.title,
          };
        }

        if (executed.mode === 'inline') {
          const settings = loadSettings();
          const metadata = { ...(settings.commandMetadata || {}) } as Record<string, { subtitle?: string }>;
          const subtitle =
            executed.exitCode === 0
              ? String(executed.firstLine || '').trim()
              : String(executed.lastLine || '').trim() || 'Script failed';
          if (subtitle) {
            metadata[executed.commandId] = { subtitle };
          } else {
            delete metadata[executed.commandId];
          }
          saveSettings({ commandMetadata: metadata });
          invalidateCache();
        }

        if (!background && (executed.mode === 'compact' || executed.mode === 'silent')) {
          const fallback = executed.exitCode === 0 ? 'Script finished.' : 'Script failed.';
          const message = executed.message || fallback;
          console.log(`[ScriptCommand] ${executed.title}: ${message}`);
        }

        return {
          success: executed.exitCode === 0,
          ...executed,
        };
      } catch (error: any) {
        console.error('run-script-command error:', error);
        return {
          success: false,
          error: error?.message || 'Failed to run script command',
        };
      }
    }
  );

  // Get parsed extension manifest settings schema (preferences + commands)
  ipcMain.handle('get-installed-extensions-settings-schema', () => {
    return getInstalledExtensionsSettingsSchema();
  });

  // Launch command (for @raycast/api launchCommand)
  ipcMain.handle(
    'launch-command',
    async (_event: any, options: any) => {
      try {
        const {
          name,
          type,
          extensionName,
          arguments: args,
          context,
          fallbackText,
          sourceExtensionName,
          sourcePreferences,
        } = options;

        // Determine which extension to launch
        // For intra-extension launches, we'd need to track the current extension context
        // For now, we require extensionName to be specified
        if (!extensionName) {
          throw new Error('extensionName is required for launchCommand. Intra-extension launches are not yet fully supported.');
        }

        const bundle = buildLaunchBundle({
          extensionName,
          commandName: name,
          args: args || {},
          context,
          fallbackText: fallbackText ?? null,
          sourceExtensionName,
          sourcePreferences,
          type,
        });

        return {
          success: true,
          bundle
        };
      } catch (e: any) {
        console.error('launch-command error:', e);
        throw new Error(e?.message || 'Failed to launch command');
      }
    }
  );

  // Update command metadata (for @raycast/api updateCommandMetadata)
  ipcMain.handle(
    'update-command-metadata',
    async (_event: any, commandId: string, metadata: { subtitle?: string | null }) => {
      try {
        // Store command metadata in settings
        const settings = loadSettings();
        if (!settings.commandMetadata) {
          settings.commandMetadata = {};
        }

        if (metadata.subtitle === null) {
          // Remove custom subtitle
          delete settings.commandMetadata[commandId];
        } else {
          // Update subtitle
          settings.commandMetadata[commandId] = { subtitle: metadata.subtitle };
        }

        saveSettings({ commandMetadata: settings.commandMetadata });

        // Notify all windows to refresh command list
        invalidateCache();
        return { success: true };
      } catch (e: any) {
        console.error('update-command-metadata error:', e);
        throw new Error(e?.message || 'Failed to update command metadata');
      }
    }
  );

  // ─── IPC: Extension APIs (for @raycast/api compatibility) ────────

  // HTTP request proxy (so extensions can make Node.js HTTP requests without CORS)
  ipcMain.handle(
    'http-request',
    async (
      _event: any,
      options: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }
    ) => {
      const http = require('http');
      const https = require('https');
      const { URL } = require('url');

      // Rewrite Google Translate API to googleapis.com (no TKK token needed)
      let requestUrl = options.url;
      try {
        const u = new URL(requestUrl);
        if (u.hostname === 'translate.google.com' && u.pathname.startsWith('/translate_a/')) {
          u.hostname = 'translate.googleapis.com';
          u.searchParams.delete('tk');
          requestUrl = u.toString();
        }
      } catch {}

      const doRequest = (url: string, method: string, headers: Record<string, string>, body: string | undefined, redirectsLeft: number): Promise<any> => {
        return new Promise((resolve) => {
          try {
            const parsedUrl = new URL(url);
            const transport = parsedUrl.protocol === 'https:' ? https : http;

            const reqOptions: any = {
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
              path: parsedUrl.pathname + parsedUrl.search,
              method: method,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...headers,
              },
            };

            const req = transport.request(reqOptions, (res: any) => {
              // Follow redirects (301, 302, 303, 307, 308)
              if (redirectsLeft > 0 && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume(); // drain the response
                const redirectUrl = new URL(res.headers.location, url).toString();
                const redirectMethod = (res.statusCode === 303) ? 'GET' : method;
                const redirectBody = (res.statusCode === 303) ? undefined : body;
                resolve(doRequest(redirectUrl, redirectMethod, headers, redirectBody, redirectsLeft - 1));
                return;
              }

              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                const bodyBuffer = Buffer.concat(chunks);
                const contentEncoding = String(res.headers['content-encoding'] || '').toLowerCase();
                let decodedBuffer = bodyBuffer;
                try {
                  const zlib = require('zlib');
                  if (contentEncoding.includes('br')) {
                    decodedBuffer = zlib.brotliDecompressSync(bodyBuffer);
                  } else if (contentEncoding.includes('gzip')) {
                    decodedBuffer = zlib.gunzipSync(bodyBuffer);
                  } else if (contentEncoding.includes('deflate')) {
                    decodedBuffer = zlib.inflateSync(bodyBuffer);
                  }
                } catch {
                  // If decompression fails, keep raw buffer to avoid hard-failing requests.
                  decodedBuffer = bodyBuffer;
                }
                const responseHeaders: Record<string, string> = {};
                for (const [key, val] of Object.entries(res.headers)) {
                  responseHeaders[key] = Array.isArray(val) ? val.join(', ') : String(val);
                }
                resolve({
                  status: res.statusCode,
                  statusText: res.statusMessage || '',
                  headers: responseHeaders,
                  bodyText: decodedBuffer.toString('utf-8'),
                  url: url,
                });
              });
            });

            req.on('error', (err: Error) => {
              resolve({
                status: 0,
                statusText: err.message,
                headers: {},
                bodyText: '',
                url: url,
              });
            });

            req.setTimeout(30000, () => {
              req.destroy();
              resolve({
                status: 0,
                statusText: 'Request timed out',
                headers: {},
                bodyText: '',
                url: url,
              });
            });

            if (body) {
              req.write(body);
            }
            req.end();
          } catch (e: any) {
            resolve({
              status: 0,
              statusText: e?.message || 'Request failed',
              headers: {},
              bodyText: '',
              url: url,
            });
          }
        });
      };

      return doRequest(requestUrl, (options.method || 'GET').toUpperCase(), options.headers || {}, options.body, 5);
    }
  );

  // Shell command execution
  ipcMain.handle(
    'exec-command',
    async (
      _event: any,
      command: string,
      args: string[],
      options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
    ) => {
      const { spawn, execFile } = require('child_process');
      const fs = require('fs');

      return new Promise((resolve) => {
        try {
          const resolveExecutablePath = (input: string): string => {
            if (!input || typeof input !== 'string') return input;
            if (!input.includes('/') && !input.includes('\\')) return input;
            if (!input.startsWith('/')) return input;
            if (fs.existsSync(input)) return input;
            try {
              const base = input.split('/').filter(Boolean).pop() || '';
              if (!base) return input;
              const lookup = execFileSync('/bin/zsh', ['-lc', `command -v -- ${JSON.stringify(base)} 2>/dev/null || true`], { encoding: 'utf-8' }).trim();
              if (lookup && fs.existsSync(lookup)) return lookup;
            } catch {}
            return input;
          };

          const execFileSync = require('child_process').execFileSync;
          const normalizedCommand = resolveExecutablePath(command);
          // Augment PATH so extensions can find brew, npm, nvm, etc. even when
          // the app is launched from the Dock (where macOS strips the login PATH).
          const extraPaths = [
            '/opt/homebrew/bin', '/opt/homebrew/sbin',
            '/usr/local/bin', '/usr/local/sbin',
            '/usr/bin', '/usr/sbin', '/bin', '/sbin',
          ];
          const currentPath = (options?.env?.PATH ?? process.env.PATH ?? '');
          const augmentedPath = [
            ...extraPaths,
            ...currentPath.split(':').filter(Boolean),
          ].filter((v, i, a) => a.indexOf(v) === i).join(':');
          const spawnOptions: any = {
            shell: options?.shell ?? false,
            env: { ...process.env, ...options?.env, PATH: augmentedPath },
            cwd: options?.cwd || process.cwd(),
          };

          let proc: any;
          if (options?.shell) {
            // When shell is true, join command and args
            const fullCommand = [normalizedCommand, ...args].join(' ');
            proc = spawn(fullCommand, [], { ...spawnOptions, shell: true });
          } else {
            proc = spawn(normalizedCommand, args, spawnOptions);
          }

          let stdout = '';
          let stderr = '';

          proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          if (options?.input && proc.stdin) {
            proc.stdin.write(options.input);
            proc.stdin.end();
          }

          proc.on('close', (code: number | null) => {
            resolve({ stdout, stderr, exitCode: code ?? 0 });
          });

          proc.on('error', (err: Error) => {
            resolve({ stdout, stderr: err.message, exitCode: 1 });
          });

          // Timeout after 5 minutes — allows long-running commands (brew install, npm install, etc.)
          setTimeout(() => {
            try {
              proc.kill();
            } catch {}
            resolve({ stdout, stderr: stderr || 'Command timed out', exitCode: 124 });
          }, 300000);
        } catch (e: any) {
          resolve({ stdout: '', stderr: e?.message || 'Failed to execute command', exitCode: 1 });
        }
      });
    }
  );

  // Streaming spawn — runs a process and pushes stdout/stderr chunks to the renderer in real-time.
  // This is the generic fix for any extension that uses child_process.spawn with progressive output
  // (e.g. speedtest CLI outputting JSON lines, ffmpeg progress, etc.)
  {
    const spawnedProcesses = new Map<number, any>();

    ipcMain.handle(
      'spawn-process',
      (event: any, file: string, args: string[], options?: { shell?: boolean | string; env?: Record<string, string>; cwd?: string }) => {
        const { spawn } = require('child_process');
        const fs = require('fs');

        const resolveExecutablePath = (input: string): string => {
          if (!input || typeof input !== 'string') return input;
          if (!input.startsWith('/')) return input;
          if (fs.existsSync(input)) return input;
          return input;
        };

        const extraPaths = [
          '/opt/homebrew/bin', '/opt/homebrew/sbin',
          '/usr/local/bin', '/usr/local/sbin',
          '/usr/bin', '/usr/sbin', '/bin', '/sbin',
        ];
        const currentPath = (options?.env?.PATH ?? process.env.PATH ?? '');
        const augmentedPath = [
          ...extraPaths,
          ...currentPath.split(':').filter(Boolean),
        ].filter((v, i, a) => a.indexOf(v) === i).join(':');

        const resolvedFile = resolveExecutablePath(file);
        const spawnOpts: any = {
          shell: options?.shell ?? false,
          env: { ...process.env, ...options?.env, PATH: augmentedPath },
          cwd: options?.cwd || process.cwd(),
        };

        const proc = options?.shell
          ? spawn([resolvedFile, ...(args || [])].join(' '), [], { ...spawnOpts, shell: true })
          : spawn(resolvedFile, args || [], spawnOpts);

        const pid: number = proc.pid ?? -1;
        if (pid !== -1) spawnedProcesses.set(pid, proc);

        const sender = event.sender;
        const safeSend = (channel: string, ...sendArgs: any[]) => {
          try { if (!sender.isDestroyed()) sender.send(channel, ...sendArgs); } catch {}
        };
        let finalized = false;
        let sequence = 0;
        const nextSeq = () => sequence++;
        const safeSendSpawnEvent = (payload: Record<string, any>) => {
          safeSend('spawn-event', payload);
        };
        const finalize = () => {
          if (finalized) return false;
          finalized = true;
          return true;
        };

        proc.stdout?.on('data', (data: Buffer) => {
          const bytes = new Uint8Array(data);
          const seq = nextSeq();
          safeSendSpawnEvent({ pid, seq, type: 'stdout', data: bytes });
          // Legacy channels kept for compatibility with older renderer code.
          safeSend('spawn-stdout', pid, bytes);
        });
        proc.stderr?.on('data', (data: Buffer) => {
          const bytes = new Uint8Array(data);
          const seq = nextSeq();
          safeSendSpawnEvent({ pid, seq, type: 'stderr', data: bytes });
          // Legacy channels kept for compatibility with older renderer code.
          safeSend('spawn-stderr', pid, bytes);
        });
        proc.on('close', (code: number | null) => {
          if (!finalize()) return;
          spawnedProcesses.delete(pid);
          const exitCode = code ?? 0;
          const seq = nextSeq();
          safeSendSpawnEvent({ pid, seq, type: 'exit', code: exitCode });
          // Legacy channels kept for compatibility with older renderer code.
          safeSend('spawn-exit', pid, exitCode);
        });
        proc.on('error', (err: Error) => {
          if (!finalize()) return;
          spawnedProcesses.delete(pid);
          const message = err.message;
          const seq = nextSeq();
          safeSendSpawnEvent({ pid, seq, type: 'error', message });
          // Legacy channels kept for compatibility with older renderer code.
          safeSend('spawn-error', pid, message);
        });

        return { pid };
      }
    );

    ipcMain.handle('spawn-kill', (_event: any, pid: number) => {
      const proc = spawnedProcesses.get(pid);
      if (proc) {
        try { proc.kill(); } catch {}
        spawnedProcesses.delete(pid);
      }
    });
  }

  // Synchronous shell command execution (for extensions using execFileSync/execSync)
  ipcMain.on(
    'exec-command-sync',
    (
      event: any,
      command: string,
      args: string[],
      options?: { shell?: boolean | string; input?: string; env?: Record<string, string>; cwd?: string }
    ) => {
      try {
        const { spawnSync, execFileSync } = require('child_process');
        const fs = require('fs');
        const resolveExecutablePath = (input: string): string => {
          if (!input || typeof input !== 'string') return input;
          if (!input.includes('/') && !input.includes('\\')) return input;
          if (!input.startsWith('/')) return input;
          if (fs.existsSync(input)) return input;
          try {
            const base = input.split('/').filter(Boolean).pop() || '';
            if (!base) return input;
            const lookup = execFileSync('/bin/zsh', ['-lc', `command -v -- ${JSON.stringify(base)} 2>/dev/null || true`], { encoding: 'utf-8' }).trim();
            if (lookup && fs.existsSync(lookup)) return lookup;
          } catch {}
          return input;
        };
        const normalizedCommand = resolveExecutablePath(command);
        const extraPaths = [
          '/opt/homebrew/bin', '/opt/homebrew/sbin',
          '/usr/local/bin', '/usr/local/sbin',
          '/usr/bin', '/usr/sbin', '/bin', '/sbin',
        ];
        const currentPath = (options?.env?.PATH ?? process.env.PATH ?? '');
        const augmentedPath = [
          ...extraPaths,
          ...currentPath.split(':').filter(Boolean),
        ].filter((v, i, a) => a.indexOf(v) === i).join(':');
        const spawnOptions: any = {
          shell: options?.shell ?? false,
          env: { ...process.env, ...options?.env, PATH: augmentedPath },
          cwd: options?.cwd || process.cwd(),
          input: options?.input,
          encoding: 'utf-8',
          timeout: 60000, // 60 s for sync operations (longer ops should use async exec)
        };

        let result: any;
        if (options?.shell) {
          const fullCommand = [normalizedCommand, ...(args || [])].join(' ');
          result = spawnSync(fullCommand, [], { ...spawnOptions, shell: true });
        } else {
          result = spawnSync(normalizedCommand, args || [], spawnOptions);
        }

        event.returnValue = {
          stdout: result?.stdout || '',
          stderr: result?.stderr || '',
          exitCode: typeof result?.status === 'number' ? result.status : 0,
        };
      } catch (e: any) {
        event.returnValue = {
          stdout: '',
          stderr: e?.message || 'Failed to execute command',
          exitCode: 1,
        };
      }
    }
  );

  // Download a URL to a binary buffer via Node.js (bypasses CORS — renderer fetch cannot
  // download from CDNs that don't send CORS headers, but Node.js has no such restriction).
  // Returns a Uint8Array which IPC transmits via structured clone without encoding overhead.
  ipcMain.handle('http-download-binary', async (_event: any, url: string) => {
    const https = require('https');
    const http = require('http');
    const { execFile } = require('child_process');
    const REQUEST_TIMEOUT_MS = 30_000;

    const downloadUrl = async (targetUrl: string, redirectCount = 0): Promise<Uint8Array> => {
      if (redirectCount > 10) throw new Error('Too many redirects');
      const parsed = new URL(targetUrl);

      return new Promise((resolve, reject) => {
        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.get(
          parsed.toString(),
          {
            headers: {
              'User-Agent': 'SuperCmd/1.0 (+https://github.com/raycast/extensions)',
              Accept: '*/*',
            },
          },
          (res: any) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              const redirectUrl = new URL(res.headers.location, parsed).toString();
              downloadUrl(redirectUrl, redirectCount + 1).then(resolve, reject);
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
            res.on('error', reject);
          }
        );

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
          req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
        });
        req.on('error', reject);
      });
    };

    const downloadWithCurlFallback = async (): Promise<Uint8Array> => {
      try {
        return await downloadUrl(url);
      } catch (primaryErr: any) {
        const curlOutput = await new Promise<Uint8Array>((resolve, reject) => {
          execFile(
            '/usr/bin/curl',
            [
              '-fsSL',
              '--connect-timeout',
              '10',
              '--max-time',
              '60',
              url,
            ],
            { encoding: null, maxBuffer: 100 * 1024 * 1024 },
            (err: Error | null, stdout: Buffer, stderr: Buffer | string) => {
              if (err) {
                const stderrText = typeof stderr === 'string' ? stderr : String(stderr || '');
                reject(
                  new Error(
                    `HTTP download failed (${primaryErr?.message || 'unknown'}) and curl fallback failed (${stderrText || err.message})`
                  )
                );
                return;
              }
              resolve(new Uint8Array(stdout));
            }
          );
        });
        return curlOutput;
      }
    };

    return downloadWithCurlFallback();
  });

  // Write raw binary data to a real file path (extensions use this for CLI tool downloads)
  ipcMain.handle('fs-write-binary-file', async (_event: any, filePath: string, data: Uint8Array) => {
    const fs = require('fs');
    const nodePath = require('path');
    await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, Buffer.from(data));
  });

  // Get installed applications
  ipcMain.handle('get-applications', async (_event: any, targetPath?: string) => {
    const { execFileSync } = require('child_process');
    const fsNative = require('fs');

    const resolveBundleId = (appPath: string): string | undefined => {
      try {
        const plistPath = path.join(appPath, 'Contents', 'Info.plist');
        if (!fsNative.existsSync(plistPath)) return undefined;
        const out = execFileSync(
          '/usr/bin/plutil',
          ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plistPath],
          { encoding: 'utf-8' }
        ).trim();
        return out || undefined;
      } catch {
        try {
          const out = execFileSync(
            '/usr/bin/mdls',
            ['-name', 'kMDItemCFBundleIdentifier', '-raw', appPath],
            { encoding: 'utf-8' }
          ).trim();
          if (!out || out === '(null)') return undefined;
          return out;
        } catch {
          return undefined;
        }
      }
    };

    const commands = await getAvailableCommands();
    let apps = commands
      .filter((c) => c.category === 'app')
      .map((c) => ({
        name: c.title,
        path: c.path || '',
        bundleId: c.path ? resolveBundleId(c.path) : undefined,
      }));

    // Raycast API compatibility: if path is provided, return only apps that can open it.
    if (targetPath && typeof targetPath === 'string') {
      try {
        const appPath = execFileSync(
          '/usr/bin/osascript',
          [
            '-l',
            'AppleScript',
            '-e',
            `use framework "AppKit"
set fileURL to current application's NSURL's fileURLWithPath:"${targetPath.replace(/"/g, '\\"')}"
set appURL to current application's NSWorkspace's sharedWorkspace()'s URLForApplicationToOpenURL:fileURL
if appURL is missing value then return ""
return appURL's |path|() as text`,
          ],
          { encoding: 'utf-8' }
        ).trim();

        if (appPath) {
          apps = apps.filter((a) => a.path === appPath);
        } else {
          apps = [];
        }
      } catch {
        apps = [];
      }
    }

    return apps;
  });

  // Get default application for a file/URL
  ipcMain.handle('get-default-application', async (_event: any, filePath: string) => {
    try {
      const { execSync } = require('child_process');
      // Use Launch Services via AppleScript to find default app
      const script = `
        use framework "AppKit"
        set fileURL to current application's NSURL's fileURLWithPath:"${filePath.replace(/"/g, '\\"')}"
        set appURL to current application's NSWorkspace's sharedWorkspace()'s URLForApplicationToOpenURL:fileURL
        if appURL is missing value then
          error "No default application found"
        end if
        set appPath to appURL's |path|() as text
        set appBundle to current application's NSBundle's bundleWithPath:appPath
        set appName to (appBundle's infoDictionary()'s objectForKey:"CFBundleName") as text
        set bundleId to (appBundle's bundleIdentifier()) as text
        return appName & "|||" & appPath & "|||" & bundleId
      `;
      const result = execSync(`osascript -l AppleScript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
      const [name, appPath, bundleId] = result.split('|||');
      return { name, path: appPath, bundleId };
    } catch (e: any) {
      console.error('get-default-application error:', e);
      throw new Error(`No default application found for: ${filePath}`);
    }
  });

  // Get frontmost application
  ipcMain.handle('get-frontmost-application', async () => {
    try {
      const { execSync } = require('child_process');
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
          set appPath to POSIX path of (file of frontApp as alias)
          set appId to bundle identifier of frontApp
          return appName & "|||" & appPath & "|||" & appId
        end tell
      `;
      const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
      const [name, appPath, bundleId] = result.split('|||');
      return { name, path: appPath, bundleId };
    } catch (e) {
      return { name: 'SuperCmd', path: '', bundleId: 'com.supercommand' };
    }
  });

  // Run AppleScript
  ipcMain.handle('run-applescript', async (_event: any, script: string) => {
    try {
      const { spawnSync } = require('child_process');
      const proc = spawnSync('/usr/bin/osascript', ['-l', 'AppleScript'], {
        input: script,
        encoding: 'utf-8',
      });

      if (proc.status !== 0) {
        const stderr = (proc.stderr || '').trim() || 'AppleScript execution failed';
        throw new Error(stderr);
      }

      const result = proc.stdout || '';
      return result.trim();
    } catch (e: any) {
      console.error('AppleScript error:', e);
      throw new Error(e?.message || 'AppleScript execution failed');
    }
  });

  // Move to trash
  ipcMain.handle('move-to-trash', async (_event: any, paths: string[]) => {
    for (const p of paths) {
      try {
        await shell.trashItem(p);
      } catch (e) {
        console.error(`Failed to trash ${p}:`, e);
      }
    }
  });

  // File system operations for extensions
  const fs = require('fs');
  const fsPromises = require('fs/promises');

  ipcMain.handle('read-file', async (_event: any, filePath: string) => {
    try {
      return await fsPromises.readFile(filePath, 'utf-8');
    } catch (e) {
      return '';
    }
  });

  // Synchronous file read for extensions that use readFileSync (e.g. emoji picker)
  ipcMain.on('read-file-sync', (event: any, filePath: string) => {
    try {
      event.returnValue = { data: fs.readFileSync(filePath, 'utf-8'), error: null };
    } catch (e: any) {
      event.returnValue = { data: null, error: e.message };
    }
  });

  // Synchronous file-exists check
  ipcMain.on('file-exists-sync', (event: any, filePath: string) => {
    try {
      event.returnValue = fs.existsSync(filePath);
    } catch {
      event.returnValue = false;
    }
  });

  // Synchronous stat check
  ipcMain.on('stat-sync', (event: any, filePath: string) => {
    try {
      const stat = fs.statSync(filePath);
      event.returnValue = { exists: true, isDirectory: stat.isDirectory(), isFile: stat.isFile(), size: stat.size };
    } catch {
      event.returnValue = { exists: false, isDirectory: false, isFile: false, size: 0 };
    }
  });

  ipcMain.handle('write-file', async (_event: any, filePath: string, content: string) => {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(filePath, content, 'utf-8');
    } catch (e) {
      console.error('write-file error:', e);
    }
  });

  ipcMain.handle('file-exists', async (_event: any, filePath: string) => {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('read-dir', async (_event: any, dirPath: string) => {
    try {
      return await fsPromises.readdir(dirPath);
    } catch {
      return [];
    }
  });

  ipcMain.handle('get-file-icon-data-url', async (_event: any, filePath: string, size = 20) => {
    try {
      const icon = await app.getFileIcon(filePath, { size: size <= 16 ? 'small' : size >= 64 ? 'large' : 'normal' });
      if (icon && !icon.isEmpty()) {
        return icon.resize({ width: size, height: size }).toDataURL();
      }
      return null;
    } catch {
      return null;
    }
  });

  // Get system appearance
  ipcMain.handle('get-appearance', () => {
    return 'dark';
  });

  // SQLite query execution (for extensions like cursor-recent-projects)
  ipcMain.handle('run-sqlite-query', async (_event: any, dbPath: string, query: string) => {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const fs = require('fs');

    console.log('[SQLite] Query request:', { dbPath, query: query.substring(0, 100), dbExists: fs.existsSync(dbPath) });

    try {
      const { stdout, stderr } = await execFileAsync('sqlite3', ['-json', dbPath, query], { maxBuffer: 10 * 1024 * 1024 });

      if (stderr) {
        console.warn('[SQLite] Query stderr:', stderr);
      }

      console.log('[SQLite] Query stdout length:', stdout.length, 'first 200 chars:', stdout.substring(0, 200));

      try {
        const parsed = JSON.parse(stdout);
        console.log('[SQLite] Successfully parsed JSON, result type:', Array.isArray(parsed) ? `array[${parsed.length}]` : typeof parsed);
        return { data: parsed, error: null };
      } catch (parseError: any) {
        // If not JSON, return raw output
        console.warn('[SQLite] Failed to parse JSON:', parseError.message, 'returning raw output');
        return { data: stdout, error: null };
      }
    } catch (e: any) {
      console.error('[SQLite] Query failed:', e.message, 'stderr:', e.stderr);
      return { data: null, error: e.message || 'SQLite query failed' };
    }
  });

  // ─── IPC: Store (Community Extensions) ──────────────────────────

  ipcMain.handle(
    'get-catalog',
    async (_event: any, forceRefresh?: boolean) => {
      return await getCatalog(forceRefresh ?? false);
    }
  );

  ipcMain.handle(
    'get-extension-screenshots',
    async (_event: any, extensionName: string) => {
      return await getExtensionScreenshotUrls(extensionName);
    }
  );

  ipcMain.handle('get-installed-extension-names', () => {
    return getInstalledExtensionNames();
  });

  ipcMain.handle(
    'install-extension',
    async (_event: any, name: string) => {
      const success = await installExtension(name);
      if (success) {
        // Invalidate command cache so new extensions appear in the launcher
        invalidateCache();
      }
      return success;
    }
  );

  ipcMain.handle(
    'uninstall-extension',
    async (_event: any, name: string) => {
      const success = await uninstallExtension(name);
      if (success) {
        // Invalidate command cache so removed extensions disappear
        invalidateCache();
      }
      return success;
    }
  );

  // ─── IPC: Clipboard Manager ─────────────────────────────────────

  ipcMain.handle('clipboard-get-history', () => {
    return getClipboardHistory();
  });

  ipcMain.handle('clipboard-search', (_event: any, query: string) => {
    return searchClipboardHistory(query);
  });

  ipcMain.handle('clipboard-clear-history', () => {
    clearClipboardHistory();
  });

  ipcMain.handle('clipboard-delete-item', (_event: any, id: string) => {
    return deleteClipboardItem(id);
  });

  ipcMain.handle('clipboard-copy-item', (_event: any, id: string) => {
    return copyItemToClipboard(id);
  });

  ipcMain.handle('clipboard-paste-item', async (_event: any, id: string) => {
    const success = copyItemToClipboard(id);
    if (!success) return false;

    return await hideAndPaste();
  });

  ipcMain.handle('clipboard-set-enabled', (_event: any, enabled: boolean) => {
    setClipboardMonitorEnabled(enabled);
  });

  // Focus-safe clipboard APIs for extension/runtime shims.
  ipcMain.handle('clipboard-write', (_event: any, payload: { text?: string; html?: string }) => {
    try {
      const text = payload?.text || '';
      const html = payload?.html || '';
      if (html) {
        systemClipboard.write({ text, html });
      } else {
        systemClipboard.writeText(text);
      }
      return true;
    } catch (error) {
      console.error('clipboard-write failed:', error);
      return false;
    }
  });

  ipcMain.handle('clipboard-read-text', () => {
    try {
      return systemClipboard.readText() || '';
    } catch (error) {
      console.error('clipboard-read-text failed:', error);
      return '';
    }
  });

  ipcMain.handle('get-selected-text', async () => {
    const fresh = String(await getSelectedTextForSpeak() || '');
    if (fresh.trim().length > 0) {
      rememberSelectionSnapshot(fresh);
      return fresh;
    }
    const recent = getRecentSelectionSnapshot();
    if (recent.trim().length > 0) return recent;
    return String(lastCursorPromptSelection || '');
  });

  ipcMain.handle('get-selected-text-strict', async () => {
    const fresh = String(await getSelectedTextForSpeak() || '');
    if (fresh.trim().length > 0) {
      rememberSelectionSnapshot(fresh);
      return fresh;
    }
    return String(getRecentSelectionSnapshot() || '');
  });

  ipcMain.handle(
    'memory-add',
    async (
      _event: any,
      payload: { text: string; userId?: string; source?: string; metadata?: Record<string, any> }
    ) => {
      const text = String(payload?.text || '').trim();
      if (!text) {
        return { success: false, error: 'No selected text found.' };
      }
      return await addMemory(loadSettings(), {
        text,
        userId: payload?.userId,
        source: payload?.source || 'launcher-selection',
        metadata: payload?.metadata,
      });
    }
  );

  // ─── IPC: Snippet Manager ─────────────────────────────────────

  ipcMain.handle('snippet-get-all', () => {
    return getAllSnippets();
  });

  ipcMain.handle('snippet-search', (_event: any, query: string) => {
    return searchSnippets(query);
  });

  ipcMain.handle('snippet-create', (_event: any, data: { name: string; content: string; keyword?: string }) => {
    const created = createSnippet(data);
    refreshSnippetExpander();
    return created;
  });

  ipcMain.handle('snippet-update', (_event: any, id: string, data: { name?: string; content?: string; keyword?: string }) => {
    const updated = updateSnippet(id, data);
    refreshSnippetExpander();
    return updated;
  });

  ipcMain.handle('snippet-delete', (_event: any, id: string) => {
    const removed = deleteSnippet(id);
    refreshSnippetExpander();
    return removed;
  });

  ipcMain.handle('snippet-delete-all', () => {
    const removed = deleteAllSnippets();
    refreshSnippetExpander();
    return removed;
  });

  ipcMain.handle('snippet-duplicate', (_event: any, id: string) => {
    return duplicateSnippet(id);
  });

  ipcMain.handle('snippet-toggle-pin', (_event: any, id: string) => {
    return togglePinSnippet(id);
  });

  ipcMain.handle('snippet-get-by-keyword', (_event: any, keyword: string) => {
    return getSnippetByKeyword(keyword);
  });

  ipcMain.handle('snippet-get-dynamic-fields', (_event: any, id: string) => {
    return getSnippetDynamicFieldsById(id);
  });

  ipcMain.handle('snippet-render', (_event: any, id: string, dynamicValues?: Record<string, string>) => {
    return renderSnippetById(id, dynamicValues);
  });

  ipcMain.handle('snippet-copy-to-clipboard', (_event: any, id: string) => {
    return copySnippetToClipboard(id);
  });

  ipcMain.handle('snippet-copy-to-clipboard-resolved', (_event: any, id: string, dynamicValues?: Record<string, string>) => {
    return copySnippetToClipboardResolved(id, dynamicValues);
  });

  ipcMain.handle('snippet-paste', async (_event: any, id: string) => {
    const success = copySnippetToClipboard(id);
    if (!success) return false;

    return await hideAndPaste();
  });

  ipcMain.handle('snippet-paste-resolved', async (_event: any, id: string, dynamicValues?: Record<string, string>) => {
    const success = copySnippetToClipboardResolved(id, dynamicValues);
    if (!success) return false;

    return await hideAndPaste();
  });

  ipcMain.handle('snippet-import', async () => {
    suppressBlurHide = true;
    try {
      const result = await importSnippetsFromFile(mainWindow || undefined);
      refreshSnippetExpander();
      return result;
    } finally {
      suppressBlurHide = false;
    }
  });

  ipcMain.handle('snippet-export', async () => {
    suppressBlurHide = true;
    try {
      return await exportSnippetsToFile(mainWindow || undefined);
    } finally {
      suppressBlurHide = false;
    }
  });

  ipcMain.handle('paste-text', async (_event: any, text: string) => {
    const nextText = String(text || '');
    if (!nextText) return false;

    const previousClipboardText = systemClipboard.readText();
    try {
      systemClipboard.writeText(nextText);
      let pasted = await hideAndPaste();
      if (!pasted) {
        await activateLastFrontmostApp();
        await new Promise((resolve) => setTimeout(resolve, 120));
        pasted = await typeTextDirectly(nextText);
      }
      setTimeout(() => {
        try {
          systemClipboard.writeText(previousClipboardText);
        } catch {}
      }, 500);
      return pasted;
    } catch (error) {
      console.error('paste-text failed:', error);
      return false;
    }
  });

  ipcMain.handle('type-text-live', async (_event: any, text: string) => {
    const nextText = String(text || '');
    if (!nextText) return false;
    console.log('[Whisper][type-live]', JSON.stringify(nextText));
    await activateLastFrontmostApp();
    await new Promise((resolve) => setTimeout(resolve, 70));
    let typed = await typeTextDirectly(nextText);
    if (!typed) {
      typed = await pasteTextToActiveApp(nextText);
    }
    return typed;
  });

  ipcMain.handle('whisper-type-text-live', async (_event: any, text: string) => {
    const nextText = String(text || '');
    if (!nextText) {
      return { typed: false, fallbackClipboard: false };
    }

    let typed = await pasteTextToActiveApp(nextText);
    if (!typed) {
      typed = await typeTextDirectly(nextText);
    }
    if (typed) {
      return { typed: true, fallbackClipboard: false };
    }
    return { typed: false, fallbackClipboard: false };
  });

  ipcMain.handle('replace-live-text', async (_event: any, previousText: string, nextText: string) => {
    console.log('[Whisper][replace-live]', JSON.stringify(previousText), '=>', JSON.stringify(nextText));
    await activateLastFrontmostApp();
    await new Promise((resolve) => setTimeout(resolve, 70));
    let replaced = await replaceTextDirectly(previousText, nextText);
    if (!replaced) {
      replaced = await replaceTextViaBackspaceAndPaste(previousText, nextText);
    }
    return replaced;
  });

  ipcMain.handle('prompt-apply-generated-text', async (_event: any, payload: { previousText?: string; nextText: string }) => {
    const previousText = String(payload?.previousText || '');
    const nextText = String(payload?.nextText || '');
    if (!nextText.trim()) return false;

    // Ensure prompt window is closed before typing/replacing so text is not inserted back into prompt UI.
    hidePromptWindow();
    await activateLastFrontmostApp();
    await new Promise((resolve) => setTimeout(resolve, 70));

    if (previousText.trim()) {
      // Use paste-based replacement first to preserve all newlines exactly.
      let replaced = await replaceTextViaBackspaceAndPaste(previousText, nextText);
      if (!replaced) {
        replaced = await replaceTextDirectly(previousText, nextText);
      }
      return replaced;
    }

    // Paste first so multiline responses keep exact line breaks.
    let typed = await pasteTextToActiveApp(nextText);
    if (!typed) {
      typed = await typeTextDirectly(nextText);
    }
    return typed;
  });

  ipcMain.on('whisper-debug-log', (_event: any, payload: { tag?: string; message?: string; data?: any }) => {
    const tag = String(payload?.tag || 'event');
    const message = String(payload?.message || '');
    const data = payload?.data;
    if (typeof data === 'undefined') {
      console.log(`[Whisper][${tag}] ${message}`);
      return;
    }
    console.log(`[Whisper][${tag}] ${message}`, data);
  });

  // ─── IPC: AI ───────────────────────────────────────────────────

  ipcMain.handle(
    'ai-ask',
    async (event: any, requestId: string, prompt: string, options?: { model?: string; creativity?: number; systemPrompt?: string }) => {
      const s = loadSettings();
      if (!isAIAvailable(s.ai)) {
        event.sender.send('ai-stream-error', { requestId, error: 'AI is not configured. Please set up an API key in Settings → AI.' });
        return;
      }

      const controller = new AbortController();
      activeAIRequests.set(requestId, controller);

      try {
        const memoryContextSystemPrompt = await buildMemoryContextSystemPrompt(
          s,
          String(prompt || ''),
          { limit: 6 }
        );
        const mergedSystemPrompt = [options?.systemPrompt, memoryContextSystemPrompt]
          .filter((part) => typeof part === 'string' && part.trim().length > 0)
          .join('\n\n');

        const gen = streamAI(s.ai, {
          prompt,
          model: options?.model,
          creativity: options?.creativity,
          systemPrompt: mergedSystemPrompt || undefined,
          signal: controller.signal,
        });

        for await (const chunk of gen) {
          if (controller.signal.aborted) break;
          event.sender.send('ai-stream-chunk', { requestId, chunk });
        }

        if (!controller.signal.aborted) {
          event.sender.send('ai-stream-done', { requestId });
        }
      } catch (e: any) {
        if (!controller.signal.aborted) {
          event.sender.send('ai-stream-error', { requestId, error: e?.message || 'AI request failed' });
        }
      } finally {
        activeAIRequests.delete(requestId);
      }
    }
  );

  ipcMain.handle('ai-cancel', (_event: any, requestId: string) => {
    const controller = activeAIRequests.get(requestId);
    if (controller) {
      controller.abort();
      activeAIRequests.delete(requestId);
    }
  });

  ipcMain.handle('ai-is-available', () => {
    const s = loadSettings();
    return isAIAvailable(s.ai);
  });

  ipcMain.handle('whisper-refine-transcript', async (_event: any, transcript: string) => {
    return await refineWhisperTranscript(transcript);
  });

  ipcMain.handle(
    'whisper-transcribe',
    async (_event: any, audioArrayBuffer: ArrayBuffer, options?: { language?: string; mimeType?: string }) => {
      const s = loadSettings();

      // Parse speechToTextModel to a concrete provider model.
      let provider: 'openai' | 'elevenlabs' = 'openai';
      let model = 'gpt-4o-transcribe';
      const sttModel = s.ai.speechToTextModel || '';
      if (!sttModel || sttModel === 'default') {
        provider = 'openai';
        model = 'gpt-4o-transcribe';
      } else if (sttModel === 'native') {
        // Renderer should not call cloud transcription in native mode.
        // Return empty transcript instead of surfacing an IPC error.
        return '';
      } else if (sttModel.startsWith('openai-')) {
        provider = 'openai';
        model = sttModel.slice('openai-'.length);
      } else if (sttModel.startsWith('elevenlabs-')) {
        provider = 'elevenlabs';
        model = resolveElevenLabsSttModel(sttModel);
      } else if (sttModel) {
        model = sttModel;
      }

      if (provider === 'openai' && !s.ai.openaiApiKey) {
        throw new Error('OpenAI API key not configured. Go to Settings -> AI to set it up.');
      }
      const elevenLabsApiKey = getElevenLabsApiKey(s);
      if (provider === 'elevenlabs' && !elevenLabsApiKey) {
        throw new Error('ElevenLabs API key not configured. Set it in Settings -> AI (or ELEVENLABS_API_KEY env var).');
      }

      // Convert BCP-47 (e.g. 'en-US') to ISO-639-1 (e.g. 'en')
      const rawLang = options?.language || s.ai.speechLanguage || 'en-US';
      const language = rawLang.split('-')[0].toLowerCase() || 'en';
      const mimeType = options?.mimeType;

      const audioBuffer = Buffer.from(audioArrayBuffer);

      console.log(`[Whisper] Transcribing ${audioBuffer.length} bytes, provider=${provider}, model=${model}, lang=${language}, mime=${mimeType || 'unknown'}`);

      const text = provider === 'elevenlabs'
        ? await transcribeAudioWithElevenLabs({
            audioBuffer,
            apiKey: elevenLabsApiKey,
            model,
            language,
            mimeType,
          })
        : await transcribeAudio({
            audioBuffer,
            apiKey: s.ai.openaiApiKey,
            model,
            language,
            mimeType,
          });

      console.log(`[Whisper] Transcription result: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
      return text;
    }
  );

  // ─── IPC: Native Speech Recognition (macOS SFSpeechRecognizer) ──

  ipcMain.handle('whisper-start-native', async (event: any, language?: string) => {
    // Kill any existing process
    if (nativeSpeechProcess) {
      try { nativeSpeechProcess.kill('SIGTERM'); } catch {}
      nativeSpeechProcess = null;
      nativeSpeechStdoutBuffer = '';
    }

    const lang = language || loadSettings().ai.speechLanguage || 'en-US';
    const binaryPath = getNativeBinaryPath('speech-recognizer');
    const fs = require('fs');

    // Compile on demand (same pattern as color-picker / snippet-expander)
    if (!fs.existsSync(binaryPath)) {
      try {
        const { execFileSync } = require('child_process');
        const sourcePath = path.join(app.getAppPath(), 'src', 'native', 'speech-recognizer.swift');
        execFileSync('swiftc', [
          '-O', '-o', binaryPath, sourcePath,
          '-framework', 'Speech',
          '-framework', 'AVFoundation',
        ]);
        console.log('[Whisper][native] Compiled speech-recognizer binary');
      } catch (error) {
        console.error('[Whisper][native] Compile failed:', error);
        throw new Error('Failed to compile native speech recognizer. Ensure Xcode Command Line Tools are installed.');
      }
    }

    const { spawn } = require('child_process');
    nativeSpeechProcess = spawn(binaryPath, [lang], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    nativeSpeechStdoutBuffer = '';
    console.log(`[Whisper][native] Started speech-recognizer (lang=${lang})`);

    nativeSpeechProcess.stdout.on('data', (chunk: Buffer | string) => {
      nativeSpeechStdoutBuffer += chunk.toString();
      const lines = nativeSpeechStdoutBuffer.split('\n');
      nativeSpeechStdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const payload = JSON.parse(trimmed);
          // Forward to renderer
          event.sender.send('whisper-native-chunk', payload);
        } catch {
          // ignore malformed lines
        }
      }
    });

    nativeSpeechProcess.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim();
      if (text) console.warn('[Whisper][native]', text);
    });

    nativeSpeechProcess.on('exit', (code: number | null) => {
      console.log(`[Whisper][native] Process exited (code=${code})`);
      nativeSpeechProcess = null;
      nativeSpeechStdoutBuffer = '';
      // Notify renderer that native recognition ended
      try { event.sender.send('whisper-native-chunk', { ended: true }); } catch {}
    });
  });

  ipcMain.handle('whisper-stop-native', async () => {
    if (nativeSpeechProcess) {
      try { nativeSpeechProcess.kill('SIGTERM'); } catch {}
      nativeSpeechProcess = null;
      nativeSpeechStdoutBuffer = '';
    }
  });

  // ─── IPC: Ollama Model Management ──────────────────────────────

  function resolveOllamaBaseUrl(raw?: string): string {
    const fallback = 'http://localhost:11434';
    const input = (raw || fallback).trim();
    try {
      const normalized = new URL(input);
      return normalized.toString();
    } catch {
      return fallback;
    }
  }

  ipcMain.handle('ollama-status', async () => {
    const s = loadSettings();
    const configured = resolveOllamaBaseUrl(s.ai.ollamaBaseUrl);
    const candidates = Array.from(
      new Set([configured, 'http://127.0.0.1:11434', 'http://localhost:11434'])
    );

    const requestJson = (url: URL): Promise<{ statusCode: number; body: string } | null> =>
      new Promise((resolve) => {
        const mod = url.protocol === 'https:' ? require('https') : require('http');
        const req = mod.get(url.toString(), (res: any) => {
          let body = '';
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
        });
        req.on('error', () => resolve(null));
        req.setTimeout(2500, () => {
          req.destroy();
          resolve(null);
        });
      });

    for (const baseUrl of candidates) {
      const tagsUrl = new URL('/api/tags', baseUrl);
      const tagsResult = await requestJson(tagsUrl);
      if (tagsResult && tagsResult.statusCode === 200) {
        try {
          const data = JSON.parse(tagsResult.body || '{}');
          return {
            running: true,
            models: (data.models || []).map((m: any) => ({
              name: m.name,
              size: m.size,
              parameterSize: m.details?.parameter_size || '',
              quantization: m.details?.quantization_level || '',
              modifiedAt: m.modified_at,
            })),
          };
        } catch {
          return { running: true, models: [] };
        }
      }

      const versionUrl = new URL('/api/version', baseUrl);
      const versionResult = await requestJson(versionUrl);
      if (versionResult && versionResult.statusCode === 200) {
        return { running: true, models: [] };
      }
    }

    return { running: false, models: [] };
  });

  ipcMain.handle(
    'ollama-pull',
    async (event: any, requestId: string, modelName: string) => {
      const s = loadSettings();
      const baseUrl = resolveOllamaBaseUrl(s.ai.ollamaBaseUrl);
      const url = new URL('/api/pull', baseUrl);
      const mod = url.protocol === 'https:' ? require('https') : require('http');

      const controller = new AbortController();
      activeAIRequests.set(requestId, controller);

      const body = JSON.stringify({ name: modelName, stream: true });

      const req = mod.request(
        {
          hostname: url.hostname,
          port: url.port ? parseInt(url.port) : undefined,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res: any) => {
          if (res.statusCode && res.statusCode >= 400) {
            let errBody = '';
            res.on('data', (chunk: Buffer) => { errBody += chunk.toString(); });
            res.on('end', () => {
              event.sender.send('ollama-pull-error', {
                requestId,
                error: `HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`,
              });
              activeAIRequests.delete(requestId);
            });
            return;
          }

          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            if (controller.signal.aborted) return;
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const obj = JSON.parse(trimmed);
                event.sender.send('ollama-pull-progress', {
                  requestId,
                  status: obj.status || '',
                  digest: obj.digest || '',
                  total: obj.total || 0,
                  completed: obj.completed || 0,
                });
              } catch {}
            }
          });

          res.on('end', () => {
            if (buffer.trim()) {
              try {
                const obj = JSON.parse(buffer.trim());
                event.sender.send('ollama-pull-progress', {
                  requestId,
                  status: obj.status || '',
                  digest: obj.digest || '',
                  total: obj.total || 0,
                  completed: obj.completed || 0,
                });
              } catch {}
            }
            if (!controller.signal.aborted) {
              event.sender.send('ollama-pull-done', { requestId });
            }
            activeAIRequests.delete(requestId);
          });
        }
      );

      req.on('error', (err: Error) => {
        if (!controller.signal.aborted) {
          event.sender.send('ollama-pull-error', {
            requestId,
            error: err.message || 'Failed to pull model',
          });
        }
        activeAIRequests.delete(requestId);
      });

      if (controller.signal.aborted) {
        req.destroy();
        return;
      }
      controller.signal.addEventListener('abort', () => {
        req.destroy();
      }, { once: true });

      req.write(body);
      req.end();
    }
  );

  ipcMain.handle('ollama-delete', async (_event: any, modelName: string) => {
    const s = loadSettings();
    const baseUrl = resolveOllamaBaseUrl(s.ai.ollamaBaseUrl);
    const url = new URL('/api/delete', baseUrl);
    const mod = url.protocol === 'https:' ? require('https') : require('http');

    return new Promise((resolve) => {
      const body = JSON.stringify({ name: modelName });
      const req = mod.request(
        {
          hostname: url.hostname,
          port: url.port ? parseInt(url.port) : undefined,
          path: url.pathname,
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        },
        (res: any) => {
          let resBody = '';
          res.on('data', (chunk: Buffer) => { resBody += chunk.toString(); });
          res.on('end', () => {
            resolve({ success: res.statusCode === 200, error: res.statusCode !== 200 ? resBody : null });
          });
        }
      );
      req.on('error', (err: Error) => {
        resolve({ success: false, error: err.message });
      });
      req.write(body);
      req.end();
    });
  });

  ipcMain.handle('ollama-open-download', async () => {
    await shell.openExternal('https://ollama.com/download');
    return true;
  });

  // ─── IPC: WindowManagement ──────────────────────────────────────

  ipcMain.handle('window-management-get-active-window', async () => {
    try {
      const { execSync } = require('child_process');
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set frontAppName to name of frontApp
          set frontWindow to window 1 of frontApp

          set windowBounds to bounds of frontWindow
          set windowId to id of frontWindow as text
          set windowTitle to name of frontWindow
          set windowPosition to {item 1 of windowBounds, item 2 of windowBounds}
          set windowSize to {(item 3 of windowBounds) - (item 1 of windowBounds), (item 4 of windowBounds) - (item 2 of windowBounds)}

          return windowId & "|" & windowTitle & "|" & (item 1 of windowPosition) & "|" & (item 2 of windowPosition) & "|" & (item 1 of windowSize) & "|" & (item 2 of windowSize) & "|" & frontAppName
        end tell
      `;

      const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
      const [id, title, x, y, width, height, appName] = result.split('|');

      return {
        id,
        active: true,
        bounds: {
          position: { x: parseInt(x), y: parseInt(y) },
          size: { width: parseInt(width), height: parseInt(height) }
        },
        desktopId: '1',
        positionable: true,
        resizable: true,
        fullScreenSettable: true,
        application: {
          name: appName,
          path: '',
          bundleId: ''
        }
      };
    } catch (error) {
      console.error('Failed to get active window:', error);
      return null;
    }
  });

  ipcMain.handle('window-management-get-windows-on-active-desktop', async () => {
    try {
      const { execSync } = require('child_process');
      const script = `
        tell application "System Events"
          set windowList to {}
          repeat with proc in (every application process where background only is false)
            try
              set procName to name of proc
              repeat with win in (every window of proc)
                set windowBounds to bounds of win
                set windowId to id of win as text
                set windowTitle to name of win
                set windowPosition to {item 1 of windowBounds, item 2 of windowBounds}
                set windowSize to {(item 3 of windowBounds) - (item 1 of windowBounds), (item 4 of windowBounds) - (item 2 of windowBounds)}

                set end of windowList to windowId & "|" & windowTitle & "|" & (item 1 of windowPosition) & "|" & (item 2 of windowPosition) & "|" & (item 1 of windowSize) & "|" & (item 2 of windowSize) & "|" & procName
              end repeat
            end try
          end repeat

          set text item delimiters to "\\n"
          return windowList as text
        end tell
      `;

      const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' }).trim();
      if (!result || result.trim() === '') {
        return [];
      }

      const windows = result.split('\n').map((line: string) => {
        const [id, title, x, y, width, height, appName] = line.split('|');
        return {
          id,
          active: false,
          bounds: {
            position: { x: parseInt(x), y: parseInt(y) },
            size: { width: parseInt(width), height: parseInt(height) }
          },
          desktopId: '1',
          positionable: true,
          resizable: true,
          fullScreenSettable: true,
          application: {
            name: appName,
            path: '',
            bundleId: ''
          }
        };
      });

      return windows;
    } catch (error) {
      console.error('Failed to get windows:', error);
      return [];
    }
  });

  ipcMain.handle('window-management-get-desktops', async () => {
    try {
      // macOS doesn't expose virtual desktops (Spaces) easily via AppleScript
      // Return a minimal implementation
      const { screen } = require('electron');
      const displays = screen.getAllDisplays();

      return displays.map((display: any, index: number) => ({
        id: String(index + 1),
        active: index === 0,
        screenId: String(display.id),
        size: {
          width: display.bounds.width,
          height: display.bounds.height
        },
        type: 'user'
      }));
    } catch (error) {
      console.error('Failed to get desktops:', error);
      return [];
    }
  });

  ipcMain.handle('window-management-set-window-bounds', async (_event: any, options: any) => {
    try {
      const { execSync } = require('child_process');
      const { id, bounds, desktopId } = options;

      if (bounds === 'fullscreen') {
        // Set window to fullscreen
        const script = `
          tell application "System Events"
            set targetWindow to (first window of (first application process whose (id of window 1) as text is "${id}"))
            set value of attribute "AXFullScreen" of targetWindow to true
          end tell
        `;
        execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' });
      } else {
        // Set window position/size
        const { position, size } = bounds;

        // If desktopId specifies a different display, offset position to that display
        let offsetX = 0;
        let offsetY = 0;
        if (desktopId) {
          const { screen: electronScreen } = require('electron');
          const displays = electronScreen.getAllDisplays();
          const targetIndex = parseInt(desktopId) - 1;
          if (targetIndex >= 0 && targetIndex < displays.length) {
            offsetX = displays[targetIndex].bounds.x;
            offsetY = displays[targetIndex].bounds.y;
          }
        }

        let script = 'tell application "System Events"\n';
        script += `  set targetWindow to (first window of (first application process whose (id of window 1) as text is "${id}"))\n`;

        if (position && size) {
          const x = (position.x ?? 0) + offsetX;
          const y = (position.y ?? 0) + offsetY;
          script += `  set bounds of targetWindow to {${x}, ${y}, ${x + (size.width ?? 0)}, ${y + (size.height ?? 0)}}\n`;
        } else if (position) {
          script += `  set position of targetWindow to {${(position.x ?? 0) + offsetX}, ${(position.y ?? 0) + offsetY}}\n`;
        } else if (size) {
          script += `  set size of targetWindow to {${size.width}, ${size.height}}\n`;
        }

        script += 'end tell';
        execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf-8' });
      }
    } catch (error) {
      console.error('Failed to set window bounds:', error);
      throw error;
    }
  });

  // ─── IPC: Native Color Picker ──────────────────────────────────

  ipcMain.handle('native-pick-color', async () => {
    const { execFile } = require('child_process');
    const colorPickerPath = getNativeBinaryPath('color-picker');

    // Keep the launcher open while the native picker is focused.
    suppressBlurHide = true;
    const pickedColor = await new Promise((resolve) => {
      execFile(colorPickerPath, (error: any, stdout: string) => {
        if (error) {
          console.error('Color picker failed:', error);
          resolve(null);
          return;
        }

        const trimmed = stdout.trim();
        if (trimmed === 'null' || !trimmed) {
          resolve(null);
          return;
        }

        try {
          const color = JSON.parse(trimmed);
          resolve(color);
        } catch (e) {
          console.error('Failed to parse color picker output:', e);
          resolve(null);
        }
      });
    });
    suppressBlurHide = false;
    return pickedColor;
  });

  // ─── IPC: Native File Picker (for Form.FilePicker) ───────────────
  ipcMain.handle(
    'pick-files',
    async (
      _event: any,
      options?: {
        allowMultipleSelection?: boolean;
        canChooseDirectories?: boolean;
        canChooseFiles?: boolean;
        showHiddenFiles?: boolean;
      }
    ) => {
      const canChooseFiles = options?.canChooseFiles !== false;
      const canChooseDirectories = options?.canChooseDirectories === true;
      const properties: string[] = [];

      if (canChooseFiles) properties.push('openFile');
      if (canChooseDirectories) properties.push('openDirectory');
      if (options?.allowMultipleSelection) properties.push('multiSelections');
      if (options?.showHiddenFiles) properties.push('showHiddenFiles');

      // Ensure at least one target type is selectable.
      if (!properties.includes('openFile') && !properties.includes('openDirectory')) {
        properties.push('openFile');
      }

      suppressBlurHide = true;
      try {
        const result = await dialog.showOpenDialog(mainWindow || undefined, {
          properties: properties as any,
        });
        if (result.canceled) return [];
        return result.filePaths || [];
      } catch (error: any) {
        console.error('pick-files failed:', error);
        return [];
      } finally {
        suppressBlurHide = false;
      }
    }
  );

  // ─── IPC: Menu Bar (Tray) Extensions ────────────────────────────

  // Get all menu-bar extension bundles so the renderer can run them
  ipcMain.handle('get-menubar-extensions', async () => {
    const allCmds = discoverInstalledExtensionCommands();
    const menuBarCmds = allCmds.filter((c) => c.mode === 'menu-bar');

    const bundles: any[] = [];
    for (const cmd of menuBarCmds) {
      const bundle = getExtensionBundle(cmd.extName, cmd.cmdName);
      if (bundle) {
        bundles.push({
          code: bundle.code,
          title: bundle.title,
          mode: bundle.mode,
          extName: cmd.extName,
          cmdName: cmd.cmdName,
          extensionName: bundle.extensionName,
          extensionDisplayName: bundle.extensionDisplayName,
          extensionIconDataUrl: bundle.extensionIconDataUrl,
          commandName: bundle.commandName,
          assetsPath: bundle.assetsPath,
          supportPath: bundle.supportPath,
          owner: bundle.owner,
          preferences: bundle.preferences,
          preferenceDefinitions: bundle.preferenceDefinitions,
          commandArgumentDefinitions: bundle.commandArgumentDefinitions,
        });
      }
    }
    return bundles;
  });

  // Update / create a menu-bar Tray when the renderer sends menu structure
  ipcMain.on('menubar-update', (_event: any, data: any) => {
    const { extId, iconPath, iconEmoji, title, tooltip, items } = data;

    let tray = menuBarTrays.get(extId);

    const createNativeImageFromMenuIconPath = (pathValue: string, size: number) => {
      try {
        const fs = require('fs');
        if (!pathValue || !fs.existsSync(pathValue)) return null;
        const isSvg = /\.svg$/i.test(pathValue);
        let image: any;
        if (isSvg) {
          const svg = fs.readFileSync(pathValue, 'utf8');
          const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
          image = nativeImage.createFromDataURL(svgDataUrl);
        } else {
          image = nativeImage.createFromPath(pathValue);
        }
        if (!image || image.isEmpty()) return null;
        return image.resize({ width: size, height: size });
      } catch {
        return null;
      }
    };

    const resolveTrayIcon = () => {
      const img = iconPath ? createNativeImageFromMenuIconPath(iconPath, 18) : null;
      if (img) {
        // Keep template rendering for bitmap assets (classic menubar style).
        // For SVGs, preserve source appearance (e.g., explicit light/dark icon variants).
        const isSvg = /\.svg$/i.test(iconPath || '');
        try {
          img.setTemplateImage(!isSvg);
        } catch {}
        return img;
      }
      return nativeImage.createEmpty();
    };

    if (!tray) {
      const icon = resolveTrayIcon();
      tray = new Tray(icon);
      menuBarTrays.set(extId, tray);
    }

    // Always refresh icon on update (first payload can be incomplete).
    tray.setImage(resolveTrayIcon());

    // Update title: if there's a text title, show it; if only emoji icon, show that
    if (title) {
      tray.setTitle(title);
    } else if (iconEmoji) {
      tray.setTitle(iconEmoji);
    } else if (!iconPath) {
      // Keep tray visible even when extension provides neither icon nor title.
      tray.setTitle('⏱');
    } else {
      tray.setTitle('');
    }
    if (tooltip) tray.setToolTip(tooltip);

    // Build native menu from serialized items
    const menuTemplate = buildMenuBarTemplate(items, extId);
    const menu = Menu.buildFromTemplate(menuTemplate);
    tray.setContextMenu(menu);
  });

  ipcMain.on('menubar-remove', (_event: any, data: any) => {
    const extId = String(data?.extId || '').trim();
    if (!extId) return;
    const tray = menuBarTrays.get(extId);
    if (!tray) return;
    try {
      tray.destroy();
    } catch {}
    menuBarTrays.delete(extId);
  });

  // Route native menu clicks back to the renderer
  function buildMenuBarTemplate(items: any[], extId: string): any[] {
    const resolveMenuItemIcon = (item: any) => {
      const iconPath = typeof item?.iconPath === 'string' ? item.iconPath : '';
      if (!iconPath) return undefined;
      try {
        const fs = require('fs');
        if (!fs.existsSync(iconPath)) return undefined;
        const isSvg = /\.svg$/i.test(iconPath);
        let img: any;
        if (isSvg) {
          const svg = fs.readFileSync(iconPath, 'utf8');
          const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
          img = nativeImage.createFromDataURL(svgDataUrl);
        } else {
          img = nativeImage.createFromPath(iconPath);
        }
        if (!img || img.isEmpty()) return undefined;
        try {
          img.setTemplateImage(false);
        } catch {}
        return img.resize({ width: 16, height: 16 });
      } catch {}
      return undefined;
    };

    const labelWithEmoji = (item: any) => {
      const title = String(item?.title || '');
      const subtitle = String(item?.subtitle || '').trim();
      const text = [title, subtitle].filter(Boolean).join(' ').trim();
      const emoji = typeof item?.iconEmoji === 'string' ? item.iconEmoji.trim() : '';
      if (!emoji || emoji === '•') return text || title;
      if (!text) return emoji;
      return `${emoji} ${text}`;
    };

    const template: any[] = [];
    for (const item of items) {
      switch (item.type) {
        case 'separator':
          template.push({ type: 'separator' as const });
          break;
        case 'label':
          template.push({ label: item.title || '', enabled: false });
          break;
        case 'submenu':
          const submenuIcon = resolveMenuItemIcon(item);
          template.push({
            label: labelWithEmoji(item),
            ...(submenuIcon ? { icon: submenuIcon } : {}),
            submenu: buildMenuBarTemplate(item.children || [], extId),
          });
          break;
        case 'item':
        default:
          const menuItemIcon = resolveMenuItemIcon(item);
          const disabled = Boolean(item?.disabled);
          template.push({
            label: labelWithEmoji(item),
            ...(menuItemIcon ? { icon: menuItemIcon } : {}),
            ...(disabled
              ? { enabled: false }
              : {
                  click: () => {
                    mainWindow?.webContents.send('menubar-item-click', { extId, itemId: item.id });
                  },
                }),
          });
          break;
      }
    }
    return template;
  }

  // ─── Window + Shortcuts ─────────────────────────────────────────

  createWindow();
  registerGlobalShortcut(settings.globalShortcut);
  registerCommandHotkeys(settings.commandHotkeys);

  // Wait for the renderer to finish loading before showing the window.
  // Showing before load completes results in a blank/transparent frame.
  if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', () => {
      void openLauncherFromUserEntry();
    });
  } else {
    void openLauncherFromUserEntry();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      // New window — wait for content to load before showing.
      if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
        mainWindow.webContents.once('did-finish-load', () => {
          void openLauncherFromUserEntry();
        });
        return;
      }
    }
    void openLauncherFromUserEntry();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopWhisperHoldWatcher();
  stopSpeakSession({ resetStatus: false });
  stopClipboardMonitor();
  stopSnippetExpander();
  // Clean up trays
  for (const [, tray] of menuBarTrays) {
    tray.destroy();
  }
  menuBarTrays.clear();
});
