#!/usr/bin/env python3
"""
fix_claude_build.py — Add !claude <task> command to bridge.py.

Replaces the Ollama/LangGraph dependency for code generation with a direct
call to the Anthropic Claude API. Follows the same approval flow as !build:

  !claude <task>
    → Calls claude-sonnet-4-5 (or model set in ANTHROPIC_MODEL env var)
    → Sends code + plan preview via iMessage
    → Reply "approve" to apply, "reject: <feedback>" to revise (up to 3 rounds)
    → "reject" alone discards

Setup (one-time):
  1. Add ANTHROPIC_API_KEY=sk-ant-... to ~/cowork-bridge/.env  (or export in shell)
  2. Run this script to patch bridge.py
  3. Restart bridge

Why this instead of !build:
  - !build requires LangGraph + langgraph_agent.py to be installed and working
  - !claude works with just an API key and the requests already in bridge's venv
    (uses stdlib urllib — no extra packages needed)
  - Claude API quality >> local Gemma for code generation tasks

Guard sentinel: '_claude_build_handler'
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_claude_build_handler' in s:
    print('SKIPPED — !claude command already installed')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: The Claude API caller + handler function
# ══════════════════════════════════════════════════════════════════════════════

CLAUDE_BUILD_CODE = r'''
# ── !claude build: Claude API-powered code generation ─────────────────────────

_claude_build_handler = True   # sentinel


def _call_claude_api(system_prompt: str, user_prompt: str, max_tokens: int = 4096) -> str:
    """
    Call the Anthropic Messages API using only stdlib (urllib).
    Reads ANTHROPIC_API_KEY from environment or ~/cowork-bridge/.env
    """
    import urllib.request as _ur, json as _uj, os as _uos, pathlib as _up

    # Load API key: env var first, then .env file
    _api_key = _uos.environ.get('ANTHROPIC_API_KEY', '')
    if not _api_key:
        _env_file = _up.Path.home() / 'cowork-bridge' / '.env'
        if _env_file.exists():
            for _line in _env_file.read_text().splitlines():
                _line = _line.strip()
                if _line.startswith('ANTHROPIC_API_KEY='):
                    _api_key = _line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
    if not _api_key:
        raise RuntimeError(
            'ANTHROPIC_API_KEY not set. Add it to ~/cowork-bridge/.env:\n'
            'ANTHROPIC_API_KEY=sk-ant-...'
        )

    _model = _uos.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-4-5')
    _payload = {
        'model': _model,
        'max_tokens': max_tokens,
        'system': system_prompt,
        'messages': [{'role': 'user', 'content': user_prompt}],
    }
    _req = _ur.Request(
        'https://api.anthropic.com/v1/messages',
        data=_uj.dumps(_payload).encode(),
        headers={
            'x-api-key': _api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        method='POST',
    )
    with _ur.urlopen(_req, timeout=120) as _resp:
        _body = _uj.loads(_resp.read())
    return _body['content'][0]['text']


def _handle_claude_command(task: str, sender: str):
    """
    Run a code generation task via Claude API and store result in _pending_build.
    Called in a background thread by the !claude dispatch.
    """
    import pathlib as _hcp, re as _hcr

    _SYSTEM = (
        'You are an expert Python developer. Your task is to write a Python code patch '
        'for bridge.py — a macOS iMessage automation bridge. '
        'bridge.py runs as a launchd service and processes iMessage commands.\n\n'
        'RULES:\n'
        '1. Output ONLY a Python code block (```python ... ```) containing the patch.\n'
        '2. The patch should be a self-contained function or block that can be appended '
        'to bridge.py before the main loop.\n'
        '3. Include a brief PLAN comment at the top (3-5 lines) explaining what the code does.\n'
        '4. The code must be syntactically valid Python 3.\n'
        '5. Use only stdlib or packages already imported in bridge.py.\n'
        '6. If wiring into the message loop is needed, include clear INTEGRATION NOTES '
        'at the end explaining exactly where to add the dispatch call.\n'
    )

    # Enrich with past skills if available
    try:
        _sk_refs = _search_skills(task) if '_search_skills' in dir() else []
    except Exception:
        _sk_refs = []

    _user_prompt = task
    if _sk_refs:
        _sk_lines = ['Past skills that may be relevant:']
        for _sk in _sk_refs:
            _sk_lines.append(f'  [{_sk["name"]}] {_sk.get("description", "")[:120]}')
            if _sk.get('code_summary'):
                _sk_lines.append(f'    {_sk["code_summary"][:250]}')
        _user_prompt = '\n'.join(_sk_lines) + '\n\nTask: ' + task

    send_imessage(sender, f'[Claude] Designing: {task[:80]}...')
    print(f'[claude-build] Starting task: {task[:100]}', flush=True)

    try:
        _response = _call_claude_api(_SYSTEM, _user_prompt)
    except Exception as _e:
        send_imessage(sender, f'[Claude] API error: {_e}')
        print(f'[claude-build] API error: {_e}', flush=True)
        return

    # Extract code block
    _fence_m = __import__('re').search(r'```(?:python)?\n(.*?)```', _response, __import__('re').DOTALL)
    _code = _fence_m.group(1).strip() if _fence_m else _response.strip()

    # Extract plan (first comment block)
    _plan_lines = []
    for _pl in _code.splitlines():
        if _pl.strip().startswith('#'):
            _plan_lines.append(_pl.strip().lstrip('# '))
        elif _plan_lines:
            break
    _plan = '\n'.join(_plan_lines[:6]) or '(see code)'

    # Store in _pending_build (reuses existing approve/reject infrastructure)
    _pending_build.update({
        'task':     task,
        'code':     _code,
        'plan':     _plan,
        'review':   'Generated by Claude API',
        'approved': True,
        'round':    1,
        'source':   'claude-api',
    })

    _model_id = __import__('os').environ.get('ANTHROPIC_MODEL', 'claude-sonnet-4-5')
    _preview = (
        f'[Claude/{_model_id}]\n'
        f'Task: {task[:80]}\n\n'
        f'─── Plan ───\n{_plan}\n\n'
        f'─── Code ({len(_code)} chars) ───\n{_code[:800]}'
        + ('...\n(truncated)' if len(_code) > 800 else '') +
        '\n\n'
        f'Reply "approve" to apply to bridge.py, or "reject: <feedback>" to revise.'
    )
    send_imessage(sender, _preview)
    print(f'[claude-build] Done. Code length: {len(_code)}. Awaiting approval.', flush=True)

'''

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Dispatch in the message loop
# ══════════════════════════════════════════════════════════════════════════════

CLAUDE_DISPATCH = (
    '                # ── !claude: Claude API-powered code generation ──────────\n'
    '                if _tl.startswith(\'!claude \') or _tl == \'!claude\':\n'
    '                    _cl_task = text.strip()[7:].strip()\n'
    '                    if not _cl_task:\n'
    '                        send_imessage(REPLY_TO,\n'
    '                            \'Usage: !claude <task>\\n\'\n'
    '                            \'Example: !claude add a !weather command to bridge.py\\n\\n\'\n'
    '                            \'Requires ANTHROPIC_API_KEY in ~/cowork-bridge/.env\')\n'
    '                    else:\n'
    '                        import threading as _clt\n'
    '                        _clt.Thread(\n'
    '                            target=_handle_claude_command,\n'
    '                            args=(_cl_task, REPLY_TO),\n'
    '                            daemon=True,\n'
    '                            name=\'claude-build\',\n'
    '                        ).start()\n'
    '                    continue\n'
)

# ══════════════════════════════════════════════════════════════════════════════
# Apply patches
# ══════════════════════════════════════════════════════════════════════════════

# Part 1: Insert helpers before _apply_patch or run_shell
anchors1 = ['\ndef _apply_patch(', '\ndef _pending_build', '\ndef run_shell(', '\ndef query_ollama(']
inserted1 = False
for _a1 in anchors1:
    _pos1 = s.find(_a1)
    if _pos1 != -1:
        s = s[:_pos1] + CLAUDE_BUILD_CODE + s[_pos1:]
        print(f'Part 1: _handle_claude_command inserted before "{_a1.strip()}"')
        inserted1 = True
        break
if not inserted1:
    # Try inserting after the existing _pending_build dict definition
    _pb_pos = s.find('_pending_build = {}')
    if _pb_pos != -1:
        _nl = s.find('\n', _pb_pos) + 1
        s = s[:_nl] + CLAUDE_BUILD_CODE + s[_nl:]
        print('Part 1: _handle_claude_command inserted after _pending_build dict')
        inserted1 = True
if not inserted1:
    print('Part 1 FAILED — no anchor found')
    sys.exit(1)

# Part 2: Wire dispatch — insert before approve/reject block or !build block
_inserted2 = False

# Best anchor: insert right before the approve/reject sentinel
APPROVE_SENTINEL = '                # ── approve / reject build replies'
_as_pos = s.find(APPROVE_SENTINEL)
if _as_pos != -1:
    s = s[:_as_pos] + CLAUDE_DISPATCH + s[_as_pos:]
    print('Part 2: !claude dispatch inserted before approve/reject block')
    _inserted2 = True

if not _inserted2:
    # Fallback: before !build dispatch
    BUILD_ANCHORS = [
        "                # ── !build / !task LangGraph command",
        "                if _tl.startswith('!build')",
    ]
    for _ba in BUILD_ANCHORS:
        _ba_pos = s.find(_ba)
        if _ba_pos != -1:
            s = s[:_ba_pos] + CLAUDE_DISPATCH + s[_ba_pos:]
            print(f'Part 2: !claude dispatch inserted before !build block')
            _inserted2 = True
            break

if not _inserted2:
    print('Part 2 WARNING: Could not find dispatch insertion point')
    print('  Manually add CLAUDE_DISPATCH to the message loop')

# ══════════════════════════════════════════════════════════════════════════════
# Write & validate
# ══════════════════════════════════════════════════════════════════════════════
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — !claude command installed')
    print('\nSetup:')
    print('  echo "ANTHROPIC_API_KEY=sk-ant-..." >> ~/cowork-bridge/.env')
    print('\nUsage (via iMessage):')
    print('  !claude add a !weather command that calls wttr.in and sends back the forecast')
    print('  approve           → applies patch to bridge.py, restarts')
    print('  reject: <notes>   → revises with feedback (max 3 rounds)')
    print('  reject            → discards')
    print('\nModel: claude-sonnet-4-5 (override with ANTHROPIC_MODEL in .env)')
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
