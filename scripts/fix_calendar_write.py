#!/usr/bin/env python3
"""
fix_calendar_write.py — Add calendar write (create/delete/edit) via AppleScript.

PROBLEM
=======
get_calendar_events() uses icalBuddy which is read-only. The bridge has no way
to create, delete, or edit calendar events — Gemma tells users "I don't have
the ability to delete events."

THE FIX
=======
Add three AppleScript-backed functions:
  1. calendar_delete_events(event_name, all_occurrences=True)
       — finds all events matching the name (case-insensitive) across all
         calendars and deletes them (or just future ones)
  2. calendar_create_event(title, start_str, end_str, calendar_name=None)
       — creates a new event in the default (or specified) calendar
  3. calendar_list_matching(event_name)
       — returns count + dates of matching events before destructive delete

Wire all three into the agentic tool dispatch (the elif chain starting around
line 810) and add their definitions to the tool JSON block (~line 775).

Add a confirmation flow for delete: tool returns a summary of matches first,
and only executes deletion when the user says "confirm delete".

Guard sentinel: '_calendar_write_fixed'
"""
import pathlib, subprocess, sys, re, tempfile, os

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_calendar_write_fixed' in s:
    print('SKIPPED — calendar write already installed')
    sys.exit(0)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Add calendar write helper functions before get_calendar_events()
# ══════════════════════════════════════════════════════════════════════════════

CALENDAR_WRITE_CODE = r'''
# ── Calendar write helpers (AppleScript) ──────────────────────────────────────
# _calendar_write_fixed

def _run_applescript(script: str, timeout: int = 15) -> str:
    """Run an AppleScript and return stdout. Returns error string on failure."""
    import subprocess as _sp
    try:
        r = _sp.run(['osascript', '-e', script], capture_output=True, text=True, timeout=timeout)
        out = r.stdout.strip()
        err = r.stderr.strip()
        if r.returncode != 0:
            return f"AppleScript error: {err or 'unknown error'}"
        return out
    except _sp.TimeoutExpired:
        return "AppleScript timed out"
    except Exception as _ae:
        return f"AppleScript exception: {_ae}"


def calendar_list_matching(event_name: str) -> str:
    """
    Find all calendar events whose title contains event_name (case-insensitive).
    Returns a summary string: count, calendar names, and date range.
    """
    safe_name = event_name.replace('"', '').replace("'", '')
    script = f"""
tell application "Calendar"
    set matchList to {{}}
    set searchName to "{safe_name}"
    repeat with aCal in calendars
        set evts to (every event of aCal whose summary contains searchName)
        repeat with anEvt in evts
            set evtDate to start date of anEvt
            set end of matchList to (name of aCal & ": " & summary of anEvt & " @ " & (evtDate as string))
        end repeat
    end repeat
    if length of matchList = 0 then
        return "NO_MATCH"
    end if
    set AppleScript's text item delimiters to linefeed
    return (matchList as string) & linefeed & "TOTAL:" & (length of matchList as string)
end tell
"""
    return _run_applescript(script)


def calendar_delete_events(event_name: str, future_only: bool = False) -> str:
    """
    Delete all calendar events whose title contains event_name.
    If future_only=True, only deletes events from today onwards.
    Returns a summary of what was deleted.
    """
    import datetime as _dt
    today_str = _dt.date.today().strftime("%Y-%m-%d")
    safe_name = event_name.replace('"', '').replace("'", '')

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
"""
    result = _run_applescript(script)
    if result.isdigit():
        n = int(result)
        scope = "future occurrences" if future_only else "occurrences (all time)"
        if n == 0:
            return f"CALENDAR DELETE: No events found matching '{event_name}'"
        return f"CALENDAR DELETE OK: Deleted {n} {scope} of '{event_name}'"
    return f"CALENDAR DELETE ERROR: {result}"


def calendar_create_event(title: str, start_str: str, end_str: str,
                          calendar_name: str = "") -> str:
    """
    Create a calendar event using AppleScript.
    start_str / end_str: natural language or ISO format (YYYY-MM-DD HH:MM)
    calendar_name: optional, uses default calendar if empty.
    """
    import datetime as _dt, re as _re

    # Normalise datetime strings to AppleScript-friendly format
    def _parse_dt(s):
        s = s.strip()
        # Try ISO: "2026-04-15 09:00" or "2026-04-15T09:00"
        m = _re.match(r'(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})', s)
        if m:
            yr, mo, dy, hr, mn = m.groups()
            dt = _dt.datetime(int(yr), int(mo), int(dy), int(hr), int(mn))
            return dt.strftime("%A, %B %d, %Y at %I:%M %p")
        # If just a date, default to 9am-10am
        m2 = _re.match(r'(\d{4})-(\d{2})-(\d{2})', s)
        if m2:
            yr, mo, dy = m2.groups()
            dt = _dt.datetime(int(yr), int(mo), int(dy), 9, 0)
            return dt.strftime("%A, %B %d, %Y at %I:%M %p")
        # Pass through — AppleScript may handle natural language
        return s

    as_start = _parse_dt(start_str)
    as_end   = _parse_dt(end_str)
    safe_title = title.replace('"', "'")

    if calendar_name:
        safe_cal = calendar_name.replace('"', '').replace("'", '')
        cal_clause = f'tell calendar "{safe_cal}"'
    else:
        cal_clause = 'tell calendar 1'

    script = f"""
tell application "Calendar"
    {cal_clause}
        set newEvt to make new event with properties {{summary:"{safe_title}", start date:date "{as_start}", end date:date "{as_end}"}}
        return summary of newEvt & " @ " & (start date of newEvt as string)
    end tell
end tell
"""
    result = _run_applescript(script)
    if result.startswith("AppleScript"):
        return f"CALENDAR CREATE ERROR: {result}"
    return f"CALENDAR CREATE OK: {result}"

'''

# Insert before get_calendar_events() definition
ANCHOR = 'def get_calendar_events(days: int = 7) -> str:'
if ANCHOR in s:
    s = s.replace(ANCHOR, CALENDAR_WRITE_CODE + ANCHOR, 1)
    print('Part 1: Calendar write helpers inserted before get_calendar_events()')
    applied += 1
else:
    # Fallback: try to insert near the [tool] log print for get_calendar
    print('Part 1 WARNING: get_calendar_events anchor not found — trying fallback')
    ANCHOR2 = 'def get_calendar_events('
    if ANCHOR2 in s:
        s = s.replace(ANCHOR2, CALENDAR_WRITE_CODE + ANCHOR2, 1)
        print('Part 1: Calendar write helpers inserted (fallback anchor)')
        applied += 1
    else:
        print('Part 1 FAILED: no get_calendar_events anchor found')

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Add new tools to the tool definition JSON block (~line 775)
#
# The existing block has: "name":"get_calendar"
# We add: delete_calendar_events, create_calendar_event
# ══════════════════════════════════════════════════════════════════════════════

# Find the get_calendar tool entry — it uses nested {"type":"function","function":{...}}
# so we locate "name":"get_calendar" then find the closing }} of its outer wrapper.
_gc_name_pos = s.find('"name":"get_calendar"')
if _gc_name_pos == -1:
    _gc_name_pos = s.find('"name": "get_calendar"')

if _gc_name_pos != -1:
    # Scan backward from "name":"get_calendar" to find the 2nd unmatched {
    # going backward:  inner { is 1st (for "function":{...}),
    #                  outer { is 2nd (for {"type":"function",...})
    _containers = 0
    _depth = 0
    outer_start = _gc_name_pos
    for _ci in range(_gc_name_pos, -1, -1):
        if s[_ci] == '}':
            _depth += 1
        elif s[_ci] == '{':
            if _depth > 0:
                _depth -= 1
            else:
                _containers += 1
                if _containers == 2:   # outer { of {"type":"function",...}
                    outer_start = _ci
                    break
    # Scan forward from outer_start to find its balanced closing }
    _depth = 0
    outer_end = outer_start
    for _ci in range(outer_start, len(s)):
        if s[_ci] == '{': _depth += 1
        elif s[_ci] == '}':
            _depth -= 1
            if _depth == 0:
                outer_end = _ci + 1
                break
    old_tool_def = s[outer_start:outer_end]
    print(f'  Part 2: outer tool entry ({len(old_tool_def)} chars): {old_tool_def[:60]!r}...')
    _gc_tool_m = True  # signal success
else:
    _gc_tool_m = None

if _gc_tool_m:
    new_tool_defs = old_tool_def + ''',
    {"type": "function", "function": {
        "name": "delete_calendar_events",
        "description": "Delete calendar events by name. Always call list_calendar_matches first to confirm what will be deleted, then call this with confirmed=True.",
        "parameters": {
            "type": "object",
            "properties": {
                "event_name": {"type": "string", "description": "The event name to search and delete (partial match)"},
                "future_only": {"type": "boolean", "description": "If true, only delete events from today onwards (default: false = all occurrences)"},
                "confirmed": {"type": "boolean", "description": "Must be true to actually delete — set only after user confirms"}
            },
            "required": ["event_name"]
        }
    }},
    {"type": "function", "function": {
        "name": "list_calendar_matches",
        "description": "Find all calendar events matching a name, to preview before deleting. Always call this before delete_calendar_events.",
        "parameters": {
            "type": "object",
            "properties": {
                "event_name": {"type": "string", "description": "The event name to search (partial match, case-insensitive)"}
            },
            "required": ["event_name"]
        }
    }},
    {"type": "function", "function": {
        "name": "create_calendar_event",
        "description": "Create a new calendar event.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Event title"},
                "start": {"type": "string", "description": "Start datetime: YYYY-MM-DD HH:MM format"},
                "end": {"type": "string", "description": "End datetime: YYYY-MM-DD HH:MM format"},
                "calendar": {"type": "string", "description": "Calendar name (optional, uses default if omitted)"}
            },
            "required": ["title", "start", "end"]
        }
    }}'''
    s = s.replace(old_tool_def, new_tool_defs, 1)
    print('Part 2: delete_calendar_events, list_calendar_matches, create_calendar_event added to tool JSON')
    applied += 1
else:
    print('Part 2 WARNING: get_calendar tool definition not found in JSON block')
    # Show context around "name":"get_calendar"
    m2 = re.search(r'.{0,100}"name"\s*:\s*"get_calendar".{0,200}', s, re.DOTALL)
    if m2:
        print(f'  Context: {m2.group(0)!r}')

# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Add elif dispatch handlers for the new tools
#
# Find:  elif name == "get_calendar":
# Insert after its block.
# ══════════════════════════════════════════════════════════════════════════════

# Find the get_calendar dispatch block.
# We first determine the exact indentation of the elif line, then only match
# body lines that have STRICTLY MORE indentation (preventing capture of
# subsequent elif/else blocks at the same indent level).
_gc_indent_m = re.search(r'^([ \t]*)elif name == "get_calendar"', s, re.MULTILINE)
if _gc_indent_m:
    _gc_indent    = _gc_indent_m.group(1)          # e.g. "            " (12 spaces)
    _body_min_len = len(_gc_indent) + 1             # body must have > this many leading spaces
    _gc_disp_m = re.search(
        re.escape(_gc_indent) + r'elif name == "get_calendar":[^\n]*\n'
        r'(?:[ \t]{' + str(_body_min_len) + r',}[^\n]*\n)*',
        s
    )
else:
    _gc_disp_m = None
if _gc_disp_m:
    old_dispatch = _gc_disp_m.group(0)
    ind = _gc_indent  # base indentation (the elif's own indent)

    NEW_DISPATCH = old_dispatch + f'''{ind}elif name == "list_calendar_matches":
{ind}    event_name = args.get("event_name", "")
{ind}    if not event_name:
{ind}        r = "list_calendar_matches requires event_name"
{ind}    else:
{ind}        r = calendar_list_matching(event_name)
{ind}        if r == "NO_MATCH":
{ind}            r = f"No events found matching '{{event_name}}'"
{ind}        else:
{ind}            lines = r.strip().splitlines()
{ind}            total_line = [l for l in lines if l.startswith("TOTAL:")]
{ind}            count = total_line[0].replace("TOTAL:", "").strip() if total_line else "?"
{ind}            events = [l for l in lines if not l.startswith("TOTAL:")]
{ind}            r = f"Found {{count}} event(s) matching '{{event_name}}':\\n" + "\\n".join(events[:20])
{ind}    print(f"[tool] list_calendar_matches('{{event_name}}') -> {{len(r)}} chars", flush=True)
{ind}elif name == "delete_calendar_events":
{ind}    event_name = args.get("event_name", "")
{ind}    future_only = bool(args.get("future_only", False))
{ind}    confirmed = bool(args.get("confirmed", False))
{ind}    if not event_name:
{ind}        r = "delete_calendar_events requires event_name"
{ind}    elif not confirmed:
{ind}        # Preview first — never delete without confirmed=True
{ind}        preview = calendar_list_matching(event_name)
{ind}        if preview == "NO_MATCH":
{ind}            r = f"No events found matching '{{event_name}}' — nothing to delete"
{ind}        else:
{ind}            lines = preview.strip().splitlines()
{ind}            total_line = [l for l in lines if l.startswith("TOTAL:")]
{ind}            count = total_line[0].replace("TOTAL:", "").strip() if total_line else "?"
{ind}            scope = "future occurrences" if future_only else "ALL occurrences"
{ind}            r = (f"Found {{count}} event(s) matching '{{event_name}}'.\\n"
{ind}                 f"To delete {{scope}}, "
{ind}                 f"call delete_calendar_events again with confirmed=true.")
{ind}    else:
{ind}        r = calendar_delete_events(event_name, future_only=future_only)
{ind}    print(f"[tool] delete_calendar_events('{{event_name}}', future={{future_only}}, confirmed={{confirmed}}) -> {{len(r)}} chars", flush=True)
{ind}elif name == "create_calendar_event":
{ind}    title   = args.get("title", "")
{ind}    start   = args.get("start", "")
{ind}    end     = args.get("end", "")
{ind}    cal     = args.get("calendar", "")
{ind}    if not (title and start and end):
{ind}        r = "create_calendar_event requires title, start, and end"
{ind}    else:
{ind}        r = calendar_create_event(title, start, end, calendar_name=cal)
{ind}    print(f"[tool] create_calendar_event('{{title}}') -> {{len(r)}} chars", flush=True)
'''
    s = s.replace(old_dispatch, NEW_DISPATCH, 1)
    print('Part 3: delete_calendar_events, list_calendar_matches, create_calendar_event dispatch added')
    applied += 1
else:
    print('Part 3 WARNING: elif name == "get_calendar" dispatch not found')
    # Diagnostic
    for i, line in enumerate(s.splitlines(), 1):
        if 'elif name ==' in line and 'calendar' in line.lower():
            print(f'  {i:5d}: {line.rstrip()}')

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
print(f'\n✅ Calendar write installed ({applied} change(s))')
print()
print('New capabilities:')
print('  list_calendar_matches(event_name)     — preview before delete')
print('  delete_calendar_events(event_name, future_only, confirmed)')
print('  create_calendar_event(title, start, end, calendar)')
print()
print('Delete flow: Gemma previews matches → user confirms → deletes')
print()
print('Restart bridge:')
print('  launchctl unload ~/Library/LaunchAgents/com.cowork.bridge.plist')
print('  launchctl load ~/Library/LaunchAgents/com.cowork.bridge.plist')
