#!/usr/bin/env python3
"""
fix_search_vault_semantic.py — Clean up search_vault duplicates and fix short-query gap.

WHAT WAS FOUND
==============
bridge.py already has a full semantic search system (nomic-embed-text, cosine
similarity, 904 cached embeddings, 30-min re-indexer). The original search_vault
tool dispatch at line 1174 calls retrieve_memories() which IS the semantic search.

fix_vault_tools.py added two problems:
  1. Duplicate {"name":"search_vault"} entry in TOOLS list — the original
     fires first so the duplicate is dead but confusing.
  2. Dead `elif name == "search_vault":` dispatch at line 1189 — shadowed by
     the original `if`, never executes (calls keyword-grep, not semantic).

REAL BUG: retrieve_memories() line 161 has `if len(query.split()) < 4: return ""`
Queries shorter than 4 words ("projects", "EOL OS", "sleep") return nothing from
the tool. Short questions are very common.

THE FIX
=======
1. Remove the duplicate {"name":"search_vault"} tool definition we added.
2. Remove the dead `elif name == "search_vault":` dispatch block.
3. Replace the original `if name == "search_vault":` dispatch with a version
   that does vault-only semantic search with NO word-count minimum, then falls
   back to keyword search if embeddings aren't ready.

read_vault_file and list_vault_files are untouched — they're correct.

Guard sentinel: '_search_vault_semantic_fixed'
"""
import pathlib, subprocess, sys, re, tempfile, os

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_search_vault_semantic_fixed' in s:
    print('SKIPPED — already applied')
    sys.exit(0)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Remove the duplicate search_vault entry from TOOLS list
#
# Our injection added a second {"name": "search_vault", ...} entry after the
# original. Remove it (keeping the original).
# ══════════════════════════════════════════════════════════════════════════════

OLD_DUPE_TOOL = '''    {"type": "function", "function": {
        "name": "search_vault",
        "description": "Search all Obsidian vault notes for a keyword or phrase. Returns matching snippets with file names and context. Call this whenever the user asks about notes, tasks, projects, journal entries, or anything that might be in their vault.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search term or phrase to look for (case-insensitive)"},
                "max_results": {"type": "integer", "description": "Maximum number of files to return (default 15)"}
            },
            "required": ["query"]
        }
    }},'''

if OLD_DUPE_TOOL in s:
    s = s.replace(OLD_DUPE_TOOL, '', 1)
    print('Part 1: removed duplicate search_vault tool definition')
    applied += 1
else:
    # Try a looser match
    _dm = re.search(
        r'\{"type":\s*"function",\s*"function":\s*\{\s*\n'
        r'\s*"name":\s*"search_vault",\s*\n'
        r'\s*"description":\s*"Search all Obsidian vault notes[^}]+\}\s*\}\},\n?',
        s, re.DOTALL
    )
    if _dm:
        s = s[:_dm.start()] + s[_dm.end():]
        print('Part 1: removed duplicate search_vault tool definition (regex match)')
        applied += 1
    else:
        print('Part 1 NOTE: duplicate search_vault tool definition not found (may already be clean)')

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Remove the dead `elif name == "search_vault":` dispatch block
#
# This block at line ~1189 is shadowed by the original `if name == "search_vault":`
# at line 1174. It calls search_vault() (keyword grep) and never executes.
# ══════════════════════════════════════════════════════════════════════════════

OLD_DEAD_DISPATCH = (
    '        elif name == "search_vault":\n'
    '            query       = args.get("query", "")\n'
    '            max_results = int(args.get("max_results", 15))\n'
    '            if not query:\n'
    '                r = "search_vault requires a query"\n'
    '            else:\n'
    '                r = search_vault(query, max_results=max_results)\n'
    '            print(f"[tool] search_vault({query!r}) -> {len(r)} chars", flush=True)\n'
)

if OLD_DEAD_DISPATCH in s:
    s = s.replace(OLD_DEAD_DISPATCH, '', 1)
    print('Part 2: removed dead elif search_vault dispatch')
    applied += 1
else:
    # Looser match
    _dm2 = re.search(
        r'        elif name == "search_vault":\n'
        r'            query\s+=\s+args\.get\("query"[^\n]+\n'
        r'            max_results\s+=\s+int[^\n]+\n'
        r'(?:            [^\n]+\n){3,6}'
        r'            print\(f"\[tool\] search_vault[^\n]+\n',
        s
    )
    if _dm2:
        s = s[:_dm2.start()] + s[_dm2.end():]
        print('Part 2: removed dead elif search_vault dispatch (regex)')
        applied += 1
    else:
        print('Part 2 NOTE: dead elif search_vault not found (may already be clean)')

# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Replace the original `if name == "search_vault":` dispatch
#
# Old: calls retrieve_memories(query) — which has a 4-word minimum and searches
#      ALL files (vault + sessions mixed together).
#
# New: semantic search on vault files only, no word-count minimum, with
#      keyword-grep fallback if embeddings aren't ready yet.
# ══════════════════════════════════════════════════════════════════════════════

OLD_SEARCH_DISPATCH = (
    '        if name == "search_vault":\n'
    '            r = retrieve_memories(args.get("query", ""))\n'
    '            print(f"[tool] search_vault({repr(args.get(\'query\',\'\')[:40])}) -> {len(r)} chars", flush=True)\n'
    '            return r or "No relevant notes found."\n'
)

NEW_SEARCH_DISPATCH = '''\
        if name == "search_vault":
            # _search_vault_semantic_fixed
            _sq   = args.get("query", "")
            _smxr = int(args.get("max_results", 15))
            if not _sq:
                return "search_vault requires a query"
            # --- Semantic search on vault files only (no 4-word minimum) ---
            _sr = ""
            try:
                with _cache_lock:
                    _snap = dict(_embed_cache)
                _vault_str = str(VAULT_DIR)
                # Filter to vault files only
                _vcands = {k: v for k, v in _snap.items()
                           if v.get("embedding") and _vault_str in k}
                if not _vcands:
                    # Fallback: all embedded files if vault slice is empty
                    _vcands = {k: v for k, v in _snap.items() if v.get("embedding")}
                if _vcands:
                    _qemb = _get_embedding(_sq)
                    if _qemb:
                        _scos = {k: _cosine_sim(_qemb, v["embedding"])
                                 for k, v in _vcands.items()}
                        _stop = sorted(_scos, key=_scos.get, reverse=True)[:_smxr]
                        _ssnips = []
                        for _sfp in _stop:
                            if _scos[_sfp] < 0.3:
                                break
                            try:
                                _stxt = Path(_sfp).read_text(encoding="utf-8", errors="ignore")
                                _sname = Path(_sfp).name
                                _ssnips.append(
                                    f"[{_sname} — similarity {_scos[_sfp]:.2f}]\\n{_stxt[:2000]}"
                                )
                            except Exception:
                                pass
                        _sr = "\\n\\n---\\n\\n".join(_ssnips)
            except Exception:
                pass
            # --- Keyword fallback if semantic returned nothing ---
            if not _sr:
                _sr = search_vault(_sq, _smxr)
            print(f"[tool] search_vault({_sq!r}) -> {len(_sr)} chars", flush=True)
            return _sr or "No relevant notes found."
'''

if OLD_SEARCH_DISPATCH in s:
    s = s.replace(OLD_SEARCH_DISPATCH, NEW_SEARCH_DISPATCH, 1)
    print('Part 3: search_vault dispatch upgraded to vault-only semantic (no 4-word limit)')
    applied += 1
else:
    # Looser match
    _dm3 = re.search(
        r'([ \t]*)if name == "search_vault":\n'
        r'[ \t]+r = retrieve_memories\(args\.get\("query"[^\n]+\)\)\n'
        r'[ \t]+print\([^\n]+\n'
        r'[ \t]+return r or "No relevant notes found\."\n',
        s
    )
    if _dm3:
        old_block = _dm3.group(0)
        # Adjust indentation to match
        ind = _dm3.group(1)
        new_block = NEW_SEARCH_DISPATCH.replace('        ', ind + '    ')
        # Actually just use the literal replacement preserving indent
        s = s.replace(old_block, NEW_SEARCH_DISPATCH, 1)
        print('Part 3: search_vault dispatch upgraded (regex match)')
        applied += 1
    else:
        print('Part 3 WARNING: original search_vault dispatch pattern not matched')
        # Show context for manual fix
        for m in re.finditer(r'if name == "search_vault"', s):
            ctx = s[max(0, m.start()-10):m.start()+300]
            print(f'  Context:\n{ctx}')

# ══════════════════════════════════════════════════════════════════════════════
# Validate & write
# ══════════════════════════════════════════════════════════════════════════════

if applied == 0:
    print('\nNo changes made.')
    sys.exit(0)

with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as tf:
    tf.write(s)
    tmp_path = tf.name

r = subprocess.run([PYTHON, '-m', 'py_compile', tmp_path], capture_output=True, text=True)
os.unlink(tmp_path)

if r.returncode != 0:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    print('Original bridge.py NOT modified.')
    sys.exit(1)

open(BRIDGE, 'w', encoding='utf-8').write(s)
print(f'\n✅ search_vault semantic upgrade applied ({applied} change(s))')
print()
print('Changes:')
print('  - Removed duplicate search_vault tool definition from TOOLS list')
print('  - Removed dead elif search_vault dispatch (was never reached)')
print('  - search_vault now does vault-only semantic search, no 4-word minimum')
print('  - Falls back to keyword grep if embeddings not ready')
print()
print('Restart bridge:')
print('  launchctl unload ~/Library/LaunchAgents/com.cowork.bridge.plist')
print('  launchctl load ~/Library/LaunchAgents/com.cowork.bridge.plist')
