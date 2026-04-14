#!/usr/bin/env python3
"""
harden_debug_cleanup.py — Remove [DEBUG-EXEC] diagnostic prints from bridge.py.

These were added during debugging fix_exec_early.py and are now noisy in logs
and leak internal routing information. Safe to remove now that !exec is confirmed
working.

Also removes a stray print("[DEBUG-EXEC]...") that fires on every single message.

Guard sentinel: '_debug_exec_cleaned'
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_debug_exec_cleaned' in s:
    print('SKIPPED — debug cleanup already applied')
    sys.exit(0)

removed = 0
lines = s.splitlines(keepends=True)
new_lines = []

for line in lines:
    # Remove any line that contains [DEBUG-EXEC] print statements
    if '[DEBUG-EXEC]' in line and 'print(' in line:
        removed += 1
        print(f'  Removing: {line.rstrip()!r}')
        continue
    new_lines.append(line)

if removed == 0:
    print('No [DEBUG-EXEC] print lines found — nothing to remove')
    # Still write the sentinel so we don't re-run
else:
    print(f'Removed {removed} [DEBUG-EXEC] line(s)')

# Insert sentinel as a comment near the !exec dispatch
new_s = ''.join(new_lines)

# Add sentinel to the existing _exec_early_fix comment line
new_s = new_s.replace(
    '                # _exec_early_fix: !exec checked before _tl / agentic path',
    '                # _exec_early_fix: !exec checked before _tl / agentic path  # _debug_exec_cleaned',
    1
)

if '_debug_exec_cleaned' not in new_s:
    # Fallback: append sentinel to top of file as a comment
    new_s = new_s.replace(
        '# _bridge_main_loop_fixed',
        '# _bridge_main_loop_fixed  # _debug_exec_cleaned',
        1
    )

# Validate
import tempfile, os
with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as tf:
    tf.write(new_s)
    tmp_path = tf.name

r = subprocess.run([PYTHON, '-m', 'py_compile', tmp_path], capture_output=True, text=True)
os.unlink(tmp_path)

if r.returncode != 0:
    print(f'SYNTAX ERROR:\n{r.stderr}')
    print('Original bridge.py NOT modified.')
    sys.exit(1)

open(BRIDGE, 'w', encoding='utf-8').write(new_s)
print('\n✅ Debug prints removed — bridge.py updated')
