#!/usr/bin/env python3
"""
harden_dedup_filelock.py — Add file locking to the dedup .seen_msgs persistence.

The dedup in this bridge is inline in the message loop (not a separate function).
Structure found in bridge.py (lines ~3067-3085):

  # Init (runs once per loop iteration if _seen_msg_hashes not yet in dir()):
  _SEEN_MSGS_FILE = _pldd.Path.home() / "cowork-bridge" / ".seen_msgs"
  try:
      _seen_msg_hashes = (set(_SEEN_MSGS_FILE.read_text().splitlines())
                          if _SEEN_MSGS_FILE.exists() else set())
  except Exception:
      _SEEN_MSGS_FILE = None

  # Persist (after hash added to set):
  if _SEEN_MSGS_FILE:
      try:
          with open(_SEEN_MSGS_FILE, "a") as _smf: _smf.write(_mh + "\\n")
          _sml = _SEEN_MSGS_FILE.read_text().splitlines()
          if len(_sml) > 5000: _SEEN_MSGS_FILE.write_text("\\n".join(_sml[-5000:])+\"\\n\")

THE FIX: Replace the 3-line persist block with an fcntl-locked version.

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
    print('ERROR — _SEEN_MSGS_FILE not found; run fix_persistent_dedup.py first')
    sys.exit(1)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Replace the 3-line compact persist block with fcntl-locked version.
#
# Target pattern (from grep output, ~line 3083):
#   {ind}with open(_SEEN_MSGS_FILE, "a") as _smf: _smf.write(_mh + "\n")
#   {ind}_sml = _SEEN_MSGS_FILE.read_text().splitlines()
#   {ind}if len(_sml) > 5000: _SEEN_MSGS_FILE.write_text("\n".join(_sml[-5000:])+"\n")
# ══════════════════════════════════════════════════════════════════════════════

_persist_pattern = re.compile(
    r'(?P<ind>[ \t]*)with open\(_SEEN_MSGS_FILE,\s*["\']a["\']\) as _smf: _smf\.write\(_mh \+ ["\']\\n["\']\)\n'
    r'(?P=ind)_sml = _SEEN_MSGS_FILE\.read_text\(\)\.splitlines\(\)\n'
    r'(?P=ind)if len\(_sml\) > 5000: _SEEN_MSGS_FILE\.write_text\([^\n]+\n',
)

_pm = _persist_pattern.search(s)
if _pm:
    ind = _pm.group('ind')
    OLD_PERSIST = _pm.group(0)

    NEW_PERSIST = (
        f'{ind}# _seen_msgs_filelock: fcntl-locked atomic write\n'
        f'{ind}try:\n'
        f'{ind}    import fcntl as _fcntl\n'
        f'{ind}    with open(_SEEN_MSGS_FILE, "a+", encoding="utf-8") as _smf:\n'
        f'{ind}        _fcntl.flock(_smf, _fcntl.LOCK_EX)\n'
        f'{ind}        try:\n'
        f'{ind}            _smf.write(_mh + "\\n")\n'
        f'{ind}            _smf.flush()\n'
        f'{ind}            _smf.seek(0)\n'
        f'{ind}            _sml = [_l.strip() for _l in _smf.read().splitlines() if _l.strip()]\n'
        f'{ind}            if len(_sml) > 5000:\n'
        f'{ind}                _smf.seek(0)\n'
        f'{ind}                _smf.write("\\n".join(_sml[-5000:]) + "\\n")\n'
        f'{ind}                _smf.truncate()\n'
        f'{ind}                _smf.flush()\n'
        f'{ind}        finally:\n'
        f'{ind}            _fcntl.flock(_smf, _fcntl.LOCK_UN)\n'
        f'{ind}except ImportError:\n'
        f'{ind}    with open(_SEEN_MSGS_FILE, "a", encoding="utf-8") as _smf:\n'
        f'{ind}        _smf.write(_mh + "\\n")\n'
        f'{ind}except Exception as _sme:\n'
        f'{ind}    print(f"[dedup] persist error: {{_sme}}", flush=True)\n'
    )

    s = s.replace(OLD_PERSIST, NEW_PERSIST, 1)
    print('Part 1: dedup persist block replaced with fcntl-locked version')
    applied += 1
else:
    print('Part 1 WARNING: compact persist block not found')
    # Show what we do have around _SEEN_MSGS_FILE for diagnosis
    for i, line in enumerate(s.splitlines(), 1):
        if '_SEEN_MSGS_FILE' in line and 'open(' in line:
            ctx_lines = s.splitlines()[max(0, i-3):i+4]
            print('  Found _SEEN_MSGS_FILE open() context:')
            for j, cl in enumerate(ctx_lines, max(1, i-2)):
                print(f'    {j:4d}: {cl!r}')
            break

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Harden the init — if reading .seen_msgs fails, rename corrupt file
#         instead of silently setting _SEEN_MSGS_FILE = None
#
# Target pattern (~line 3074):
#   except Exception:
#       _SEEN_MSGS_FILE = None
# ══════════════════════════════════════════════════════════════════════════════

_init_pattern = re.compile(
    r'(?P<ind>[ \t]*)except Exception:\n'
    r'(?P=ind)    _SEEN_MSGS_FILE = None\n'
)

_ip = _init_pattern.search(s)
if _ip:
    ind2 = _ip.group('ind')
    OLD_INIT_ERR = _ip.group(0)
    NEW_INIT_ERR = (
        f'{ind2}except Exception as _dde:\n'
        f'{ind2}    import datetime as _ddt\n'
        f'{ind2}    _dts = _ddt.datetime.now().strftime("%Y%m%d_%H%M%S")\n'
        f'{ind2}    _dbad = (_SEEN_MSGS_FILE.parent / f".seen_msgs.corrupt.{{_dts}}")\n'
        f'{ind2}    try:\n'
        f'{ind2}        _SEEN_MSGS_FILE.rename(_dbad)\n'
        f'{ind2}        print(f"[dedup] Corrupt .seen_msgs renamed to {{_dbad.name}}", flush=True)\n'
        f'{ind2}    except Exception:\n'
        f'{ind2}        pass\n'
        f'{ind2}    _SEEN_MSGS_FILE = None\n'
    )
    s = s.replace(OLD_INIT_ERR, NEW_INIT_ERR, 1)
    print('Part 2: dedup init hardened (corrupt file rename on read error)')
    applied += 1
else:
    print('Part 2 WARNING: init error pattern not found — skipping')

# ══════════════════════════════════════════════════════════════════════════════
# Validate & write
# ══════════════════════════════════════════════════════════════════════════════

if applied == 0:
    print('\nNo changes made — bridge.py unchanged')
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
print('  - Corrupt .seen_msgs renamed instead of silently set to None')
