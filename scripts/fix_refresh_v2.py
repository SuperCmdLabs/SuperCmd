#!/usr/bin/env python3
"""
fix_refresh_v2.py — Item 2: Live embedding refresh every 30 minutes.

Adds a background daemon thread that calls _start_vault_indexer() every
30 minutes so new/modified Obsidian notes are picked up without restarting.

Previous fix_refresh.py failed because it searched for a direct call to
_index_vault_files(), which is never called directly — it's always invoked
via threading.Thread(target=_index_vault_files, ...) inside _start_vault_indexer().

This version correctly:
  - Confirms _start_vault_indexer() exists in bridge.py
  - Finds its startup call site (the bare  _start_vault_indexer()  call
    that runs at import/startup time)
  - Inserts the 30-minute background thread immediately after that call
"""
import subprocess, sys

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if '_embed_refresh_thread' in s or 'embed_refresh_loop' in s:
    print('SKIPPED — refresh thread already present')
    sys.exit(0)

# ── Confirm _start_vault_indexer exists ───────────────────────────────────────
if '_start_vault_indexer' not in s:
    print('FAILED — _start_vault_indexer not found in bridge.py')
    # Diagnostic: show any vault/index related functions
    import re
    for m in re.finditer(r'def (_?\w*(vault|index|embed)\w*)\(', s, re.IGNORECASE):
        print(f'  Found: {m.group(0)}')
    sys.exit(1)

print('Found _start_vault_indexer in bridge.py ✓')

# ── Find the startup call site ────────────────────────────────────────────────
# The bare call  _start_vault_indexer()  (not inside a def, not as a Thread target)
# is what runs at startup.  We insert the refresh thread immediately after it.

TARGET = '_start_vault_indexer()'
call_pos = s.find(TARGET)

if call_pos == -1:
    print(f'FAILED — startup call "{TARGET}" not found in bridge.py')
    import re
    for m in re.finditer(r'_start_vault_indexer', s):
        ls = s.rfind('\n', 0, m.start()) + 1
        le = s.find('\n', m.start())
        print(f'  at {m.start()}: {repr(s[ls:le].strip())}')
    sys.exit(1)

# Detect indentation of the call line
line_start = s.rfind('\n', 0, call_pos) + 1
ind_raw    = s[line_start:call_pos]
ind        = ind_raw[:len(ind_raw) - len(ind_raw.lstrip())]
call_line_end = s.find('\n', call_pos) + 1

print(f'Startup call at pos {call_pos}: {repr(s[line_start:call_line_end].strip())}')
print(f'Indentation: {repr(ind)}')

# ── Determine threading import alias ─────────────────────────────────────────
if 'import threading as _threading' in s or '_threading' in s:
    thread_ref = '_threading'
elif 'import threading' in s:
    thread_ref = 'threading'
else:
    thread_ref = '_threading'   # we'll add the import

REFRESH_BLOCK = (
    f'\n{ind}# ── Live vault re-index every 30 minutes ────────────────────────────────\n'
    f'{ind}def _embed_refresh_loop():\n'
    f'{ind}    import time as _tr\n'
    f'{ind}    while True:\n'
    f'{ind}        _tr.sleep(1800)  # 30 minutes\n'
    f'{ind}        try:\n'
    f'{ind}            _start_vault_indexer()\n'
    f'{ind}            print("[memory] Background re-index complete", flush=True)\n'
    f'{ind}        except Exception as _re:\n'
    f'{ind}            print(f"[memory] Re-index error: {{_re}}", flush=True)\n'
    f'{ind}\n'
    f'{ind}_embed_refresh_thread = {thread_ref}.Thread(\n'
    f'{ind}    target=_embed_refresh_loop, daemon=True, name="embed-refresh"\n'
    f'{ind})\n'
    f'{ind}_embed_refresh_thread.start()\n'
    f'{ind}print("[memory] Background refresh thread started (30m interval)", flush=True)\n'
)

if thread_ref == '_threading' and 'import threading as _threading' not in s and '_threading' not in s:
    REFRESH_BLOCK = f'{ind}import threading as _threading\n' + REFRESH_BLOCK

s = s[:call_line_end] + REFRESH_BLOCK + s[call_line_end:]
print('Refresh thread inserted after _start_vault_indexer() startup call ✓')

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — bridge.py updated with 30-minute refresh thread')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
