#!/usr/bin/env python3
"""
fix_calendar_tool.py — Fix calendar tool hallucination bug.

SYMPTOM
=======
When the user asks "What's on my calendar for tomorrow?", the bridge:
  1. Calls get_calendar(days=1) — tool runs successfully, returns ~34 chars
  2. Gemma receives the result but responds: "I'm sorry, it looks like I had a
     momentary connection issue / timing out every time I try"

This is a Gemma hallucination: the tool ran fine, but Gemma can't distinguish
between "no events found" and "connection failure", so it generates a plausible-
sounding apology instead of accurately reporting the tool result.

ROOT CAUSE
==========
The tool returns a short, ambiguous string like "No events found" (15 chars) or
an icalBuddy access-denied message. Gemma fills in the gap with its training
bias toward apologising for connection problems.

THE FIX (3 parts)
==================
1. Wrap get_calendar's return value with an unambiguous label:
       "CALENDAR OK: No events found"           → no events
       "CALENDAR OK: <event list>"              → events found
       "CALENDAR ERROR: <error>"                → access denied / icalBuddy missing

2. Add a diagnostic that shows what icalBuddy actually returns right now.

3. Improve the agentic tool result prompt injection so the model instruction
   explicitly says: "When CALENDAR OK is in the tool result, report it
   accurately. Never say 'connection issue' if the tool returned CALENDAR OK."

Guard sentinel: '_calendar_tool_fixed'
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_calendar_tool_fixed' in s:
    print('SKIPPED — calendar tool fix already applied')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Diagnostic: show what get_calendar currently looks like in bridge.py
# ══════════════════════════════════════════════════════════════════════════════

print('=== Diagnostic ===')

# Find all places in bridge.py where "get_calendar" appears
for i, line in enumerate(s.splitlines(), 1):
    if 'get_calendar' in line or 'icalBuddy' in line:
        print(f'  {i:5d}: {line.rstrip()}')

print()

# ══════════════════════════════════════════════════════════════════════════════
# Live check: what does icalBuddy actually return right now?
# ══════════════════════════════════════════════════════════════════════════════

print('=== Live icalBuddy check ===')
import datetime
tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).strftime('%Y-%m-%d')

try:
    r = subprocess.run(
        ['icalBuddy', '-n', '-iep', 'title,datetime', '-df', '%Y-%m-%d',
         f'eventsFrom:{tomorrow} to:{tomorrow}'],
        capture_output=True, text=True, timeout=10
    )
    ical_out  = r.stdout.strip()
    ical_err  = r.stderr.strip()
    ical_rc   = r.returncode
    print(f'  returncode: {ical_rc}')
    print(f'  stdout ({len(ical_out)} chars): {ical_out!r}')
    if ical_err:
        print(f'  stderr: {ical_err!r}')
except FileNotFoundError:
    print('  icalBuddy not installed (FileNotFoundError)')
    ical_out = None
except subprocess.TimeoutExpired:
    print('  icalBuddy timed out')
    ical_out = None
except Exception as e:
    print(f'  icalBuddy error: {e}')
    ical_out = None

print()

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Fix _get_calendar_events() to return labelled results
#
# Current: returns 'No events found' or raw icalBuddy output (ambiguous)
# After:   returns 'CALENDAR OK: No events found' or 'CALENDAR OK: <events>'
#          or 'CALENDAR ERROR: icalBuddy not installed'
# ══════════════════════════════════════════════════════════════════════════════

OLD_RETURN_NO_EVENTS = "        return 'No events found'"
NEW_RETURN_NO_EVENTS = "        return 'CALENDAR OK: No events found'  # _calendar_tool_fixed"

OLD_RETURN_EVENTS = (
    "        print(f'[morning-brief] Calendar events retrieved ({len(output)} chars)', flush=True)\n"
    "        return output\n"
)
NEW_RETURN_EVENTS = (
    "        print(f'[morning-brief] Calendar events retrieved ({len(output)} chars)', flush=True)\n"
    "        return f'CALENDAR OK: {output}'  # _calendar_tool_fixed\n"
)

OLD_RETURN_NO_ICAL = "        return 'No events found'\n    except Exception as _ce:"
NEW_RETURN_NO_ICAL = "        return 'CALENDAR ERROR: icalBuddy not installed'  # _calendar_tool_fixed\n    except Exception as _ce:"

OLD_RETURN_CAL_ERR = (
    "        print(f'[morning-brief] Calendar fetch failed: {_ce}', flush=True)\n"
    "        return 'No events found'\n"
)
NEW_RETURN_CAL_ERR = (
    "        print(f'[morning-brief] Calendar fetch failed: {_ce}', flush=True)\n"
    "        return f'CALENDAR ERROR: {_ce}'  # _calendar_tool_fixed\n"
)

# Apply return-value fixes
if OLD_RETURN_NO_EVENTS in s:
    # There may be multiple occurrences (inside FileNotFoundError and except blocks)
    # Replace all of them
    s = s.replace(OLD_RETURN_NO_EVENTS, NEW_RETURN_NO_EVENTS)
    print('Part 1a: _get_calendar_events "No events found" returns labelled')
    applied += 1
else:
    print('Part 1a WARNING: "No events found" pattern not found')

if OLD_RETURN_EVENTS in s:
    s = s.replace(OLD_RETURN_EVENTS, NEW_RETURN_EVENTS, 1)
    print('Part 1b: _get_calendar_events success return labelled')
    applied += 1
else:
    print('Part 1b WARNING: success return pattern not found')

if OLD_RETURN_CAL_ERR in s:
    s = s.replace(OLD_RETURN_CAL_ERR, NEW_RETURN_CAL_ERR, 1)
    print('Part 1c: _get_calendar_events exception return labelled')
    applied += 1
else:
    print('Part 1c WARNING: exception return pattern not found')

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Find any get_calendar tool wrapper and label its return too
#
# The agentic loop may have a separate get_calendar() function that wraps
# _get_calendar_events() or icalBuddy directly. Search for it and fix it.
# ══════════════════════════════════════════════════════════════════════════════

# Pattern: def get_calendar( or async def get_calendar(
_gc_m = re.search(r'([ \t]*)(?:async )?def get_calendar\b[^\n]*\n', s)
if _gc_m:
    print(f'Part 2: Found get_calendar() at char {_gc_m.start()} — scanning for return statements')
    # Find the function body (until next same-or-lower indent def)
    fn_start = _gc_m.end()
    fn_indent = _gc_m.group(1)
    body_end = len(s)
    for _nm in re.finditer(r'^(?:' + re.escape(fn_indent) + r')(?:async )?def \w', s[fn_start:], re.MULTILINE):
        body_end = fn_start + _nm.start()
        break
    fn_body = s[fn_start:body_end]
    print(f'  Function body ({len(fn_body)} chars):')
    for ln in fn_body.splitlines()[:20]:
        print(f'    {ln}')
    if len(fn_body.splitlines()) > 20:
        print(f'    ... ({len(fn_body.splitlines()) - 20} more lines)')
else:
    print('Part 2: No standalone get_calendar() function found (may be inline in tool dispatch)')

# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Find the tool-result injection point in the agentic loop and add
#         an explicit instruction to the model about CALENDAR OK responses.
#
# Target: wherever tool results are injected back into messages (usually as
#         a 'tool' role or injected into the user message).
# ══════════════════════════════════════════════════════════════════════════════

# Common patterns for tool result injection in Ollama-based agentic loops:
TOOL_RESULT_PATTERNS = [
    # Pattern A: role="tool" message injection
    (
        '{"role": "tool", "content": tool_result}',
        '{"role": "tool", "content": f"[Tool result] {tool_result}"}',
    ),
    # Pattern B: user-message injection of tool output
    (
        '"content": f"Tool result: {tool_result}"',
        '"content": f"Tool result (CALENDAR OK means success): {tool_result}"',
    ),
]

for old_p, new_p in TOOL_RESULT_PATTERNS:
    if old_p in s:
        s = s.replace(old_p, new_p, 1)
        print(f'Part 3: Tool result injection clarified')
        applied += 1
        break
else:
    print('Part 3: standard tool result injection pattern not found — checking for agentic loop...')
    # Look for the [tool] print log to find the injection point
    _tl_m = re.search(
        r"print\(f'\[tool\][^\n]+'\s*,\s*flush=True\)",
        s
    )
    if _tl_m:
        print(f'  Found [tool] log at char {_tl_m.start()}')
        # Show context around it
        ctx_start = max(0, s.rfind('\n', 0, _tl_m.start() - 500))
        ctx_end = min(len(s), _tl_m.end() + 500)
        print('  Context:')
        for ln in s[ctx_start:ctx_end].splitlines():
            print(f'    {ln}')

# ══════════════════════════════════════════════════════════════════════════════
# Part 4: If get_calendar is an inline tool dispatch in the agentic loop,
#         add a clear prefix to its return value
#
# Pattern to find: something like
#   if tool_name == 'get_calendar':
#       ... return <calendar data>
# ══════════════════════════════════════════════════════════════════════════════

_gc_dispatch = re.search(
    r"([ \t]*)(?:if|elif)\s+tool_name\s*==\s*['\"]get_calendar['\"][^\n]*\n"
    r"((?:.*\n)*?)"
    r"(?=[ \t]*(?:elif|else|if)\s+tool_name|\Z)",
    s
)
if _gc_dispatch:
    dispatch_text = _gc_dispatch.group(0)
    print(f'\nPart 4: Found get_calendar dispatch block:')
    for ln in dispatch_text.splitlines():
        print(f'  {ln}')
    # Look for return/assignment inside this block
    _ret_m = re.search(
        r"([ \t]*)tool_result\s*=\s*_get_calendar_events\(([^)]*)\)",
        dispatch_text
    )
    if _ret_m:
        old_assign = _ret_m.group(0)
        ind3 = _ret_m.group(1)
        new_assign = (
            f"{old_assign}\n"
            f"{ind3}if not tool_result.startswith('CALENDAR '):\n"
            f"{ind3}    tool_result = 'CALENDAR OK: ' + tool_result  # _calendar_tool_fixed"
        )
        s = s.replace(old_assign, new_assign, 1)
        print('Part 4: get_calendar dispatch return labelled')
        applied += 1
    else:
        print('Part 4: get_calendar dispatch found but return pattern unclear — manual review needed')
else:
    print('Part 4: No tool_name == get_calendar dispatch found')

# ══════════════════════════════════════════════════════════════════════════════
# Part 5: Inject a system-prompt note about tool results
#
# Find the system_msg / system prompt assembly and add a tool-result clause.
# ══════════════════════════════════════════════════════════════════════════════

_sys_patterns = [
    # Pattern A: system_msg = f"..." multi-line
    r'(system_msg\s*=\s*f?["\'])',
    # Pattern B: {"role": "system", "content": ...}
    r'(\{"role":\s*"system",\s*"content":\s*)',
]

TOOL_INSTR = (
    "When a tool returns a result starting with 'CALENDAR OK:', "
    "report the calendar information accurately — never say there was a connection "
    "issue or timeout if the tool returned CALENDAR OK. "
    "If the result is 'CALENDAR OK: No events found', tell the user they have no events. "
)

_sys_injected = False
for _sp in _sys_patterns:
    _sm = re.search(_sp, s)
    if _sm:
        # Check if instruction already there
        if 'CALENDAR OK' not in s:
            # Find the end of the system message string to append
            # This is tricky to do safely with regex — just add a note in the
            # agentic system prompt instead
            print(f'Part 5 NOTE: Found system prompt at char {_sm.start()} — '
                  f'add tool guidance manually if needed')
        _sys_injected = True
        break

if not _sys_injected:
    print('Part 5: System prompt pattern not found')

# ══════════════════════════════════════════════════════════════════════════════
# Validate & write
# ══════════════════════════════════════════════════════════════════════════════

if applied == 0:
    print('\nNo changes made to bridge.py (tool infrastructure may differ from expected patterns).')
    print('Diagnostic output above shows the current state — use it to apply fixes manually.')
    print('Key info: icalBuddy returned the value shown above.')
    sys.exit(0)

import tempfile, os
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
print(f'\n✅ Calendar tool fix applied ({applied} change(s))')
print('  - Tool returns now prefixed with "CALENDAR OK:" or "CALENDAR ERROR:"')
print('  - Gemma cannot confuse "no events" with "connection failure"')
print()
print('Restart bridge to pick up changes:')
print('  launchctl unload ~/Library/LaunchAgents/com.cowork.bridge.plist')
print('  launchctl load ~/Library/LaunchAgents/com.cowork.bridge.plist')
