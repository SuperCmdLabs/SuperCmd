#!/usr/bin/env python3
"""
fix_persistent_dedup.py — Make the message dedup set survive bridge restarts.

Problem: _seen_msg_hashes is an in-memory set that resets on every restart.
When bridge crashes after processing an ERA URL, launchd restarts it and the
same message gets processed again — infinitely.

Fix (3 parts):
  1. Change the _seen_msg_hashes initializer to load from disk at startup:
       ~/.cowork-bridge/.seen_msgs  (one hex hash per line)
  2. After the dedup hash is added to the set, also append it to the file.
  3. Cap the file at 5000 lines (keep newest) to prevent unbounded growth.

The dedup injection in bridge.py looks like:
    _msg_hash = hashlib.md5((text + str(chat_id or '')).encode()).hexdigest()
    if _msg_hash in _seen_msg_hashes:
        print(f"[dedup] Skipping already-processed message: {repr(text[:60])}", flush=True)
        continue
    _seen_msg_hashes.add(_msg_hash)
"""
import subprocess, sys, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if '_SEEN_MSGS_FILE' in s or 'seen_msgs' in s:
    print('SKIPPED — persistent dedup already present')
    sys.exit(0)

if '_seen_msg_hashes' not in s:
    print('FAILED — _seen_msg_hashes not found in bridge.py; run fix_dedup first')
    sys.exit(1)

# ── Part 1: Replace in-memory set init with disk-backed load ──────────────────
# Find:   _seen_msg_hashes = set()
OLD_INIT = '_seen_msg_hashes = set()'
if OLD_INIT not in s:
    print(f'FAILED — "{OLD_INIT}" not found in bridge.py')
    # Show what we have near _seen_msg_hashes
    idx = s.find('_seen_msg_hashes')
    if idx != -1:
        ls = s.rfind('\n', 0, idx) + 1
        le = s.find('\n', idx)
        print(f'  Found: {repr(s[ls:le].strip())}')
    sys.exit(1)

NEW_INIT = '''_SEEN_MSGS_FILE = __import__('pathlib').Path.home() / 'cowork-bridge' / '.seen_msgs'
def _load_seen_msgs():
    try:
        if _SEEN_MSGS_FILE.exists():
            lines = _SEEN_MSGS_FILE.read_text().splitlines()
            return set(h.strip() for h in lines if h.strip())
    except Exception as _e:
        print(f'[dedup] Could not load seen-msgs file: {_e}', flush=True)
    return set()
_seen_msg_hashes = _load_seen_msgs()
print(f'[dedup] Loaded {len(_seen_msg_hashes)} seen message hashes from disk', flush=True)'''

s = s.replace(OLD_INIT, NEW_INIT, 1)
print('Part 1: replaced _seen_msg_hashes = set() with disk-backed loader')

# ── Part 2: After _seen_msg_hashes.add(_msg_hash), persist to disk ────────────
OLD_ADD = '_seen_msg_hashes.add(_msg_hash)'
if OLD_ADD not in s:
    print(f'FAILED — "{OLD_ADD}" not found in bridge.py')
    sys.exit(1)

# Find the line containing the add call and append persistence after it
add_pos = s.find(OLD_ADD)
add_line_end = s.find('\n', add_pos) + 1

# Detect indentation
add_line_start = s.rfind('\n', 0, add_pos) + 1
ind_raw = s[add_line_start:add_pos]
ind = ind_raw[:len(ind_raw) - len(ind_raw.lstrip())]

PERSIST_BLOCK = (
    f'{ind}try:\n'
    f'{ind}    with open(_SEEN_MSGS_FILE, "a") as _smf:\n'
    f'{ind}        _smf.write(_msg_hash + "\\n")\n'
    f'{ind}    # Cap file at 5000 lines (keep newest)\n'
    f'{ind}    _sm_lines = _SEEN_MSGS_FILE.read_text().splitlines()\n'
    f'{ind}    if len(_sm_lines) > 5000:\n'
    f'{ind}        _SEEN_MSGS_FILE.write_text("\\n".join(_sm_lines[-5000:]) + "\\n")\n'
    f'{ind}except Exception as _sme:\n'
    f'{ind}    print(f"[dedup] Could not persist hash: {{_sme}}", flush=True)\n'
)

s = s[:add_line_end] + PERSIST_BLOCK + s[add_line_end:]
print('Part 2: hash persistence block inserted after _seen_msg_hashes.add()')

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — bridge.py updated with persistent dedup')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
