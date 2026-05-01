#!/usr/bin/env node
/**
 * raycast-parity-check.mjs
 *
 * Diffs our `@raycast/api` compatibility shim against the official
 * `@raycast/api` type declarations and emits docs/raycast-parity.md.
 *
 * Source-of-truth: node_modules/@raycast/api/types/index.d.ts
 * Shim:            src/renderer/src/raycast-api/index.tsx
 *
 * Exits 1 when the shim is missing a top-level spec export, or a member
 * of a tracked namespace/class. Extras in the shim are reported but
 * don't fail.
 *
 * Uses the TypeScript Compiler API directly; no extra deps.
 */

import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'node_modules/@raycast/api/types/index.d.ts');
const SHIM_PATH = path.join(ROOT, 'src/renderer/src/raycast-api/index.tsx');
const REPORT_PATH = path.join(ROOT, 'docs/raycast-parity.md');

if (!fs.existsSync(SPEC_PATH)) {
  console.error(`Spec file not found: ${SPEC_PATH}`);
  console.error(`Run \`npm install\` to make @raycast/api types available.`);
  process.exit(2);
}
if (!fs.existsSync(SHIM_PATH)) {
  console.error(`Shim file not found: ${SHIM_PATH}`);
  process.exit(2);
}

const compilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
  strict: false,
  isolatedModules: false,
  resolveJsonModule: true,
  allowJs: false,
  lib: ['ES2020', 'DOM', 'DOM.Iterable'],
};

const program = ts.createProgram([SPEC_PATH, SHIM_PATH], compilerOptions);
const checker = program.getTypeChecker();

const specSF = program.getSourceFile(SPEC_PATH);
const shimSF = program.getSourceFile(SHIM_PATH);

if (!specSF || !shimSF) {
  console.error('Failed to load source files into program.');
  process.exit(2);
}

function getModuleExports(sf) {
  const sym = checker.getSymbolAtLocation(sf);
  const out = new Map();
  if (!sym) return out;
  for (const exp of checker.getExportsOfModule(sym)) {
    out.set(exp.name, exp);
  }
  return out;
}

const specExports = getModuleExports(specSF);
const shimExports = getModuleExports(shimSF);

function symbolKind(sym) {
  if (!sym) return 'unknown';
  // Aliases (re-exports) — follow to the original symbol
  let s = sym;
  if (s.flags & ts.SymbolFlags.Alias) {
    try { s = checker.getAliasedSymbol(s); } catch { /* ignore */ }
  }
  const f = s.flags;
  if (f & ts.SymbolFlags.Class) return 'class';
  if (f & ts.SymbolFlags.RegularEnum || f & ts.SymbolFlags.ConstEnum || f & ts.SymbolFlags.Enum) return 'enum';
  if (f & ts.SymbolFlags.NamespaceModule) return 'namespace';
  if (f & ts.SymbolFlags.ValueModule) return 'namespace';
  if (f & ts.SymbolFlags.Module) return 'namespace';
  if (f & ts.SymbolFlags.Function) return 'function';
  if (f & ts.SymbolFlags.Interface) return 'interface';
  if (f & ts.SymbolFlags.TypeAlias) return 'type';
  if (f & ts.SymbolFlags.Variable) return 'const';
  if (f & ts.SymbolFlags.BlockScopedVariable) return 'const';
  if (f & ts.SymbolFlags.FunctionScopedVariable) return 'const';
  return 'value';
}

// React's FunctionComponent / Component types add static slots that aren't
// part of the public Raycast API. Filter them out so we don't report them
// as gaps.
const REACT_NOISE = new Set([
  'displayName', 'defaultProps', 'propTypes', 'contextTypes', 'childContextTypes',
  'getDerivedStateFromProps', 'getDerivedStateFromError', 'prototype',
  '$$typeof', 'render',
]);

const TS_NOISE = new Set([
  '__@toStringTag', 'Symbol(Symbol.toStringTag)',
]);

function isNoise(name) {
  if (REACT_NOISE.has(name)) return true;
  if (TS_NOISE.has(name)) return true;
  if (name.startsWith('__@')) return true;
  return false;
}

/**
 * Class instance fields/methods that are implementation details, not API.
 * Convention: leading underscore. We filter these from "extras" so the
 * report doesn't bury the real gaps under private state.
 */
function isPrivateImpl(name) {
  return name.startsWith('_');
}

const MAX_LIST_ITEMS = 30;
function capList(items) {
  if (items.length <= MAX_LIST_ITEMS) return items;
  return [...items.slice(0, MAX_LIST_ITEMS), `…and ${items.length - MAX_LIST_ITEMS} more`];
}

/**
 * Collect both runtime properties (via the symbol's resolved type) and
 * namespace/class members (via symbol.exports / symbol.members) for a given
 * exported symbol. Returns a Set<string> of member names.
 */
function getMembers(sym) {
  const names = new Set();
  if (!sym) return names;

  // Follow re-export aliases
  let s = sym;
  if (s.flags & ts.SymbolFlags.Alias) {
    try { s = checker.getAliasedSymbol(s); } catch { /* ignore */ }
  }

  // 1. Runtime type properties — handles `Object.assign(X, {...})` shim
  //    pattern AND `declare const X: ...` spec pattern.
  const decls = s.getDeclarations() || [];
  for (const decl of decls) {
    try {
      const type = checker.getTypeOfSymbolAtLocation(s, decl);
      if (type) {
        for (const prop of type.getProperties()) {
          if (!isNoise(prop.name)) names.add(prop.name);
        }
      }
    } catch { /* ignore */ }
  }

  // 2. Namespace block exports (declare namespace X { export ... })
  if (s.exports) {
    s.exports.forEach((_value, key) => {
      const k = String(key);
      if (k && k !== 'default' && !isNoise(k)) names.add(k);
    });
  }

  // 3. Class members (instance + static via separate iteration)
  if (s.members) {
    s.members.forEach((_value, key) => {
      const k = String(key);
      if (k && !isNoise(k)) names.add(k);
    });
  }

  return names;
}

const specNames = [...specExports.keys()].sort();
const shimNames = [...shimExports.keys()].sort();
const missingTopLevel = specNames.filter(n => !shimExports.has(n));
const extraTopLevel = shimNames.filter(n => !specExports.has(n));

// Symbols where we want a deeper member-level diff. These are the namespaces
// and classes that carry the bulk of the public API surface. Adding a name
// here is cheap; failing here is what catches sub-component drift.
const DEEP_CHECK = [
  'Action', 'ActionPanel', 'Form', 'List', 'Grid', 'Detail', 'MenuBarExtra',
  'AI', 'Toast', 'Alert', 'OAuth', 'Cache', 'Clipboard', 'LocalStorage',
  'Color', 'Image', 'Keyboard', 'WindowManagement', 'BrowserExtension',
  'Tool', 'Icon', 'environment',
];

const memberDiffs = [];
for (const name of DEEP_CHECK) {
  const specSym = specExports.get(name);
  if (!specSym) continue; // not in spec — skip
  const shimSym = shimExports.get(name);
  if (!shimSym) continue; // already counted in missingTopLevel

  const specMembers = getMembers(specSym);
  const shimMembers = getMembers(shimSym);
  const missing = [...specMembers].filter(m => !shimMembers.has(m)).sort();
  const extra = [...shimMembers].filter(m => !specMembers.has(m) && !isPrivateImpl(m)).sort();
  // Heuristic: if the shim type-introspection returned 0 members but spec has
  // many, the shim almost certainly attaches members via runtime mutation
  // (e.g. `attachFormFields(FormComponent)`) that TS can't see at the type
  // level. Flag this so a reader doesn't read "20 missing" as 20 real gaps.
  const introspectionLimited = shimMembers.size === 0 && specMembers.size > 0;
  memberDiffs.push({
    name,
    specCount: specMembers.size,
    shimCount: shimMembers.size,
    missing,
    extra,
    introspectionLimited,
  });
}

// =========================================================================
// Render markdown
// =========================================================================

function readPackageJsonField(field) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@raycast/api/package.json'), 'utf8'));
    return pkg[field];
  } catch {
    return null;
  }
}

const specVersion = readPackageJsonField('version') || 'unknown';
const totalMissing = missingTopLevel.length + memberDiffs.reduce((a, d) => a + d.missing.length, 0);
const namespacesWithGaps = memberDiffs.filter(d => d.missing.length > 0).length;

function fmtSection(title, items, formatItem, emptyMsg) {
  const lines = [`## ${title}`, ''];
  if (items.length === 0) {
    lines.push(emptyMsg);
  } else {
    for (const it of items) lines.push(formatItem(it));
  }
  lines.push('');
  return lines.join('\n');
}

const reportLines = [];
reportLines.push('# Raycast API Parity Report');
reportLines.push('');
reportLines.push(`_Generated by \`scripts/raycast-parity-check.mjs\`._  `);
reportLines.push(`_Spec: \`@raycast/api@${specVersion}\` (\`node_modules/@raycast/api/types/index.d.ts\`)._  `);
reportLines.push(`_Shim: \`src/renderer/src/raycast-api/index.tsx\`._`);
reportLines.push('');
reportLines.push('## Summary');
reportLines.push('');
reportLines.push(`| Metric | Count |`);
reportLines.push(`| --- | --- |`);
reportLines.push(`| Spec top-level exports | ${specNames.length} |`);
reportLines.push(`| Shim top-level exports | ${shimNames.length} |`);
reportLines.push(`| Missing top-level in shim (FAIL) | ${missingTopLevel.length} |`);
reportLines.push(`| Extra top-level in shim (info) | ${extraTopLevel.length} |`);
reportLines.push(`| Namespaces with member gaps (FAIL) | ${namespacesWithGaps} |`);
reportLines.push(`| Total missing (top-level + members) | ${totalMissing} |`);
reportLines.push('');
reportLines.push(fmtSection(
  'Missing Top-Level Exports (FAIL)',
  missingTopLevel,
  n => `- \`${n}\` — *${symbolKind(specExports.get(n))}*`,
  '_None — all top-level spec exports are present in the shim._',
));
reportLines.push('## Member-Level Gaps');
reportLines.push('');
if (memberDiffs.length === 0 || memberDiffs.every(d => d.missing.length === 0 && d.extra.length === 0)) {
  reportLines.push('_None — all tracked namespaces/classes have full member parity._');
  reportLines.push('');
} else {
  for (const d of memberDiffs) {
    if (d.missing.length === 0 && d.extra.length === 0) continue;
    reportLines.push(`### \`${d.name}\``);
    reportLines.push('');
    reportLines.push(`Spec members: **${d.specCount}** · Shim members: **${d.shimCount}**`);
    if (d.introspectionLimited) {
      reportLines.push('');
      reportLines.push('> ⚠️ Shim type-level introspection returned 0 members. The runtime ');
      reportLines.push('> probably attaches members via mutation (e.g. `Object.assign` or ');
      reportLines.push('> `attachX(Component)`) that TS can\'t see at the type level. The ');
      reportLines.push('> "missing" list below is what *spec* exposes — verify against ');
      reportLines.push('> shim runtime behavior, not just types.');
    }
    reportLines.push('');
    if (d.missing.length > 0) {
      reportLines.push('**Missing in shim:**');
      reportLines.push('');
      for (const m of capList(d.missing)) reportLines.push(`- \`${m}\``);
      reportLines.push('');
    }
    if (d.extra.length > 0) {
      reportLines.push('**Extra in shim (informational):**');
      reportLines.push('');
      for (const m of capList(d.extra)) reportLines.push(`- \`${m}\``);
      reportLines.push('');
    }
  }
}

reportLines.push(fmtSection(
  'Extra Top-Level Exports in Shim (informational)',
  extraTopLevel,
  n => `- \`${n}\``,
  '_None._',
));

const report = reportLines.join('\n');

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, report, 'utf8');

console.log(`Parity report → ${path.relative(ROOT, REPORT_PATH)}`);
console.log(`Spec exports:        ${specNames.length}`);
console.log(`Shim exports:        ${shimNames.length}`);
console.log(`Missing top-level:   ${missingTopLevel.length}`);
console.log(`Namespaces w/ gaps:  ${namespacesWithGaps}`);
console.log(`Total missing:       ${totalMissing}`);

if (totalMissing > 0) {
  console.log('');
  console.log('FAIL — see report for details.');
  process.exit(1);
}
process.exit(0);
