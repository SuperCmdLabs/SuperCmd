import fs from 'fs';
import path from 'path';

const localesDir = path.resolve('src/renderer/src/i18n/locales');
const baseLocale = 'en';
const strictLocales = new Set((process.env.SUPERCMD_STRICT_LOCALES || 'ko').split(',').map((item) => item.trim()).filter(Boolean));

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function walk(baseNode, localeNode, currentPath, result) {
  const baseKeys = Object.keys(baseNode);
  const localeKeys = isObject(localeNode) ? Object.keys(localeNode) : [];

  for (const key of baseKeys) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    if (!localeNode || !(key in localeNode)) {
      result.missing.push(nextPath);
      continue;
    }
    if (isObject(baseNode[key]) && isObject(localeNode[key])) {
      walk(baseNode[key], localeNode[key], nextPath, result);
    }
  }

  for (const key of localeKeys) {
    if (!(key in baseNode)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      result.extra.push(nextPath);
    }
  }
}

const baseMessages = JSON.parse(fs.readFileSync(path.join(localesDir, `${baseLocale}.json`), 'utf8'));
const localeFiles = fs.readdirSync(localesDir).filter((file) => file.endsWith('.json') && file !== `${baseLocale}.json`);

let hasStrictFailure = false;

for (const file of localeFiles) {
  const locale = file.replace(/\.json$/, '');
  const localeMessages = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
  const result = { missing: [], extra: [] };
  walk(baseMessages, localeMessages, '', result);

  if (result.missing.length === 0 && result.extra.length === 0) {
    console.log(`[i18n] ${locale}: OK`);
    continue;
  }

  const lines = [
    `[i18n] ${locale}: missing=${result.missing.length} extra=${result.extra.length}`,
  ];
  if (result.missing.length > 0) lines.push(`  missing: ${result.missing.slice(0, 12).join(', ')}`);
  if (result.extra.length > 0) lines.push(`  extra: ${result.extra.slice(0, 12).join(', ')}`);

  const message = lines.join('\n');
  if (strictLocales.has(locale)) {
    hasStrictFailure = true;
    console.error(message);
  } else {
    console.warn(message);
  }
}

if (hasStrictFailure) {
  process.exitCode = 1;
} else {
  console.log('[i18n] check complete');
}
