#!/usr/bin/env python3
"""
fix_system_prompt_tools.py — Add explicit tool capabilities note to the system prompt.

PROBLEM
=======
Gemma says "I don't have the ability to delete recurring events" even though
delete_calendar_events is installed. Without an explicit mention in the system
prompt, Gemma falls back on its training bias ("I can't do that") rather than
attempting available tools.

THE FIX
=======
1. Append a concise capabilities block to the system prompt listing every
   tool category and what Gemma CAN do with each.

2. Improve the delete_calendar_events tool description to explicitly say
   it handles recurring events.

Guard sentinel: '_system_prompt_tools_fixed'
"""
import pathlib, subprocess, sys, re, tempfile, os

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_system_prompt_tools_fixed' in s:
    print('SKIPPED — system prompt tools note already applied')
    sys.exit(0)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Improve delete_calendar_events tool description
# ══════════════════════════════════════════════════════════════════════════════

OLD_DELETE_DESC = (
    '"description": "Delete calendar events by name. Always call '
    'list_calendar_matches first to confirm what will be deleted, '
    'then call this with confirmed=True."'
)
NEW_DELETE_DESC = (
    '"description": "Delete calendar events by name — including ALL occurrences '
    'of a recurring event series. Works on any event type. '
    'Call list_calendar_matches first to preview, then call this with confirmed=true '
    'to actually delete. Use future_only=true to remove only upcoming occurrences."'
)

if OLD_DELETE_DESC in s:
    s = s.replace(OLD_DELETE_DESC, NEW_DELETE_DESC, 1)
    print('Part 1: delete_calendar_events description updated (recurring events)')
    applied += 1
else:
    # Try to find and patch it with a looser match
    _dm = re.search(
        r'("name":\s*"delete_calendar_events"[^}]{0,50}"description":\s*")([^"]+)(")',
        s, re.DOTALL
    )
    if _dm:
        old_block = _dm.group(0)
        new_block = _dm.group(1) + (
            'Delete calendar events by name — including ALL occurrences of a '
            'recurring event series. Call list_calendar_matches first to preview, '
            'then call this with confirmed=true to delete. '
            'Use future_only=true for only upcoming occurrences.'
        ) + _dm.group(3)
        s = s.replace(old_block, new_block, 1)
        print('Part 1: delete_calendar_events description updated (regex match)')
        applied += 1
    else:
        print('Part 1 NOTE: delete_calendar_events description pattern not found — skipping')

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Add capabilities note to the system prompt
#
# This tells Gemma what it CAN do so it uses tools instead of apologising.
# We use the same three fallback patterns as fix_vault_tools.py Part 4.
# ══════════════════════════════════════════════════════════════════════════════

# NOTE: must not contain _system_prompt_tools_fixed (that's our sentinel check above)
CAPS_NOTE = (
    ' TOOL CAPABILITIES — always use these tools, never say you cannot: '
    'CALENDAR READ: get_calendar(days) — fetch upcoming events. '
    'CALENDAR WRITE: list_calendar_matches(name) preview events; '
    'delete_calendar_events(name, future_only, confirmed) delete events including entire recurring series; '
    'create_calendar_event(title, start, end, calendar) create new events. '
    'VAULT: search_vault(query) search notes; read_vault_file(path) read a note; list_vault_files(folder) browse vault. '
    'When the user asks to delete/remove/cancel a calendar event, use delete_calendar_events. '
    'When the user asks about notes or projects, use search_vault. '
    'Never claim a capability is missing if a matching tool exists.'
    ' _system_prompt_tools_fixed'
)

_sys_patched = False

# Pattern A: triple-double-quote system_msg
_sys_m = re.search(r'(system_msg\s*=\s*f?)(""")(.*?)(""")', s, re.DOTALL)
if not _sys_m:
    _sys_m = re.search(r"(system_msg\s*=\s*f?)(''')(.*?)(''')", s, re.DOTALL)
if _sys_m and '_system_prompt_tools_fixed' not in _sys_m.group(3):
    old_block = _sys_m.group(0)
    new_block = (_sys_m.group(1) + _sys_m.group(2) +
                 _sys_m.group(3).rstrip() + CAPS_NOTE + _sys_m.group(4))
    s = s.replace(old_block, new_block, 1)
    print('Part 2: capabilities note appended to system_msg (triple-quote)')
    _sys_patched = True
    applied += 1

# Pattern B: single-line system_msg = "..."
if not _sys_patched:
    _sys_m2 = re.search(r'(system_msg\s*=\s*f?")([^"]+)(")', s)
    if not _sys_m2:
        _sys_m2 = re.search(r"(system_msg\s*=\s*f?')([^']+)(')", s)
    if _sys_m2 and '_system_prompt_tools_fixed' not in _sys_m2.group(2):
        old_block = _sys_m2.group(0)
        new_block = (_sys_m2.group(1) + _sys_m2.group(2).rstrip() +
                     CAPS_NOTE + _sys_m2.group(3))
        s = s.replace(old_block, new_block, 1)
        print('Part 2: capabilities note appended to system_msg (single-line)')
        _sys_patched = True
        applied += 1

# Pattern C: inline "role":"system" content
if not _sys_patched:
    _sys_m3 = re.search(
        r'("role"\s*:\s*"system"\s*,\s*"content"\s*:\s*f?")([^"]+)(")',
        s
    )
    if _sys_m3 and '_system_prompt_tools_fixed' not in _sys_m3.group(2):
        old_block = _sys_m3.group(0)
        new_block = (_sys_m3.group(1) + _sys_m3.group(2).rstrip() +
                     CAPS_NOTE + _sys_m3.group(3))
        s = s.replace(old_block, new_block, 1)
        print('Part 2: capabilities note appended to inline system content')
        _sys_patched = True
        applied += 1

if not _sys_patched:
    print('Part 2 WARNING: no system prompt pattern matched')
    # Diagnostic
    for m in re.finditer(r'system_msg', s):
        ctx = s[max(0, m.start()-5):m.start()+200]
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
print(f'\n✅ System prompt tool capabilities added ({applied} change(s))')
print()
print('Gemma now knows it CAN:')
print('  - Delete calendar events (including recurring series)')
print('  - Create calendar events')
print('  - Preview calendar events before deleting')
print('  - Search and read your Obsidian vault')
print()
print('Restart bridge:')
print('  launchctl unload ~/Library/LaunchAgents/com.cowork.bridge.plist')
print('  launchctl load ~/Library/LaunchAgents/com.cowork.bridge.plist')
