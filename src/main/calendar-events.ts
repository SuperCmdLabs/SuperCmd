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

function normalizeCalendarResult(payload: any): CalendarEventsResult {
  const accessStatus = String(payload?.accessStatus || 'unknown') as CalendarAccessStatus;
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

export async function getCalendarEvents(start: string, end: string): Promise<CalendarEventsResult> {
  if (process.platform !== 'darwin') {
    return {
      granted: false,
      accessStatus: 'unknown',
      events: [],
      error: 'Calendar is currently supported on macOS only.',
    };
  }

  const binaryPath = ensureCalendarEventsBinary();
  if (!binaryPath) {
    return {
      granted: false,
      accessStatus: 'unknown',
      events: [],
      error: 'Calendar helper is unavailable. Reinstall SuperCmd or install Xcode Command Line Tools.',
    };
  }

  return await new Promise<CalendarEventsResult>((resolve) => {
    const proc = spawn(binaryPath, ['--start', start, '--end', end], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finalize = (result: CalendarEventsResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      finalize({
        granted: false,
        accessStatus: 'unknown',
        events: [],
        error: 'Calendar request timed out.',
      });
    }, 15000);

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk || '');
    });

    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk || '');
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      finalize({
        granted: false,
        accessStatus: 'unknown',
        events: [],
        error: error.message || 'Failed to start calendar helper.',
      });
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';

      if (!lastLine) {
        finalize({
          granted: false,
          accessStatus: 'unknown',
          events: [],
          error: stderr.trim() || 'Calendar helper returned no data.',
        });
        return;
      }

      try {
        finalize(normalizeCalendarResult(JSON.parse(lastLine)));
      } catch (error) {
        finalize({
          granted: false,
          accessStatus: 'unknown',
          events: [],
          error:
            stderr.trim() ||
            (error instanceof Error ? error.message : 'Failed to parse calendar helper output.'),
        });
      }
    });
  });
}
