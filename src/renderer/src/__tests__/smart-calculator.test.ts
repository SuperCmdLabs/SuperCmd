import { describe, it, expect } from 'vitest';
import { tryCalculate } from '../smart-calculator';

describe('tryCalculate math expressions', () => {
  it('handles operator precedence', () => {
    const result = tryCalculate('2+3*4');
    expect(result?.result).toBe('14');
    expect(result?.resultLabel).toBe('Fourteen');
  });

  it('handles parentheses', () => {
    const result = tryCalculate('(2+3)*4');
    expect(result?.result).toBe('20');
    expect(result?.resultLabel).toBe('Twenty');
  });

  it('handles power operator ^', () => {
    const result = tryCalculate('2^3');
    expect(result?.result).toBe('8');
  });

  it('handles power operator **', () => {
    const result = tryCalculate('2**3');
    expect(result?.result).toBe('8');
  });

  it('handles unary operators', () => {
    expect(tryCalculate('-5+2')?.result).toBe('-3');
    expect(tryCalculate('+5-2')?.result).toBe('3');
  });

  it('returns null for invalid expressions', () => {
    expect(tryCalculate('2+abc')).toBeNull();
    expect(tryCalculate('2+*3')).toBeNull();
  });

  it('formats integers with commas', () => {
    expect(tryCalculate('1000+2000')?.result).toBe('3,000');
  });

  it('formats small decimals with precision', () => {
    const result = tryCalculate('1/3');
    expect(result?.result).toBe('0.33333333');
  });

  it('uses scientific notation for tiny values', () => {
    const result = tryCalculate('1/10000000');
    expect(result?.result).toBe('1.0000e-7');
  });
});

describe('tryCalculate unit conversions', () => {
  it('converts same-category units', () => {
    const kmToMi = tryCalculate('10 km to mi');
    expect(kmToMi?.result).toBe('6.213712 mi');
    expect(kmToMi?.resultLabel).toBe('Miles');

    const gbToMb = tryCalculate('1 gb to mb');
    expect(gbToMb?.result).toBe('1,024 MB');
    expect(gbToMb?.resultLabel).toBe('Megabytes');
  });

  it('rejects cross-category conversions', () => {
    expect(tryCalculate('10 kg to m')).toBeNull();
  });

  it('supports case and spacing flexibility', () => {
    const result = tryCalculate('10 KM   to   miles');
    expect(result?.result).toBe('6.213712 mi');
  });
});

describe('tryCalculate temperature conversions', () => {
  it('converts fahrenheit to celsius', () => {
    const result = tryCalculate('32 f to c');
    expect(result?.result).toBe('0 °C');
    expect(result?.resultLabel).toBe('Celsius');
  });

  it('converts celsius to kelvin', () => {
    const result = tryCalculate('0 c to k');
    expect(result?.result).toBe('273.15 K');
    expect(result?.resultLabel).toBe('Kelvin');
  });

  it('returns null for same-unit temperature conversions', () => {
    expect(tryCalculate('10 c to c')).toBeNull();
  });
});
