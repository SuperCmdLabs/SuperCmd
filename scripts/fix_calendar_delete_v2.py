#!/usr/bin/env python3
"""
fix_calendar_delete_v2.py — Fix calendar_delete_events AppleScript.

BUGS IN V1
==========
1. `(date "2026-04-14")` — AppleScript cannot parse ISO 8601 dates.
   Result: the `future_only` date filter silently fails, either erroring or
   matching nothing. Calendar returns 0 deletions and Gemma hallucinates success.

2. `repeat with anEvt in evts ... delete anEvt` — iterating over a collected
   list then deleting invalidates the references mid-loop. Subsequent deletes
   silently skip.

THE FIX
=======
Replace the filter_clause/script block with two purpose-built scripts:

  future_only=True:
    Use AppleScript `current date` (no Python date injection).
    Use "delete first match, loop until none" pattern to safely handle
    recurring events and avoid stale reference issues.

  future_only=False (delete all):
    Same loop pattern, no date filter.

Guard sentinel: '_calendar_delete_v2_fixed'
"""
import pathlib, subprocess, sys, re, tempfile, os

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_calendar_delete_v2_fixed' in s:
    print('SKIPPED — calendar delete v2 already applied')
    sys.exit(0)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Replace the broken filter_clause + script block in calendar_delete_events()
# ══════════════════════════════════════════════════════════════════════════════

# The old block starts after `safe_name = ...` and ends before `result = _run_applescript`
# We target the whole if/else + script assignment in one replacement.

OLD_BLOCK = '''\
    if future_only:
        filter_clause = f'whose summary contains "{safe_name}" and start date >= (date "{today_str}")'
    else:
        filter_clause = f'whose summary contains "{safe_name}"'

    script = f"""
tell application "Calendar"
    set deleteCount to 0
    repeat with aCal in calendars
        set evts to (every event of aCal {filter_clause})
        repeat with anEvt in evts
            delete anEvt
            set deleteCount to deleteCount + 1
        end repeat
    end repeat
    return deleteCount as string
end tell
"""'''

NEW_BLOCK = '''\
    # _calendar_delete_v2_fixed
    # Build two separate scripts: future-only uses AppleScript 'current date'
    # (no Python date injection — ISO 8601 is not valid AppleScript date format).
    # Both use "delete first match, loop until empty" to safely handle recurring
    # event series without stale-reference issues.
    if future_only:
        script = f"""
tell application "Calendar"
    set deleteCount to 0
    set cutoffDate to current date
    set time of cutoffDate to 0
    repeat with aCal in calendars
        set keepGoing to true
        repeat while keepGoing
            set keepGoing to false
            try
                set anEvt to first event of aCal whose (summary contains "{safe_name}" and start date >= cutoffDate)
                delete anEvt
                set deleteCount to deleteCount + 1
                set keepGoing to true
            end try
        end repeat
    end repeat
    return deleteCount as string
end tell
"""
    else:
        script = f"""
tell application "Calendar"
    set deleteCount to 0
    repeat with aCal in calendars
        set keepGoing to true
        repeat while keepGoing
            set keepGoing to false
            try
                set anEvt to first event of aCal whose summary contains "{safe_name}"
                delete anEvt
                set deleteCount to deleteCount + 1
                set keepGoing to true
            end try
        end repeat
    end repeat
    return deleteCount as string
end tell
"""'''

if OLD_BLOCK in s:
    s = s.replace(OLD_BLOCK, NEW_BLOCK, 1)
    print('calendar_delete_events: AppleScript fixed (date format + loop)')
    applied += 1
else:
    print('WARNING: old block not found exactly — trying relaxed match...')
    # Try to find just the filter_clause lines as a fallback
    _fm = re.search(
        r"([ \t]+if future_only:\n)"
        r"([ \t]+filter_clause = f'whose[^\n]+\n)"
        r"([ \t]+else:\n)"
        r"([ \t]+filter_clause = f'whose[^\n]+\n)"
        r"\n"
        r"([ \t]+script = f\"\"\"[\s\S]+?\"\"\")",
        s
    )
    if _fm:
        indent = re.match(r'([ \t]*)', _fm.group(1)).group(1)
        # Extract the safe_name variable name from context (should be safe_name)
        old_frag = _fm.group(0)
        new_frag = NEW_BLOCK
        s = s.replace(old_frag, new_frag, 1)
        print('calendar_delete_events: AppleScript fixed (relaxed match)')
        applied += 1
    else:
        print('FAILED: could not find calendar_delete_events script block')
        # Show the function for diagnosis
        fn_start = s.find('def calendar_delete_events(')
        if fn_start != -1:
            print('Current function body:')
            for i, ln in enumerate(s[fn_start:fn_start+1500].splitlines(), 1):
                print(f'  {i:3d}: {ln}')
        sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# Also remove the now-unused today_str line
# (it was only used for the broken filter_clause)
# ══════════════════════════════════════════════════════════════════════════════

OLD_TODAY = "    today_str = _dt.date.today().strftime(\"%Y-%m-%d\")\n"
if OLD_TODAY in s:
    s = s.replace(OLD_TODAY, "", 1)
    print('Removed unused today_str line')

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
print(f'\n✅ Calendar delete v2 applied')
print('  - AppleScript now uses "current date" (no ISO date string injection)')
print('  - Loop-until-empty pattern handles recurring events correctly')
print()
print('Restart bridge:')
print('  launchctl unload ~/Library/LaunchAgents/com.cowork.bridge.plist')
print('  launchctl load ~/Library/LaunchAgents/com.cowork.bridge.plist')
