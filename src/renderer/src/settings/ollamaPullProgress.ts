export type OllamaPullProgressEvent = {
  requestId: string;
  status: string;
  digest: string;
  total: number;
  completed: number;
};

export type OllamaPullDoneEvent = {
  requestId: string;
};

export type OllamaPullErrorEvent = {
  requestId: string;
  error: string;
};

export type OllamaPullProgressState = {
  status: string;
  percent: number;
};

type MaybeCleanup = (() => void) | void;

type OllamaPullEventBridge = {
  onOllamaPullProgress: (callback: (data: OllamaPullProgressEvent) => void) => MaybeCleanup;
  onOllamaPullDone: (callback: (data: OllamaPullDoneEvent) => void) => MaybeCleanup;
  onOllamaPullError: (callback: (data: OllamaPullErrorEvent) => void) => MaybeCleanup;
};

type RegisterOllamaPullListenersOptions = {
  bridge: OllamaPullEventBridge;
  getActiveRequestId: () => string | null;
  getPreferredModel: () => string | undefined;
  clearActivePull: () => void;
  setPullingModel: (modelName: string | null) => void;
  setPullProgress: (progress: OllamaPullProgressState) => void;
  setOllamaError: (error: string | null) => void;
  scheduleErrorClear: () => void;
  refreshOllamaStatus: (preferredModelName?: string) => void;
};

function isActivePullEvent(eventRequestId: string, activeRequestId: string | null): boolean {
  return Boolean(activeRequestId && eventRequestId === activeRequestId);
}

export function toOllamaPullProgressState(data: OllamaPullProgressEvent): OllamaPullProgressState {
  return {
    status: data.status,
    percent: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
  };
}

export function registerOllamaPullListeners({
  bridge,
  clearActivePull,
  getActiveRequestId,
  getPreferredModel,
  refreshOllamaStatus,
  scheduleErrorClear,
  setOllamaError,
  setPullingModel,
  setPullProgress,
}: RegisterOllamaPullListenersOptions): () => void {
  let lastProgress: (OllamaPullProgressState & { requestId: string }) | null = null;

  const cleanupProgress = bridge.onOllamaPullProgress((data) => {
    if (!isActivePullEvent(data.requestId, getActiveRequestId())) return;

    const nextProgress = toOllamaPullProgressState(data);
    if (
      lastProgress?.requestId === data.requestId &&
      lastProgress.status === nextProgress.status &&
      lastProgress.percent === nextProgress.percent
    ) {
      return;
    }

    lastProgress = { ...nextProgress, requestId: data.requestId };
    setPullProgress(nextProgress);
  });

  const cleanupDone = bridge.onOllamaPullDone((data) => {
    if (!isActivePullEvent(data.requestId, getActiveRequestId())) return;

    const preferredModel = getPreferredModel();
    lastProgress = null;
    clearActivePull();
    setPullingModel(null);
    setPullProgress({ status: '', percent: 0 });
    refreshOllamaStatus(preferredModel);
  });

  const cleanupError = bridge.onOllamaPullError((data) => {
    if (!isActivePullEvent(data.requestId, getActiveRequestId())) return;

    lastProgress = null;
    clearActivePull();
    setPullingModel(null);
    setPullProgress({ status: '', percent: 0 });
    setOllamaError(data.error);
    scheduleErrorClear();
  });

  return () => {
    cleanupProgress?.();
    cleanupDone?.();
    cleanupError?.();
  };
}
