#!/usr/bin/env python3
"""
fix_action_tracker.py — Extract and track action items from conversations.

Problem: When the user or assistant mentions tasks ("I need to call Bob",
"remind me to follow up", "let's schedule X"), nothing captures them. Next
session those commitments are lost.

Fix (4 parts):
  1. Add should_extract_actions(text, reply) — lightweight heuristic.
  2. Add extract_action_items(text, reply, vault_path) — background thread
     that uses Hermes3 to extract new action items and update
     AI Archive/Action Items.md in Obsidian, marking completed ones.
  3. Wire extract_action_items() after save_session() in the message loop
     (same pattern as extract_user_facts).
  4. Inject pending action items into the conversation context so the AI
     can reference them proactively ("You had an open item about X…").

Action Items.md format:
  # Action Items
  _Auto-maintained by bridge. Last updated: DATETIME_

  ## Pending
  - [ ] Call Bob re: contract (added: 2026-04-12, source: conversation)
  - [ ] Follow up with Felicia about property listings

  ## Completed
  - [x] Book dentist appointment (done: 2026-04-10)
"""
import subprocess, sys

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if 'extract_action_items' in s or 'Action Items' in s:
    print('SKIPPED — action tracker already present')
    sys.exit(0)

# ── Part 1+2: helper code ─────────────────────────────────────────────────────
ACTION_HELPERS = r'''

# ── Action item tracker ───────────────────────────────────────────────────────
_ACTION_ITEMS_PATH = None  # resolved lazily

_ACTION_TRIGGERS = [
    # User committing to do something
    'i need to', 'i should', 'i have to', 'i want to', "i'll",
    'i will', 'i plan to', 'i am going to', "i'm going to",
    'remind me', 'remind me to', 'don\'t forget', 'make sure',
    'follow up', 'schedule', 'call ', 'email ', 'text ', 'message ',
    'book ', 'set up', 'look into', 'research', 'check on',
    'get back to', 'reach out', 'send ', 'submit ', 'file ',
    'finish ', 'complete ', 'fix ', 'update ', 'review ',
    # Assistant surfacing action items
    'action item', 'todo', 'to-do', 'task:', 'next step',
    'you should', 'you need to', 'you mentioned',
    # Completion signals
    'i did', 'i finished', 'i completed', 'done with', 'i sent',
    'i called', 'i booked', 'i scheduled', 'already did',
    'taken care of', 'handled', 'resolved',
]


def should_extract_actions(text: str, reply: str) -> bool:
    """Quick heuristic — only run extraction when turn likely has action items."""
    combined = (text + ' ' + reply).lower()
    return any(t in combined for t in _ACTION_TRIGGERS)


def _get_action_items_path(vault_path: str) -> 'pathlib.Path':
    global _ACTION_ITEMS_PATH
    if _ACTION_ITEMS_PATH is None:
        import pathlib as _pl
        _ACTION_ITEMS_PATH = _pl.Path(vault_path) / 'Action Items.md'
    return _ACTION_ITEMS_PATH


def extract_action_items(text: str, reply: str, vault_path: str) -> None:
    """
    Background thread: ask Hermes to extract/update action items from the turn.
    Updates Action Items.md in the Obsidian vault.
    Runs as daemon thread — never blocks the main message loop.
    """
    import threading as _t_ai
    def _do_extract(text, reply, vault_path):
        try:
            import pathlib as _pl, time as _t6
            action_path = _get_action_items_path(vault_path)

            existing = ''
            if action_path.exists():
                existing = action_path.read_text(errors='ignore').strip()

            today = _t6.strftime('%Y-%m-%d')
            prompt = (
                'You track action items and tasks for the USER from a conversation turn.\n\n'
                f'USER MESSAGE:\n{text[:600]}\n\n'
                f'ASSISTANT REPLY:\n{reply[:400]}\n\n'
                f'CURRENT ACTION ITEMS:\n{existing[:2000] if existing else "(empty)"}\n\n'
                'Instructions:\n'
                '- Add any NEW tasks/commitments/to-dos mentioned in this turn\n'
                '- Mark items as [x] COMPLETED if the user said they finished them\n'
                '- Keep all existing items unless explicitly completed or cancelled\n'
                f'- Use today\'s date for new items: {today}\n\n'
                'Return ONLY the updated full note in this exact format, or reply '
                'NO_UPDATE if nothing changed:\n\n'
                '# Action Items\n'
                f'_Auto-maintained by bridge. Last updated: {_t6.strftime("%Y-%m-%d %H:%M")}_\n\n'
                '## Pending\n'
                '- [ ] task description (added: DATE)\n\n'
                '## Completed\n'
                '- [x] task description (done: DATE)\n'
            )

            msgs = [
                {
                    'role': 'system',
                    'content': (
                        'You are a task-tracking assistant. '
                        'Extract ONLY explicit tasks, to-dos, and commitments. '
                        'Never invent tasks. Output ONLY the action items note or NO_UPDATE.'
                    ),
                },
                {'role': 'user', 'content': prompt},
            ]

            result = query_ollama(msgs, model=MODELS.get('archivist', 'hermes3'))

            if not result or result.strip() == 'NO_UPDATE':
                return

            if '# Action Items' not in result:
                return  # model didn't follow format

            action_path.parent.mkdir(parents=True, exist_ok=True)
            action_path.write_text(result.strip())
            print(f'[actions] Updated {action_path.name}', flush=True)

        except Exception as _ae:
            print(f'[actions] Error: {_ae}', flush=True)

    _t_ai.Thread(
        target=_do_extract,
        args=(text, reply, vault_path),
        daemon=True,
        name='action-item-extractor',
    ).start()

'''

# ── Insert helpers before anchor function ─────────────────────────────────────
anchors_helpers = [
    '\ndef run_shell(',
    '\ndef execute_code_task(',
    '\ndef query_ollama(',
]

inserted = False
for anchor in anchors_helpers:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + ACTION_HELPERS + s[pos:]
        print(f'Part 1+2: action tracker helpers inserted before "{anchor.strip()}"')
        inserted = True
        break

if not inserted:
    print('Part 1+2 FAILED — no anchor found for helper insertion')
    sys.exit(1)


# ── Part 3: Wire extract_action_items after save_session ──────────────────────
SAVE_CALL = 'save_session(conversation, session_start)'
sp = s.find(SAVE_CALL)
if sp == -1:
    print('Part 3 FAILED — save_session(conversation, session_start) not found')
    sys.exit(1)

if 'extract_action_items' in s[sp:sp + 600]:
    print('Part 3 SKIPPED — already wired')
else:
    eol = s.find('\n', sp) + 1
    ls  = s.rfind('\n', 0, sp) + 1
    ind_raw = s[ls:sp]
    ind = ind_raw[:len(ind_raw) - len(ind_raw.lstrip())]

    vault_expr = (
        'str(SEARCH_DIR)' if 'SEARCH_DIR' in s else
        'str(VAULT)' if 'VAULT' in s else
        '"/Users/alexmcgann/Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive"'
    )

    reply_expr = 'reply if "reply" in dir() else ""'

    insert_actions = (
        f'{ind}if should_extract_actions(text, {reply_expr}):\n'
        f'{ind}    extract_action_items(\n'
        f'{ind}        text, {reply_expr},\n'
        f'{ind}        {vault_expr}\n'
        f'{ind}    )  # background — non-blocking\n'
    )
    s = s[:eol] + insert_actions + s[eol:]
    print('Part 3: extract_action_items wired after save_session')


# ── Part 4: Inject pending action items into conversation context ──────────────
# Anchor: the same hybrid search print used for profile injection.
# Insert action items context just after the profile context (or after hybrid search).

HYBRID_PRINT = '[memory] Hybrid search'
hp = s.find(HYBRID_PRINT)

if hp == -1:
    print('Part 4 SKIPPED — hybrid search anchor not found')
elif 'Action Items' in s[max(0, hp-300):hp+800]:
    print('Part 4 SKIPPED — action items injection already present')
else:
    hp_line_end = s.find('\n', hp) + 1
    hp_ls = s.rfind('\n', 0, hp) + 1
    raw_ind = s[hp_ls:hp]
    ind4 = raw_ind[:len(raw_ind) - len(raw_ind.lstrip())]

    vault_expr2 = (
        'str(SEARCH_DIR)' if 'SEARCH_DIR' in s else
        'str(VAULT)' if 'VAULT' in s else
        '"/Users/alexmcgann/Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive"'
    )

    # Scan forward past any existing profile injection to find the right insert point
    inject_at = hp_line_end
    # If profile injection is present right after hybrid search, insert after it
    profile_marker = '_get_profile_path('
    pm = s.find(profile_marker, hp_line_end)
    if pm != -1 and pm < hp_line_end + 600:
        # Find end of profile injection block (next line at same or lower indent)
        scan = pm
        while scan < len(s):
            nl = s.find('\n', scan)
            if nl == -1: break
            next_line = s[nl+1:s.find('\n', nl+1)]
            stripped = next_line.lstrip()
            if stripped and len(next_line) - len(stripped) <= len(ind4):
                inject_at = nl + 1
                break
            scan = nl + 1

    ACTION_INJECT = (
        f'{ind4}# ── Inject pending Action Items into context ─────────────────────────────\n'
        f'{ind4}_action_path = _get_action_items_path({vault_expr2})\n'
        f'{ind4}if _action_path.exists():\n'
        f'{ind4}    import pathlib as _apl\n'
        f'{ind4}    _action_txt = _apl.Path(str(_action_path)).read_text(errors="ignore")\n'
        f'{ind4}    # Only inject if there are pending items\n'
        f'{ind4}    if "- [ ]" in _action_txt:\n'
        f'{ind4}        _pending_section = _action_txt.split("## Completed")[0] if "## Completed" in _action_txt else _action_txt\n'
        f'{ind4}        _pending_section = _pending_section[:1200].strip()\n'
        f'{ind4}        if _pending_section:\n'
        f'{ind4}            conversation.insert(1, {{\n'
        f'{ind4}                "role": "user",\n'
        f'{ind4}                "content": "[OPEN ACTION ITEMS — reference these proactively if relevant:]\\n" + _pending_section\n'
        f'{ind4}            }})\n'
        f'{ind4}            conversation.insert(2, {{\n'
        f'{ind4}                "role": "assistant",\n'
        f'{ind4}                "content": "Understood, I have your current open action items in mind."\n'
        f'{ind4}            }})\n'
    )

    s = s[:inject_at] + ACTION_INJECT + s[inject_at:]
    print('Part 4: Action Items context injected into conversation')


# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — bridge.py updated with action item tracker')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
