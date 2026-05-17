export type BrowserInputResolution = {
  type: 'url' | 'search';
  url: string;
  host: string;
  display: string;
};

const EXPLICIT_SCHEME_RE = /^[a-z][a-z0-9+.\-]*:\/\//i;
const SCHEME_RELATIVE_RE = /^\/\//;
const URL_SAFE_RE = /^[^\s]+$/;
const LOCALHOST_HOST_RE = /^localhost$/i;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_BRACKET_HOST_RE = /^\[[0-9a-f:.]+\]$/i;
const DOMAIN_HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function resolveBrowserInput(rawInput: string): BrowserInputResolution | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;

  const explicit = resolveExplicitUrl(trimmed);
  if (explicit) return explicit;

  if (SCHEME_RELATIVE_RE.test(trimmed)) {
    return resolveExplicitUrl(`https:${trimmed}`, trimmed.replace(/^\/\//, ''));
  }

  if (!URL_SAFE_RE.test(trimmed)) return toSearch(trimmed);
  if (looksLikeFilePath(trimmed)) return toSearch(trimmed);
  if (looksLikeEmail(trimmed)) return toSearch(trimmed);

  const bare = resolveBareUrl(trimmed);
  if (bare) return bare;

  return toSearch(trimmed);
}

export function isBrowserUrlInput(rawInput: string): boolean {
  return resolveBrowserInput(rawInput)?.type === 'url';
}

function resolveExplicitUrl(input: string, displayOverride?: string): BrowserInputResolution | null {
  if (!EXPLICIT_SCHEME_RE.test(input)) return null;
  try {
    const parsed = new URL(input);
    if (!parsed.host) return null;
    return {
      type: 'url',
      url: parsed.toString(),
      host: parsed.host.toLowerCase(),
      display: displayOverride || input.replace(/\/+$/, ''),
    };
  } catch {
    return null;
  }
}

function resolveBareUrl(input: string): BrowserInputResolution | null {
  const rawHostname = getBareHostname(input);
  if (rawHostname && isNumericDottedButNotIpv4(rawHostname)) return null;

  try {
    const parsed = new URL(`https://${input}`);
    if (!isRecognizedBareHost(parsed.hostname, parsed.host)) return null;
    return {
      type: 'url',
      url: parsed.toString(),
      host: parsed.host.toLowerCase(),
      display: input.replace(/\/+$/, ''),
    };
  } catch {
    return null;
  }
}

function isRecognizedBareHost(hostname: string, host: string): boolean {
  const normalizedHostname = String(hostname || '').toLowerCase();
  const normalizedHost = String(host || '').toLowerCase();
  if (LOCALHOST_HOST_RE.test(normalizedHostname)) return true;
  if (IPV6_BRACKET_HOST_RE.test(normalizedHostname) || IPV6_BRACKET_HOST_RE.test(normalizedHost)) return true;
  if (IPV4_RE.test(normalizedHostname)) return isValidIpv4(normalizedHostname);
  if (/^\d+(?:\.\d+)+$/.test(normalizedHostname)) return false;
  return DOMAIN_HOST_RE.test(normalizedHostname);
}

function getBareHostname(input: string): string {
  const authority = input.split(/[/?#]/, 1)[0] || '';
  if (authority.startsWith('[')) {
    const closeIndex = authority.indexOf(']');
    return closeIndex >= 0 ? authority.slice(0, closeIndex + 1).toLowerCase() : authority.toLowerCase();
  }
  return authority.split(':', 1)[0].toLowerCase();
}

function isNumericDottedButNotIpv4(hostname: string): boolean {
  const value = hostname.trim();
  return /^\d+(?:\.\d+)+$/.test(value) && !(IPV4_RE.test(value) && isValidIpv4(value));
}

function isValidIpv4(value: string): boolean {
  return value.split('.').every((part) => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

function looksLikeFilePath(input: string): boolean {
  return input.startsWith('/') ||
    input.startsWith('~/') ||
    input.startsWith('./') ||
    input.startsWith('../');
}

function looksLikeEmail(input: string): boolean {
  const firstPathChar = input.search(/[/?#]/);
  const authority = firstPathChar >= 0 ? input.slice(0, firstPathChar) : input;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(authority);
}

function toSearch(input: string): BrowserInputResolution {
  return {
    type: 'search',
    url: `https://www.google.com/search?q=${encodeURIComponent(input)}`,
    host: '',
    display: input,
  };
}
