/**
 * raycast-api/hooks/use-stable-args.ts
 * Purpose: Stable, safe hook dependency signatures for Raycast hook args.
 */

import { useRef } from 'react';

const EMPTY_ARGS: any[] = [];
const signatureCache = new WeakMap<object, string>();

function stringifyArgs(value: any): string {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (_key, nextValue) => {
      if (nextValue && typeof nextValue === 'object') {
        if (seen.has(nextValue)) {
          return '[Circular]';
        }
        seen.add(nextValue);
      }
      return nextValue;
    });
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

export function getStableArgsKey(args: any[] = EMPTY_ARGS): string {
  const cached = signatureCache.get(args);
  if (cached !== undefined) return cached;

  const key = stringifyArgs(args);
  signatureCache.set(args, key);
  return key;
}

export function useStableArgs(args?: any[]): any[] {
  const nextArgs = args ?? EMPTY_ARGS;
  const ref = useRef(nextArgs);
  const prevKey = useRef('');
  const key = getStableArgsKey(nextArgs);

  if (prevKey.current !== key) {
    prevKey.current = key;
    ref.current = nextArgs;
  }

  return ref.current;
}
