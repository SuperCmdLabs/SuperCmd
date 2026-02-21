import { describe, expect, it } from 'vitest';
import { tryCalculate } from '../smart-calculator';

describe('smart calculator', () => {
  it('evaluates arithmetic expressions', () => {
    const result = tryCalculate('2+2');
    expect(result).not.toBeNull();
    expect(result?.result).toBe('4');
  });

  it('converts common length units', () => {
    const result = tryCalculate('10 cm to in');
    expect(result).not.toBeNull();
    expect(result?.input).toContain('cm');
    expect(result?.result).toContain('in');
  });

  it('converts temperature units', () => {
    const result = tryCalculate('100 c to f');
    expect(result).not.toBeNull();
    expect(result?.result).toContain('°F');
    expect(result?.result.startsWith('212')).toBe(true);
  });

  it('returns null for non-calculation queries', () => {
    expect(tryCalculate('open chrome')).toBeNull();
  });
});
