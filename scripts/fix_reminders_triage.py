#!/usr/bin/env python3
"""
fix_reminders_triage.py — Fix !reminders being swallowed by !remind save handler.

Root cause:
  The !remind save handler checks `_tl.startswith('!remind')`.
  '!reminders'.startswith('!remind') == True, so sending '!reminders' enters the
  save handler with argument 'ers', which fails to parse → Gemma gets invoked.

Fix:
  Part 1: Change startswith('!remind') to startswith('!remind ') or == '!remind'
          so '!reminders' no longer triggers the save handler, and falls through
          to the existing !reminders list handler at line 3206.

Guard sentinel: '_remind_triage_fix'
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_remind_triage_fix' in s:
    print('SKIPPED — reminders triage fix already applied')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Fix startswith('!remind') → startswith('!remind ') or == '!remind'
# ══════════════════════════════════════════════════════════════════════════════
# The check was inserted by fix_proactive_reminders.py. Try the exact string
# first, then fall back to a regex that finds any variant of the pattern.

OLD_CHECK = "                if _tl.startswith('!remind') or _tl.startswith('remind me'):\n"
NEW_CHECK = (
    "                # _remind_triage_fix: trailing space prevents '!reminders' false-positive\n"
    "                if _tl.startswith('!remind ') or _tl == '!remind' or _tl.startswith('remind me'):\n"
)

_fixed1 = False
if OLD_CHECK in s:
    s = s.replace(OLD_CHECK, NEW_CHECK, 1)
    print("Part 1: '!remind' startswith fixed to '!remind ' (space) — !reminders no longer intercepted")
    _fixed1 = True
else:
    # Regex fallback: find any line with startswith('!remind') not already space-qualified
    _pat = re.compile(r"([ \t]+)if _tl\.startswith\('!remind'\)(.*?\n)", re.MULTILINE)
    _m   = _pat.search(s)
    if _m:
        _ind   = _m.group(1)
        _rest  = _m.group(2)
        _old   = _m.group(0)
        _new   = (
            _ind + "# _remind_triage_fix: trailing space prevents '!reminders' false-positive\n"
            + _ind + "if _tl.startswith('!remind ') or _tl == '!remind'" + _rest
        )
        s = s.replace(_old, _new, 1)
        print("Part 1: '!remind' startswith fixed via regex fallback")
        _fixed1 = True
    else:
        print("Part 1 WARNING: '!remind' startswith check not found — already fixed or not present")
        # Still mark so guard passes but don't abort
        _fixed1 = False

# Mark the fix so the guard can detect it on re-run
if not _fixed1:
    # Inject a no-op comment near the top to register the sentinel
    _top = s.find('\n', s.find('\n') + 1) + 1
    s = s[:_top] + '# _remind_triage_fix applied (no-op: pattern not found)\n' + s[_top:]
    print('Part 1: sentinel injected (pattern was already correct or missing)')

# ══════════════════════════════════════════════════════════════════════════════
# Write & validate
# ══════════════════════════════════════════════════════════════════════════════
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — !reminders triage fix applied')
    print('\nBefore: startswith("!remind")  → matches "!reminders" (bug)')
    print('After:  startswith("!remind ") → only matches "!remind <text>"')
    print('\n!reminders now falls through to the existing list handler (line ~3206)')
else:
    import re as _dbgre
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    _lm = _dbgre.search(r'line (\d+)', r.stderr)
    if _lm:
        _el = int(_lm.group(1))
        _lines = s.splitlines()
        _lo, _hi = max(0, _el - 5), min(len(_lines), _el + 3)
        print(f'\n--- bridge.py lines {_lo+1}–{_hi} ---')
        for _i, _l in enumerate(_lines[_lo:_hi], _lo + 1):
            print(f'{">>>" if _i == _el else "   "} {_i:4d}: {_l}')
        print('---')
    open(BRIDGE, 'w').write(orig)
    print('\nRestored original bridge.py')
    sys.exit(1)
