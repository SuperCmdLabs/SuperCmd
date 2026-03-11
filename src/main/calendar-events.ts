import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';

export type CalendarAccessStatus =
  | 'granted'
  | 'write-only'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown';

export interface CalendarAgendaEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  title: string;
  location: string;
  notes: string;
  url: string;
  start: string;
  end: string;
  isAllDay: boolean;
}

export interface CalendarEventsResult {
  granted: boolean;
  accessStatus: CalendarAccessStatus;
  events: CalendarAgendaEvent[];
  error?: string;
}

export interface CalendarPermissionResult {
  granted: boolean;
  accessStatus: CalendarAccessStatus;
  requested: boolean;
  canPrompt: boolean;
  error?: string;
}

function resolvePackagedUnpackedPath(candidatePath: string): string {
  if (!app.isPackaged) return candidatePath;
  if (!candidatePath.includes('app.asar')) return candidatePath;
  const unpackedPath = candidatePath.replace('app.asar', 'app.asar.unpacked');
  try {
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
  } catch {}
  return candidatePath;
}

function getNativeBinaryPath(name: string): string {
  return resolvePackagedUnpackedPath(path.join(__dirname, '..', 'native', name));
}

function ensureCalendarEventsBinary(): string | null {
  const binaryPath = getNativeBinaryPath('calendar-events');
  if (fs.existsSync(binaryPath)) return binaryPath;

  try {
    const sourceCandidates = [
      path.join(app.getAppPath(), 'src', 'native', 'calendar-events.swift'),
      path.join(process.cwd(), 'src', 'native', 'calendar-events.swift'),
      path.join(__dirname, '..', '..', 'src', 'native', 'calendar-events.swift'),
    ];
    const sourcePath = sourceCandidates.find((candidate) => fs.existsSync(candidate));
    if (!sourcePath) return null;
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    execFileSync('swiftc', [
      '-O',
      '-o',
      binaryPath,
      sourcePath,
      '-framework',
      'EventKit',
    ]);
    return binaryPath;
  } catch (error) {
    console.error('Failed to compile calendar-events helper:', error);
    return null;
  }
}

function normalizeCalendarAccessStatus(payload: any): CalendarAccessStatus {
  return String(payload?.accessStatus || 'unknown') as CalendarAccessStatus;
}

function normalizeCalendarResult(payload: any): CalendarEventsResult {
  const accessStatus = normalizeCalendarAccessStatus(payload);
  return {
    granted: Boolean(payload?.granted),
    accessStatus,
    events: Array.isArray(payload?.events)
      ? payload.events
          .map((event: any) => ({
            id: String(event?.id || ''),
            calendarId: String(event?.calendarId || ''),
            calendarName: String(event?.calendarName || ''),
            calendarColor: String(event?.calendarColor || '#8b93a1'),
            title: String(event?.title || 'Untitled Event'),
            location: String(event?.location || ''),
            notes: String(event?.notes || ''),
            url: String(event?.url || ''),
            start: String(event?.start || ''),
            end: String(event?.end || ''),
            isAllDay: Boolean(event?.isAllDay),
          }))
          .filter((event: CalendarAgendaEvent) => event.start && event.end)
      : [],
    error: typeof payload?.error === 'string' && payload.error.trim() ? payload.error.trim() : undefined,
  };
}

function normalizeCalendarPermissionResult(payload: any): CalendarPermissionResult {
  const accessStatus = normalizeCalendarAccessStatus(payload);
  return {
    granted: Boolean(payload?.granted),
    accessStatus,
    requested: Boolean(payload?.requested),
    canPrompt: typeof payload?.canPrompt === 'boolean'
      ? Boolean(payload.canPrompt)
      : accessStatus === 'not-determined' || accessStatus === 'unknown',
    error: typeof payload?.error === 'string' && payload.error.trim() ? payload.error.trim() : undefined,
  };
}

async function runCalendarHelper(args: string[]): Promise<any> {
  const binaryPath = ensureCalendarEventsBinary();
  if (!binaryPath) throw new Error('Calendar helper is unavailable. Reinstall SuperCmd or install Xcode Command Line Tools.');

  return await new Promise<any>((resolve, reject) => {
    const proc = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finalize = (result: any) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      reject(new Error('Calendar request timed out.'));
    }, 15000);

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk || '');
    });

    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk || '');
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(error.message || 'Failed to start calendar helper.'));
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';

      if (!lastLine) {
        reject(new Error(stderr.trim() || 'Calendar helper returned no data.'));
        return;
      }

      try {
        finalize(JSON.parse(lastLine));
      } catch (error) {
        reject(new Error(
          stderr.trim() ||
          (error instanceof Error ? error.message : 'Failed to parse calendar helper output.')
        ));
      }
    });
  });
}

export async function ensureCalendarAccess(prompt = true): Promise<CalendarPermissionResult> {
  if (process.platform !== 'darwin') {
    return {
      granted: false,
      accessStatus: 'unknown',
      requested: false,
      canPrompt: false,
      error: 'Calendar is currently supported on macOS only.',
    };
  }

  try {
    const payload = await runCalendarHelper(prompt ? ['--prompt-only', '--prompt'] : ['--prompt-only']);
    return normalizeCalendarPermissionResult(payload);
  } catch (error) {
    return {
      granted: false,
      accessStatus: 'unknown',
      requested: false,
      canPrompt: false,
      error: error instanceof Error ? error.message : 'Failed to check calendar access.',
    };
  }
}

export async function getCalendarEvents(start: string, end: string): Promise<CalendarEventsResult> {
  if (process.platform !== 'darwin') {
    return {
      granted: false,
      accessStatus: 'unknown',
      events: [],
      error: 'Calendar is currently supported on macOS only.',
    };
  }

  try {
    const payload = await runCalendarHelper(['--start', start, '--end', end, '--prompt']);
    return normalizeCalendarResult(payload);
  } catch (error) {
    return {
      granted: false,
      accessStatus: 'unknown',
      events: [],
      error: error instanceof Error ? error.message : 'Failed to load calendar events.',
    };
  }
}
