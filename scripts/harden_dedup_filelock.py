#!/usr/bin/env python3
"""
harden_dedup_filelock.py — Add file locking to the dedup .seen_msgs persistence.

PROBLEM
=======
The current dedup persistence (from fix_persistent_dedup.py) writes to
~/.seen_msgs with a plain open(..., 'a') and then reads it back to cap at 5000
lines. With concurrent message processing (multiple for-loop iterations or
background threads), two paths can interleave:

  Thread A:  open(.seen_msgs, 'a').write(hash_A)   # appends
  Thread B:  open(.seen_msgs, 'a').write(hash_B)   # appends
  Thread A:  read() → 5001 lines → write back [-5000:]  ← loses hash_B
  Thread B:  read() → 5000 lines → no-op           ← stale view

This can:
  1. Drop hashes from the file → dedup bypassed → messages reprocessed
  2. Cap logic writes a partial file if OS buffers aren't flushed

THE FIX
=======
Replace the plain open/write with an fcntl-locked write:
  - Acquire an exclusive advisory lock (fcntl.LOCK_EX) on the file
  - Read current contents under the lock
  - Append new hash
  - Cap if needed
  - Release lock

Also fixes the "dedup bypass on restart" issue: if .seen_msgs is unreadable
at startup, log a clear warning and rename the file (don't silently reset).

Guard sentinel: '_seen_msgs_filelock'
"""
import pathlib, subprocess, sys, re, tempfile, os

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_seen_msgs_filelock' in s:
    print('SKIPPED — dedup file locking already installed')
    sys.exit(0)

if '_SEEN_MSGS_FILE' not in s:
    print('ERROR — persistent dedup not installed; run fix_persistent_dedup.py first')
    sys.exit(1)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Replace _load_seen_msgs() with a hardened version
#   Uses regex to match regardless of exact quote style / whitespace diffs
# ══════════════════════════════════════════════════════════════════════════════

NEW_LOAD = (
    'def _load_seen_msgs():\n'
    '    # _seen_msgs_filelock\n'
    '    try:\n'
    '        if _SEEN_MSGS_FILE.exists():\n'
    '            _raw = _SEEN_MSGS_FILE.read_text(encoding="utf-8", errors="replace")\n'
    '            _hashes = set(h.strip() for h in _raw.splitlines() if h.strip())\n'
    '            print(f"[dedup] Loaded {len(_hashes)} hashes from disk", flush=True)\n'
    '            return _hashes\n'
    '    except Exception as _e:\n'
    '        # Do NOT silently reset — rename corrupt file so it can be inspected\n'
    '        import datetime as _ldt\n'
    '        _ts = _ldt.datetime.now().strftime("%Y%m%d_%H%M%S")\n'
    '        _bad = _SEEN_MSGS_FILE.parent / f".seen_msgs.corrupt.{_ts}"\n'
    '        try:\n'
    '            _SEEN_MSGS_FILE.rename(_bad)\n'
    '            print(f"[dedup] Corrupt .seen_msgs renamed to {_bad.name} — starting fresh", flush=True)\n'
    '        except Exception:\n'
    '            print(f"[dedup] Could not rename corrupt .seen_msgs: {_e} — starting fresh", flush=True)\n'
    '    print("[dedup] Starting with empty dedup set", flush=True)\n'
    '    return set()\n'
)

# Match the entire _load_seen_msgs function body (from def to the final `return set()`)
_fn_pattern = re.compile(
    r'def _load_seen_msgs\(\):.*?    return set\(\)\n',
    re.DOTALL,
)
_fn_match = _fn_pattern.search(s)
if _fn_match:
    old_fn = _fn_match.group(0)
    if '_seen_msgs_filelock' in old_fn:
        print('Part 1: _load_seen_msgs() already hardened')
    else:
        s = s.replace(old_fn, NEW_LOAD, 1)
        print('Part 1: _load_seen_msgs() hardened (regex match)')
        applied += 1
else:
    print('Part 1 WARNING: _load_seen_msgs() not found in bridge.py — skipping')

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Replace the plain append + cap block with an fcntl-locked version
#   Flexible regex match on the key lines regardless of indentation level
# ══════════════════════════════════════════════════════════════════════════════

# Match: try: ... with open(_SEEN_MSGS_FILE, "a") ... except Exception as _sme: ...
_persist_pattern = re.compile(
    r'(?P<ind>[ \t]*)try:\n'
    r'(?P=ind)[ \t]+with open\(_SEEN_MSGS_FILE,\s*["\']a["\']\)[^\n]*:\n'
    r'(?:.*\n)*?'                     # any lines inside
    r'(?P=ind)except Exception as _sme:[^\n]*\n'
    r'(?P=ind)[ \t]+print[^\n]*_sme[^\n]*\n',
    re.MULTILINE,
)

_pm = _persist_pattern.search(s)
if _pm:
    ind = _pm.group('ind')
    OLD_PERSIST = _pm.group(0)

    NEW_PERSIST = (
        f'{ind}try:\n'
        f'{ind}    import fcntl as _fcntl\n'
        f'{ind}    with open(_SEEN_MSGS_FILE, "a+", encoding="utf-8") as _smf:\n'
        f'{ind}        _fcntl.flock(_smf, _fcntl.LOCK_EX)  # exclusive lock\n'
        f'{ind}        try:\n'
        f'{ind}            _smf.write(_msg_hash + "\\n")\n'
        f'{ind}            _smf.flush()\n'
        f'{ind}            # Cap to 5000 lines under the lock\n'
        f'{ind}            _smf.seek(0)\n'
        f'{ind}            _sm_lines = [_l.strip() for _l in _smf.read().splitlines() if _l.strip()]\n'
        f'{ind}            if len(_sm_lines) > 5000:\n'
        f'{ind}                _smf.seek(0)\n'
        f'{ind}                _smf.write("\\n".join(_sm_lines[-5000:]) + "\\n")\n'
        f'{ind}                _smf.truncate()\n'
        f'{ind}                _smf.flush()\n'
        f'{ind}        finally:\n'
        f'{ind}            _fcntl.flock(_smf, _fcntl.LOCK_UN)  # always release\n'
        f'{ind}except ImportError:\n'
        f'{ind}    # fcntl not available — fall back to plain append\n'
        f'{ind}    with open(_SEEN_MSGS_FILE, "a", encoding="utf-8") as _smf:\n'
        f'{ind}        _smf.write(_msg_hash + "\\n")\n'
        f'{ind}except Exception as _sme:\n'
        f'{ind}    print(f"[dedup] Could not persist hash: {{_sme}}", flush=True)\n'
    )

    s = s.replace(OLD_PERSIST, NEW_PERSIST, 1)
    print('Part 2: dedup persist block replaced with fcntl-locked version')
    applied += 1
else:
    print('Part 2 WARNING: persist block not found — file locking not applied')
    print('  Run: grep -n "_SEEN_MSGS_FILE" ~/cowork-bridge/bridge.py | head -20')
    print('  to inspect the dedup structure manually')

# ══════════════════════════════════════════════════════════════════════════════
# Validate & write — only if something actually changed
# ══════════════════════════════════════════════════════════════════════════════

if applied == 0:
    print('\nNo changes made — bridge.py unchanged')
    print('Dedup may already be hardened or have an unexpected structure.')
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
print(f'\n✅ Dedup file locking installed ({applied} change(s))')
print('  - fcntl.LOCK_EX protects concurrent .seen_msgs writes')
print('  - Corrupt .seen_msgs renamed instead of silently reset')
