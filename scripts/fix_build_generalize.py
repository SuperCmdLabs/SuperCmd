#!/usr/bin/env python3
"""
fix_build_generalize.py — Extend !build to write to any file in ~/cowork-bridge/.

Builds on fix_self_improvement.py (approval loop) and fix_langgraph.py (!build).

What this does:

Part 1: Parse --file flag in _handle_build_command
  !build add retry logic              → patches bridge.py (existing behaviour)
  !build --file agents/news.py <task> → creates/patches ~/cowork-bridge/agents/news.py
  !build --file knowledge_agent.py <task> → patches ~/cowork-bridge/knowledge_agent.py

Part 2: Update _apply_patch signature to accept target_file=None
  - None → Path(__file__) / bridge.py (existing behaviour)
  - Otherwise → resolve relative to ~/cowork-bridge/, validate no traversal
  - New files: write directly (no sentinel needed)
  - Existing non-bridge files: append the code at the end
  - bridge.py: keep sentinel/append logic exactly as-is
  - Backup name uses target filename stem + timestamp + suffix

Part 3: Pass target_file from the APPROVAL_DISPATCH block to _apply_patch

Part 4: Update iMessage messages to include the target file name

Part 5: Preserve target_file across reject/retry in _rerun_build

Safety:
  - Rejects absolute paths (starts with /)
  - Rejects paths containing ..
  - Rejects paths that resolve outside ~/cowork-bridge/

Guard sentinel: '_build_target_file' — skip if already applied.
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if '_build_target_file' in s:
    print('SKIPPED — build generalise already installed')
    sys.exit(0)

# Check that the self-improvement loop is present (prerequisite)
if '_pending_build' not in s:
    print('ERROR — _pending_build not found in bridge.py')
    print('Run fix_self_improvement.py first, then re-run this script.')
    sys.exit(1)

if '_apply_patch' not in s:
    print('ERROR — _apply_patch not found in bridge.py')
    print('Run fix_self_improvement.py first, then re-run this script.')
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Patch _handle_build_command to parse --file flag
#
# Current code that parses the task:
#   _task_desc = text.split(' ', 1)[1].strip()
#
# We need to replace _handle_build_command's body to extract --file before
# passing the task to run_build, and store target_file in _pending_build.
# ══════════════════════════════════════════════════════════════════════════════

# The !build dispatch block inside the message loop — replace task extraction
# Original (from fix_langgraph.py / fix_self_improvement.py):
#
#   if text.lower().startswith('!build ') or text.lower().startswith('!task '):
#       _task_desc = text.split(' ', 1)[1].strip()
#       if _task_desc:
#           import threading as _bth
#           _bth.Thread(
#               target=_handle_build_command,
#               args=(_task_desc, REPLY_TO),
#               daemon=True,
#               name='langgraph-build',
#           ).start()
#           continue

OLD_BUILD_DISPATCH = (
    "                if text.lower().startswith('!build ') or text.lower().startswith('!task '):\n"
    "                    _task_desc = text.split(' ', 1)[1].strip()\n"
    "                    if _task_desc:\n"
    "                        import threading as _bth\n"
    "                        _bth.Thread(\n"
    "                            target=_handle_build_command,\n"
    "                            args=(_task_desc, REPLY_TO),\n"
    "                            daemon=True,\n"
    "                            name='langgraph-build',\n"
    "                        ).start()\n"
    "                        continue\n"
)

NEW_BUILD_DISPATCH = (
    "                if text.lower().startswith('!build ') or text.lower().startswith('!task '):\n"
    "                    _raw_args = text.split(' ', 1)[1].strip()\n"
    "                    # Parse --file flag: !build --file <filename> <task>\n"
    "                    _build_target_file = None\n"
    "                    import re as _btre\n"
    "                    _file_m = _btre.match(r'--file\\s+(\\S+)\\s+(.*)', _raw_args)\n"
    "                    if _file_m:\n"
    "                        _build_target_file = _file_m.group(1).strip()\n"
    "                        _task_desc = _file_m.group(2).strip()\n"
    "                    else:\n"
    "                        _task_desc = _raw_args\n"
    "                    if _task_desc:\n"
    "                        import threading as _bth\n"
    "                        _bth.Thread(\n"
    "                            target=_handle_build_command,\n"
    "                            args=(_task_desc, REPLY_TO, _build_target_file),\n"
    "                            daemon=True,\n"
    "                            name='langgraph-build',\n"
    "                        ).start()\n"
    "                        continue\n"
)

if OLD_BUILD_DISPATCH in s:
    s = s.replace(OLD_BUILD_DISPATCH, NEW_BUILD_DISPATCH, 1)
    print('Part 1a: !build dispatch updated to parse --file flag')
else:
    print('Part 1a WARNING: !build dispatch pattern not found — skipping')

# ── Part 1b: Update _handle_build_command signature + store target_file ───────
# Current signature: def _handle_build_command(task: str, sender: str):
# New signature:     def _handle_build_command(task: str, sender: str, target_file: str = None):

OLD_BUILD_FUNC_SIG = "def _handle_build_command(task: str, sender: str):"
NEW_BUILD_FUNC_SIG = "def _handle_build_command(task: str, sender: str, target_file: str = None):"

if OLD_BUILD_FUNC_SIG in s:
    s = s.replace(OLD_BUILD_FUNC_SIG, NEW_BUILD_FUNC_SIG, 1)
    print('Part 1b: _handle_build_command signature extended with target_file param')
else:
    print('Part 1b WARNING: _handle_build_command signature not found — skipping')

# ── Part 1c: Store target_file in _pending_build when storing build result ────
# The pending_build update block (from fix_self_improvement.py) stores:
#   _pending_build.update({
#       'task':     task,
#       'code':     state['code'],
#       'plan':     state['plan'],
#       'review':   state['review'],
#       'approved': state['approved'],
#       'round':    1,
#   })
#
# We add 'target_file': target_file to this dict.

OLD_PENDING_UPDATE = (
    "    _pending_build.update({\n"
    "        'task':     task,\n"
    "        'code':     state['code'],\n"
    "        'plan':     state['plan'],\n"
    "        'review':   state['review'],\n"
    "        'approved': state['approved'],\n"
    "        'round':    1,\n"
    "    })\n"
)

NEW_PENDING_UPDATE = (
    "    _pending_build.update({\n"
    "        'task':        task,\n"
    "        'code':        state['code'],\n"
    "        'plan':        state['plan'],\n"
    "        'review':      state['review'],\n"
    "        'approved':    state['approved'],\n"
    "        'round':       1,\n"
    "        'target_file': target_file,\n"
    "    })\n"
)

if OLD_PENDING_UPDATE in s:
    s = s.replace(OLD_PENDING_UPDATE, NEW_PENDING_UPDATE, 1)
    print('Part 1c: _pending_build.update extended with target_file key')
else:
    # Alt form produced by fix_self_improvement alt branch
    OLD_PENDING_ALT = (
        "    _pending_build.update({'task': task, 'code': state['code'],\n"
        "        'plan': state['plan'], 'review': state['review'],\n"
        "        'approved': state['approved'], 'round': 1})\n"
    )
    NEW_PENDING_ALT = (
        "    _pending_build.update({'task': task, 'code': state['code'],\n"
        "        'plan': state['plan'], 'review': state['review'],\n"
        "        'approved': state['approved'], 'round': 1,\n"
        "        'target_file': target_file})\n"
    )
    if OLD_PENDING_ALT in s:
        s = s.replace(OLD_PENDING_ALT, NEW_PENDING_ALT, 1)
        print('Part 1c: _pending_build.update extended with target_file key (alt form)')
    else:
        print('Part 1c WARNING: _pending_build.update pattern not found — skipping')

# ── Part 1d: Update "Build complete" iMessage to include target file ──────────
# Current:
#   _msg = (
#       f'[Build complete]\n'
#       f'Task: {task[:80]}\n\n'
#       ...
#   )
# New:
#   _target_label = f' for `{target_file}`' if target_file else ''
#   _msg = (
#       f'[Build complete{_target_label}]\n'
#       ...
#   )

OLD_BUILD_COMPLETE_MSG = (
    "    _msg = (\n"
    "        f'[Build complete]\\n'\n"
    "        f'Task: {task[:80]}\\n\\n'\n"
)
NEW_BUILD_COMPLETE_MSG = (
    "    _target_label = f' for `{target_file}`' if target_file else ''\n"
    "    _msg = (\n"
    "        f'[Build complete{_target_label}]\\n'\n"
    "        f'Task: {task[:80]}\\n\\n'\n"
)

if OLD_BUILD_COMPLETE_MSG in s:
    s = s.replace(OLD_BUILD_COMPLETE_MSG, NEW_BUILD_COMPLETE_MSG, 1)
    print('Part 1d: "Build complete" message updated to include target file')
else:
    print('Part 1d WARNING: "Build complete" message pattern not found — skipping')


# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Replace _apply_patch function definition
#
# Replace the entire function body with a new version that:
# - Accepts target_file=None
# - Resolves and validates the target path
# - Handles new files, existing non-bridge files, and bridge.py differently
# - Names backups using the target file's stem/suffix
# ══════════════════════════════════════════════════════════════════════════════

# Locate the existing _apply_patch function.
# It starts at "def _apply_patch(" and ends before the next top-level "def " or class.
# We use a regex to find the full body.

_apply_start = s.find('\ndef _apply_patch(')
if _apply_start == -1:
    print('Part 2 ERROR: _apply_patch function not found — aborting')
    sys.exit(1)

# Find the next top-level def/class after _apply_patch to delimit its body
_next_def = re.search(r'\ndef [a-zA-Z_]|\nclass [a-zA-Z_]', s[_apply_start + 1:])
if _next_def:
    _apply_end = _apply_start + 1 + _next_def.start()
else:
    _apply_end = len(s)

OLD_APPLY_PATCH = s[_apply_start:_apply_end]

NEW_APPLY_PATCH = r'''
def _apply_patch(code: str, task: str, sender: str, target_file: str = None):
    """
    Apply a code patch to a file inside ~/cowork-bridge/:
      1. Validate target_file path (no traversal, relative, within bridge dir)
      2. Extract Python code block from the LLM output
      3. Validate syntax with py_compile
      4. Write backup (stem.backup.TIMESTAMP.suffix)
      5. Write/append/insert in the target file
      6. Reload via launchctl (bridge.py only)

    target_file=None → patch bridge.py (existing behaviour)
    target_file='agents/news.py' → ~/cowork-bridge/agents/news.py
    """
    import pathlib as _ap, subprocess as _asp, datetime as _adt, tempfile as _atmp, os as _aos

    _bridge_dir  = _ap.Path.home() / 'cowork-bridge'
    _bridge_path = _ap.Path(__file__)

    # ── Resolve target path ────────────────────────────────────────────────────
    if target_file is None:
        _target_path = _bridge_path
    else:
        # Safety: reject absolute paths and path traversal
        _tf = str(target_file).strip()
        if _tf.startswith('/'):
            send_imessage(sender, f'[Apply] Rejected: target path must be relative, not absolute: {_tf}')
            return False
        if '..' in _tf.split('/'):
            send_imessage(sender, f'[Apply] Rejected: path traversal not allowed: {_tf}')
            return False
        _candidate = (_bridge_dir / _tf).resolve()
        try:
            _candidate.relative_to(_bridge_dir.resolve())
        except ValueError:
            send_imessage(sender, f'[Apply] Rejected: path resolves outside ~/cowork-bridge/: {_tf}')
            return False
        _target_path = _candidate

    _is_bridge   = (_target_path.resolve() == _bridge_path.resolve())
    _target_name = _target_path.name

    # ── Extract code: strip markdown fences if present ────────────────────────
    _code = code.strip()
    _fence_m = __import__('re').search(r'```(?:python)?\n(.*?)```', _code, __import__('re').DOTALL)
    if _fence_m:
        _code = _fence_m.group(1).strip()

    if not _code:
        send_imessage(sender, '[Apply] No code to apply — build result was empty')
        return False

    # ── Validate: py_compile the new code snippet standalone ──────────────────
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

    # ── Notify ─────────────────────────────────────────────────────────────────
    send_imessage(sender, f'[Apply] Applying patch to {_target_name}...')
    print(f'[build] Applying patch to {_target_path}', flush=True)

    # ── Read current source (or empty for new files) ───────────────────────────
    _is_new_file = not _target_path.exists()
    _current     = '' if _is_new_file else _target_path.read_text(encoding='utf-8', errors='replace')

    # ── Write backup ──────────────────────────────────────────────────────────
    _ts          = _adt.datetime.now().strftime('%Y%m%d_%H%M%S')
    _backup_name = f'{_target_path.stem}.backup.{_ts}{_target_path.suffix}'
    _backup_path = _bridge_dir / _backup_name
    if not _is_new_file:
        _backup_path.write_text(_current)
        print(f'[build] Backup written: {_backup_name}', flush=True)

    # ── Build new source ───────────────────────────────────────────────────────
    if _is_new_file:
        # New file: write code directly
        _new_source = _code + '\n'
    elif _is_bridge:
        # bridge.py: use sentinel insertion (existing behaviour)
        _sentinel     = "\nif __name__ == '__main__':"
        _alt_sentinel = '\nwhile True:'
        if _sentinel in _current:
            _new_source = _current.replace(
                _sentinel,
                f'\n\n# ── Auto-patched: {task[:60]} ──\n{_code}\n{_sentinel}',
                1,
            )
        elif _alt_sentinel in _current:
            _idx = _current.rfind(_alt_sentinel)
            _new_source = (
                _current[:_idx]
                + f'\n\n# ── Auto-patched: {task[:60]} ──\n{_code}\n'
                + _current[_idx:]
            )
        else:
            _new_source = _current + f'\n\n# ── Auto-patched: {task[:60]} ──\n{_code}\n'
    else:
        # Existing non-bridge file: append at end
        _new_source = _current.rstrip('\n') + f'\n\n# ── Auto-patched: {task[:60]} ──\n{_code}\n'

    # ── Validate full patched file ─────────────────────────────────────────────
    _tmp2 = _atmp.NamedTemporaryFile(suffix='.py', delete=False, mode='w')
    _tmp2.write(_new_source)
    _tmp2.close()
    _r2 = _asp.run([__import__('sys').executable, '-m', 'py_compile', _tmp2.name],
                   capture_output=True, text=True)
    _aos.unlink(_tmp2.name)
    if _r2.returncode != 0:
        send_imessage(sender, f'[Apply] Patched file has syntax error — not written:\n{_r2.stderr[:300]}')
        print(f'[build] Patched file syntax error:\n{_r2.stderr}', flush=True)
        return False

    # ── Write patched file ─────────────────────────────────────────────────────
    _target_path.parent.mkdir(parents=True, exist_ok=True)
    _target_path.write_text(_new_source)
    print(f'[build] Patch applied to {_target_path}', flush=True)
    _backup_note = f'  Backup: {_backup_name}' if not _is_new_file else '  (new file created)'
    send_imessage(sender, f'✅ Patch applied to {_target_name}.{_backup_note}')

    # ── Reload via launchctl (bridge.py only) ──────────────────────────────────
    if _is_bridge:
        send_imessage(sender, 'Restarting bridge...')
        _plist = str(_ap.Path.home() / 'Library/LaunchAgents/com.alexmcgann.cowork-bridge.plist')
        _asp.run(['launchctl', 'unload', _plist], capture_output=True)
        _asp.run(['launchctl', 'load',   _plist], capture_output=True)
        print('[build] Bridge reloaded via launchctl', flush=True)
    return True

'''

s = s[:_apply_start] + NEW_APPLY_PATCH + s[_apply_end:]
print('Part 2: _apply_patch replaced with generalised version')


# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Pass target_file from the APPROVAL_DISPATCH block to _apply_patch
#
# The APPROVAL_DISPATCH block (from fix_self_improvement.py) calls:
#   _apply_patch(_pb_code, _pb_task, REPLY_TO)
#
# We need to:
#   1. Read _pb_target_file from _pending_build before clearing it
#   2. Pass it as the 4th argument to _apply_patch
# ══════════════════════════════════════════════════════════════════════════════

OLD_APPROVE_BLOCK = (
    "                if _pending_build and text.strip().lower() == 'approve':\n"
    "                    _pb_code = _pending_build.get('code', '')\n"
    "                    _pb_task = _pending_build.get('task', '')\n"
    "                    if _pb_code:\n"
    "                        send_imessage(REPLY_TO, '[Apply] Applying patch to bridge.py...')\n"
    "                        _pending_build.clear()\n"
    "                        import threading as _ath\n"
    "                        _ath.Thread(\n"
    "                            target=_apply_patch,\n"
    "                            args=(_pb_code, _pb_task, REPLY_TO),\n"
    "                            daemon=True\n"
    "                        ).start()\n"
    "                    else:\n"
    "                        send_imessage(REPLY_TO, 'No pending build to approve.')\n"
    "                    continue\n"
)

NEW_APPROVE_BLOCK = (
    "                if _pending_build and text.strip().lower() == 'approve':\n"
    "                    _pb_code        = _pending_build.get('code', '')\n"
    "                    _pb_task        = _pending_build.get('task', '')\n"
    "                    _pb_target_file = _pending_build.get('target_file')\n"
    "                    if _pb_code:\n"
    "                        _pending_build.clear()\n"
    "                        import threading as _ath\n"
    "                        _ath.Thread(\n"
    "                            target=_apply_patch,\n"
    "                            args=(_pb_code, _pb_task, REPLY_TO, _pb_target_file),\n"
    "                            daemon=True\n"
    "                        ).start()\n"
    "                    else:\n"
    "                        send_imessage(REPLY_TO, 'No pending build to approve.')\n"
    "                    continue\n"
)

if OLD_APPROVE_BLOCK in s:
    s = s.replace(OLD_APPROVE_BLOCK, NEW_APPROVE_BLOCK, 1)
    print('Part 3: approve dispatch updated to pass target_file to _apply_patch')
else:
    print('Part 3 WARNING: approve dispatch pattern not found — skipping')
    print('  If the approve block uses different text, update Part 3 manually.')


# ══════════════════════════════════════════════════════════════════════════════
# Part 4: Already handled in Part 1d (Build complete message) and Part 2
# (_apply_patch itself sends "Applying patch to {filename}..." and
# "✅ Patch applied to {filename}.").
# ══════════════════════════════════════════════════════════════════════════════
print('Part 4: iMessage messages updated (handled in Parts 1d and 2)')


# ══════════════════════════════════════════════════════════════════════════════
# Part 5: Preserve target_file across reject/retry in _rerun_build
#
# In _rerun_build the pending_build.update() call doesn't re-set target_file,
# which means it is already preserved via the existing key — unless the update
# overwrites the whole dict.  The current code uses dict.update() which only
# updates named keys, so target_file is preserved.
#
# However, the _rerun_build update block uses positional keys that don't
# include target_file, so we add it explicitly.
# ══════════════════════════════════════════════════════════════════════════════

OLD_RERUN_UPDATE = (
    "        _pending_build.update({\n"
    "            'task': _task,\n"
    "            'code': state['code'],\n"
    "            'plan': state['plan'],\n"
    "            'review': state['review'],\n"
    "            'approved': state['approved'],\n"
    "        })\n"
)

NEW_RERUN_UPDATE = (
    "        _pending_build.update({\n"
    "            'task':        _task,\n"
    "            'code':        state['code'],\n"
    "            'plan':        state['plan'],\n"
    "            'review':      state['review'],\n"
    "            'approved':    state['approved'],\n"
    "            # target_file preserved from original _pending_build entry\n"
    "            'target_file': _pending_build.get('target_file'),\n"
    "        })\n"
)

if OLD_RERUN_UPDATE in s:
    s = s.replace(OLD_RERUN_UPDATE, NEW_RERUN_UPDATE, 1)
    print('Part 5: _rerun_build updated to preserve target_file on retry')
else:
    # Try alt spacing
    _rerun_start = s.find('def _rerun_build(')
    if _rerun_start != -1:
        _rerun_block = s[_rerun_start:_rerun_start + 2000]
        if "'task': _task" in _rerun_block and "'code': state['code']" in _rerun_block:
            # Regex-based replacement within the function
            _m = re.search(
                r"(_pending_build\.update\(\{[^}]*'task':\s*_task,[^}]*'code':\s*state\['code'\],[^}]*"
                r"'plan':\s*state\['plan'\],[^}]*'review':\s*state\['review'\],[^}]*"
                r"'approved':\s*state\['approved'\],[^}]*\}\))",
                s[_rerun_start:_rerun_start + 2000],
                re.DOTALL,
            )
            if _m:
                old_fragment = _m.group(1)
                new_fragment = old_fragment.rstrip(')') + ",\n            'target_file': _pending_build.get('target_file'),\n        })"
                s = s[:_rerun_start] + s[_rerun_start:_rerun_start + 2000].replace(old_fragment, new_fragment, 1) + s[_rerun_start + 2000:]
                print('Part 5: _rerun_build updated to preserve target_file on retry (regex match)')
            else:
                print('Part 5 WARNING: _rerun_build update pattern not matched')
        else:
            print('Part 5 WARNING: _rerun_build update keys not found — skipping')
    else:
        print('Part 5 WARNING: _rerun_build function not found — skipping')


# ══════════════════════════════════════════════════════════════════════════════
# Write & validate
# ══════════════════════════════════════════════════════════════════════════════
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — !build generalised to support --file flag')
    print('\nUsage examples:')
    print('  !build add retry logic to the scheduler')
    print('      → patches bridge.py (default)')
    print('  !build --file agents/news_agent.py create a news fetching agent')
    print('      → creates/patches ~/cowork-bridge/agents/news_agent.py')
    print('  !build --file knowledge_agent.py add screenshot OCR')
    print('      → patches ~/cowork-bridge/knowledge_agent.py')
    print('\nSafety:')
    print('  Absolute paths (/etc/...) → rejected')
    print('  Path traversal (../../..) → rejected')
    print('  Outside ~/cowork-bridge/  → rejected')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original bridge.py — no changes applied')
    sys.exit(1)
