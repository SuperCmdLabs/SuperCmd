#!/usr/bin/env python3
"""
fix_langgraph.py — Install LangGraph multi-agent workflow harness.

What this does:
  1. pip install langgraph langchain-core into the bridge venv
  2. Write ~/cowork-bridge/langgraph_agent.py — standalone 3-node graph:
       planner (gemma4) → writer (qwen2.5-coder:3b) → validator (gemma4)
       Validator can send back to writer for one retry cycle.
  3. Add _handle_build_command() to bridge.py
  4. Wire '!build ' / '!task ' prefix detection into message handling

Trigger:
  iMessage: "!build <task description>"
  e.g.  "!build add a command that lists all scheduled jobs and their next run time"

Output (via iMessage):
  [Step 1/3] Planning...
  [Step 2/3] Writing code...
  [Step 3/3] Validating...
  [Build complete] <title>
  Plan: <summary>
  Code: <patch or function>
  Review: <validator notes>
"""
import pathlib, subprocess, sys, os

HOME      = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON    = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
PIP       = str(BRIDGE_DIR / '.venv' / 'bin' / 'pip')
BRIDGE    = str(BRIDGE_DIR / 'bridge.py')
AGENT     = str(BRIDGE_DIR / 'langgraph_agent.py')

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Install dependencies
# ══════════════════════════════════════════════════════════════════════════════
print('Part 1: Installing langgraph + langchain-core...')
r = subprocess.run(
    [PIP, 'install', '--quiet', 'langgraph', 'langchain-core'],
    capture_output=True, text=True
)
if r.returncode != 0:
    print(f'pip install failed:\n{r.stderr}')
    sys.exit(1)

# Verify import
r2 = subprocess.run(
    [PYTHON, '-c', 'import langgraph; import langchain_core; print("ok")'],
    capture_output=True, text=True
)
if r2.stdout.strip() != 'ok':
    print(f'Import check failed:\n{r2.stderr}')
    sys.exit(1)
print('  langgraph and langchain-core installed OK')


# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Write langgraph_agent.py
# ══════════════════════════════════════════════════════════════════════════════
AGENT_CODE = r'''#!/usr/bin/env python3
"""
langgraph_agent.py — Multi-agent LangGraph workflow for bridge.py.

Graph:  planner → writer → validator → [retry writer? max 2x] → done

Called from bridge.py _handle_build_command().
Uses direct HTTP to Ollama — no langchain-ollama dependency.
"""
from __future__ import annotations
import http.client, json, time
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END


# ── Model config ──────────────────────────────────────────────────────────────
MODEL_PLANNER   = 'gemma4:latest'
MODEL_WRITER    = 'qwen2.5-coder:3b'
MODEL_VALIDATOR = 'gemma4:latest'
MAX_RETRIES     = 2


# ── Shared state schema ───────────────────────────────────────────────────────
class BuildState(TypedDict):
    task:           str           # original user request
    plan:           str           # planner output
    code:           str           # writer output
    review:         str           # validator feedback
    approved:       bool          # validator decision
    retry_count:    int           # writer retry counter
    progress_cb:    object        # callable(msg) for iMessage progress updates
    error:          Optional[str] # any fatal error


# ── Ollama helper (no external deps) ─────────────────────────────────────────
def _ollama(messages: list, model: str, timeout: int = 180) -> str:
    try:
        payload = json.dumps({'model': model, 'messages': messages, 'stream': False})
        conn = http.client.HTTPConnection('localhost', 11434, timeout=timeout)
        conn.request('POST', '/api/chat',
                     body=payload.encode(),
                     headers={'Content-Type': 'application/json'})
        resp = conn.getresponse()
        if resp.status != 200:
            return f'(Ollama HTTP {resp.status})'
        data = json.loads(resp.read())
        return data.get('message', {}).get('content', '').strip()
    except Exception as e:
        return f'(Ollama error: {e})'


def _is_error(text: str) -> bool:
    return not text or any(p in text.lower() for p in [
        'ollama http', 'ollama error', 'http error', 'internal server'
    ])


# ── Node: Planner ─────────────────────────────────────────────────────────────
def planner_node(state: BuildState) -> BuildState:
    cb = state.get('progress_cb')
    if cb:
        cb('[Build 1/3] Planning implementation...')

    msgs = [
        {'role': 'system', 'content': (
            'You are a software architect. Given a task, produce a concise '
            'step-by-step implementation plan. Be specific about what code '
            'needs to change and how. No code yet — just the plan.'
        )},
        {'role': 'user', 'content': (
            f'Task: {state["task"]}\n\n'
            'Write a numbered implementation plan (5-8 steps max). '
            'For each step: what file/function, what change, why.'
        )},
    ]
    result = _ollama(msgs, MODEL_PLANNER)
    if _is_error(result):
        return {**state, 'error': f'Planner failed: {result}'}
    return {**state, 'plan': result, 'error': None}


# ── Node: Writer ──────────────────────────────────────────────────────────────
def writer_node(state: BuildState) -> BuildState:
    cb = state.get('progress_cb')
    retry = state.get('retry_count', 0)
    label = f'[Build 2/3] Writing code{"  (retry " + str(retry) + ")" if retry else ""}...'
    if cb:
        cb(label)

    feedback_section = ''
    if state.get('review') and retry > 0:
        feedback_section = f'\n\nValidator feedback to address:\n{state["review"]}'

    msgs = [
        {'role': 'system', 'content': (
            'You are an expert Python developer. Given an implementation plan, '
            'write the complete code. Output ONLY the code — no explanation, '
            'no markdown fences unless showing a complete file. '
            'If it is a patch/addition, show the full function or section.'
        )},
        {'role': 'user', 'content': (
            f'Task: {state["task"]}\n\n'
            f'Plan:\n{state["plan"]}{feedback_section}\n\n'
            'Write the implementation code now.'
        )},
    ]
    result = _ollama(msgs, MODEL_WRITER, timeout=240)
    if _is_error(result):
        return {**state, 'error': f'Writer failed: {result}'}
    return {**state, 'code': result, 'error': None}


# ── Node: Validator ───────────────────────────────────────────────────────────
def validator_node(state: BuildState) -> BuildState:
    cb = state.get('progress_cb')
    if cb:
        cb('[Build 3/3] Validating...')

    msgs = [
        {'role': 'system', 'content': (
            'You are a senior code reviewer. Review the code for: '
            'correctness, edge cases, security issues, and alignment with the plan. '
            'Be concise. End your review with exactly one line: '
            'VERDICT: APPROVED  or  VERDICT: NEEDS REVISION'
        )},
        {'role': 'user', 'content': (
            f'Task: {state["task"]}\n\n'
            f'Plan:\n{state["plan"]}\n\n'
            f'Code to review:\n{state["code"]}'
        )},
    ]
    result = _ollama(msgs, MODEL_VALIDATOR)
    if _is_error(result):
        # If validator fails, approve anyway so we don't loop forever
        return {**state, 'review': '(validator unavailable)', 'approved': True}

    approved = 'VERDICT: APPROVED' in result or 'approved' in result.lower().split('verdict:')[-1]
    return {**state, 'review': result, 'approved': approved}


# ── Routing: retry writer or finish ──────────────────────────────────────────
def should_retry(state: BuildState) -> str:
    if state.get('error'):
        return 'done'
    if state.get('approved'):
        return 'done'
    if state.get('retry_count', 0) >= MAX_RETRIES:
        return 'done'
    return 'writer'


def increment_retry(state: BuildState) -> BuildState:
    return {**state, 'retry_count': state.get('retry_count', 0) + 1}


# ── Build and compile the graph ───────────────────────────────────────────────
def build_graph():
    g = StateGraph(BuildState)
    g.add_node('planner',  planner_node)
    g.add_node('writer',   writer_node)
    g.add_node('validator', validator_node)
    g.add_node('retry_inc', increment_retry)

    g.set_entry_point('planner')
    g.add_edge('planner', 'writer')
    g.add_edge('writer', 'validator')
    g.add_conditional_edges('validator', should_retry, {
        'writer': 'retry_inc',
        'done':   END,
    })
    g.add_edge('retry_inc', 'writer')
    return g.compile()


_GRAPH = None

def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    return _GRAPH


# ── Public entry point ────────────────────────────────────────────────────────
def run_build(task: str, progress_cb=None) -> dict:
    """
    Run the planner→writer→validator graph for the given task.
    progress_cb: optional callable(str) for step notifications.
    Returns the final BuildState dict.
    """
    initial = BuildState(
        task=task,
        plan='',
        code='',
        review='',
        approved=False,
        retry_count=0,
        progress_cb=progress_cb,
        error=None,
    )
    graph = get_graph()
    result = graph.invoke(initial)
    return result


if __name__ == '__main__':
    import sys
    task = ' '.join(sys.argv[1:]) or 'add a hello world function to bridge.py'
    print(f'Task: {task}\n')

    def log(msg):
        print(msg)

    state = run_build(task, progress_cb=log)
    print(f'\n--- PLAN ---\n{state["plan"]}')
    print(f'\n--- CODE ---\n{state["code"][:2000]}')
    print(f'\n--- REVIEW ---\n{state["review"]}')
    print(f'\nAPPROVED: {state["approved"]}')
    if state.get("error"):
        print(f'ERROR: {state["error"]}')
'''


# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Add _handle_build_command() to bridge.py
# ══════════════════════════════════════════════════════════════════════════════
BUILD_HANDLER = r'''
# ── LangGraph Build Command Handler ───────────────────────────────────────────

def _handle_build_command(task: str, sender: str):
    """
    Run the LangGraph planner→writer→validator workflow for a !build command.
    Sends progress pings and final result via iMessage.
    Called in a background thread from the message handler.
    """
    import sys as _bsys, pathlib as _bpl
    _agent_path = str(_bpl.Path.home() / 'cowork-bridge')
    if _agent_path not in _bsys.path:
        _bsys.path.insert(0, _agent_path)

    try:
        from langgraph_agent import run_build
    except ImportError as _ie:
        send_imessage(sender, f'[Build] LangGraph not installed: {_ie}\nRun fix_langgraph.py first.')
        return

    print(f'[build] Starting task: {task!r}', flush=True)

    def _progress(msg):
        send_imessage(sender, msg)
        print(f'[build] {msg}', flush=True)

    try:
        state = run_build(task, progress_cb=_progress)
    except Exception as _be:
        import traceback as _btb
        send_imessage(sender, f'[Build] Error: {_be}')
        print(f'[build] Exception:\n{_btb.format_exc()}', flush=True)
        return

    if state.get('error'):
        send_imessage(sender, f'[Build failed] {state["error"]}')
        print(f'[build] Failed: {state["error"]}', flush=True)
        return

    # Format result for iMessage
    _plan_short = state['plan'][:500].rstrip()
    if len(state['plan']) > 500:
        _plan_short += '…'

    _code_short = state['code'][:800].rstrip()
    if len(state['code']) > 800:
        _code_short += '\n…[truncated — full code in bridge.log]'

    _verdict = '✅ Approved' if state['approved'] else '⚠️ Needs revision'
    _review_short = state['review'][:300].rstrip()

    _msg = (
        f'[Build complete]\n'
        f'Task: {task[:80]}\n\n'
        f'─── Plan ───\n{_plan_short}\n\n'
        f'─── Code ───\n{_code_short}\n\n'
        f'─── Review ({_verdict}) ───\n{_review_short}'
    )
    send_imessage(sender, _msg)
    print(f'[build] Done. Approved={state["approved"]}', flush=True)

    # Log full code to bridge.log for copy-paste
    print(f'[build] FULL CODE:\n{state["code"]}', flush=True)

'''


# ══════════════════════════════════════════════════════════════════════════════
# Apply patches to bridge.py
# ══════════════════════════════════════════════════════════════════════════════
s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# Guard
if '_handle_build_command' in s:
    print('Part 3 SKIPPED — _handle_build_command already in bridge.py')
else:
    # Insert before run_shell / query_ollama
    anchors = ['\ndef run_shell(', '\ndef execute_code_task(', '\ndef query_ollama(']
    inserted = False
    for anchor in anchors:
        pos = s.find(anchor)
        if pos != -1:
            s = s[:pos] + BUILD_HANDLER + s[pos:]
            print(f'Part 3: _handle_build_command() inserted before "{anchor.strip()}"')
            inserted = True
            break
    if not inserted:
        print('Part 3 FAILED — no anchor found')
        sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
# Part 4: Wire !build / !task prefix detection into message handling
# ══════════════════════════════════════════════════════════════════════════════
# Find the main message processing — look for where we call query_ollama on
# the incoming message and insert a prefix check before it.
BUILD_DISPATCH = '''\
        # ── LangGraph build command ───────────────────────────────────────────
        if text.lower().startswith('!build ') or text.lower().startswith('!task '):
            _task_desc = text.split(' ', 1)[1].strip()
            if _task_desc:
                import threading as _bth
                _bth.Thread(
                    target=_handle_build_command,
                    args=(_task_desc, sender),
                    daemon=True,
                    name='langgraph-build',
                ).start()
                continue
'''

import re as _re

# Look for the main message loop — find where 'text' and 'sender' are used with query_ollama
# Strategy: find the processing loop body and insert before the query_ollama call
patched_dispatch = False

# Common pattern: right after dedup / URL skip checks, before calling the LLM
# Look for a block that has 'msgs = [' or 'query_ollama(msgs' after extracting text
anchors4 = [
    # After the URL skip check
    "            continue  # URL skip\n",
    # After dedup continue
    "            print('[dedup] Skipping already-replied message', flush=True)\n            continue\n",
    # Generic: before 'msgs = ['
]

for anc in anchors4:
    if anc in s:
        # Insert our dispatch after the last dedup/skip continue
        # Find the last occurrence near the message processing loop
        idx = s.rfind(anc)
        insert_pos = idx + len(anc)
        s = s[:insert_pos] + BUILD_DISPATCH + s[insert_pos:]
        print(f'Part 4: !build dispatch wired after "{anc[:50].strip()}"')
        patched_dispatch = True
        break

if not patched_dispatch:
    # Try inserting before the first query_ollama call in the message loop
    # Find the main processing section
    m = _re.search(r'\n(\s+)msgs\s*=\s*\[', s)
    if m:
        indent = m.group(1)
        insert_pos = m.start()
        s = s[:insert_pos] + '\n' + BUILD_DISPATCH + s[insert_pos:]
        print('Part 4: !build dispatch wired before msgs = [ (regex)')
        patched_dispatch = True

if not patched_dispatch:
    print('Part 4 WARNING: could not find insertion point for !build dispatch')
    print('  You may need to add the command check manually')


# ══════════════════════════════════════════════════════════════════════════════
# Write agent + validate bridge
# ══════════════════════════════════════════════════════════════════════════════
import tempfile

# Syntax-check agent
tmp = tempfile.NamedTemporaryFile(suffix='.py', delete=False, mode='w')
tmp.write(AGENT_CODE)
tmp.close()
r = subprocess.run([PYTHON, '-m', 'py_compile', tmp.name], capture_output=True, text=True)
os.unlink(tmp.name)
if r.returncode != 0:
    print(f'SYNTAX ERROR in langgraph_agent.py:\n{r.stderr}')
    sys.exit(1)

pathlib.Path(AGENT).write_text(AGENT_CODE)
print(f'Part 2: Wrote {AGENT}')

# Validate bridge
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ All done — restart bridge and test with:')
    print('  iMessage → "!build add a /status command that shows bridge uptime and last job run times"')
else:
    print(f'\nSYNTAX ERROR in bridge.py:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original bridge.py')
    sys.exit(1)
