import type {
  ParakeetModelStatus,
  Qwen3ModelStatus,
  WhisperCppModelStatus,
} from '../../types/electron';

export const AI_MODEL_STATUS_POLL_INTERVAL_MS = 1000;

export type AiModelStatusSnapshot = {
  whisperCpp: WhisperCppModelStatus | null;
  parakeet: ParakeetModelStatus | null;
  qwen3: Qwen3ModelStatus | null;
};

export type AiModelStatusPatch = Partial<AiModelStatusSnapshot>;

export type AiModelStatusFetchers = {
  whisperCpp: () => Promise<WhisperCppModelStatus>;
  parakeet: () => Promise<ParakeetModelStatus>;
  qwen3: () => Promise<Qwen3ModelStatus>;
};

export function createEmptyAiModelStatusSnapshot(): AiModelStatusSnapshot {
  return {
    whisperCpp: null,
    parakeet: null,
    qwen3: null,
  };
}

function sameOptionalString(left?: string, right?: string): boolean {
  return (left || '') === (right || '');
}

export function areWhisperCppModelStatusesEqual(
  left: WhisperCppModelStatus | null,
  right: WhisperCppModelStatus | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.state === right.state
    && left.modelName === right.modelName
    && left.path === right.path
    && left.bytesDownloaded === right.bytesDownloaded
    && left.totalBytes === right.totalBytes
    && sameOptionalString(left.error, right.error);
}

export function areParakeetModelStatusesEqual(
  left: ParakeetModelStatus | null,
  right: ParakeetModelStatus | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.state === right.state
    && left.modelName === right.modelName
    && left.path === right.path
    && left.progress === right.progress
    && sameOptionalString(left.error, right.error);
}

export function areQwen3ModelStatusesEqual(
  left: Qwen3ModelStatus | null,
  right: Qwen3ModelStatus | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.state === right.state
    && left.modelName === right.modelName
    && left.path === right.path
    && left.progress === right.progress
    && sameOptionalString(left.error, right.error);
}

export function areAiModelStatusSnapshotsEqual(
  left: AiModelStatusSnapshot,
  right: AiModelStatusSnapshot
): boolean {
  return areWhisperCppModelStatusesEqual(left.whisperCpp, right.whisperCpp)
    && areParakeetModelStatusesEqual(left.parakeet, right.parakeet)
    && areQwen3ModelStatusesEqual(left.qwen3, right.qwen3);
}

export function applyAiModelStatusPatch(
  current: AiModelStatusSnapshot,
  patch: AiModelStatusPatch
): AiModelStatusSnapshot {
  const next: AiModelStatusSnapshot = {
    whisperCpp: patch.whisperCpp === undefined ? current.whisperCpp : patch.whisperCpp,
    parakeet: patch.parakeet === undefined ? current.parakeet : patch.parakeet,
    qwen3: patch.qwen3 === undefined ? current.qwen3 : patch.qwen3,
  };

  return areAiModelStatusSnapshotsEqual(current, next) ? current : next;
}

export async function fetchAiModelStatusPollPatch(
  fetchers: AiModelStatusFetchers
): Promise<AiModelStatusPatch> {
  const [whisperCpp, parakeet, qwen3] = await Promise.all([
    fetchers.whisperCpp().catch(() => undefined),
    fetchers.parakeet().catch(() => undefined),
    fetchers.qwen3().catch(() => undefined),
  ]);

  return { whisperCpp, parakeet, qwen3 };
}
