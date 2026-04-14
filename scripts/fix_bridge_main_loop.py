#!/usr/bin/env python3
"""
fix_bridge_main_loop.py — Rescue the main while-True message loop from dead
code inside _process_imessage_attachment().

THE PROBLEM
===========
The bridge exits immediately on startup because the entire main message loop
is unreachable dead code.  Somewhere along the way, the while-True loop that
lives in main() ended up *inside* _process_imessage_attachment() — after its
`return False` statement.  Python accepts the code syntactically but never
executes it, so bridge.py imports cleanly, runs initialization, reaches the
end of main() ... and exits.

Visible symptom in logs:
  [memory] 30-min refresh thread started   ← this line NEVER prints
  (process exits with code 0)

Root cause structure (incorrect):
  def _process_imessage_attachment(attachment_path, mime_type, sender):
      ...
      return False          ← function ends here
      # ----- DEAD CODE (unreachable) -----------
      _embed_refresh_thread = ...
      conversation = _load_last_session()
      while True:           ← MAIN MESSAGE LOOP — never runs
          ...

THE FIX
=======
1. Find the `    return False` that terminates _process_imessage_attachment.
2. Extract everything after it (the dead code block).
3. Insert that block at the END of main() — right before the next top-level
   function definition, keeping the same 4-space indentation (correct for
   being inside main()).
4. Remove it from its current dead location.
5. Validate with py_compile; roll back if broken.
6. Restart launchctl service.

Guard sentinel: '_bridge_main_loop_fixed'
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

lines = open(BRIDGE, encoding='utf-8', errors='replace').readlines()
orig_content = ''.join(lines)

if '_bridge_main_loop_fixed' in orig_content:
    print('SKIPPED — bridge main loop fix already applied')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Locate _process_imessage_attachment
# ══════════════════════════════════════════════════════════════════════════════

attach_fn_start = None
for i, line in enumerate(lines):
    if line.startswith('def _process_imessage_attachment('):
        attach_fn_start = i
        break

if attach_fn_start is None:
    print('ERROR: def _process_imessage_attachment not found — bridge structure unexpected')
    sys.exit(1)

print(f'Step 1: _process_imessage_attachment at line {attach_fn_start + 1}')

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Find the return False that ends the function
#         We look for '    return False' (exactly 4-space indent).
#         We want the LAST such line within the function body, before the
#         dead code region begins.
# ══════════════════════════════════════════════════════════════════════════════

return_false_idx = None

# Strategy: scan forward from attach_fn_start.  The real end of the function
# is the last `    return False` before we hit another `    while True:` that
# is followed by a for-loop over new_msgs (the main loop sentinel).
# Simpler: find the last `    return False` whose NEXT non-blank line starts
# with `    _embed_refresh_thread` OR `    while True:` (both dead code).

for i in range(attach_fn_start + 1, len(lines)):
    stripped = lines[i].rstrip()
    if stripped == '    return False':
        # Peek ahead: next non-blank line should be dead code
        j = i + 1
        while j < len(lines) and lines[j].strip() == '':
            j += 1
        if j < len(lines):
            next_stripped = lines[j].rstrip()
            if (next_stripped.startswith('    _embed_refresh_thread')
                    or next_stripped.startswith('    while True:')
                    or next_stripped.startswith('    conversation = _load_last_session')
                    or next_stripped.startswith('    print("[memory]')):
                return_false_idx = i
                break
        # Fallback: just record last return False in function
        return_false_idx = i

if return_false_idx is None:
    # Broader fallback: any `    return False` in the function
    for i in range(attach_fn_start + 1, len(lines)):
        if lines[i].rstrip() == '    return False':
            return_false_idx = i

if return_false_idx is None:
    print('ERROR: Could not locate return False in _process_imessage_attachment')
    sys.exit(1)

print(f'Step 2: return False at line {return_false_idx + 1}')

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Extract the dead code block
#         Everything from return_false_idx+1 to the next 0-indent definition.
# ══════════════════════════════════════════════════════════════════════════════

dead_start = return_false_idx + 1

# Skip any blank lines between return False and dead code
while dead_start < len(lines) and lines[dead_start].strip() == '':
    dead_start += 1

if dead_start >= len(lines):
    print('ERROR: Nothing after return False — nothing to rescue')
    sys.exit(1)

print(f'Step 3: Dead code begins at line {dead_start + 1}: {lines[dead_start].rstrip()!r}')

# Dead code ends at the next top-level definition (0-indent def/class/if) or EOF
dead_end = len(lines)
for i in range(dead_start, len(lines)):
    line = lines[i]
    if line and not line[0].isspace() and line.strip() and not line.strip().startswith('#'):
        dead_end = i
        break

print(f'Step 3: Dead code ends at line {dead_end} (exclusive), span = {dead_end - dead_start} lines')

dead_code_lines = lines[dead_start:dead_end]

# Sanity check: the dead code should contain a while True loop
dead_text = ''.join(dead_code_lines)
if 'while True:' not in dead_text:
    print('WARNING: dead code block does not contain "while True:" — verify extraction')

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Find insertion point — end of main()
#         Insert just before the first top-level function AFTER main().
# ══════════════════════════════════════════════════════════════════════════════

main_start = None
for i, line in enumerate(lines):
    if line.startswith('def main():') or line.startswith('def main('):
        main_start = i
        break

if main_start is None:
    print('ERROR: def main() not found')
    sys.exit(1)

print(f'Step 4: main() at line {main_start + 1}')

# Find the next top-level definition after main()
insert_before = None
for i in range(main_start + 1, len(lines)):
    line = lines[i]
    if line and not line[0].isspace() and line.strip():
        if line.startswith('def ') or line.startswith('class ') or line.startswith('if '):
            insert_before = i
            break

if insert_before is None:
    print('ERROR: Could not find end of main() (no following top-level definition)')
    sys.exit(1)

print(f'Step 4: Will insert dead code before line {insert_before + 1}: {lines[insert_before].rstrip()!r}')

if insert_before >= dead_start:
    print(f'ERROR: insert_before ({insert_before}) >= dead_start ({dead_start}) — main() appears to be after the dead code')
    print('       This would create a circular reference.  Manual fix required.')
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Rebuild the file
# ══════════════════════════════════════════════════════════════════════════════
#
# New layout:
#   lines[:insert_before]                   — everything up to end of main()
#   sentinel + dead_code_lines              — the rescued main loop (inside main())
#   lines[insert_before:return_false_idx+1] — helper functions up to return False
#   lines[dead_end:]                        — anything after dead code (if __name__ etc.)
#
# Note: lines[insert_before:return_false_idx+1] includes
#   - get_new_messages_with_attachments (if it lives between main_end and attach_fn)
#   - _process_imessage_attachment body through return False
#   The dead code (lines[dead_start:dead_end]) is skipped — we already placed it above.

sentinel = '    # _bridge_main_loop_fixed — rescued from dead code inside _process_imessage_attachment\n'

# Ensure a blank line before the sentinel if the line above isn't already blank
prefix = lines[:insert_before]
if prefix and prefix[-1].strip() != '':
    prefix = prefix + ['\n']

new_lines = (
    prefix
    + [sentinel]
    + dead_code_lines
    + ['\n']
    + lines[insert_before:return_false_idx + 1]   # helpers + return False
    + lines[dead_end:]                             # rest of file after dead block
)

new_content = ''.join(new_lines)

# ══════════════════════════════════════════════════════════════════════════════
# Step 6: Validate & write
# ══════════════════════════════════════════════════════════════════════════════

import tempfile, os
with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as tf:
    tf.write(new_content)
    tmp_path = tf.name

r = subprocess.run([PYTHON, '-m', 'py_compile', tmp_path], capture_output=True, text=True)
os.unlink(tmp_path)

if r.returncode != 0:
    print(f'\nSYNTAX ERROR in rebuilt file:\n{r.stderr}')
    _lm = re.search(r'line (\d+)', r.stderr)
    if _lm:
        _el = int(_lm.group(1))
        _new_lines_list = new_content.splitlines()
        _lo, _hi = max(0, _el - 5), min(len(_new_lines_list), _el + 3)
        print(f'\n--- rebuilt bridge.py lines {_lo+1}–{_hi} ---')
        for _i, _l in enumerate(_new_lines_list[_lo:_hi], _lo + 1):
            print(f'{">>>" if _i == _el else "   "} {_i:4d}: {_l}')
        print('---')
    print('\nOriginal bridge.py NOT modified.')
    sys.exit(1)

print('\nStep 6: Syntax OK — writing bridge.py')
open(BRIDGE, 'w', encoding='utf-8').write(new_content)

# Quick sanity: confirm sentinel is present
reread = open(BRIDGE, encoding='utf-8').read()
assert '_bridge_main_loop_fixed' in reread, 'Sentinel not found after write!'
assert 'while True:' in reread, 'Main loop missing after write!'
print('Step 6: Sentinel confirmed in bridge.py')

# ══════════════════════════════════════════════════════════════════════════════
# Step 7: Restart bridge
# ══════════════════════════════════════════════════════════════════════════════

PLIST = 'com.cowork.bridge'

print('\nStep 7: Restarting launchctl service...')
subprocess.run(['launchctl', 'unload', f'{HOME}/Library/LaunchAgents/{PLIST}.plist'],
               capture_output=True)
import time; time.sleep(1)
r2 = subprocess.run(['launchctl', 'load', f'{HOME}/Library/LaunchAgents/{PLIST}.plist'],
                    capture_output=True, text=True)
print(f'  launchctl load exit code: {r2.returncode}')
if r2.stderr:
    print(f'  stderr: {r2.stderr.strip()}')

time.sleep(2)
r3 = subprocess.run(['pgrep', '-f', 'bridge.py'], capture_output=True, text=True)
if r3.stdout.strip():
    print(f'\n✅ Bridge running — PID(s): {r3.stdout.strip()}')
    print('\nTest with iMessage:')
    print('  !exec ls ~/Desktop')
    print('  → Should reply: "Command: ls ~/Desktop\\nReply \\"run it\\" to execute..."')
    print('  run it')
    print('  → Should run ls and return output')
else:
    print('\n⚠️  Bridge process not detected after restart — check logs:')
    print(f'  tail -50 {HOME}/cowork-bridge/bridge_error.log')
    print(f'  tail -50 {HOME}/cowork-bridge/bridge.log')
