export const LOCAL_ASR_HELPER_STATUS_CACHE_TTL_MS = 5_000;

export type LocalAsrHelperStatus = {
  state: string;
};

export type LocalAsrHelperStatusProbeOptions = {
  forceRefresh?: boolean;
};

export type LocalAsrHelperStatusProbeCache<TStatus extends LocalAsrHelperStatus> = {
  getStatus: (options?: LocalAsrHelperStatusProbeOptions) => TStatus;
  rememberStatus: (status: TStatus) => TStatus;
  clear: () => void;
};

type CreateLocalAsrHelperStatusProbeCacheOptions<TStatus extends LocalAsrHelperStatus> = {
  readStatus: () => TStatus;
  ttlMs?: number;
  now?: () => number;
};

export function isCacheableLocalAsrHelperStatus(status: LocalAsrHelperStatus | null | undefined): boolean {
  return status?.state === 'downloaded' || status?.state === 'not-downloaded';
}

export function createLocalAsrHelperStatusProbeCache<TStatus extends LocalAsrHelperStatus>({
  readStatus,
  ttlMs = LOCAL_ASR_HELPER_STATUS_CACHE_TTL_MS,
  now = Date.now,
}: CreateLocalAsrHelperStatusProbeCacheOptions<TStatus>): LocalAsrHelperStatusProbeCache<TStatus> {
  let cachedStatus: TStatus | null = null;
  let cacheExpiresAt = 0;

  function rememberStatus(status: TStatus): TStatus {
    if (isCacheableLocalAsrHelperStatus(status)) {
      cachedStatus = status;
      cacheExpiresAt = now() + ttlMs;
    } else {
      cachedStatus = null;
      cacheExpiresAt = 0;
    }
    return status;
  }

  return {
    getStatus(options = {}) {
      const currentTime = now();
      if (!options.forceRefresh && cachedStatus && currentTime < cacheExpiresAt) {
        return cachedStatus;
      }
      return rememberStatus(readStatus());
    },
    rememberStatus,
    clear() {
      cachedStatus = null;
      cacheExpiresAt = 0;
    },
  };
}
