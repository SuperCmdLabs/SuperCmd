#!/usr/bin/env python3
"""
fix_calendar_tool_v2.py — Targeted fix for get_calendar_events() hallucination.

WHAT WE KNOW (from fix_calendar_tool.py diagnostic):
  - Line 549:  def get_calendar_events(days: int = 7) -> str:   ← actual tool fn
  - Line 557:  print(f"[calendar] icalBuddy {len(out)} chars...")  ← logs output
  - Line 560:  return "icalBuddy not installed — run: brew install ical-buddy"
  - Line 775:  "name":"get_calendar"                             ← tool definition
  - Line 810:  elif name == "get_calendar":
  - Line 812:  r = get_calendar_events(days)
  - Line 813:  print(f"[tool] get_calendar(days={days})...")

PROBLEM: get_calendar_events() returns "No events found for the next 1 day"
(~34 chars) when there are no events. Gemma interprets this as a connection
failure and hallucinates an apology.

FIX (2 parts):
  1. Prefix all return values from get_calendar_events() with "CALENDAR OK: "
     or "CALENDAR ERROR: " so Gemma can't confuse success-with-no-results
     for a connection failure.

  2. Add a tool_result wrapper at the dispatch site (line 812) that explicitly
     labels the result before it reaches the model.

Guard sentinel: '_calendar_v2_fixed'
"""
import pathlib, subprocess, sys, re, tempfile, os

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_calendar_v2_fixed' in s:
    print('SKIPPED — calendar v2 fix already applied')
    sys.exit(0)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Fix get_calendar_events() return values
#
# The function (line 549) reads icalBuddy output and returns it.
# We need to find its return statements and prefix them.
#
# Strategy: find "def get_calendar_events(" and extract its body up to the
# next top-level def, then replace each return statement.
# ══════════════════════════════════════════════════════════════════════════════

lines = s.splitlines(keepends=True)

# Find the function definition line
fn_def_idx = None
for i, line in enumerate(lines):
    if re.match(r'^def get_calendar_events\b', line):
        fn_def_idx = i
        break

if fn_def_idx is None:
    print('ERROR: def get_calendar_events not found at module level')
    print('Checking for indented version...')
    for i, line in enumerate(lines):
        if 'def get_calendar_events' in line:
            print(f'  Found at line {i+1}: {line.rstrip()}')
    sys.exit(1)

print(f'Found get_calendar_events at line {fn_def_idx + 1}')

# Find the end of the function (next non-indented def/class or EOF)
fn_end_idx = len(lines)
for i in range(fn_def_idx + 1, len(lines)):
    line = lines[i]
    if line and not line[0].isspace() and not line.startswith('#'):
        # Non-indented, non-blank, non-comment → end of function
        fn_end_idx = i
        break

print(f'Function body: lines {fn_def_idx + 1}–{fn_end_idx}')
print('Current function:')
for i in range(fn_def_idx, fn_end_idx):
    print(f'  {fn_def_idx + 1 + (i - fn_def_idx):4d}: {lines[i].rstrip()}')

# Replace return values inside the function body
new_lines = list(lines)
changes_in_fn = 0

for i in range(fn_def_idx, fn_end_idx):
    line = lines[i]
    stripped = line.rstrip()

    # Skip the sentinel marker line if already present
    if '_calendar_v2_fixed' in stripped:
        continue

    # Match: return "some string" or return f"..." or return out or return result
    # We want to wrap string literals that don't already start with CALENDAR
    m = re.match(
        r'^([ \t]+)(return\s+)(f?"[^"]*"|f?\'[^\']*\'|[a-zA-Z_]\w*)\s*$',
        stripped
    )
    if m:
        ind   = m.group(1)
        kw    = m.group(2)   # "return "
        val   = m.group(3)   # the return value expression

        # Skip if already labelled
        if 'CALENDAR OK' in val or 'CALENDAR ERROR' in val:
            continue

        # Determine if this is an error return (string literal containing error keywords)
        is_error = any(w in val.lower() for w in [
            'not installed', 'error', 'failed', 'exception', 'denied',
            'not found', 'timed out', 'timeout', 'access'
        ])

        prefix = 'CALENDAR ERROR: ' if is_error else 'CALENDAR OK: '

        if val.startswith(('f"', "f'")):
            # f-string: insert prefix inside the f-string
            quote_char = val[1]
            inner = val[2:-1]  # strip f" and "
            new_val = f'f"{prefix}{inner}"'
        elif val.startswith(('"', "'")):
            # plain string: insert prefix inside the string
            quote_char = val[0]
            inner = val[1:-1]  # strip quotes
            new_val = f'"{prefix}{inner}"'
        else:
            # variable: wrap with f-string
            new_val = f'f"{prefix}{{_cal_r}}" if (_cal_r := {val}) or True else ""'
            # Simpler: just reassign
            new_lines[i] = (
                f'{ind}_cal_r = {val}\n'
                f'{ind}{kw}("{prefix}" + str(_cal_r))  # _calendar_v2_fixed\n'
            )
            changes_in_fn += 1
            continue

        new_lines[i] = f'{ind}{kw}{new_val}  # _calendar_v2_fixed\n'
        changes_in_fn += 1
        print(f'  Line {i+1}: return {val!r} → return {new_val!r}')

if changes_in_fn:
    print(f'Part 1: {changes_in_fn} return(s) labelled in get_calendar_events()')
    applied += changes_in_fn
else:
    print('Part 1 WARNING: no matching return statements found in get_calendar_events()')
    print('  The function may use a variable return — checking for out/result patterns...')

    # Fallback: look for the icalBuddy output assignment and wrap it
    # e.g.: out = r.stdout.strip(); if not out: return "No events..."
    for i in range(fn_def_idx, fn_end_idx):
        if 'return' in lines[i] and 'icalBuddy' not in lines[i]:
            print(f'  Line {i+1}: {lines[i].rstrip()}')

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Wrap the tool dispatch result (line ~812–813) so even if the function
#         doesn't prefix, the dispatch adds the label.
#
# Target pattern:
#   r = get_calendar_events(days)
#   print(f"[tool] get_calendar(days={days}) -> {len(r)} chars", flush=True)
#
# After:
#   r = get_calendar_events(days)
#   if not r.startswith(('CALENDAR OK', 'CALENDAR ERROR')):
#       r = 'CALENDAR OK: ' + r  # _calendar_v2_fixed
#   print(f"[tool] get_calendar(days={days}) -> {len(r)} chars", flush=True)
# ══════════════════════════════════════════════════════════════════════════════

s_working = ''.join(new_lines)

OLD_DISPATCH = (
    '            r = get_calendar_events(days)\n'
    '            print(f"[tool] get_calendar(days={days}) -> {len(r)} chars", flush=True)\n'
)

NEW_DISPATCH = (
    '            r = get_calendar_events(days)\n'
    '            if not r.startswith(("CALENDAR OK", "CALENDAR ERROR")):\n'
    '                r = "CALENDAR OK: " + r  # _calendar_v2_fixed\n'
    '            print(f"[tool] get_calendar(days={days}) -> {len(r)} chars", flush=True)\n'
)

if OLD_DISPATCH in s_working:
    s_working = s_working.replace(OLD_DISPATCH, NEW_DISPATCH, 1)
    print('Part 2: tool dispatch result wrapper added')
    applied += 1
else:
    # Try to find the dispatch with different indentation or quoting
    _dm = re.search(
        r'([ \t]+)(r = get_calendar_events\(days\)\n)'
        r'([ \t]+print\(f"\[tool\] get_calendar[^\n]+\n)',
        s_working
    )
    if _dm:
        ind4  = _dm.group(1)
        line1 = _dm.group(2)
        line2 = _dm.group(3)
        old_block = _dm.group(0)
        new_block = (
            f'{ind4}r = get_calendar_events(days)\n'
            f'{ind4}if not r.startswith(("CALENDAR OK", "CALENDAR ERROR")):\n'
            f'{ind4}    r = "CALENDAR OK: " + r  # _calendar_v2_fixed\n'
            + line2
        )
        s_working = s_working.replace(old_block, new_block, 1)
        print('Part 2: tool dispatch result wrapper added (regex match)')
        applied += 1
    else:
        print('Part 2 WARNING: dispatch pattern not found — showing context around get_calendar_events(days):')
        for i, ln in enumerate(s_working.splitlines(), 1):
            if 'get_calendar_events(days)' in ln:
                ctx = s_working.splitlines()
                for j in range(max(0, i-3), min(len(ctx), i+4)):
                    print(f'  {j+1:4d}: {ctx[j]}')

# ══════════════════════════════════════════════════════════════════════════════
# Validate & write
# ══════════════════════════════════════════════════════════════════════════════

if applied == 0:
    print('\nNo changes made.')
    sys.exit(0)

with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as tf:
    tf.write(s_working)
    tmp_path = tf.name

r = subprocess.run([PYTHON, '-m', 'py_compile', tmp_path], capture_output=True, text=True)
os.unlink(tmp_path)

if r.returncode != 0:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    print('Original bridge.py NOT modified.')
    sys.exit(1)

open(BRIDGE, 'w', encoding='utf-8').write(s_working)
print(f'\n✅ Calendar tool v2 fix applied ({applied} change(s))')
print('  - get_calendar_events() returns now labelled CALENDAR OK/ERROR')
print('  - Tool dispatch wraps any unlabelled result')
print()
print('Restart bridge:')
print('  launchctl unload ~/Library/LaunchAgents/com.cowork.bridge.plist')
print('  launchctl load ~/Library/LaunchAgents/com.cowork.bridge.plist')
