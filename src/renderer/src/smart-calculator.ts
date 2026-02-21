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
  aliases: string[];
  label: string;
  symbol: string;
  toBase: number; // multiply by this to get to the category base unit
}

interface UnitCategory {
  name: string;
  units: UnitDef[];
}

interface UnitLookupResult {
  category: UnitCategory;
  unit: UnitDef;
}

const UNIT_CATEGORIES: UnitCategory[] = [
  {
    name: 'Length',
    units: [
      { aliases: ['nm', 'nanometer', 'nanometers', 'nanometre', 'nanometres'], label: 'Nanometers', symbol: 'nm', toBase: 1e-9 },
      { aliases: ['um', 'micrometer', 'micrometers', 'micrometre', 'micrometres', 'micron', 'microns'], label: 'Micrometers', symbol: 'um', toBase: 1e-6 },
      { aliases: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'], label: 'Millimeters', symbol: 'mm', toBase: 1e-3 },
      { aliases: ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'], label: 'Centimeters', symbol: 'cm', toBase: 1e-2 },
      { aliases: ['dm', 'decimeter', 'decimeters', 'decimetre', 'decimetres'], label: 'Decimeters', symbol: 'dm', toBase: 1e-1 },
      { aliases: ['m', 'meter', 'meters', 'metre', 'metres'], label: 'Meters', symbol: 'm', toBase: 1 },
      { aliases: ['dam', 'decameter', 'decameters', 'dekameter', 'dekameters'], label: 'Decameters', symbol: 'dam', toBase: 10 },
      { aliases: ['hm', 'hectometer', 'hectometers', 'hectometre', 'hectometres'], label: 'Hectometers', symbol: 'hm', toBase: 100 },
      { aliases: ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'], label: 'Kilometers', symbol: 'km', toBase: 1000 },
      { aliases: ['in', 'inch', 'inches'], label: 'Inches', symbol: 'in', toBase: 0.0254 },
      { aliases: ['ft', 'foot', 'feet'], label: 'Feet', symbol: 'ft', toBase: 0.3048 },
      { aliases: ['yd', 'yard', 'yards'], label: 'Yards', symbol: 'yd', toBase: 0.9144 },
      { aliases: ['mi', 'mile', 'miles'], label: 'Miles', symbol: 'mi', toBase: 1609.344 },
      { aliases: ['nmi', 'nautical mile', 'nautical miles'], label: 'Nautical Miles', symbol: 'nmi', toBase: 1852 },
    ],
  },
  {
    name: 'Area',
    units: [
      { aliases: ['mm2', 'sq mm', 'square millimeter', 'square millimeters', 'square millimetre', 'square millimetres'], label: 'Square Millimeters', symbol: 'mm²', toBase: 1e-6 },
      { aliases: ['cm2', 'sq cm', 'square centimeter', 'square centimeters', 'square centimetre', 'square centimetres'], label: 'Square Centimeters', symbol: 'cm²', toBase: 1e-4 },
      { aliases: ['m2', 'sq m', 'square meter', 'square meters', 'square metre', 'square metres'], label: 'Square Meters', symbol: 'm²', toBase: 1 },
      { aliases: ['ha', 'hectare', 'hectares'], label: 'Hectares', symbol: 'ha', toBase: 10_000 },
      { aliases: ['km2', 'sq km', 'square kilometer', 'square kilometers', 'square kilometre', 'square kilometres'], label: 'Square Kilometers', symbol: 'km²', toBase: 1_000_000 },
      { aliases: ['in2', 'sq in', 'square inch', 'square inches'], label: 'Square Inches', symbol: 'in²', toBase: 0.00064516 },
      { aliases: ['ft2', 'sq ft', 'square foot', 'square feet'], label: 'Square Feet', symbol: 'ft²', toBase: 0.09290304 },
      { aliases: ['yd2', 'sq yd', 'square yard', 'square yards'], label: 'Square Yards', symbol: 'yd²', toBase: 0.83612736 },
      { aliases: ['acre', 'acres'], label: 'Acres', symbol: 'ac', toBase: 4046.8564224 },
      { aliases: ['mi2', 'sq mi', 'square mile', 'square miles'], label: 'Square Miles', symbol: 'mi²', toBase: 2_589_988.110336 },
    ],
  },
  {
    name: 'Volume',
    units: [
      { aliases: ['ul', 'microliter', 'microliters', 'microlitre', 'microlitres'], label: 'Microliters', symbol: 'uL', toBase: 1e-6 },
      { aliases: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'], label: 'Milliliters', symbol: 'mL', toBase: 1e-3 },
      { aliases: ['cl', 'centiliter', 'centiliters', 'centilitre', 'centilitres'], label: 'Centiliters', symbol: 'cL', toBase: 1e-2 },
      { aliases: ['dl', 'deciliter', 'deciliters', 'decilitre', 'decilitres'], label: 'Deciliters', symbol: 'dL', toBase: 1e-1 },
      { aliases: ['l', 'liter', 'liters', 'litre', 'litres'], label: 'Liters', symbol: 'L', toBase: 1 },
      { aliases: ['hl', 'hectoliter', 'hectoliters', 'hectolitre', 'hectolitres'], label: 'Hectoliters', symbol: 'hL', toBase: 100 },
      { aliases: ['m3', 'cu m', 'cubic meter', 'cubic meters', 'cubic metre', 'cubic metres'], label: 'Cubic Meters', symbol: 'm³', toBase: 1000 },
      { aliases: ['cm3', 'cc', 'cu cm', 'cubic centimeter', 'cubic centimeters', 'cubic centimetre', 'cubic centimetres'], label: 'Cubic Centimeters', symbol: 'cm³', toBase: 1e-3 },
      { aliases: ['mm3', 'cu mm', 'cubic millimeter', 'cubic millimeters', 'cubic millimetre', 'cubic millimetres'], label: 'Cubic Millimeters', symbol: 'mm³', toBase: 1e-6 },
      { aliases: ['in3', 'cu in', 'cubic inch', 'cubic inches'], label: 'Cubic Inches', symbol: 'in³', toBase: 0.016387064 },
      { aliases: ['ft3', 'cu ft', 'cubic foot', 'cubic feet'], label: 'Cubic Feet', symbol: 'ft³', toBase: 28.316846592 },
      { aliases: ['gal', 'gallon', 'gallons', 'us gallon', 'us gallons'], label: 'Gallons (US)', symbol: 'gal', toBase: 3.785411784 },
      { aliases: ['qt', 'quart', 'quarts'], label: 'Quarts', symbol: 'qt', toBase: 0.946352946 },
      { aliases: ['pt', 'pint', 'pints'], label: 'Pints', symbol: 'pt', toBase: 0.473176473 },
      { aliases: ['cup', 'cups'], label: 'Cups', symbol: 'cup', toBase: 0.2365882365 },
      { aliases: ['floz', 'fl oz', 'fluid ounce', 'fluid ounces'], label: 'Fluid Ounces', symbol: 'fl oz', toBase: 0.0295735295625 },
      { aliases: ['tbsp', 'tablespoon', 'tablespoons'], label: 'Tablespoons', symbol: 'tbsp', toBase: 0.01478676478125 },
      { aliases: ['tsp', 'teaspoon', 'teaspoons'], label: 'Teaspoons', symbol: 'tsp', toBase: 0.00492892159375 },
    ],
  },
  {
    name: 'Mass',
    units: [
      { aliases: ['ug', 'microgram', 'micrograms'], label: 'Micrograms', symbol: 'ug', toBase: 1e-6 },
      { aliases: ['mg', 'milligram', 'milligrams'], label: 'Milligrams', symbol: 'mg', toBase: 1e-3 },
      { aliases: ['g', 'gram', 'grams'], label: 'Grams', symbol: 'g', toBase: 1 },
      { aliases: ['kg', 'kilogram', 'kilograms'], label: 'Kilograms', symbol: 'kg', toBase: 1000 },
      { aliases: ['t', 'tonne', 'tonnes', 'metric ton', 'metric tons'], label: 'Metric Tonnes', symbol: 't', toBase: 1_000_000 },
      { aliases: ['oz', 'ounce', 'ounces'], label: 'Ounces', symbol: 'oz', toBase: 28.349523125 },
      { aliases: ['lb', 'lbs', 'pound', 'pounds'], label: 'Pounds', symbol: 'lb', toBase: 453.59237 },
      { aliases: ['st', 'stone', 'stones'], label: 'Stones', symbol: 'st', toBase: 6350.29318 },
      { aliases: ['ton', 'tons', 'short ton', 'short tons', 'us ton', 'us tons'], label: 'Short Tons (US)', symbol: 'ton', toBase: 907_184.74 },
      { aliases: ['long ton', 'long tons', 'imperial ton', 'imperial tons'], label: 'Long Tons (Imperial)', symbol: 'LT', toBase: 1_016_046.9088 },
    ],
  },
  {
    name: 'Time',
    units: [
      { aliases: ['ns', 'nanosecond', 'nanoseconds'], label: 'Nanoseconds', symbol: 'ns', toBase: 1e-9 },
      { aliases: ['us', 'microsecond', 'microseconds'], label: 'Microseconds', symbol: 'us', toBase: 1e-6 },
      { aliases: ['ms', 'millisecond', 'milliseconds'], label: 'Milliseconds', symbol: 'ms', toBase: 1e-3 },
      { aliases: ['s', 'sec', 'second', 'seconds'], label: 'Seconds', symbol: 's', toBase: 1 },
      { aliases: ['min', 'minute', 'minutes'], label: 'Minutes', symbol: 'min', toBase: 60 },
      { aliases: ['h', 'hr', 'hour', 'hours'], label: 'Hours', symbol: 'h', toBase: 3600 },
      { aliases: ['day', 'days', 'd'], label: 'Days', symbol: 'day', toBase: 86_400 },
      { aliases: ['week', 'weeks', 'wk'], label: 'Weeks', symbol: 'week', toBase: 604_800 },
      { aliases: ['month', 'months', 'mo'], label: 'Months (avg)', symbol: 'month', toBase: 2_629_800 },
      { aliases: ['year', 'years', 'yr', 'yrs', 'y'], label: 'Years (365.25 days)', symbol: 'yr', toBase: 31_557_600 },
    ],
  },
  {
    name: 'Speed',
    units: [
      { aliases: ['m/s', 'mps', 'meter/second', 'meters/second', 'metre/second', 'metres/second'], label: 'Meters per Second', symbol: 'm/s', toBase: 1 },
      { aliases: ['km/h', 'kmh', 'kph', 'kilometer/hour', 'kilometers/hour', 'kilometre/hour', 'kilometres/hour'], label: 'Kilometers per Hour', symbol: 'km/h', toBase: 0.2777777777777778 },
      { aliases: ['mph', 'mile/hour', 'miles/hour'], label: 'Miles per Hour', symbol: 'mph', toBase: 0.44704 },
      { aliases: ['kt', 'kts', 'knot', 'knots', 'kn'], label: 'Knots', symbol: 'kn', toBase: 0.5144444444444445 },
      { aliases: ['ft/s', 'fps', 'foot/second', 'feet/second'], label: 'Feet per Second', symbol: 'ft/s', toBase: 0.3048 },
    ],
  },
  {
    name: 'Pressure',
    units: [
      { aliases: ['pa', 'pascal', 'pascals'], label: 'Pascals', symbol: 'Pa', toBase: 1 },
      { aliases: ['kpa', 'kilopascal', 'kilopascals'], label: 'Kilopascals', symbol: 'kPa', toBase: 1000 },
      { aliases: ['mpa', 'megapascal', 'megapascals'], label: 'Megapascals', symbol: 'MPa', toBase: 1_000_000 },
      { aliases: ['bar', 'bars'], label: 'Bar', symbol: 'bar', toBase: 100_000 },
      { aliases: ['mbar', 'millibar', 'millibars'], label: 'Millibar', symbol: 'mbar', toBase: 100 },
      { aliases: ['atm', 'atmosphere', 'atmospheres'], label: 'Atmospheres', symbol: 'atm', toBase: 101_325 },
      { aliases: ['psi'], label: 'PSI', symbol: 'psi', toBase: 6894.757293168 },
      { aliases: ['torr', 'mmhg'], label: 'Torr', symbol: 'Torr', toBase: 133.3223684211 },
    ],
  },
  {
    name: 'Energy',
    units: [
      { aliases: ['j', 'joule', 'joules'], label: 'Joules', symbol: 'J', toBase: 1 },
      { aliases: ['kj', 'kilojoule', 'kilojoules'], label: 'Kilojoules', symbol: 'kJ', toBase: 1000 },
      { aliases: ['mj', 'megajoule', 'megajoules'], label: 'Megajoules', symbol: 'MJ', toBase: 1_000_000 },
      { aliases: ['cal', 'calorie', 'calories'], label: 'Calories', symbol: 'cal', toBase: 4.184 },
      { aliases: ['kcal', 'kilocalorie', 'kilocalories'], label: 'Kilocalories', symbol: 'kcal', toBase: 4184 },
      { aliases: ['wh', 'watt hour', 'watt hours'], label: 'Watt-hours', symbol: 'Wh', toBase: 3600 },
      { aliases: ['kwh', 'kilowatt hour', 'kilowatt hours'], label: 'Kilowatt-hours', symbol: 'kWh', toBase: 3_600_000 },
      { aliases: ['btu'], label: 'BTU', symbol: 'BTU', toBase: 1055.05585262 },
      { aliases: ['ev', 'electronvolt', 'electronvolts'], label: 'Electronvolts', symbol: 'eV', toBase: 1.602176634e-19 },
    ],
  },
  {
    name: 'Power',
    units: [
      { aliases: ['w', 'watt', 'watts'], label: 'Watts', symbol: 'W', toBase: 1 },
      { aliases: ['kw', 'kilowatt', 'kilowatts'], label: 'Kilowatts', symbol: 'kW', toBase: 1000 },
      { aliases: ['mw', 'megawatt', 'megawatts'], label: 'Megawatts', symbol: 'MW', toBase: 1_000_000 },
      { aliases: ['gw', 'gigawatt', 'gigawatts'], label: 'Gigawatts', symbol: 'GW', toBase: 1_000_000_000 },
      { aliases: ['hp', 'horsepower'], label: 'Horsepower', symbol: 'hp', toBase: 745.6998715822702 },
    ],
  },
  {
    name: 'Frequency',
    units: [
      { aliases: ['hz', 'hertz'], label: 'Hertz', symbol: 'Hz', toBase: 1 },
      { aliases: ['khz', 'kilohertz'], label: 'Kilohertz', symbol: 'kHz', toBase: 1000 },
      { aliases: ['mhz', 'megahertz'], label: 'Megahertz', symbol: 'MHz', toBase: 1_000_000 },
      { aliases: ['ghz', 'gigahertz'], label: 'Gigahertz', symbol: 'GHz', toBase: 1_000_000_000 },
    ],
  },
  {
    name: 'Data',
    units: [
      { aliases: ['bit', 'bits'], label: 'Bits', symbol: 'bit', toBase: 0.125 },
      { aliases: ['b', 'byte', 'bytes'], label: 'Bytes', symbol: 'B', toBase: 1 },
      { aliases: ['kb', 'kilobyte', 'kilobytes'], label: 'Kilobytes (decimal)', symbol: 'KB', toBase: 1000 },
      { aliases: ['kib', 'kibibyte', 'kibibytes'], label: 'Kibibytes (binary)', symbol: 'KiB', toBase: 1024 },
      { aliases: ['mb', 'megabyte', 'megabytes'], label: 'Megabytes (decimal)', symbol: 'MB', toBase: 1000 ** 2 },
      { aliases: ['mib', 'mebibyte', 'mebibytes'], label: 'Mebibytes (binary)', symbol: 'MiB', toBase: 1024 ** 2 },
      { aliases: ['gb', 'gigabyte', 'gigabytes'], label: 'Gigabytes (decimal)', symbol: 'GB', toBase: 1000 ** 3 },
      { aliases: ['gib', 'gibibyte', 'gibibytes'], label: 'Gibibytes (binary)', symbol: 'GiB', toBase: 1024 ** 3 },
      { aliases: ['tb', 'terabyte', 'terabytes'], label: 'Terabytes (decimal)', symbol: 'TB', toBase: 1000 ** 4 },
      { aliases: ['tib', 'tebibyte', 'tebibytes'], label: 'Tebibytes (binary)', symbol: 'TiB', toBase: 1024 ** 4 },
      { aliases: ['pb', 'petabyte', 'petabytes'], label: 'Petabytes (decimal)', symbol: 'PB', toBase: 1000 ** 5 },
      { aliases: ['pib', 'pebibyte', 'pebibytes'], label: 'Pebibytes (binary)', symbol: 'PiB', toBase: 1024 ** 5 },
    ],
  },
  {
    name: 'Force',
    units: [
      { aliases: ['n', 'newton', 'newtons'], label: 'Newtons', symbol: 'N', toBase: 1 },
      { aliases: ['kilonewton', 'kilonewtons', 'kilo newton', 'kilo newtons'], label: 'Kilonewtons', symbol: 'kN', toBase: 1000 },
      { aliases: ['lbf', 'pound force', 'pound-force'], label: 'Pound-force', symbol: 'lbf', toBase: 4.4482216152605 },
    ],
  },
];

const UNIT_LOOKUP = buildUnitLookup();

// Temperature is special (affine conversion)
type TempKey = 'c' | 'f' | 'k';

const TEMP_LABELS: Record<TempKey, { label: string; symbol: string }> = {
  c: { label: 'Celsius', symbol: '°C' },
  f: { label: 'Fahrenheit', symbol: '°F' },
  k: { label: 'Kelvin', symbol: 'K' },
};

const TEMP_ALIASES: Record<string, TempKey> = {
  c: 'c',
  celsius: 'c',
  centigrade: 'c',
  'deg c': 'c',
  'degree celsius': 'c',
  'degrees celsius': 'c',

  f: 'f',
  fahrenheit: 'f',
  'deg f': 'f',
  'degree fahrenheit': 'f',
  'degrees fahrenheit': 'f',

  k: 'k',
  kelvin: 'k',
  kelvins: 'k',
};

// ─── Monetary definitions (fiat + crypto) ───────────────────────

type MonetaryKind = 'fiat' | 'crypto';

interface MonetaryAsset {
  kind: MonetaryKind;
  code: string;
  label: string;
  symbol: string;
  coingeckoId?: string;
}

interface FiatCurrencyDef {
  code: string;
  label: string;
  symbol: string;
  aliases: string[];
}

interface CryptoCurrencyDef {
  code: string;
  label: string;
  symbol: string;
  coingeckoId: string;
  aliases: string[];
}

const FIAT_CURRENCIES: FiatCurrencyDef[] = [
  { code: 'USD', label: 'US Dollar', symbol: '$', aliases: ['usd', 'us dollar', 'us dollars', 'dollar', 'dollars', '$'] },
  { code: 'EUR', label: 'Euro', symbol: '€', aliases: ['eur', 'euro', 'euros', '€'] },
  { code: 'GBP', label: 'British Pound', symbol: '£', aliases: ['gbp', 'british pound', 'british pounds', 'pound sterling', 'pounds sterling', '£'] },
  { code: 'JPY', label: 'Japanese Yen', symbol: 'JPY', aliases: ['jpy', 'japanese yen', 'yen', 'jp¥'] },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹', aliases: ['inr', 'indian rupee', 'indian rupees', 'rupee', 'rupees', '₹'] },
  { code: 'AUD', label: 'Australian Dollar', symbol: 'A$', aliases: ['aud', 'australian dollar', 'australian dollars', 'a$'] },
  { code: 'CAD', label: 'Canadian Dollar', symbol: 'C$', aliases: ['cad', 'canadian dollar', 'canadian dollars', 'c$'] },
  { code: 'CHF', label: 'Swiss Franc', symbol: 'CHF', aliases: ['chf', 'swiss franc', 'swiss francs'] },
  { code: 'CNY', label: 'Chinese Yuan', symbol: 'CNY', aliases: ['cny', 'chinese yuan', 'yuan', 'renminbi', 'rmb', 'cn¥'] },
  { code: 'HKD', label: 'Hong Kong Dollar', symbol: 'HK$', aliases: ['hkd', 'hong kong dollar', 'hong kong dollars', 'hk$'] },
  { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$', aliases: ['sgd', 'singapore dollar', 'singapore dollars', 's$'] },
  { code: 'SEK', label: 'Swedish Krona', symbol: 'SEK', aliases: ['sek', 'swedish krona'] },
  { code: 'NOK', label: 'Norwegian Krone', symbol: 'NOK', aliases: ['nok', 'norwegian krone'] },
  { code: 'DKK', label: 'Danish Krone', symbol: 'DKK', aliases: ['dkk', 'danish krone'] },
  { code: 'PLN', label: 'Polish Zloty', symbol: 'PLN', aliases: ['pln', 'polish zloty', 'zloty'] },
  { code: 'CZK', label: 'Czech Koruna', symbol: 'CZK', aliases: ['czk', 'czech koruna'] },
  { code: 'HUF', label: 'Hungarian Forint', symbol: 'HUF', aliases: ['huf', 'hungarian forint', 'forint'] },
  { code: 'RON', label: 'Romanian Leu', symbol: 'RON', aliases: ['ron', 'romanian leu'] },
  { code: 'BGN', label: 'Bulgarian Lev', symbol: 'BGN', aliases: ['bgn', 'bulgarian lev'] },
  { code: 'BRL', label: 'Brazilian Real', symbol: 'R$', aliases: ['brl', 'brazilian real', 'r$'] },
  { code: 'MXN', label: 'Mexican Peso', symbol: 'MX$', aliases: ['mxn', 'mexican peso', 'mx$'] },
  { code: 'ZAR', label: 'South African Rand', symbol: 'ZAR', aliases: ['zar', 'south african rand', 'rand'] },
  { code: 'TRY', label: 'Turkish Lira', symbol: '₺', aliases: ['try', 'turkish lira', 'lira', '₺'] },
  { code: 'THB', label: 'Thai Baht', symbol: 'THB', aliases: ['thb', 'thai baht', 'baht'] },
  { code: 'MYR', label: 'Malaysian Ringgit', symbol: 'MYR', aliases: ['myr', 'malaysian ringgit', 'ringgit'] },
  { code: 'IDR', label: 'Indonesian Rupiah', symbol: 'IDR', aliases: ['idr', 'indonesian rupiah', 'rupiah'] },
  { code: 'PHP', label: 'Philippine Peso', symbol: '₱', aliases: ['php', 'philippine peso', 'philippine pesos', '₱'] },
  { code: 'KRW', label: 'South Korean Won', symbol: '₩', aliases: ['krw', 'south korean won', 'korean won', 'won', '₩'] },
  { code: 'ILS', label: 'Israeli New Shekel', symbol: 'ILS', aliases: ['ils', 'israeli shekel', 'new shekel', 'shekel'] },
  { code: 'ISK', label: 'Icelandic Krona', symbol: 'ISK', aliases: ['isk', 'icelandic krona'] },
];

const CRYPTO_CURRENCIES: CryptoCurrencyDef[] = [
  { code: 'BTC', label: 'Bitcoin', symbol: '₿', coingeckoId: 'bitcoin', aliases: ['btc', 'bitcoin', '₿'] },
  { code: 'ETH', label: 'Ethereum', symbol: 'ETH', coingeckoId: 'ethereum', aliases: ['eth', 'ethereum'] },
  { code: 'SOL', label: 'Solana', symbol: 'SOL', coingeckoId: 'solana', aliases: ['sol', 'solana'] },
  { code: 'BNB', label: 'BNB', symbol: 'BNB', coingeckoId: 'binancecoin', aliases: ['bnb', 'binance coin', 'binancecoin'] },
  { code: 'XRP', label: 'XRP', symbol: 'XRP', coingeckoId: 'ripple', aliases: ['xrp', 'ripple'] },
  { code: 'ADA', label: 'Cardano', symbol: 'ADA', coingeckoId: 'cardano', aliases: ['ada', 'cardano'] },
  { code: 'DOGE', label: 'Dogecoin', symbol: 'DOGE', coingeckoId: 'dogecoin', aliases: ['doge', 'dogecoin'] },
  { code: 'DOT', label: 'Polkadot', symbol: 'DOT', coingeckoId: 'polkadot', aliases: ['dot', 'polkadot'] },
  { code: 'LTC', label: 'Litecoin', symbol: 'LTC', coingeckoId: 'litecoin', aliases: ['ltc', 'litecoin'] },
  { code: 'BCH', label: 'Bitcoin Cash', symbol: 'BCH', coingeckoId: 'bitcoin-cash', aliases: ['bch', 'bitcoin cash'] },
  { code: 'LINK', label: 'Chainlink', symbol: 'LINK', coingeckoId: 'chainlink', aliases: ['link', 'chainlink'] },
  { code: 'AVAX', label: 'Avalanche', symbol: 'AVAX', coingeckoId: 'avalanche-2', aliases: ['avax', 'avalanche'] },
  { code: 'TRX', label: 'TRON', symbol: 'TRX', coingeckoId: 'tron', aliases: ['trx', 'tron'] },
  { code: 'TON', label: 'Toncoin', symbol: 'TON', coingeckoId: 'toncoin', aliases: ['ton', 'toncoin'] },
  { code: 'SHIB', label: 'Shiba Inu', symbol: 'SHIB', coingeckoId: 'shiba-inu', aliases: ['shib', 'shiba', 'shiba inu'] },
  { code: 'XLM', label: 'Stellar', symbol: 'XLM', coingeckoId: 'stellar', aliases: ['xlm', 'stellar', 'lumens'] },
  { code: 'UNI', label: 'Uniswap', symbol: 'UNI', coingeckoId: 'uniswap', aliases: ['uni', 'uniswap'] },
  { code: 'NEAR', label: 'NEAR Protocol', symbol: 'NEAR', coingeckoId: 'near', aliases: ['near', 'near protocol'] },
  { code: 'ATOM', label: 'Cosmos', symbol: 'ATOM', coingeckoId: 'cosmos', aliases: ['atom', 'cosmos'] },
  { code: 'ICP', label: 'Internet Computer', symbol: 'ICP', coingeckoId: 'internet-computer', aliases: ['icp', 'internet computer'] },
  { code: 'FIL', label: 'Filecoin', symbol: 'FIL', coingeckoId: 'filecoin', aliases: ['fil', 'filecoin'] },
  { code: 'ETC', label: 'Ethereum Classic', symbol: 'ETC', coingeckoId: 'ethereum-classic', aliases: ['etc', 'ethereum classic'] },
  { code: 'MATIC', label: 'Polygon', symbol: 'MATIC', coingeckoId: 'matic-network', aliases: ['matic', 'polygon'] },
  { code: 'USDT', label: 'Tether', symbol: 'USDT', coingeckoId: 'tether', aliases: ['usdt', 'tether'] },
  { code: 'USDC', label: 'USD Coin', symbol: 'USDC', coingeckoId: 'usd-coin', aliases: ['usdc', 'usd coin'] },
];

const FIAT_ASSETS: MonetaryAsset[] = FIAT_CURRENCIES.map((currency) => ({
  kind: 'fiat',
  code: currency.code,
  label: currency.label,
  symbol: currency.symbol,
}));

const CRYPTO_ASSETS: MonetaryAsset[] = CRYPTO_CURRENCIES.map((currency) => ({
  kind: 'crypto',
  code: currency.code,
  label: currency.label,
  symbol: currency.symbol,
  coingeckoId: currency.coingeckoId,
}));

const FIAT_BY_CODE = new Map(FIAT_ASSETS.map((asset) => [asset.code, asset]));
const CRYPTO_BY_CODE = new Map(CRYPTO_ASSETS.map((asset) => [asset.code, asset]));
const MONETARY_ALIAS_MAP = buildMonetaryAliasMap();

const STABLECOIN_CODES = new Set(['USDT', 'USDC']);

// FX and crypto rate caching
type FxRates = Record<string, number>;

const FX_CACHE_TTL_MS = 30 * 60 * 1000;
const CRYPTO_CACHE_TTL_MS = 60 * 1000;
const HTTP_TIMEOUT_MS = 5000;

const fxRatesCache = new Map<string, { expiresAt: number; rates: FxRates }>();
const fxInFlight = new Map<string, Promise<FxRates | null>>();

const cryptoUsdCache = new Map<string, { expiresAt: number; usdPrice: number }>();
const cryptoInFlight = new Map<string, Promise<number | null>>();

// ─── Parsing helpers ─────────────────────────────────────────────

interface ParsedConversionQuery {
  rawValue: string;
  value: number;
  fromRaw: string;
  toRaw: string;
}

const VALUE_PATTERN = '[+-]?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d*\\.\\d+|\\d+)(?:e[+-]?\\d+)?';
const CONVERSION_QUERY_RE = new RegExp(
  `^(${VALUE_PATTERN})\\s*([\\w°µμ²³/\\s$€£¥₹₿.,-]+?)\\s+(?:to|in|as|=)\\s+([\\w°µμ²³/\\s$€£¥₹₿.,-]+)$`,
  'i'
);
const PREFIX_SYMBOL_QUERY_RE = new RegExp(
  `^([$€£¥₹₿])\\s*(${VALUE_PATTERN})\\s+(?:to|in|as|=)\\s+([\\w°µμ²³/\\s$€£¥₹₿.,-]+)$`,
  'i'
);

function parseConversionQuery(query: string): ParsedConversionQuery | null {
  const trimmed = query.trim().replace(/\?+$/, '').trim();
  if (!trimmed) return null;

  const directMatch = trimmed.match(CONVERSION_QUERY_RE);
  if (directMatch) {
    const rawValue = directMatch[1];
    const value = Number(rawValue.replace(/,/g, ''));
    if (!Number.isFinite(value)) return null;

    return {
      rawValue,
      value,
      fromRaw: directMatch[2].trim(),
      toRaw: directMatch[3].trim(),
    };
  }

  const symbolMatch = trimmed.match(PREFIX_SYMBOL_QUERY_RE);
  if (symbolMatch) {
    const rawValue = symbolMatch[2];
    const value = Number(rawValue.replace(/,/g, ''));
    if (!Number.isFinite(value)) return null;

    return {
      rawValue,
      value,
      fromRaw: symbolMatch[1].trim(),
      toRaw: symbolMatch[3].trim(),
    };
  }

  return null;
}

function normalizeUnitAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[μµ]/g, 'u')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\^2\b/g, '2')
    .replace(/\^3\b/g, '3')
    .replace(/°/g, '')
    .replace(/\bdegrees?\b/g, '')
    .replace(/\bsquare\b/g, 'sq')
    .replace(/\bcubic\b/g, 'cu')
    .replace(/\bper\b/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/[(),]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/([a-z])\s+([23])\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMonetaryAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[(),]/g, ' ')
    .replace(/\./g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTempAlias(value: string): string {
  return normalizeUnitAlias(value)
    .replace(/\bdeg\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildUnitLookup(): Map<string, UnitLookupResult> {
  const lookup = new Map<string, UnitLookupResult>();
  for (const category of UNIT_CATEGORIES) {
    for (const unit of category.units) {
      for (const alias of unit.aliases) {
        const key = normalizeUnitAlias(alias);
        if (!key) continue;
        if (!lookup.has(key)) {
          lookup.set(key, { category, unit });
        }
      }
    }
  }
  return lookup;
}

function buildMonetaryAliasMap(): Map<string, MonetaryAsset> {
  const map = new Map<string, MonetaryAsset>();

  for (const currency of FIAT_CURRENCIES) {
    const asset = FIAT_BY_CODE.get(currency.code);
    if (!asset) continue;

    for (const alias of [currency.code.toLowerCase(), ...currency.aliases]) {
      const key = normalizeMonetaryAlias(alias);
      if (!key) continue;
      if (!map.has(key)) map.set(key, asset);
    }
  }

  for (const currency of CRYPTO_CURRENCIES) {
    const asset = CRYPTO_BY_CODE.get(currency.code);
    if (!asset) continue;

    for (const alias of [currency.code.toLowerCase(), ...currency.aliases]) {
      const key = normalizeMonetaryAlias(alias);
      if (!key) continue;
      if (!map.has(key)) map.set(key, asset);
    }
  }

  return map;
}

function findUnit(name: string): UnitLookupResult | null {
  const key = normalizeUnitAlias(name);
  if (!key) return null;
  return UNIT_LOOKUP.get(key) || null;
}

function resolveTempUnit(name: string): TempKey | null {
  const key = normalizeTempAlias(name);
  return TEMP_ALIASES[key] || null;
}

function resolveMonetaryAsset(name: string): MonetaryAsset | null {
  const normalized = normalizeMonetaryAlias(name);
  if (!normalized) return null;

  const direct = MONETARY_ALIAS_MAP.get(normalized);
  if (direct) return direct;

  const code = name.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length >= 3 && code.length <= 5) {
    const fiat = FIAT_BY_CODE.get(code);
    if (fiat) return fiat;

    const crypto = CRYPTO_BY_CODE.get(code);
    if (crypto) return crypto;
  }

  return null;
}

function convertTemp(value: number, from: TempKey, to: TempKey): number {
  if (from === to) return value;

  let celsius: number;
  if (from === 'c') celsius = value;
  else if (from === 'f') celsius = (value - 32) * (5 / 9);
  else celsius = value - 273.15;

  if (to === 'c') return celsius;
  if (to === 'f') return celsius * (9 / 5) + 32;
  return celsius + 273.15;
}

// ─── Unit conversion ────────────────────────────────────────────

function tryConversion(query: string): CalcResult | null {
  const parsed = parseConversionQuery(query);
  if (!parsed) return null;

  const fromTemp = resolveTempUnit(parsed.fromRaw);
  const toTemp = resolveTempUnit(parsed.toRaw);
  if (fromTemp && toTemp) {
    const result = convertTemp(parsed.value, fromTemp, toTemp);
    return {
      input: `${formatNumber(parsed.value)} ${TEMP_LABELS[fromTemp].symbol}`,
      inputLabel: TEMP_LABELS[fromTemp].label,
      result: `${formatNumber(result)} ${TEMP_LABELS[toTemp].symbol}`,
      resultLabel: TEMP_LABELS[toTemp].label,
    };
  }

  if (fromTemp || toTemp) return null;

  const from = findUnit(parsed.fromRaw);
  const to = findUnit(parsed.toRaw);
  if (!from || !to) return null;
  if (from.category.name !== to.category.name) return null;

  const baseValue = parsed.value * from.unit.toBase;
  const result = baseValue / to.unit.toBase;

  return {
    input: `${formatNumber(parsed.value)} ${from.unit.symbol}`,
    inputLabel: from.unit.label,
    result: `${formatNumber(result)} ${to.unit.symbol}`,
    resultLabel: to.unit.label,
  };
}

// ─── Monetary conversion (live rates) ───────────────────────────

interface FrankfurterResponse {
  rates?: Record<string, number>;
}

type CoinGeckoSimplePriceResponse = Record<string, { usd?: number }>;

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function getFxRates(baseCode: string): Promise<FxRates | null> {
  const base = baseCode.toUpperCase();
  if (!FIAT_BY_CODE.has(base)) return null;

  const now = Date.now();
  const cached = fxRatesCache.get(base);
  if (cached && cached.expiresAt > now) {
    return cached.rates;
  }

  const inflight = fxInFlight.get(base);
  if (inflight) return inflight;

  const request = (async (): Promise<FxRates | null> => {
    const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`;
    const data = await fetchJsonWithTimeout<FrankfurterResponse>(url, HTTP_TIMEOUT_MS);
    if (!data?.rates) return null;

    const rates: FxRates = { ...data.rates, [base]: 1 };
    fxRatesCache.set(base, { expiresAt: now + FX_CACHE_TTL_MS, rates });
    return rates;
  })();

  fxInFlight.set(base, request);
  try {
    return await request;
  } finally {
    fxInFlight.delete(base);
  }
}

async function getFiatRate(fromCode: string, toCode: string): Promise<number | null> {
  const from = fromCode.toUpperCase();
  const to = toCode.toUpperCase();
  if (from === to) return 1;

  const rates = await getFxRates(from);
  if (!rates) return null;

  const rate = rates[to];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

async function getCryptoUsdPrice(code: string): Promise<number | null> {
  const upper = code.toUpperCase();
  const asset = CRYPTO_BY_CODE.get(upper);
  if (!asset?.coingeckoId) return null;

  const now = Date.now();
  const cached = cryptoUsdCache.get(upper);
  if (cached && cached.expiresAt > now) {
    return cached.usdPrice;
  }

  const inflight = cryptoInFlight.get(upper);
  if (inflight) return inflight;

  const request = (async (): Promise<number | null> => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(asset.coingeckoId as string)}&vs_currencies=usd`;
    const data = await fetchJsonWithTimeout<CoinGeckoSimplePriceResponse>(url, HTTP_TIMEOUT_MS);
    const usdPrice = data?.[asset.coingeckoId as string]?.usd;

    if (typeof usdPrice === 'number' && Number.isFinite(usdPrice) && usdPrice > 0) {
      cryptoUsdCache.set(upper, { expiresAt: now + CRYPTO_CACHE_TTL_MS, usdPrice });
      return usdPrice;
    }

    if (STABLECOIN_CODES.has(upper)) return 1;
    return null;
  })();

  cryptoInFlight.set(upper, request);
  try {
    return await request;
  } finally {
    cryptoInFlight.delete(upper);
  }
}

async function getUsdPerUnit(asset: MonetaryAsset): Promise<number | null> {
  if (asset.kind === 'fiat') {
    if (asset.code === 'USD') return 1;
    return getFiatRate(asset.code, 'USD');
  }

  return getCryptoUsdPrice(asset.code);
}

function formatMonetaryAmount(amount: number, asset: MonetaryAsset): string {
  const abs = Math.abs(amount);
  if (asset.kind === 'fiat') {
    const maxFractionDigits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
    return amount.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });
  }

  const maxFractionDigits = abs >= 1 ? 8 : 10;
  return amount.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });
}

async function tryMonetaryConversion(query: string): Promise<CalcResult | null> {
  const parsed = parseConversionQuery(query);
  if (!parsed) return null;

  const from = resolveMonetaryAsset(parsed.fromRaw);
  const to = resolveMonetaryAsset(parsed.toRaw);
  if (!from || !to) return null;

  let converted: number;
  if (from.kind === to.kind && from.code === to.code) {
    converted = parsed.value;
  } else {
    const fromUsd = await getUsdPerUnit(from);
    const toUsd = await getUsdPerUnit(to);
    if (!fromUsd || !toUsd) return null;

    converted = parsed.value * (fromUsd / toUsd);
    if (!Number.isFinite(converted)) return null;
  }

  return {
    input: `${formatMonetaryAmount(parsed.value, from)} ${from.code}`,
    inputLabel: from.kind === 'crypto' ? `${from.label} (Crypto)` : from.label,
    result: `${formatMonetaryAmount(converted, to)} ${to.code}`,
    resultLabel: to.kind === 'crypto' ? `${to.label} (Crypto)` : to.label,
  };
}

// ─── Math expression parser (safe, no eval) ─────────────────────

function tryMathExpression(query: string): CalcResult | null {
  const trimmed = query.trim();
  if (!/\d/.test(trimmed)) return null;
  if (/[a-zA-Z]/.test(trimmed)) return null;
  if (!/[+\-*/%^()]/.test(trimmed)) return null;
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
  if (pos !== expr.length) return null;
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
    if (expr[pos] === '*') pos += 2;
    else pos++;
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
  if (pos < expr.length && expr[pos] === '(') {
    pos++;
    const result = parseAddSub();
    if (pos < expr.length && expr[pos] === ')') pos++;
    return result;
  }

  const start = pos;
  while (pos < expr.length && ((expr[pos] >= '0' && expr[pos] <= '9') || expr[pos] === '.')) {
    pos++;
  }

  if (pos === start) throw new Error('Unexpected character');
  return parseFloat(expr.slice(start, pos));
}

// ─── Formatting ─────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) {
    return n.toLocaleString('en-US');
  }

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

// ─── Main exports ───────────────────────────────────────────────

export function tryCalculate(query: string): CalcResult | null {
  if (!query || query.trim().length < 2) return null;

  const conversion = tryConversion(query);
  if (conversion) return conversion;

  const math = tryMathExpression(query);
  if (math) return math;

  return null;
}

export async function tryCalculateAsync(query: string): Promise<CalcResult | null> {
  if (!query || query.trim().length < 2) return null;

  const local = tryCalculate(query);
  if (local) return local;

  return tryMonetaryConversion(query);
}
