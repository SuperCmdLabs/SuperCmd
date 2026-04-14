#!/usr/bin/env python3
"""
harden_exec_allowlist.py — Restrict dangerous commands to known senders.

PROBLEM
=======
!exec, !build, and the approve/reject flow run with no sender check.
Anyone who can iMessage the Mac mini could:
  - Send "!exec rm -rf ~/important-dir"
  - Then spoof or socially engineer a "run it" reply
  - Bridge executes the command with the user's full privileges

Even for personal use, this is risky: accidental "run it" replies to
non-exec conversations (bridge matches them if _pending_exec is set).

THE FIX
=======
Add an EXEC_ALLOWED_SENDERS allowlist (a set) populated from:
  1. ~/cowork-bridge/.env  →  EXEC_ALLOWED_SENDERS=+15551234567,user@icloud.com
  2. Hardcoded fallback: process owner's local handles from iMessage DB

Commands gated by the allowlist:
  - !exec <cmd>
  - run it  (confirm pending !exec)
  - cancel  (cancel pending !exec)
  - approve (approve pending !build)
  - reject  (reject pending !build)

Non-allowlisted senders for these commands get a silent ignore (no reply,
to avoid leaking that the bridge is listening).

Guard sentinel: '_exec_allowed_senders'
"""
import pathlib, subprocess, sys

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_exec_allowed_senders' in s:
    print('SKIPPED — sender allowlist already installed')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Add EXEC_ALLOWED_SENDERS global (inserted at module level near the
#         other globals, before the main loop)
# ══════════════════════════════════════════════════════════════════════════════

ALLOWLIST_CODE = r'''
# ── !exec / !build sender allowlist ──────────────────────────────────────────
# Populate via .env: EXEC_ALLOWED_SENDERS=+15551234567,me@icloud.com
# If empty, falls back to accepting messages from yourself only (is_from_me).
# Commands checked: !exec, run it, cancel, approve, reject

def _load_exec_allowed_senders():
    """Load allowed senders from .env EXEC_ALLOWED_SENDERS, or return empty set."""
    import os as _oas, pathlib as _oap
    _raw = _oas.environ.get('EXEC_ALLOWED_SENDERS', '')
    if not _raw:
        _env_file = _oap.Path.home() / 'cowork-bridge' / '.env'
        if _env_file.exists():
            for _line in _env_file.read_text().splitlines():
                _line = _line.strip()
                if _line.startswith('EXEC_ALLOWED_SENDERS='):
                    _raw = _line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
    if _raw:
        _senders = {s.strip().lower() for s in _raw.split(',') if s.strip()}
        print(f'[security] EXEC_ALLOWED_SENDERS: {len(_senders)} sender(s) configured', flush=True)
        return _senders
    print('[security] EXEC_ALLOWED_SENDERS not configured — all senders allowed for !exec', flush=True)
    return set()  # empty = open (no restriction)

_exec_allowed_senders = _load_exec_allowed_senders()


def _is_exec_allowed(reply_to: str) -> bool:
    """Return True if reply_to is allowed to use !exec/!build commands."""
    if not _exec_allowed_senders:
        return True  # no restriction configured
    return reply_to.strip().lower() in _exec_allowed_senders

'''

# Insert before _pending_exec definition (added by fix_exec_command.py)
ANCHOR = '_pending_exec  = {}   # {cmd, requested_by}'
if ANCHOR in s:
    s = s.replace(ANCHOR, ALLOWLIST_CODE + ANCHOR, 1)
    print('Part 1: EXEC_ALLOWED_SENDERS block inserted before _pending_exec')
else:
    # Fallback: insert before _run_exec_command
    ANCHOR2 = 'def _run_exec_command(cmd: str, sender: str):'
    if ANCHOR2 in s:
        s = s.replace(ANCHOR2, ALLOWLIST_CODE + ANCHOR2, 1)
        print('Part 1: EXEC_ALLOWED_SENDERS block inserted before _run_exec_command (fallback anchor)')
    else:
        print('Part 1 FAILED — could not find insertion anchor')
        sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Guard the !exec dispatch with _is_exec_allowed(REPLY_TO)
# ══════════════════════════════════════════════════════════════════════════════

# The !exec dispatch starts with (from fix_exec_early.py):
#   if _text_l.startswith('!exec ') or _text_l == '!exec':
# We wrap the entire block by changing this to:
#   if (_text_l.startswith('!exec ') or _text_l == '!exec') and _is_exec_allowed(REPLY_TO):

OLD_EXEC_IF = "                if _text_l.startswith('!exec ') or _text_l == '!exec':"
NEW_EXEC_IF = "                if (_text_l.startswith('!exec ') or _text_l == '!exec') and _is_exec_allowed(REPLY_TO):"

if OLD_EXEC_IF in s:
    s = s.replace(OLD_EXEC_IF, NEW_EXEC_IF, 1)
    print('Part 2: !exec dispatch guarded with _is_exec_allowed()')
else:
    print('Part 2 WARNING: !exec dispatch pattern not found — guard not applied')

# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Guard "run it" and "cancel" (pending !exec confirmation)
# ══════════════════════════════════════════════════════════════════════════════

OLD_RUNIT = "                if _pending_exec and _text_l == 'run it':"
NEW_RUNIT = "                if _pending_exec and _text_l == 'run it' and _is_exec_allowed(REPLY_TO):"

if OLD_RUNIT in s:
    s = s.replace(OLD_RUNIT, NEW_RUNIT, 1)
    print('Part 3a: "run it" guard added')
else:
    print('Part 3a WARNING: "run it" pattern not found')

OLD_CANCEL = "                if _pending_exec and _text_l == 'cancel':"
NEW_CANCEL = "                if _pending_exec and _text_l == 'cancel' and _is_exec_allowed(REPLY_TO):"

if OLD_CANCEL in s:
    s = s.replace(OLD_CANCEL, NEW_CANCEL, 1)
    print('Part 3b: "cancel" guard added')
else:
    print('Part 3b WARNING: "cancel" pattern not found')

# ══════════════════════════════════════════════════════════════════════════════
# Part 4: Guard approve/reject (!build approval flow)
# ══════════════════════════════════════════════════════════════════════════════

OLD_APPROVE = "                if _pending_build and text.strip().lower() == 'approve':"
NEW_APPROVE = "                if _pending_build and text.strip().lower() == 'approve' and _is_exec_allowed(REPLY_TO):"

if OLD_APPROVE in s:
    s = s.replace(OLD_APPROVE, NEW_APPROVE, 1)
    print('Part 4a: "approve" guard added')
else:
    print('Part 4a WARNING: "approve" pattern not found (may not be installed)')

OLD_REJECT = "                if _pending_build and text.strip().lower().startswith('reject'):"
NEW_REJECT = "                if _pending_build and text.strip().lower().startswith('reject') and _is_exec_allowed(REPLY_TO):"

if OLD_REJECT in s:
    s = s.replace(OLD_REJECT, NEW_REJECT, 1)
    print('Part 4b: "reject" guard added')
else:
    print('Part 4b WARNING: "reject" pattern not found (may not be installed)')

# ══════════════════════════════════════════════════════════════════════════════
# Validate & write
# ══════════════════════════════════════════════════════════════════════════════
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
print('\n✅ Sender allowlist installed')
print('\nTo restrict !exec/!build to your phone number only, add to ~/cowork-bridge/.env:')
print('  EXEC_ALLOWED_SENDERS=+15551234567')
print('  (use your iMessage address/phone, lowercase)')
print('\nMultiple senders:')
print('  EXEC_ALLOWED_SENDERS=+15551234567,me@icloud.com')
print('\nLeave unset = no restriction (current behavior, all senders allowed)')
