#!/usr/bin/env python3
"""
fix_bridge_refresh_loop.py — Fix the _embed_refresh_loop function body.

After fix_bridge_main_loop.py rescued the dead code, the _embed_refresh_loop
function body ended up broken:

  BROKEN (current state):
    def _embed_refresh_loop():
        import time as _tr
                                        ← function body ends here (only 1 line)
# ── iMessage Attachment Support ────   ← 0-indent comment broke the function
                                        ← stray blank line
    # _bridge_main_loop_fixed sentinel
    while True:                         ← 4-space indent (INSIDE main() — blocks forever!)
            _tr.sleep(1800)             ← 12-space (NameError: _tr not in scope)

  FIXED (target state):
    def _embed_refresh_loop():
        import time as _tr
        while True:                     ← 8-space (inside the function)
            _tr.sleep(1800)             ← 12-space (inside while, fine)
            ...

The 0-indent comment and the extra blank/sentinel lines are removed from
between the function def and the while loop.

Guard sentinel: '_refresh_loop_fixed'
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_refresh_loop_fixed' in s:
    print('SKIPPED — refresh loop fix already applied')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# The broken pattern — match flexibly since there may be slight whitespace diffs
# ══════════════════════════════════════════════════════════════════════════════

# We'll work line-by-line for precision
lines = s.splitlines(keepends=True)

# Step 1: Find the _embed_refresh_loop definition
fn_line = None
for i, line in enumerate(lines):
    if '    def _embed_refresh_loop():' in line:
        fn_line = i
        break

if fn_line is None:
    print('ERROR: def _embed_refresh_loop() not found')
    sys.exit(1)
print(f'Found _embed_refresh_loop at line {fn_line + 1}')

# Step 2: Find the `while True:` that belongs to the loop body
# It should be within the next 20 lines, currently at wrong indent
while_line = None
for i in range(fn_line + 1, min(fn_line + 25, len(lines))):
    stripped = lines[i].rstrip()
    # Find 'while True:' at 4-space indent (the broken position)
    if stripped == '    while True:':
        while_line = i
        break

if while_line is None:
    print('ERROR: Could not find "    while True:" near _embed_refresh_loop')
    # Show context for debugging
    print('Context:')
    for i in range(fn_line, min(fn_line + 20, len(lines))):
        print(f'  {i+1:4d}: {lines[i].rstrip()!r}')
    sys.exit(1)

print(f'Found broken "while True:" at line {while_line + 1}')

# Step 3: Identify lines to REMOVE between fn_line+2 and while_line (exclusive)
# These are: blank lines, 0-indent comment, sentinel comment — all junk between
# the function def and the while True body.
junk_start = fn_line + 2   # line after `    import time as _tr`
junk_end   = while_line    # up to but not including the while True line

print(f'Removing junk lines {junk_start + 1}–{junk_end} (between import and while):')
for i in range(junk_start, junk_end):
    print(f'  {i+1:4d}: {lines[i].rstrip()!r}')

# Step 4: Fix the while True line — change from 4-space to 8-space indent
fixed_while = lines[while_line].replace('    while True:', '        while True:', 1)
print(f'Fixed while indent: {lines[while_line].rstrip()!r} → {fixed_while.rstrip()!r}')

# Step 5: Rebuild
new_lines = (
    lines[:junk_start]          # everything up to and including `import time as _tr`
    + ['        # _refresh_loop_fixed\n']  # sentinel inside function body
    + [fixed_while]             # `        while True:` (8-space)
    + lines[while_line + 1:]    # rest of file unchanged
)

new_s = ''.join(new_lines)

# ══════════════════════════════════════════════════════════════════════════════
# Validate
# ══════════════════════════════════════════════════════════════════════════════
import tempfile, os
with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as tf:
    tf.write(new_s)
    tmp_path = tf.name

r = subprocess.run([PYTHON, '-m', 'py_compile', tmp_path], capture_output=True, text=True)
os.unlink(tmp_path)

if r.returncode != 0:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    lm = re.search(r'line (\d+)', r.stderr)
    if lm:
        el = int(lm.group(1))
        nl = new_s.splitlines()
        lo, hi = max(0, el - 5), min(len(nl), el + 4)
        print(f'\n--- rebuilt bridge.py lines {lo+1}–{hi} ---')
        for idx, ln in enumerate(nl[lo:hi], lo + 1):
            print(f'{">>>" if idx == el else "   "} {idx:4d}: {ln}')
        print('---')
    print('\nOriginal bridge.py NOT modified.')
    sys.exit(1)

print('\nSyntax OK — writing bridge.py')
open(BRIDGE, 'w', encoding='utf-8').write(new_s)

# ══════════════════════════════════════════════════════════════════════════════
# Restart
# ══════════════════════════════════════════════════════════════════════════════
import time as _t

PLIST = 'com.cowork.bridge'
PLIST_PATH = HOME / 'Library' / 'LaunchAgents' / f'{PLIST}.plist'

print('\nRestarting launchctl service...')
subprocess.run(['launchctl', 'unload', str(PLIST_PATH)], capture_output=True)
_t.sleep(1)
subprocess.run(['launchctl', 'load', str(PLIST_PATH)], capture_output=True)
_t.sleep(3)

r2 = subprocess.run(['pgrep', '-f', 'bridge.py'], capture_output=True, text=True)
pids = r2.stdout.strip()
if pids:
    print(f'\n✅ Bridge running — PID(s): {pids}')
    print('\nVerify with:')
    print(f'  tail -5 {BRIDGE_DIR}/bridge.log')
    print('\nThen test via iMessage:')
    print('  !exec ls ~/Desktop')
    print('  → should reply: Command: ls ~/Desktop  Reply "run it" to execute...')
else:
    print(f'\n⚠️  Bridge still not running — check:')
    print(f'  tail -30 {BRIDGE_DIR}/bridge_error.log')
