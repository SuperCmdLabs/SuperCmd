#!/usr/bin/env python3
"""
fix_exec_command.py — Add !exec command to bridge.py for iMessage-triggered terminal actions.

Adds a safe, confirmation-gated shell execution command:

  !exec <shell command>
    → Bridge replies: "Command: <cmd>\nReply 'run it' to execute or 'cancel'"
    → You reply "run it" → bridge runs the command, sends stdout/stderr back
    → You reply "cancel" → discarded

  !exec last           → shows the last command + output (audit log)
  !exec history        → shows last 5 commands run

Safety design:
  - Single confirmation before any execution (like !build → approve)
  - Output capped at 2000 chars to avoid iMessage flooding
  - _pending_exec global stores pending command; auto-cleared on execute or cancel
  - Timeout: 30s max for any command
  - No auto-run — always requires "run it" confirmation

Guard sentinel: '_pending_exec'
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_pending_exec' in s:
    print('SKIPPED — !exec command already installed')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Add _pending_exec global + _run_exec_command() helper
# ══════════════════════════════════════════════════════════════════════════════

EXEC_HELPERS = r'''
# ── !exec: iMessage-triggered shell execution ─────────────────────────────────

_pending_exec  = {}   # {cmd, requested_by}
_exec_history  = []   # [{cmd, output, ts}] — last 10 runs


def _run_exec_command(cmd: str, sender: str):
    """Run a shell command and send output via iMessage. Called after confirmation."""
    import subprocess as _esp, datetime as _edt, shlex as _esh

    print(f'[exec] Running: {cmd}', flush=True)
    try:
        _r = _esp.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(__import__('pathlib').Path.home()),
        )
        _out = (_r.stdout or '').strip()
        _err = (_r.stderr or '').strip()
        _combined = _out
        if _err:
            _combined = (_combined + '\n[stderr]\n' + _err).strip()
        if not _combined:
            _combined = '(no output)'
        _rc_note = '' if _r.returncode == 0 else f'\n[exit {_r.returncode}]'
        _reply = f'$ {cmd}\n{_combined[:1900]}{_rc_note}'
    except __import__('subprocess').TimeoutExpired:
        _reply = f'$ {cmd}\n[timed out after 30s]'
    except Exception as _ee:
        _reply = f'$ {cmd}\n[error: {_ee}]'

    # Store in history
    _exec_history.append({
        'cmd': cmd,
        'output': _reply,
        'ts': _edt.datetime.now().isoformat(timespec='seconds'),
    })
    if len(_exec_history) > 10:
        _exec_history.pop(0)

    send_imessage(sender, _reply)
    print(f'[exec] Done. Output length: {len(_reply)}', flush=True)

'''

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Wire !exec dispatch into the message loop
# ══════════════════════════════════════════════════════════════════════════════
# Insert after the approve/reject block (which ends with the approve/reject
# continue statements). Anchor on the !build command handler comment that
# follows, or on a known reliable anchor.

EXEC_DISPATCH = (
    '                # ── !exec: shell command with confirmation gate ─────────\n'
    '                if _tl.startswith(\'!exec \') or _tl == \'!exec\':\n'
    '                    _exec_arg = text.strip()[5:].strip()\n'
    '                    if not _exec_arg:\n'
    '                        send_imessage(REPLY_TO, \'Usage: !exec <shell command>\\n!exec history — last 5 runs\\n!exec last — last run\')\n'
    '                    elif _exec_arg == \'history\':\n'
    '                        if not _exec_history:\n'
    '                            send_imessage(REPLY_TO, \'No commands run yet.\')\n'
    '                        else:\n'
    '                            _eh_lines = [f\'{i+1}. [{_e["ts"]}] $ {_e["cmd"]}\'\n'
    '                                         for i, _e in enumerate(_exec_history[-5:])]\n'
    '                            send_imessage(REPLY_TO, \'Last {} commands:\\n\'.format(len(_eh_lines)) + \'\\n\'.join(_eh_lines))\n'
    '                    elif _exec_arg == \'last\':\n'
    '                        if not _exec_history:\n'
    '                            send_imessage(REPLY_TO, \'No commands run yet.\')\n'
    '                        else:\n'
    '                            send_imessage(REPLY_TO, _exec_history[-1][\'output\'])\n'
    '                    else:\n'
    '                        _pending_exec[\'cmd\'] = _exec_arg\n'
    '                        _pending_exec[\'requested_by\'] = REPLY_TO\n'
    '                        send_imessage(REPLY_TO,\n'
    '                            f\'Command: {_exec_arg}\\n\\nReply \"run it\" to execute or \"cancel\" to discard.\')\n'
    '                    continue\n'
    '                # ── confirm / cancel pending !exec ──────────────────────\n'
    '                if _pending_exec and _tl == \'run it\':\n'
    '                    _pe_cmd = _pending_exec.pop(\'cmd\', \'\')\n'
    '                    _pending_exec.clear()\n'
    '                    if _pe_cmd:\n'
    '                        send_imessage(REPLY_TO, f\'Running: {_pe_cmd}\')\n'
    '                        import threading as _eth\n'
    '                        _eth.Thread(\n'
    '                            target=_run_exec_command,\n'
    '                            args=(_pe_cmd, REPLY_TO),\n'
    '                            daemon=True,\n'
    '                            name=\'exec-run\',\n'
    '                        ).start()\n'
    '                    else:\n'
    '                        send_imessage(REPLY_TO, \'No pending command to run.\')\n'
    '                    continue\n'
    '                if _pending_exec and _tl == \'cancel\':\n'
    '                    _pending_exec.clear()\n'
    '                    send_imessage(REPLY_TO, \'Command cancelled.\')\n'
    '                    continue\n'
)

# ══════════════════════════════════════════════════════════════════════════════
# Apply patches
# ══════════════════════════════════════════════════════════════════════════════

# Part 1: Insert helpers before _apply_patch or run_shell or query_ollama
anchors1 = ['\ndef _apply_patch(', '\ndef run_shell(', '\ndef execute_code_task(', '\ndef query_ollama(']
inserted1 = False
for _a1 in anchors1:
    _pos1 = s.find(_a1)
    if _pos1 != -1:
        s = s[:_pos1] + EXEC_HELPERS + s[_pos1:]
        print(f'Part 1: _pending_exec + _run_exec_command inserted before "{_a1.strip()}"')
        inserted1 = True
        break
if not inserted1:
    print('Part 1 FAILED — no anchor found')
    sys.exit(1)

# Part 2: Wire dispatch into the message loop.
# Best anchor: the approve/reject block ends with a `continue` then a blank line.
# We find the !build dispatch block end or the approve/reject block end.
# Strategy: find the approve/reject sentinel text first, then insert after it.
# Fallback: insert before the !build command anchor.

_inserted2 = False

# Try anchor: approve/reject block ends with this pattern
APPROVE_END = (
    "                    send_imessage(REPLY_TO, 'Build discarded. Send !build <task> to start fresh.')\n"
    "                    continue\n"
)
_ae_pos = s.find(APPROVE_END)
if _ae_pos != -1:
    _insert2_pos = _ae_pos + len(APPROVE_END)
    s = s[:_insert2_pos] + EXEC_DISPATCH + s[_insert2_pos:]
    print('Part 2: !exec dispatch inserted after approve/reject block (anchor 1)')
    _inserted2 = True

if not _inserted2:
    # Fallback: look for the !build command start and insert before it
    BUILD_ANCHOR = "                # ── !build / !task LangGraph command"
    if BUILD_ANCHOR not in s:
        # Broader fallback
        BUILD_ANCHOR = "                if _tl.startswith('!build')"
    _ba_pos = s.find(BUILD_ANCHOR)
    if _ba_pos != -1:
        s = s[:_ba_pos] + EXEC_DISPATCH + s[_ba_pos:]
        print(f'Part 2: !exec dispatch inserted before !build block (fallback anchor)')
        _inserted2 = True

if not _inserted2:
    # Last resort: find a known loop anchor like 'REPLY_TO' assignment block
    LOOP_ANCHOR = "                # ── approve / reject build replies"
    _la_pos = s.rfind(LOOP_ANCHOR)
    if _la_pos != -1:
        # Insert right after the whole approve/reject section
        _end_of_approve = s.find('\n\n', _la_pos + len(LOOP_ANCHOR))
        if _end_of_approve == -1:
            _end_of_approve = _la_pos + 500
        # Walk forward to find a double-newline that's not inside the block
        _insert2_pos = _la_pos
        # Just insert before this anchor instead
        s = s[:_la_pos] + EXEC_DISPATCH + s[_la_pos:]
        print('Part 2: !exec dispatch inserted via last-resort anchor')
        _inserted2 = True

if not _inserted2:
    print('Part 2 WARNING: Could not find insertion point for !exec dispatch')
    print('Part 2: Manually insert EXEC_DISPATCH into the message loop')

# ══════════════════════════════════════════════════════════════════════════════
# Write & validate
# ══════════════════════════════════════════════════════════════════════════════
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — !exec command installed')
    print('\nUsage (via iMessage):')
    print('  !exec ls ~/Documents       → asks for confirmation')
    print('  run it                     → executes, sends output back')
    print('  cancel                     → discards pending command')
    print('  !exec history              → shows last 5 commands run')
    print('  !exec last                 → shows output of last command')
    print('\nSafety: 30s timeout, 1900 char output cap, always requires "run it" confirmation')
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
