/**
 * Smart Calculator & Unit Converter — SoulverCore bridge.
 *
 * Delegates all parsing and evaluation to the long-lived SoulverCore Swift
 * helper running in the main process; the renderer just sends a query string
 * and maps the response to CalcResult.
 */

export interface CalcResult {
  kind: 'math' | 'unit' | 'currency' | 'crypto' | 'time' | 'date';
  input: string;
  inputLabel: string;
  result: string;
  resultLabel: string;
}

type SoulverKind = 'math' | 'unit' | 'currency' | 'percentage' | 'date' | 'duration' | 'string' | 'unknown';

const KIND_LABELS: Record<CalcResult['kind'], { input: string; result: string }> = {
  math: { input: 'Expression', result: 'Result' },
  unit: { input: 'From', result: 'To' },
  currency: { input: 'From', result: 'To' },
  crypto: { input: 'From', result: 'To' },
  time: { input: 'From', result: 'To' },
  date: { input: 'Query', result: 'Resolved date' },
};

function mapKind(kind: SoulverKind): CalcResult['kind'] | null {
  switch (kind) {
    case 'math':
    case 'percentage':
      return 'math';
    case 'unit':
      return 'unit';
    case 'currency':
      return 'currency';
    case 'date':
      return 'date';
    case 'duration':
      return 'time';
    default:
      return null;
  }
}

/**
 * Retained to preserve the existing two-call pattern in App.tsx. The synchronous
 * path never produced results in the previous implementation either.
 */
export function tryCalculate(query: string): CalcResult | null {
  void query;
  return null;
}

export async function tryCalculateAsync(query: string): Promise<CalcResult | null> {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return null;

  // Plain decimal numbers and single unhyphenated words are search queries, not math.
  if (/^\d+(\.\d+)?$/.test(trimmed)) return null;
  if (/^[a-zA-Z]+$/.test(trimmed)) return null;

  const api = (globalThis as any)?.electron;
  if (!api?.calculatorEvaluate) return null;

  try {
    const response = await api.calculatorEvaluate(trimmed);
    if (!response || response.error || !response.value) return null;

    const kind = mapKind(response.type as SoulverKind);
    if (!kind) return null;

    const labels = KIND_LABELS[kind];
    return {
      kind,
      input: trimmed,
      inputLabel: labels.input,
      result: response.value,
      resultLabel: labels.result,
    };
  } catch {
    return null;
  }
}
