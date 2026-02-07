/**
 * Smart Calculator & Unit Converter
 *
 * Detects math expressions and unit conversions from search queries.
 * Returns a structured result for display in the launcher.
 */

export interface CalcResult {
  input: string;
  inputLabel: string;
  result: string;
  resultLabel: string;
}

// ─── Unit definitions ───────────────────────────────────────────

interface UnitDef {
  names: string[];
  label: string;
  symbol: string;
  toBase: number; // multiply by this to get to base unit
}

interface UnitCategory {
  name: string;
  units: UnitDef[];
}

const UNIT_CATEGORIES: UnitCategory[] = [
  {
    name: 'Length',
    units: [
      { names: ['km', 'kilometer', 'kilometers'], label: 'Kilometers', symbol: 'km', toBase: 1000 },
      { names: ['m', 'meter', 'meters', 'metre', 'metres'], label: 'Meters', symbol: 'm', toBase: 1 },
      { names: ['cm', 'centimeter', 'centimeters'], label: 'Centimeters', symbol: 'cm', toBase: 0.01 },
      { names: ['mm', 'millimeter', 'millimeters'], label: 'Millimeters', symbol: 'mm', toBase: 0.001 },
      { names: ['mi', 'mile', 'miles'], label: 'Miles', symbol: 'mi', toBase: 1609.344 },
      { names: ['ft', 'foot', 'feet'], label: 'Feet', symbol: 'ft', toBase: 0.3048 },
      { names: ['in', 'inch', 'inches'], label: 'Inches', symbol: 'in', toBase: 0.0254 },
      { names: ['yd', 'yard', 'yards'], label: 'Yards', symbol: 'yd', toBase: 0.9144 },
    ],
  },
  {
    name: 'Weight',
    units: [
      { names: ['kg', 'kilogram', 'kilograms'], label: 'Kilograms', symbol: 'kg', toBase: 1000 },
      { names: ['g', 'gram', 'grams'], label: 'Grams', symbol: 'g', toBase: 1 },
      { names: ['mg', 'milligram', 'milligrams'], label: 'Milligrams', symbol: 'mg', toBase: 0.001 },
      { names: ['lb', 'lbs', 'pound', 'pounds'], label: 'Pounds', symbol: 'lb', toBase: 453.592 },
      { names: ['oz', 'ounce', 'ounces'], label: 'Ounces', symbol: 'oz', toBase: 28.3495 },
      { names: ['ton', 'tons', 'tonne', 'tonnes'], label: 'Tonnes', symbol: 't', toBase: 1_000_000 },
    ],
  },
  {
    name: 'Data',
    units: [
      { names: ['b', 'byte', 'bytes'], label: 'Bytes', symbol: 'B', toBase: 1 },
      { names: ['kb', 'kilobyte', 'kilobytes'], label: 'Kilobytes', symbol: 'KB', toBase: 1024 },
      { names: ['mb', 'megabyte', 'megabytes'], label: 'Megabytes', symbol: 'MB', toBase: 1024 ** 2 },
      { names: ['gb', 'gigabyte', 'gigabytes'], label: 'Gigabytes', symbol: 'GB', toBase: 1024 ** 3 },
      { names: ['tb', 'terabyte', 'terabytes'], label: 'Terabytes', symbol: 'TB', toBase: 1024 ** 4 },
      { names: ['pb', 'petabyte', 'petabytes'], label: 'Petabytes', symbol: 'PB', toBase: 1024 ** 5 },
    ],
  },
  {
    name: 'Volume',
    units: [
      { names: ['l', 'liter', 'liters', 'litre', 'litres'], label: 'Liters', symbol: 'L', toBase: 1 },
      { names: ['ml', 'milliliter', 'milliliters'], label: 'Milliliters', symbol: 'mL', toBase: 0.001 },
      { names: ['gal', 'gallon', 'gallons'], label: 'Gallons', symbol: 'gal', toBase: 3.78541 },
      { names: ['qt', 'quart', 'quarts'], label: 'Quarts', symbol: 'qt', toBase: 0.946353 },
      { names: ['pt', 'pint', 'pints'], label: 'Pints', symbol: 'pt', toBase: 0.473176 },
      { names: ['cup', 'cups'], label: 'Cups', symbol: 'cup', toBase: 0.236588 },
      { names: ['floz', 'fl oz'], label: 'Fluid Ounces', symbol: 'fl oz', toBase: 0.0295735 },
    ],
  },
  {
    name: 'Time',
    units: [
      { names: ['ms', 'millisecond', 'milliseconds'], label: 'Milliseconds', symbol: 'ms', toBase: 0.001 },
      { names: ['s', 'sec', 'second', 'seconds'], label: 'Seconds', symbol: 's', toBase: 1 },
      { names: ['min', 'minute', 'minutes'], label: 'Minutes', symbol: 'min', toBase: 60 },
      { names: ['hr', 'hour', 'hours'], label: 'Hours', symbol: 'hr', toBase: 3600 },
      { names: ['day', 'days'], label: 'Days', symbol: 'days', toBase: 86400 },
      { names: ['week', 'weeks'], label: 'Weeks', symbol: 'weeks', toBase: 604800 },
    ],
  },
  {
    name: 'Speed',
    units: [
      { names: ['mph'], label: 'Miles/hour', symbol: 'mph', toBase: 0.44704 },
      { names: ['kmh', 'kph', 'km/h'], label: 'Kilometers/hour', symbol: 'km/h', toBase: 0.277778 },
      { names: ['m/s', 'mps'], label: 'Meters/second', symbol: 'm/s', toBase: 1 },
      { names: ['knot', 'knots', 'kn'], label: 'Knots', symbol: 'kn', toBase: 0.514444 },
    ],
  },
];

// Temperature is special — not linear conversion
const TEMP_UNITS: Record<string, string> = {
  c: 'Celsius', celsius: 'Celsius',
  f: 'Fahrenheit', fahrenheit: 'Fahrenheit',
  k: 'Kelvin', kelvin: 'Kelvin',
};

function findUnit(name: string): { category: UnitCategory; unit: UnitDef } | null {
  const lower = name.toLowerCase();
  for (const cat of UNIT_CATEGORIES) {
    for (const unit of cat.units) {
      if (unit.names.includes(lower)) {
        return { category: cat, unit };
      }
    }
  }
  return null;
}

function convertTemp(value: number, from: string, to: string): number | null {
  const f = from.toLowerCase();
  const t = to.toLowerCase();

  // Normalize to key
  const fromKey = TEMP_UNITS[f] ? f[0] : null;
  const toKey = TEMP_UNITS[t] ? t[0] : null;
  if (!fromKey || !toKey || fromKey === toKey) return null;

  // Convert to Celsius first
  let celsius: number;
  if (fromKey === 'c') celsius = value;
  else if (fromKey === 'f') celsius = (value - 32) * 5 / 9;
  else celsius = value - 273.15; // kelvin

  // Convert from Celsius to target
  if (toKey === 'c') return celsius;
  if (toKey === 'f') return celsius * 9 / 5 + 32;
  return celsius + 273.15; // kelvin
}

// ─── Unit conversion ────────────────────────────────────────────

function tryConversion(query: string): CalcResult | null {
  // Match: "10km to miles", "10 km to miles", "100f to c"
  const match = query.match(/^([\d.,]+)\s*([a-zA-Z°/\s]+?)\s+(?:to|in|as)\s+([a-zA-Z°/\s]+)$/i);
  if (!match) return null;

  const value = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(value)) return null;

  const fromStr = match[2].trim();
  const toStr = match[3].trim();

  // Try temperature first
  if (TEMP_UNITS[fromStr.toLowerCase()] && TEMP_UNITS[toStr.toLowerCase()]) {
    const result = convertTemp(value, fromStr, toStr);
    if (result === null) return null;
    const fromLabel = TEMP_UNITS[fromStr.toLowerCase()];
    const toLabel = TEMP_UNITS[toStr.toLowerCase()];
    const toSymbol = toLabel === 'Celsius' ? '°C' : toLabel === 'Fahrenheit' ? '°F' : 'K';
    return {
      input: `${match[1]}${fromStr}`,
      inputLabel: fromLabel,
      result: `${formatNumber(result)} ${toSymbol}`,
      resultLabel: toLabel,
    };
  }

  // Try regular unit conversion
  const from = findUnit(fromStr);
  const to = findUnit(toStr);
  if (!from || !to) return null;
  if (from.category.name !== to.category.name) return null; // can't convert between categories

  const baseValue = value * from.unit.toBase;
  const result = baseValue / to.unit.toBase;

  return {
    input: `${match[1]} ${from.unit.symbol}`,
    inputLabel: from.unit.label,
    result: `${formatNumber(result)} ${to.unit.symbol}`,
    resultLabel: to.unit.label,
  };
}

// ─── Math expression parser (safe, no eval) ─────────────────────

function tryMathExpression(query: string): CalcResult | null {
  const trimmed = query.trim();
  // Must contain at least one operator and one digit, no letters
  if (!/\d/.test(trimmed)) return null;
  if (/[a-zA-Z]/.test(trimmed)) return null;
  // Must contain an operator (not just a plain number)
  if (!/[+\-*/%^()]/.test(trimmed)) return null;
  // Don't trigger on just negative numbers like "-5"
  if (/^-?\d+\.?\d*$/.test(trimmed)) return null;

  try {
    const result = parseExpression(trimmed);
    if (result === null || !isFinite(result)) return null;

    return {
      input: trimmed,
      inputLabel: 'Expression',
      result: formatNumber(result),
      resultLabel: numberToWords(result),
    };
  } catch {
    return null;
  }
}

// Recursive descent parser
let pos = 0;
let expr = '';

function parseExpression(input: string): number | null {
  expr = input.replace(/\s+/g, '');
  pos = 0;
  const result = parseAddSub();
  if (pos !== expr.length) return null; // unparsed chars
  return result;
}

function parseAddSub(): number {
  let left = parseMulDiv();
  while (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
    const op = expr[pos++];
    const right = parseMulDiv();
    left = op === '+' ? left + right : left - right;
  }
  return left;
}

function parseMulDiv(): number {
  let left = parsePower();
  while (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/' || expr[pos] === '%')) {
    const op = expr[pos++];
    const right = parsePower();
    if (op === '*') left *= right;
    else if (op === '/') left /= right;
    else left %= right;
  }
  return left;
}

function parsePower(): number {
  let base = parseUnary();
  while (pos < expr.length && (expr[pos] === '^' || (expr[pos] === '*' && expr[pos + 1] === '*'))) {
    if (expr[pos] === '*') pos += 2; else pos++;
    const exp = parseUnary();
    base = Math.pow(base, exp);
  }
  return base;
}

function parseUnary(): number {
  if (pos < expr.length && expr[pos] === '-') {
    pos++;
    return -parseUnary();
  }
  if (pos < expr.length && expr[pos] === '+') {
    pos++;
    return parseUnary();
  }
  return parseAtom();
}

function parseAtom(): number {
  // Parentheses
  if (pos < expr.length && expr[pos] === '(') {
    pos++; // skip (
    const result = parseAddSub();
    if (pos < expr.length && expr[pos] === ')') pos++; // skip )
    return result;
  }

  // Number
  const start = pos;
  while (pos < expr.length && (expr[pos] >= '0' && expr[pos] <= '9' || expr[pos] === '.')) {
    pos++;
  }
  if (pos === start) throw new Error('Unexpected character');
  return parseFloat(expr.slice(start, pos));
}

// ─── Formatting ─────────────────────────────────────────────────

function formatNumber(n: number): string {
  // If it's a nice integer, show with commas
  if (Number.isInteger(n) && Math.abs(n) < 1e15) {
    return n.toLocaleString('en-US');
  }
  // Otherwise show reasonable precision
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
  if (abs >= 0.001) return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  return n.toExponential(4);
}

function numberToWords(n: number): string {
  if (!Number.isInteger(n) || Math.abs(n) > 999_999_999_999) return '';

  const abs = Math.abs(n);
  if (abs === 0) return 'Zero';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function chunk(num: number): string {
    if (num === 0) return '';
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + chunk(num % 100) : '');
  }

  const parts: string[] = [];
  const scales = ['', ' Thousand', ' Million', ' Billion'];
  let remaining = abs;
  let i = 0;
  while (remaining > 0) {
    const part = remaining % 1000;
    if (part > 0) parts.unshift(chunk(part) + scales[i]);
    remaining = Math.floor(remaining / 1000);
    i++;
  }

  return (n < 0 ? 'Negative ' : '') + parts.join(' ');
}

// ─── Main export ────────────────────────────────────────────────

export function tryCalculate(query: string): CalcResult | null {
  if (!query || query.trim().length < 2) return null;

  // Try unit conversion first (more specific)
  const conversion = tryConversion(query);
  if (conversion) return conversion;

  // Try math expression
  const math = tryMathExpression(query);
  if (math) return math;

  return null;
}
