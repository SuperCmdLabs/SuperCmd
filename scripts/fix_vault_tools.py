#!/usr/bin/env python3
"""
fix_vault_tools.py — Add Obsidian vault search/read tools to the bridge.

WHAT WE'RE ADDING
=================
Three tools Gemma can call when the user asks about their vault:

  search_vault(query, max_results=15)
    Case-insensitive search across all .md files. Returns matching
    snippets with filenames and surrounding context (2 lines each side).
    One match per file max (to stay within context window).

  read_vault_file(path)
    Read a specific vault file by path relative to vault root.
    Truncated at 8 000 chars for large files.

  list_vault_files(folder="")
    List .md files in the vault or a subfolder, sorted by recency,
    with last-modified date. Cap 150 files.

SYSTEM PROMPT UPDATE (Part 4)
  Appends a one-sentence hint to the system message so Gemma knows to
  USE these tools when answering vault questions.

Guard sentinel: '_vault_tools_fixed'
"""
import pathlib, subprocess, sys, re, tempfile, os

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_vault_tools_fixed' in s:
    print('SKIPPED — vault tools already installed')
    sys.exit(0)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Add vault helper functions before get_calendar_events()
# ══════════════════════════════════════════════════════════════════════════════

VAULT_TOOLS_CODE = r'''
# ── Obsidian vault read tools ─────────────────────────────────────────────────
# _vault_tools_fixed

import pathlib as _pl_vt
import re as _re_vt


def _vault_root_path() -> _pl_vt.Path:
    """Return the Obsidian vault root, using VAULT_DIR if defined in bridge."""
    try:
        return _pl_vt.Path(str(VAULT_DIR))
    except NameError:
        # Fallback: walk common iCloud Obsidian locations
        candidates = [
            _pl_vt.Path.home() / 'Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS',
            _pl_vt.Path.home() / 'Library/Mobile Documents/iCloud~md~obsidian/Documents',
            _pl_vt.Path.home() / 'Documents/LifeOS',
        ]
        for c in candidates:
            if c.exists():
                return c
        return _pl_vt.Path.home() / 'Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS'


def search_vault(query: str, max_results: int = 15) -> str:
    """
    Search all .md files in the Obsidian vault for query (case-insensitive).
    Returns matching snippets with file names and surrounding context.
    One result per file; up to max_results files total.
    """
    vault = _vault_root_path()
    if not vault.exists():
        return f'VAULT ERROR: vault not found at {vault}'

    query_lower = query.lower()
    results = []

    try:
        md_files = sorted(
            vault.rglob('*.md'),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
    except Exception as _e:
        return f'VAULT ERROR listing files: {_e}'

    files_searched = 0
    for f in md_files:
        if len(results) >= max_results:
            break
        files_searched += 1
        try:
            text = f.read_text(encoding='utf-8', errors='ignore')
            lines = text.splitlines()
            rel = str(f.relative_to(vault))
            for i, line in enumerate(lines):
                if query_lower in line.lower():
                    ctx_s = max(0, i - 2)
                    ctx_e = min(len(lines), i + 3)
                    snippet = '\n'.join(lines[ctx_s:ctx_e])
                    results.append(f'### {rel} (line {i + 1})\n{snippet}')
                    break  # one hit per file keeps results concise
        except Exception:
            continue

    if not results:
        return f"VAULT SEARCH: No matches for '{query}' across {files_searched} files"

    header = f"VAULT SEARCH OK: {len(results)} file(s) match '{query}' ({files_searched} searched)\n\n"
    return header + '\n\n---\n\n'.join(results)


def read_vault_file(path: str) -> str:
    """
    Read a specific Obsidian vault file.
    path is relative to vault root (e.g. 'Projects/MyProject.md').
    Truncated at 8 000 chars if the file is very large.
    """
    vault = _vault_root_path()
    safe  = path.lstrip('/')
    target = vault / safe

    # Safety: ensure we stay inside the vault
    try:
        target.resolve().relative_to(vault.resolve())
    except ValueError:
        return 'VAULT ERROR: path escapes vault root'

    if not target.exists():
        return f'VAULT ERROR: not found: {path}'
    if not target.is_file():
        return f'VAULT ERROR: not a file: {path}'

    try:
        content = target.read_text(encoding='utf-8', errors='ignore')
        truncated = ''
        if len(content) > 8000:
            truncated = f'\n\n[truncated — file is {len(content):,} chars; first 8 000 shown]'
            content = content[:8000]
        return f'VAULT FILE OK: {path}\n\n{content}{truncated}'
    except Exception as _e:
        return f'VAULT ERROR reading {path}: {_e}'


def list_vault_files(folder: str = '') -> str:
    """
    List .md files in the vault (or a subfolder), sorted by recency.
    Returns file paths relative to vault root with last-modified date.
    Capped at 150 files.
    """
    import datetime as _dt_vt
    vault = _vault_root_path()
    base  = (vault / folder.lstrip('/')) if folder else vault

    if not base.exists():
        return f'VAULT ERROR: folder not found: {folder or "(vault root)"}'

    try:
        files = sorted(base.rglob('*.md'), key=lambda p: p.stat().st_mtime, reverse=True)
    except Exception as _e:
        return f'VAULT ERROR: {_e}'

    if not files:
        return f'VAULT: No .md files in {folder or "vault root"}'

    cap   = 150
    shown = files[:cap]
    rows  = []
    for f in shown:
        rel   = str(f.relative_to(vault))
        mtime = _dt_vt.datetime.fromtimestamp(f.stat().st_mtime).strftime('%Y-%m-%d')
        rows.append(f'{mtime}  {rel}')

    header = f'VAULT FILES OK: {len(files)} .md files'
    if len(files) > cap:
        header += f' (showing {cap} most recent)'
    return header + '\n' + '\n'.join(rows)

'''

# Insert before get_calendar_events() — same anchor as fix_calendar_write.py
ANCHOR = 'def get_calendar_events(days: int = 7) -> str:'
if ANCHOR in s:
    s = s.replace(ANCHOR, VAULT_TOOLS_CODE + ANCHOR, 1)
    print('Part 1: vault tools inserted before get_calendar_events()')
    applied += 1
else:
    ANCHOR2 = 'def get_calendar_events('
    if ANCHOR2 in s:
        s = s.replace(ANCHOR2, VAULT_TOOLS_CODE + ANCHOR2, 1)
        print('Part 1: vault tools inserted (fallback anchor)')
        applied += 1
    else:
        # Last resort: insert before the calendar write helpers we added earlier
        ANCHOR3 = '# ── Calendar write helpers (AppleScript)'
        if ANCHOR3 in s:
            s = s.replace(ANCHOR3, VAULT_TOOLS_CODE.lstrip('\n') + '\n\n' + ANCHOR3, 1)
            print('Part 1: vault tools inserted before calendar write block')
            applied += 1
        else:
            print('Part 1 FAILED: no insertion anchor found')

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Add tool JSON definitions (same bracket-counting as fix_calendar_write)
# ══════════════════════════════════════════════════════════════════════════════

# Locate the get_calendar tool's outer {"type":"function",...} wrapper
_gc_name_pos = s.find('"name":"get_calendar"')
if _gc_name_pos == -1:
    _gc_name_pos = s.find('"name": "get_calendar"')

if _gc_name_pos != -1:
    # Scan backward for 2nd unmatched { (outer wrapper)
    _containers = 0
    _depth      = 0
    outer_start = _gc_name_pos
    for _ci in range(_gc_name_pos, -1, -1):
        if s[_ci] == '}':
            _depth += 1
        elif s[_ci] == '{':
            if _depth > 0:
                _depth -= 1
            else:
                _containers += 1
                if _containers == 2:
                    outer_start = _ci
                    break

    # Scan forward for matching closing }
    _depth     = 0
    outer_end  = outer_start
    for _ci in range(outer_start, len(s)):
        if s[_ci] == '{':
            _depth += 1
        elif s[_ci] == '}':
            _depth -= 1
            if _depth == 0:
                outer_end = _ci + 1
                break

    old_tool_def = s[outer_start:outer_end]
    print(f'Part 2: get_calendar outer entry ({len(old_tool_def)} chars): {old_tool_def[:60]!r}...')

    new_tool_defs = old_tool_def + ''',
    {"type": "function", "function": {
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
    }},
    {"type": "function", "function": {
        "name": "read_vault_file",
        "description": "Read the full contents of a specific Obsidian vault note by its path (relative to vault root). Use this after search_vault to read a specific file in detail.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to the file relative to vault root, e.g. 'Projects/MyProject.md'"}
            },
            "required": ["path"]
        }
    }},
    {"type": "function", "function": {
        "name": "list_vault_files",
        "description": "List all .md files in the Obsidian vault or a subfolder, sorted by recency with last-modified dates. Use this to explore vault structure before searching.",
        "parameters": {
            "type": "object",
            "properties": {
                "folder": {"type": "string", "description": "Subfolder to list (optional, default is vault root)"}
            },
            "required": []
        }
    }}'''

    s = s.replace(old_tool_def, new_tool_defs, 1)
    print('Part 2: search_vault, read_vault_file, list_vault_files added to tool JSON')
    applied += 1
else:
    print('Part 2 WARNING: get_calendar tool definition not found')
    _ctx = re.search(r'.{0,80}"name"\s*:\s*"get_calendar".{0,150}', s, re.DOTALL)
    if _ctx:
        print(f'  Context: {_ctx.group(0)!r}')

# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Add elif dispatch handlers (indentation-aware, same fix as calendar write)
# ══════════════════════════════════════════════════════════════════════════════

_gc_indent_m = re.search(r'^([ \t]*)elif name == "get_calendar"', s, re.MULTILINE)
if _gc_indent_m:
    _gc_indent    = _gc_indent_m.group(1)
    _body_min_len = len(_gc_indent) + 1
    _gc_disp_m    = re.search(
        re.escape(_gc_indent) + r'elif name == "get_calendar":[^\n]*\n'
        r'(?:[ \t]{' + str(_body_min_len) + r',}[^\n]*\n)*',
        s
    )
else:
    _gc_disp_m = None

if _gc_disp_m:
    old_dispatch = _gc_disp_m.group(0)
    ind          = _gc_indent

    NEW_DISPATCH = old_dispatch + (
        f'{ind}elif name == "search_vault":\n'
        f'{ind}    query       = args.get("query", "")\n'
        f'{ind}    max_results = int(args.get("max_results", 15))\n'
        f'{ind}    if not query:\n'
        f'{ind}        r = "search_vault requires a query"\n'
        f'{ind}    else:\n'
        f'{ind}        r = search_vault(query, max_results=max_results)\n'
        f'{ind}    print(f"[tool] search_vault({{query!r}}) -> {{len(r)}} chars", flush=True)\n'
        f'{ind}elif name == "read_vault_file":\n'
        f'{ind}    path = args.get("path", "")\n'
        f'{ind}    if not path:\n'
        f'{ind}        r = "read_vault_file requires a path"\n'
        f'{ind}    else:\n'
        f'{ind}        r = read_vault_file(path)\n'
        f'{ind}    print(f"[tool] read_vault_file({{path!r}}) -> {{len(r)}} chars", flush=True)\n'
        f'{ind}elif name == "list_vault_files":\n'
        f'{ind}    folder = args.get("folder", "")\n'
        f'{ind}    r = list_vault_files(folder)\n'
        f'{ind}    print(f"[tool] list_vault_files({{folder!r}}) -> {{len(r)}} chars", flush=True)\n'
    )

    s = s.replace(old_dispatch, NEW_DISPATCH, 1)
    print('Part 3: search_vault, read_vault_file, list_vault_files dispatch added')
    applied += 1
else:
    print('Part 3 WARNING: elif name == "get_calendar" not found')
    for i, line in enumerate(s.splitlines(), 1):
        if 'elif name ==' in line:
            print(f'  {i:5d}: {line.rstrip()}')

# ══════════════════════════════════════════════════════════════════════════════
# Part 4: Append vault-awareness hint to the system prompt
#
# Strategy: find the longest single-quoted or double-quoted string assigned
# to `system_msg` and append our hint before its closing quote.
# Fall back to searching for the "role":"system" content field.
# ══════════════════════════════════════════════════════════════════════════════

VAULT_HINT = (
    ' You have access to the user\'s Obsidian vault via search_vault, '
    'read_vault_file, and list_vault_files tools — use them whenever '
    'the user asks about notes, tasks, projects, plans, or journal entries.'
)

_sys_patched = False

# Pattern A: system_msg = "..." or system_msg = f"..."  (possibly multi-line with \n)
_sys_m = re.search(
    r'(system_msg\s*=\s*f?)(""")(.*?)(""")',
    s, re.DOTALL
)
if not _sys_m:
    _sys_m = re.search(
        r"(system_msg\s*=\s*f?)(''')(.*?)(''')",
        s, re.DOTALL
    )
if _sys_m and VAULT_HINT.strip() not in _sys_m.group(3):
    old_block = _sys_m.group(0)
    new_block = _sys_m.group(1) + _sys_m.group(2) + _sys_m.group(3).rstrip() + VAULT_HINT + _sys_m.group(4)
    s = s.replace(old_block, new_block, 1)
    print('Part 4: vault hint appended to system_msg (triple-quote)')
    _sys_patched = True
    applied += 1

# Pattern B: system_msg = "single-line string"
if not _sys_patched:
    _sys_m2 = re.search(r'(system_msg\s*=\s*f?")([^"]+)(")', s)
    if not _sys_m2:
        _sys_m2 = re.search(r"(system_msg\s*=\s*f?')([^']+)(')", s)
    if _sys_m2 and VAULT_HINT.strip() not in _sys_m2.group(2):
        old_block = _sys_m2.group(0)
        new_block = _sys_m2.group(1) + _sys_m2.group(2).rstrip() + VAULT_HINT + _sys_m2.group(3)
        s = s.replace(old_block, new_block, 1)
        print('Part 4: vault hint appended to system_msg (single-line)')
        _sys_patched = True
        applied += 1

# Pattern C: inline "role":"system" content field
if not _sys_patched:
    _sys_m3 = re.search(
        r'("role"\s*:\s*"system"\s*,\s*"content"\s*:\s*f?")([^"]+)(")',
        s
    )
    if _sys_m3 and VAULT_HINT.strip() not in _sys_m3.group(2):
        old_block = _sys_m3.group(0)
        new_block = _sys_m3.group(1) + _sys_m3.group(2).rstrip() + VAULT_HINT + _sys_m3.group(3)
        s = s.replace(old_block, new_block, 1)
        print('Part 4: vault hint appended to inline system content')
        _sys_patched = True
        applied += 1

if not _sys_patched:
    print('Part 4 NOTE: system prompt pattern not found — vault tools work but Gemma '
          'will need to discover them through tool definitions.')
    # Show what system-message-like content exists for manual inspection
    for m in re.finditer(r'system_msg', s):
        ctx = s[max(0, m.start()-10):m.start()+120]
        print(f'  system_msg context: {ctx!r}')
        break

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
print(f'\n✅ Vault tools installed ({applied} change(s))')
print()
print('New tools available to Gemma:')
print('  search_vault(query, max_results=15)')
print('    — searches all .md files, returns snippets with context')
print('  read_vault_file(path)')
print('    — reads a specific note by relative path')
print('  list_vault_files(folder="")')
print('    — lists .md files sorted by recency')
print()
print('Restart bridge:')
print('  launchctl unload ~/Library/LaunchAgents/com.cowork.bridge.plist')
print('  launchctl load ~/Library/LaunchAgents/com.cowork.bridge.plist')
