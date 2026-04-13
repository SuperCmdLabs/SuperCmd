#!/usr/bin/env python3
"""
fix_self_improvement.py — Add approval/reject/apply loop to bridge.py.

Builds on fix_langgraph.py (!build command). Adds:

1. _pending_build global — stores last build result awaiting approval
2. Reply parser — detects 'approve' / 'reject: <feedback>' before normal LLM
3. _apply_patch(code, task) — backup → apply → py_compile → launchctl reload
4. Rejection loop — re-runs LangGraph with feedback, up to 3 rounds

Flow:
  !build <task>
    → LangGraph runs (planner → writer → validator)
    → Result sent via iMessage + stored in _pending_build
    → "approve" → _apply_patch() → bridge restarts
    → "reject: needs error handling" → re-run graph with feedback
    → "reject" (no feedback) → discard pending build

Safety guards:
  - py_compile validation before any write
  - Automatic backup to ~/cowork-bridge/bridge.backup.<timestamp>.py
  - Only patches bridge.py (no arbitrary file writes)
  - Double-confirm for self-modification: bridge sends "Applying patch..."
    before writing, so you see it happen
"""
import pathlib, subprocess, sys, re

HOME      = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON    = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE    = str(BRIDGE_DIR / 'bridge.py')

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_pending_build' in s:
    print('SKIPPED — self-improvement loop already installed')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Add _pending_build global + _apply_patch() + _rerun_build() to bridge
# ══════════════════════════════════════════════════════════════════════════════
SELF_IMPROVE_CODE = r'''
# ── Self-improvement: pending build state + patch applier ─────────────────────

_pending_build = {}   # {task, code, plan, review, approved, round}


def _apply_patch(code: str, task: str, sender: str):
    """
    Apply a code patch to bridge.py:
      1. Extract Python code block from the LLM output
      2. Validate syntax with py_compile
      3. Write backup
      4. Append/replace in bridge.py
      5. Reload via launchctl
    """
    import pathlib as _ap, subprocess as _asp, datetime as _adt, tempfile as _atmp, os as _aos

    _bridge_path = _ap.Path(__file__)
    _backup_name = f'bridge.backup.{_adt.datetime.now():%Y%m%d_%H%M%S}.py'
    _backup_path = _bridge_path.parent / _backup_name

    # Extract code: strip markdown fences if present
    _code = code.strip()
    _fence_m = __import__('re').search(r'```(?:python)?\n(.*?)```', _code, __import__('re').DOTALL)
    if _fence_m:
        _code = _fence_m.group(1).strip()

    if not _code:
        send_imessage(sender, '[Apply] No code to apply — build result was empty')
        return False

    # Validate: py_compile the new code snippet standalone
    _tmp = _atmp.NamedTemporaryFile(suffix='.py', delete=False, mode='w')
    _tmp.write(_code)
    _tmp.close()
    _r = _asp.run([__import__('sys').executable, '-m', 'py_compile', _tmp.name],
                  capture_output=True, text=True)
    _aos.unlink(_tmp.name)
    if _r.returncode != 0:
        send_imessage(sender, f'[Apply] Syntax error in patch — not applied:\n{_r.stderr[:300]}')
        print(f'[build] Patch syntax error:\n{_r.stderr}', flush=True)
        return False

    # Read current bridge source
    _current = _bridge_path.read_text(encoding='utf-8', errors='replace')

    # Write backup
    _backup_path.write_text(_current)
    print(f'[build] Backup written: {_backup_name}', flush=True)

    # Append the new code before the main loop sentinel or at end
    _sentinel = '\nif __name__ == \'__main__\':'
    _alt_sentinel = '\nwhile True:'
    if _sentinel in _current:
        _new_source = _current.replace(_sentinel, f'\n\n# ── Auto-patched: {task[:60]} ──\n{_code}\n{_sentinel}', 1)
    elif _alt_sentinel in _current:
        # Find the last main loop and insert before it
        _idx = _current.rfind(_alt_sentinel)
        _new_source = _current[:_idx] + f'\n\n# ── Auto-patched: {task[:60]} ──\n{_code}\n' + _current[_idx:]
    else:
        _new_source = _current + f'\n\n# ── Auto-patched: {task[:60]} ──\n{_code}\n'

    # Validate the full patched bridge
    _tmp2 = _atmp.NamedTemporaryFile(suffix='.py', delete=False, mode='w')
    _tmp2.write(_new_source)
    _tmp2.close()
    _r2 = _asp.run([__import__('sys').executable, '-m', 'py_compile', _tmp2.name],
                   capture_output=True, text=True)
    _aos.unlink(_tmp2.name)
    if _r2.returncode != 0:
        send_imessage(sender, f'[Apply] Patched bridge has syntax error — restored:\n{_r2.stderr[:300]}')
        print(f'[build] Patched bridge syntax error:\n{_r2.stderr}', flush=True)
        return False

    # Write patched bridge
    _bridge_path.write_text(_new_source)
    print(f'[build] Patch applied to {_bridge_path}', flush=True)
    send_imessage(sender, f'✅ Patch applied. Restarting bridge...\nBackup: {_backup_name}')

    # Reload via launchctl
    _plist = str(_ap.Path.home() / 'Library/LaunchAgents/com.alexmcgann.cowork-bridge.plist')
    _asp.run(['launchctl', 'unload', _plist], capture_output=True)
    _asp.run(['launchctl', 'load',   _plist], capture_output=True)
    print('[build] Bridge reloaded via launchctl', flush=True)
    return True


def _rerun_build(feedback: str, sender: str):
    """Re-run the LangGraph graph with rejection feedback."""
    import threading as _rth, sys as _rsys, pathlib as _rpl

    _task = _pending_build.get('task', '')
    _round = _pending_build.get('round', 1)

    if _round >= 3:
        send_imessage(sender, '[Build] Max revision rounds reached (3). Start fresh with !build.')
        _pending_build.clear()
        return

    _agent_path = str(_rpl.Path.home() / 'cowork-bridge')
    if _agent_path not in _rsys.path:
        _rsys.path.insert(0, _agent_path)

    try:
        from langgraph_agent import run_build
    except ImportError as _ie:
        send_imessage(sender, f'[Build] LangGraph not available: {_ie}')
        return

    _full_task = f'{_task}\n\nPrevious attempt feedback: {feedback}'
    _pending_build['round'] = _round + 1

    def _progress(msg):
        send_imessage(sender, msg)
        print(f'[build] {msg}', flush=True)

    def _run():
        try:
            state = run_build(_full_task, progress_cb=_progress)
        except Exception as _e:
            send_imessage(sender, f'[Build] Error on retry: {_e}')
            return

        if state.get('error'):
            send_imessage(sender, f'[Build failed] {state["error"]}')
            return

        _pending_build.update({
            'task': _task,
            'code': state['code'],
            'plan': state['plan'],
            'review': state['review'],
            'approved': state['approved'],
        })

        _verdict = '✅ Approved' if state['approved'] else '⚠️ Needs revision'
        _msg = (
            f'[Build revision {_round + 1}]\n'
            f'Task: {_task[:80]}\n\n'
            f'─── Plan ───\n{state["plan"][:400]}\n\n'
            f'─── Code ───\n{state["code"][:700]}\n\n'
            f'─── Review ({_verdict}) ───\n{state["review"][:300]}\n\n'
            f'Reply "approve" to apply or "reject: <feedback>" to revise again.'
        )
        send_imessage(sender, _msg)

    _rth.Thread(target=_run, daemon=True, name='langgraph-retry').start()

'''

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Patch _handle_build_command to store result in _pending_build
# ══════════════════════════════════════════════════════════════════════════════
# After the final send_imessage in _handle_build_command, add storage + prompt
OLD_BUILD_END = (
    "    send_imessage(sender, _msg)\n"
    "    print(f'[build] Done. Approved={state[\"approved\"]}', flush=True)\n"
    "\n"
    "    # Log full code to bridge.log for copy-paste\n"
    "    print(f'[build] FULL CODE:\\n{state[\"code\"]}', flush=True)\n"
)

NEW_BUILD_END = (
    "    # Store result for approval\n"
    "    _pending_build.update({\n"
    "        'task':     task,\n"
    "        'code':     state['code'],\n"
    "        'plan':     state['plan'],\n"
    "        'review':   state['review'],\n"
    "        'approved': state['approved'],\n"
    "        'round':    1,\n"
    "    })\n"
    "\n"
    "    _approval_hint = (\n"
    "        '\\n\\nReply \"approve\" to apply this patch to bridge.py, '\n"
    "        'or \"reject: <feedback>\" to revise.'\n"
    "    )\n"
    "    send_imessage(sender, _msg + _approval_hint)\n"
    "    print(f'[build] Done. Approved={state[\"approved\"]}. Awaiting iMessage approval.', flush=True)\n"
    "\n"
    "    # Log full code to bridge.log for copy-paste\n"
    "    print(f'[build] FULL CODE:\\n{state[\"code\"]}', flush=True)\n"
)

# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Wire approve/reject replies into the message loop
# ══════════════════════════════════════════════════════════════════════════════
# Insert after the !build dispatch block (which ends with 'continue')
# Anchor: the !build dispatch ends with:
#                         ).start()
#                         continue

APPROVAL_DISPATCH = (
    '                # ── approve / reject build replies ──────────────────────\n'
    '                if _pending_build and text.strip().lower() == \'approve\':\n'
    '                    _pb_code = _pending_build.get(\'code\', \'\')\n'
    '                    _pb_task = _pending_build.get(\'task\', \'\')\n'
    '                    if _pb_code:\n'
    '                        send_imessage(REPLY_TO, \'[Apply] Applying patch to bridge.py...\')\n'
    '                        _pending_build.clear()\n'
    '                        import threading as _ath\n'
    '                        _ath.Thread(\n'
    '                            target=_apply_patch,\n'
    '                            args=(_pb_code, _pb_task, REPLY_TO),\n'
    '                            daemon=True\n'
    '                        ).start()\n'
    '                    else:\n'
    '                        send_imessage(REPLY_TO, \'No pending build to approve.\')\n'
    '                    continue\n'
    '                if _pending_build and text.strip().lower().startswith(\'reject\'):\n'
    '                    _fb = text.strip()[6:].lstrip(\': \').strip()\n'
    '                    if _fb:\n'
    '                        send_imessage(REPLY_TO, f\'[Build] Revising with feedback: {_fb[:80]}\')\n'
    '                        _rerun_build(_fb, REPLY_TO)\n'
    '                    else:\n'
    '                        _pending_build.clear()\n'
    '                        send_imessage(REPLY_TO, \'Build discarded. Send !build <task> to start fresh.\')\n'
    '                    continue\n'
)

# ══════════════════════════════════════════════════════════════════════════════
# Apply all patches
# ══════════════════════════════════════════════════════════════════════════════

# Part 1: Insert SELF_IMPROVE_CODE before run_shell / query_ollama
anchors = ['\ndef run_shell(', '\ndef execute_code_task(', '\ndef query_ollama(']
inserted1 = False
for anchor in anchors:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + SELF_IMPROVE_CODE + s[pos:]
        print(f'Part 1: self-improvement functions inserted before "{anchor.strip()}"')
        inserted1 = True
        break
if not inserted1:
    print('Part 1 FAILED — no anchor found')
    sys.exit(1)

# Part 2: Patch _handle_build_command end
if OLD_BUILD_END in s:
    s = s.replace(OLD_BUILD_END, NEW_BUILD_END, 1)
    print('Part 2: _handle_build_command updated to store pending build + approval prompt')
else:
    # Try without the log line
    old_alt = (
        "    send_imessage(sender, _msg)\n"
        "    print(f'[build] Done. Approved={state[\"approved\"]}', flush=True)\n"
    )
    if old_alt in s:
        new_alt = (
            "    _pending_build.update({'task': task, 'code': state['code'],\n"
            "        'plan': state['plan'], 'review': state['review'],\n"
            "        'approved': state['approved'], 'round': 1})\n"
            "    _approval_hint = '\\n\\nReply \"approve\" to apply or \"reject: <feedback>\" to revise.'\n"
            "    send_imessage(sender, _msg + _approval_hint)\n"
            "    print(f'[build] Done. Awaiting approval.', flush=True)\n"
        )
        s = s.replace(old_alt, new_alt, 1)
        print('Part 2: _handle_build_command patched (alt match)')
    else:
        print('Part 2 WARNING: _handle_build_command end pattern not found')

# Part 3: Wire approve/reject after the !build dispatch
BUILD_CONTINUE = (
    "                        ).start()\n"
    "                        continue\n"
    "                # ── !build / !task LangGraph command"
)
# Find the end of the !build dispatch block
build_dispatch_end = (
    "                        ).start()\n"
    "                        continue\n"
)
idx = s.find(build_dispatch_end)
if idx != -1:
    insert_pos = idx + len(build_dispatch_end)
    s = s[:insert_pos] + APPROVAL_DISPATCH + s[insert_pos:]
    print('Part 3: approve/reject dispatch wired after !build block')
else:
    print('Part 3 WARNING: !build dispatch end not found — approve/reject not wired')

# Validate
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — self-improvement loop installed')
    print('\nWorkflow:')
    print('  !build <task>     → runs LangGraph, sends result')
    print('  approve           → applies patch to bridge.py, restarts')
    print('  reject: <notes>   → reruns with your feedback (max 3 rounds)')
    print('  reject            → discards pending build')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original bridge.py')
    sys.exit(1)
