#!/usr/bin/env python3
"""
fix_skill_loop.py — Autonomous skill creation loop for bridge.py.

Inspired by the hermes-agent skill-learning system. After each successful
!build approval + patch application, the bridge automatically asks Ollama to
distill the change into a reusable skill file.  Future !build commands search
past skills and inject the top-3 most relevant ones as prompt context, so the
LangGraph planner can build on prior work without being told explicitly.

What this does:

Part 1: Add skill helper functions (_load_skills, _search_skills, _save_skill)
  Inserted before _apply_patch in bridge.py.

  _load_skills()          → list of skill dicts, newest first
  _search_skills(query)   → top-k skills ranked by keyword overlap
  _save_skill(task, code, target_file)
      • Calls Ollama to produce: name (kebab-slug), description, code_summary
      • Falls back to auto-derived values if Ollama unavailable
      • Writes ~/cowork-bridge/skills/<slug>.json
      • Appends timestamp suffix to avoid collisions

Part 2: Hook _apply_patch() to call _save_skill() after successful patch
  Inserted before the launchctl reload block.
  For bridge.py:  synchronous call (process about to restart)
  For other files: background thread (no shutdown race)

Part 3: Inject relevant past skills into _handle_build_command prompt
  Before calling run_build(task, ...), searches skills and prepends
  top-3 as context so the planner can reuse proven patterns.

Part 4: Add !skills iMessage command
  Lists up to 15 saved skills (name, description, target file, date).
  Inserted before the !build dispatch in the message loop.

Skill file schema (~/cowork-bridge/skills/<slug>.json):
  {
    "name":         "add-retry-logic",
    "description":  "Add exponential retry logic to the scheduler job loop.",
    "code_summary": "...",
    "task":         "<original task text>",
    "target_file":  "bridge.py",
    "date":         "2026-04-13T12:00:00"
  }

Guard sentinel: '_save_skill'
Prerequisite:   fix_build_generalize.py (_build_target_file must be present)
                fix_self_improvement.py (_pending_build must be present)
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guards ────────────────────────────────────────────────────────────────────
if '_save_skill' in s:
    print('SKIPPED — skill loop already installed')
    sys.exit(0)

if '_build_target_file' not in s:
    print('ERROR — _build_target_file not found in bridge.py')
    print('Run fix_build_generalize.py first, then re-run this script.')
    sys.exit(1)

if '_pending_build' not in s:
    print('ERROR — _pending_build not found in bridge.py')
    print('Run fix_self_improvement.py first, then re-run this script.')
    sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Skill helper functions
# ══════════════════════════════════════════════════════════════════════════════

SKILL_HELPERS = r'''
# ── Autonomous skill creation loop ──────────────────────────────────────────

def _load_skills():
    """Return all saved skill dicts, sorted newest-first by mtime."""
    import json as _lsj, pathlib as _lsp
    _skills_dir = _lsp.Path.home() / 'cowork-bridge' / 'skills'
    if not _skills_dir.exists():
        return []
    _out = []
    for _fp in sorted(_skills_dir.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            _out.append(_lsj.loads(_fp.read_text()))
        except Exception:
            pass
    return _out


def _search_skills(query: str, top_k: int = 3):
    """
    Return up to top_k skills most relevant to query.
    Scores by counting query words (>3 chars) that appear in the skill text.
    """
    _all = _load_skills()
    if not _all:
        return []
    _qwords = {_w for _w in query.lower().split() if len(_w) > 3}
    if not _qwords:
        return _all[:top_k]
    _scored = []
    for _sk in _all:
        _text  = ' '.join([
            _sk.get('name',         ''),
            _sk.get('description',  ''),
            _sk.get('task',         ''),
            _sk.get('code_summary', ''),
        ]).lower()
        _score = sum(1 for _w in _qwords if _w in _text)
        if _score > 0:
            _scored.append((_score, _sk))
    _scored.sort(key=lambda x: x[0], reverse=True)
    return [_sk for _, _sk in _scored[:top_k]]


def _save_skill(task: str, code: str, target_file=None):
    """
    Distill a completed build into a reusable JSON skill file.

    Calls Ollama to produce name / description / code_summary.
    Falls back to auto-derived values if Ollama is unavailable or returns
    unparseable output.  Written to ~/cowork-bridge/skills/<slug>.json.
    """
    import json as _ssj, re as _ssr, datetime as _ssd, pathlib as _ssp
    import urllib.request as _ssur

    _skills_dir = _ssp.Path.home() / 'cowork-bridge' / 'skills'
    _skills_dir.mkdir(parents=True, exist_ok=True)

    # ── Determine model name ─────────────────────────────────────────────────
    _model = 'llama3'
    try:
        _src_sample = open(__file__).read(6000)
        _mm = _ssr.search(r'OLLAMA_MODEL\s*=\s*["\']([^"\']+)["\']', _src_sample)
        if not _mm:
            _mm = _ssr.search(r'(?:model|MODEL)\s*=\s*["\']([^"\']+)["\']', _src_sample)
        if _mm:
            _model = _mm.group(1)
    except Exception:
        pass

    # ── Ask Ollama to summarize the skill ────────────────────────────────────
    _prompt = (
        'A developer just applied a code patch to their automation bridge. '
        'Summarize it as a reusable skill entry.\n\n'
        f'Task: {task[:400]}\n\n'
        f'Code:\n```python\n{code[:1400]}\n```\n\n'
        'Respond ONLY with raw JSON (no markdown fences, no commentary):\n'
        '{\n'
        '  "name": "short-kebab-case-skill-name",\n'
        '  "description": "One sentence describing what this skill does.",\n'
        '  "code_summary": "2-3 sentences on the implementation approach."\n'
        '}'
    )

    _skill_meta = None
    try:
        _payload = _ssj.dumps({
            'model':  _model,
            'prompt': _prompt,
            'stream': False,
        }).encode()
        _req = _ssur.Request(
            'http://localhost:11434/api/generate',
            data=_payload,
            headers={'Content-Type': 'application/json'},
        )
        with _ssur.urlopen(_req, timeout=45) as _resp:
            _raw = _ssj.loads(_resp.read().decode()).get('response', '').strip()
            _jm  = _ssr.search(r'\{[^{}]*\}', _raw, _ssr.DOTALL)
            if _jm:
                _parsed = _ssj.loads(_jm.group())
                if 'name' in _parsed and 'description' in _parsed:
                    _skill_meta = _parsed
    except Exception as _oe:
        print(f'[skill] Ollama call failed: {_oe}', flush=True)

    # ── Fallback: derive from task text ──────────────────────────────────────
    if not _skill_meta:
        _auto_slug = _ssr.sub(r'[^a-z0-9]+', '-', task[:60].lower()).strip('-') or 'skill'
        _skill_meta = {
            'name':         _auto_slug,
            'description':  task[:120],
            'code_summary': f'Patched {target_file or "bridge.py"}.',
        }

    # ── Normalise slug ────────────────────────────────────────────────────────
    _name = (
        _ssr.sub(r'[^a-z0-9-]+', '-', _skill_meta.get('name', 'skill').lower())
        .strip('-') or 'skill'
    )

    _skill_obj = {
        'name':         _name,
        'description':  _skill_meta.get('description', task[:120]),
        'code_summary': _skill_meta.get('code_summary', ''),
        'task':         task,
        'target_file':  target_file or 'bridge.py',
        'date':         _ssd.datetime.now().isoformat(timespec='seconds'),
    }

    # ── Write (append timestamp suffix on name collision) ─────────────────────
    _fname = _name + '.json'
    _dest  = _skills_dir / _fname
    if _dest.exists():
        _ts    = _ssd.datetime.now().strftime('%Y%m%d_%H%M%S')
        _fname = f'{_name}.{_ts}.json'
        _dest  = _skills_dir / _fname

    _dest.write_text(_ssj.dumps(_skill_obj, indent=2))
    print(f'[skill] Saved: {_fname}  —  {_skill_obj["description"][:80]}', flush=True)

'''

# Insert before _apply_patch; fall back to _rerun_build or run_shell
_anchors1 = ['\ndef _apply_patch(', '\ndef _rerun_build(', '\ndef run_shell(']
_inserted1 = False
for _a1 in _anchors1:
    _pos1 = s.find(_a1)
    if _pos1 != -1:
        s = s[:_pos1] + SKILL_HELPERS + s[_pos1:]
        print(f'Part 1: skill helpers inserted before "{_a1.strip()}"')
        _inserted1 = True
        break
if not _inserted1:
    print('Part 1 ERROR: no suitable anchor found for skill helper insertion')
    sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Hook _apply_patch() to call _save_skill() before launchctl reload
# ══════════════════════════════════════════════════════════════════════════════
# Primary anchor: the "Reload via launchctl" comment that marks the last block.
# Fallback: the last "    return True" in _apply_patch.

OLD_RELOAD_HDR = (
    "    # ── Reload via launchctl (bridge.py only) ──────────────────────────────────\n"
    "    if _is_bridge:\n"
)
NEW_RELOAD_HDR = (
    "    # ── Distill applied patch into skill file ─────────────────────────────────\n"
    "    if _is_bridge:\n"
    "        # Synchronous: launchctl reload will kill the process right after\n"
    "        try:\n"
    "            _save_skill(task, _code, target_file)\n"
    "        except Exception as _sse:\n"
    "            print(f'[skill] _save_skill error: {_sse}', flush=True)\n"
    "    else:\n"
    "        import threading as _sk_th\n"
    "        _sk_th.Thread(target=_save_skill, args=(task, _code, target_file),\n"
    "                      daemon=True, name='skill-save').start()\n"
    "\n"
    "    # ── Reload via launchctl (bridge.py only) ──────────────────────────────────\n"
    "    if _is_bridge:\n"
)

if OLD_RELOAD_HDR in s:
    s = s.replace(OLD_RELOAD_HDR, NEW_RELOAD_HDR, 1)
    print('Part 2: _apply_patch() hooked — _save_skill() called before launchctl reload')
else:
    # Fallback: find the last "    return True" inside _apply_patch and insert before it
    _ap_start = s.find('\ndef _apply_patch(')
    if _ap_start != -1:
        _ap_nxt = re.search(r'\ndef [a-zA-Z_]|\nclass [a-zA-Z_]', s[_ap_start + 1:])
        _ap_end = (_ap_start + 1 + _ap_nxt.start()) if _ap_nxt else len(s)
        _ap_body = s[_ap_start:_ap_end]
        _rt_pos  = _ap_body.rfind('\n    return True')
        if _rt_pos != -1:
            _abs_rt   = _ap_start + _rt_pos + 1   # +1 to skip leading \n
            _save_blk = (
                "    # ── Distill applied patch into skill file ─────────────────────────────────\n"
                "    try:\n"
                "        _save_skill(task, _code, target_file)\n"
                "    except Exception as _sse:\n"
                "        print(f'[skill] _save_skill error: {_sse}', flush=True)\n"
            )
            s = s[:_abs_rt] + _save_blk + s[_abs_rt:]
            print('Part 2: _apply_patch() hooked via return True fallback')
        else:
            print('Part 2 WARNING: no return True found in _apply_patch — skill save not hooked')
    else:
        print('Part 2 WARNING: _apply_patch function not found — skill save not hooked')


# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Inject relevant past skills into _handle_build_command prompt
# ══════════════════════════════════════════════════════════════════════════════
# Strategy: find "run_build(task" inside _handle_build_command, read the actual
# line indentation from the source (don't guess it), and INSERT BEFORE that line
# without replacing it.  We rebind `task` before the call, so run_build(task, ...)
# will receive the enriched context automatically.
# This avoids all indentation detection issues from using f-strings.

_hbc_start = s.find('\ndef _handle_build_command(')
if _hbc_start == -1:
    _hbc_start = s.find('def _handle_build_command(')

_injected3 = False
if _hbc_start != -1:
    _hbc_nxt = re.search(r'\ndef [a-zA-Z_]|\nclass [a-zA-Z_]', s[_hbc_start + 1:])
    _hbc_end = (_hbc_start + 1 + _hbc_nxt.start()) if _hbc_nxt else len(s)
    _hbc_body = s[_hbc_start:_hbc_end]

    # Find "run_build(task" (not run_build(_full_task) from _rerun_build)
    _rb_pos = _hbc_body.find('run_build(task')
    if _rb_pos != -1:
        # Walk back to the start of this line
        _line_start_in_body = _hbc_body.rfind('\n', 0, _rb_pos) + 1
        # Read the actual indentation chars from the line
        _raw_line = _hbc_body[_line_start_in_body:]
        _ind3 = _raw_line[:len(_raw_line) - len(_raw_line.lstrip())]

        # Build the injection using plain string concat — no f-strings, no {{}}
        _I  = _ind3        # base indent (matches run_build call)
        _I1 = _ind3 + '    '   # +4 for if-body
        _I2 = _ind3 + '        '  # +8 for for-body

        SKILL_INJ = (
            _I  + "# ── Inject relevant past skills as prompt context ─────────────────────\n"
            + _I  + "_sk_refs_p3 = _search_skills(task)\n"
            + _I  + "if _sk_refs_p3:\n"
            + _I1 + "_sk_hdr_p3 = ['Past skills that may be relevant:']\n"
            + _I1 + "for _sk_r_p3 in _sk_refs_p3:\n"
            + _I2 + "_sk_d_p3 = _sk_r_p3.get('description', '')[:120]\n"
            + _I2 + "_sk_hdr_p3.append('  [' + _sk_r_p3['name'] + '] ' + _sk_d_p3)\n"
            + _I2 + "if _sk_r_p3.get('code_summary'):\n"
            + _I2 + "    _sk_hdr_p3.append('    ' + _sk_r_p3['code_summary'][:250])\n"
            + _I1 + "task = '\\n'.join(_sk_hdr_p3) + '\\n\\nTask: ' + task\n"
            + _I  + "# ── End skill injection ─────────────────────────────────────────────\n"
        )

        # Insert before the run_build line (absolute position in s)
        _abs_line_start = _hbc_start + _line_start_in_body
        s = s[:_abs_line_start] + SKILL_INJ + s[_abs_line_start:]
        print('Part 3: skill context inserted before run_build(task in _handle_build_command')
        _injected3 = True
    else:
        print('Part 3 WARNING: run_build(task not found inside _handle_build_command')
        print('  Skills will NOT be auto-injected into future !build prompts')
else:
    print('Part 3 WARNING: _handle_build_command not found — skill injection skipped')


# ══════════════════════════════════════════════════════════════════════════════
# Part 4: Add !skills iMessage command
# ══════════════════════════════════════════════════════════════════════════════

SKILLS_DISPATCH = (
    "                # ── !skills — list saved skills ───────────────────────────────────────\n"
    "                if text.strip().lower() == '!skills':\n"
    "                    _all_sk = _load_skills()\n"
    "                    if not _all_sk:\n"
    "                        send_imessage(REPLY_TO, 'No skills saved yet. Run !build <task> to build something!')\n"
    "                    else:\n"
    "                        _sk_lines = [f'Skills ({len(_all_sk)} saved):']\n"
    "                        for _ski, _ske in enumerate(_all_sk[:15], 1):\n"
    "                            _sk_lines.append(\n"
    "                                f'{_ski}. {_ske[\"name\"]}\\n'\n"
    "                                f'   {_ske.get(\"description\", \"\")[:90]}\\n'\n"
    "                                f'   File: {_ske.get(\"target_file\", \"bridge.py\")}  '\n"
    "                                f'Date: {_ske.get(\"date\", \"\")[:10]}'\n"
    "                            )\n"
    "                        send_imessage(REPLY_TO, '\\n'.join(_sk_lines))\n"
    "                    continue\n"
)

# Same anchor list as fix_proactive_reminders.py — insert before !build dispatch
CMD_ANCHORS = [
    "                if text.lower().startswith('!build ') or text.lower().startswith('!task ')",
    "                if text.lower().startswith('!build') or text.lower().startswith('!task')",
    "                if text.strip().lower().startswith('!build')",
    '                if text.strip().lower().startswith("!build")',
    "                if _tl.startswith('!build')",
    '                if _tl.startswith("!build")',
    "                if text.strip().lower().startswith('!summarize')",
    "                if text.strip().lower().startswith('!search ')",
    "                if text.strip().lower().startswith('!help')",
]

_inserted4 = False
for _anch4 in CMD_ANCHORS:
    _idx4 = s.find(_anch4)
    if _idx4 != -1:
        _line_start4 = s.rfind('\n', 0, _idx4) + 1
        s = s[:_line_start4] + SKILLS_DISPATCH + s[_line_start4:]
        print(f'Part 4: !skills command inserted before "{_anch4.strip()[:60]}"')
        _inserted4 = True
        break
if not _inserted4:
    print('Part 4 WARNING: no anchor found for !skills insertion — command not added')


# ══════════════════════════════════════════════════════════════════════════════
# Write & validate
# ══════════════════════════════════════════════════════════════════════════════
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — autonomous skill loop installed')
    print('\nFeatures:')
    print('  • approve      → patch applied + skill distilled into ~/cowork-bridge/skills/')
    print('  • !build <task> → top-3 relevant past skills injected as prompt context')
    print('  • !skills       → list all saved skills via iMessage')
    print('\nSkill files: ~/cowork-bridge/skills/*.json')
else:
    import re as _dbgre
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    _line_m = _dbgre.search(r'line (\d+)', r.stderr)
    if _line_m:
        _errline = int(_line_m.group(1))
        _lines   = s.splitlines()
        _lo, _hi = max(0, _errline - 5), min(len(_lines), _errline + 3)
        print(f'\n--- bridge.py lines {_lo+1}–{_hi} (around error) ---')
        for _i, _l in enumerate(_lines[_lo:_hi], _lo + 1):
            _marker = ' >>>' if _i == _errline else '    '
            print(f'{_marker} {_i:4d}: {_l}')
        print('--- end context ---')
    open(BRIDGE, 'w').write(orig)
    print('\nRestored original bridge.py — no changes applied')
    sys.exit(1)
