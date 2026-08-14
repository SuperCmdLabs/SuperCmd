export type ClipboardTextWriter = (text: string) => void;

/**
 * Preserve completed dictation when macOS cannot inject it into the intended
 * text target. This deliberately writes to the real clipboard rather than the
 * temporary paste clipboard, so the user can recover the transcript.
 */
export function preserveWhisperTranscript(text: string, writeText: ClipboardTextWriter): boolean {
  const transcript = String(text || '');
  if (!transcript) return false;

  try {
    writeText(transcript);
    return true;
  } catch {
    return false;
  }
}
