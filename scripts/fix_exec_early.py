#!/usr/bin/env python3
"""
fix_exec_early.py — Move !exec dispatch to the earliest possible position in the
message loop, right after the /help handler. This guarantees it's checked before
any _tl reassignment, agentic routing, or other handlers can interfere.

Also fixes the guard sentinel so the old !exec block is removed and replaced.
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_exec_early_fix' in s:
    print('SKIPPED — exec early fix already applied')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Remove the OLD !exec dispatch block (inserted by fix_exec_command.py)
# ══════════════════════════════════════════════════════════════════════════════

OLD_EXEC_BLOCK = (
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
    '                            f\'Command: {_exec_arg}\\n\\nReply "run it" to execute or "cancel" to discard.\')\n'
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

if OLD_EXEC_BLOCK in s:
    s = s.replace(OLD_EXEC_BLOCK, '', 1)
    print('Step 1: Removed old !exec dispatch block')
else:
    print('Step 1: Old !exec block not found (may have different whitespace) — will insert new one anyway')

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Insert NEW !exec dispatch right after the /help handler
#         Anchor: the /help handler ends with `continue`
#         We look for the specific continue that follows send_imessage(REPLY_TO, help_msg)
# ══════════════════════════════════════════════════════════════════════════════

HELP_ANCHOR = (
    '                    send_imessage(REPLY_TO, help_msg)\n'
    '                    continue\n'
)

# The new !exec block — uses text directly (not _tl, which may not be set yet)
NEW_EXEC_BLOCK = (
    '                    send_imessage(REPLY_TO, help_msg)\n'
    '                    continue\n'
    '                # _exec_early_fix: !exec checked before _tl / agentic path\n'
    '                _text_l = text.strip().lower()\n'
    '                if _text_l.startswith(\'!exec \') or _text_l == \'!exec\':\n'
    '                    print(f\'[exec] Command received: {text.strip()!r}\', flush=True)\n'
    '                    _exec_arg = text.strip()[6:].strip()\n'
    '                    if not _exec_arg:\n'
    '                        send_imessage(REPLY_TO, \'Usage: !exec <shell command>\\n!exec history — last 5 runs\\n!exec last — last run\')\n'
    '                    elif _exec_arg == \'history\':\n'
    '                        if not _exec_history:\n'
    '                            send_imessage(REPLY_TO, \'No commands run yet.\')\n'
    '                        else:\n'
    '                            _eh_lines_e = [f\'{_i+1}. [{_e["ts"]}] $ {_e["cmd"]}\'\n'
    '                                           for _i, _e in enumerate(_exec_history[-5:])]\n'
    '                            send_imessage(REPLY_TO, \'Last \' + str(len(_eh_lines_e)) + \' commands:\\n\' + \'\\n\'.join(_eh_lines_e))\n'
    '                    elif _exec_arg == \'last\':\n'
    '                        if not _exec_history:\n'
    '                            send_imessage(REPLY_TO, \'No commands run yet.\')\n'
    '                        else:\n'
    '                            send_imessage(REPLY_TO, _exec_history[-1][\'output\'])\n'
    '                    else:\n'
    '                        _pending_exec[\'cmd\'] = _exec_arg\n'
    '                        _pending_exec[\'requested_by\'] = REPLY_TO\n'
    '                        send_imessage(REPLY_TO,\n'
    '                            \'Command: \' + _exec_arg + \'\\n\\nReply "run it" to execute or "cancel" to discard.\')\n'
    '                    continue\n'
    '                # ── confirm / cancel pending !exec ──────────────────────\n'
    '                if _pending_exec and _text_l == \'run it\':\n'
    '                    _pe_cmd = _pending_exec.pop(\'cmd\', \'\')\n'
    '                    _pending_exec.clear()\n'
    '                    if _pe_cmd:\n'
    '                        send_imessage(REPLY_TO, \'Running: \' + _pe_cmd)\n'
    '                        import threading as _eth2\n'
    '                        _eth2.Thread(\n'
    '                            target=_run_exec_command,\n'
    '                            args=(_pe_cmd, REPLY_TO),\n'
    '                            daemon=True,\n'
    '                            name=\'exec-run\',\n'
    '                        ).start()\n'
    '                    else:\n'
    '                        send_imessage(REPLY_TO, \'No pending command to run.\')\n'
    '                    continue\n'
    '                if _pending_exec and _text_l == \'cancel\':\n'
    '                    _pending_exec.clear()\n'
    '                    send_imessage(REPLY_TO, \'Command cancelled.\')\n'
    '                    continue\n'
)

if HELP_ANCHOR in s:
    s = s.replace(HELP_ANCHOR, NEW_EXEC_BLOCK, 1)
    print('Step 2: !exec dispatch inserted right after /help handler')
else:
    print('Step 2 FAILED — /help anchor not found')
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# Write & validate
# ══════════════════════════════════════════════════════════════════════════════
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — !exec moved to earliest position in message loop')
    print('Now test with: !exec ls ~/Desktop')
    print('Expected: "Command: ls ~/Desktop\\nReply \\"run it\\" to execute..."')
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
