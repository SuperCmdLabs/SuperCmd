#!/usr/bin/env python3
"""
fix_user_profile.py — Proactively save personal facts/preferences to Obsidian.

Problem: When the user drops personal context ("Local would be Vegas for me",
"I prefer X", "My company is Y"), the bridge processes it and replies but never
saves it anywhere persistent. Next session the agent has no memory of it.

Fix (3 parts):
  1. Add extract_user_facts(text, reply) — uses Hermes3 (or the fast model) to
     extract structured personal facts from a turn and appends them to
     AI Archive/User Profile.md in Obsidian.
  2. Add should_extract_facts(text) — lightweight heuristic to decide whether
     a turn is worth running extraction on (avoids calling Ollama on every
     single message).
  3. Wire extract_user_facts() after save_session() in the message loop so it
     runs as a background thread without blocking replies.

User Profile.md format:
  # User Profile
  _Auto-maintained by bridge. Last updated: DATETIME_

  ## Personal Facts
  - location: Las Vegas, NV
  - ...

  ## Preferences
  - prefers: concise replies
  - ...

  ## Projects & Work
  - ...
"""
import subprocess, sys

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if 'extract_user_facts' in s or 'User Profile' in s:
    print('SKIPPED — user profile extraction already present')
    sys.exit(0)

# ── Part 1: helper code ───────────────────────────────────────────────────────
PROFILE_HELPERS = r'''

# ── User Profile extractor ────────────────────────────────────────────────────
_PROFILE_PATH = None   # resolved lazily from vault path

_FACT_TRIGGERS = [
    # Personal info
    'i am ', "i'm ", 'my name is', 'i live', 'i work', 'i use', 'i prefer',
    'i like', "i don't like", 'i hate', 'i love', 'i always', 'i usually',
    'local', 'my company', 'my job', 'my role', 'my team', 'my project',
    'my phone', 'my email', 'my address', 'my location', 'i am based',
    'for me', 'in my case', 'my setup', 'my workflow',
    # Stated preferences
    'remind me', 'remember that', 'note that', 'save that', 'keep track',
    'add to my', 'update my', 'my preference',
]


def should_extract_facts(text: str) -> bool:
    """Quick heuristic — only run Hermes extraction when likely to yield facts."""
    low = text.lower()
    return any(t in low for t in _FACT_TRIGGERS)


def _get_profile_path(vault_path: str) -> 'pathlib.Path':
    global _PROFILE_PATH
    if _PROFILE_PATH is None:
        import pathlib as _pl
        _PROFILE_PATH = _pl.Path(vault_path) / 'User Profile.md'
    return _PROFILE_PATH


def extract_user_facts(text: str, reply: str, vault_path: str) -> None:
    """
    Background thread: ask Hermes to extract personal facts from the turn
    and append them to User Profile.md in the Obsidian vault.
    Runs as daemon thread — never blocks the main message loop.
    """
    import threading as _t_uf
    def _do_extract(text, reply, vault_path):
        try:
            import pathlib as _pl, time as _t5
            profile_path = _get_profile_path(vault_path)

            # Read existing profile so Hermes knows what's already recorded
            existing = ''
            if profile_path.exists():
                existing = profile_path.read_text(errors='ignore').strip()

            prompt = (
                'You extract personal facts, preferences, and context about the USER '
                '(not the assistant) from a conversation turn and update a structured '
                'Obsidian profile note.\n\n'
                f'USER MESSAGE:\n{text[:600]}\n\n'
                f'ASSISTANT REPLY:\n{reply[:400]}\n\n'
                f'CURRENT PROFILE:\n{existing[:1500] if existing else "(empty)"}\n\n'
                'Return ONLY the updated full profile note in this exact format '
                '(keep existing facts, add new ones, never remove facts):\n\n'
                '# User Profile\n'
                f'_Auto-maintained by bridge. Last updated: {_t5.strftime("%Y-%m-%d %H:%M")}_\n\n'
                '## Personal Facts\n'
                '- key: value\n\n'
                '## Preferences\n'
                '- key: value\n\n'
                '## Projects & Work\n'
                '- key: value\n\n'
                '## Other Notes\n'
                '- note\n\n'
                'If this turn contains NO new personal facts, reply with exactly: NO_UPDATE'
            )

            msgs = [
                {
                    'role': 'system',
                    'content': (
                        'You are a personal knowledge archivist. '
                        'Extract ONLY facts explicitly stated by the user about themselves. '
                        'Never invent or guess. Output ONLY the profile note or NO_UPDATE.'
                    ),
                },
                {'role': 'user', 'content': prompt},
            ]

            result = query_ollama(msgs, model=MODELS.get('archivist', 'hermes3'))

            if result.strip() == 'NO_UPDATE' or not result.strip():
                return

            if '# User Profile' not in result:
                return   # model didn't follow format

            profile_path.parent.mkdir(parents=True, exist_ok=True)
            profile_path.write_text(result.strip())
            print(f'[profile] Updated {profile_path.name}', flush=True)

        except Exception as _pe:
            print(f'[profile] Error: {_pe}', flush=True)

    _t_uf.Thread(
        target=_do_extract,
        args=(text, reply, vault_path),
        daemon=True,
        name='user-profile-extractor',
    ).start()

'''

# ── Insert helpers (same anchor logic as fix_recall.py) ──────────────────────
anchors_helpers = [
    '\ndef run_shell(',
    '\ndef execute_code_task(',
    '\ndef query_ollama(',
]

inserted = False
for anchor in anchors_helpers:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + PROFILE_HELPERS + s[pos:]
        print(f'Part 1: user-profile helpers inserted before "{anchor.strip()}"')
        inserted = True
        break

if not inserted:
    print('Part 1 FAILED — no anchor found for helper insertion')
    sys.exit(1)


# ── Part 2+3: wire extract_user_facts after save_session ─────────────────────
# save_session(conversation, session_start) is already in the loop.
# After that line we inject the profile extraction call.

SAVE_CALL = 'save_session(conversation, session_start)'
sp = s.find(SAVE_CALL)
if sp == -1:
    print('Part 2 FAILED — save_session(conversation, session_start) not found')
    import re
    for needle in ['save_session(', 'session_start']:
        idx = s.find(needle)
        if idx != -1:
            ls = s.rfind('\n', 0, idx) + 1
            le = s.find('\n', idx)
            print(f'  {repr(s[ls:le].strip())}')
    sys.exit(1)

if 'extract_user_facts' in s[sp:sp + 400]:
    print('Part 2 SKIPPED — already wired')
else:
    eol = s.find('\n', sp) + 1
    ls  = s.rfind('\n', 0, sp) + 1
    ind_raw = s[ls:sp]
    ind = ind_raw[:len(ind_raw) - len(ind_raw.lstrip())]

    # Determine vault variable name
    vault_expr = (
        'str(VAULT)' if 'VAULT' in s else
        'str(SEARCH_DIR)' if 'SEARCH_DIR' in s else
        '"/Users/alexmcgann/Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive"'
    )

    insert_profile = (
        f'{ind}if should_extract_facts(text):\n'
        f'{ind}    extract_user_facts(\n'
        f'{ind}        text, reply if "reply" in dir() else "",\n'
        f'{ind}        {vault_expr}\n'
        f'{ind}    )  # background — non-blocking\n'
    )
    s = s[:eol] + insert_profile + s[eol:]
    print('Part 2+3: extract_user_facts wired after save_session')


# ── Also inject User Profile into system prompt ───────────────────────────────
# Find where the vault/memory context is built and prepend User Profile.md content
# Anchor: the same hybrid search print used in fix_recall.py

HYBRID_PRINT = '[memory] Hybrid search'
hp = s.find(HYBRID_PRINT)

if hp == -1:
    print('Part 4 SKIPPED — hybrid search anchor not found (profile inject skipped)')
elif 'User Profile' in s[max(0, hp-200):hp+500]:
    print('Part 4 SKIPPED — profile injection already present')
else:
    hp_line_end = s.find('\n', hp) + 1
    hp_ls = s.rfind('\n', 0, hp) + 1
    raw_ind = s[hp_ls:hp]
    ind4 = raw_ind[:len(raw_ind) - len(raw_ind.lstrip())]

    vault_expr2 = (
        'str(VAULT)' if 'VAULT' in s else
        'str(SEARCH_DIR)' if 'SEARCH_DIR' in s else
        '"/Users/alexmcgann/Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive"'
    )

    PROFILE_INJECT = (
        f'{ind4}# ── Inject User Profile into context ────────────────────────────────\n'
        f'{ind4}_profile_path = _get_profile_path({vault_expr2})\n'
        f'{ind4}if _profile_path.exists():\n'
        f'{ind4}    import pathlib as _ppl\n'
        f'{ind4}    _profile_txt = _ppl.Path(str(_profile_path)).read_text(errors="ignore").strip()\n'
        f'{ind4}    if _profile_txt:\n'
        f'{ind4}        conversation.insert(1, {{\n'
        f'{ind4}            "role": "user",\n'
        f'{ind4}            "content": "[USER PROFILE — use for personalization:]\\n" + _profile_txt\n'
        f'{ind4}        }})\n'
        f'{ind4}        conversation.insert(2, {{\n'
        f'{ind4}            "role": "assistant",\n'
        f'{ind4}            "content": "Understood, I have your profile context."\n'
        f'{ind4}        }})\n'
    )

    s = s[:hp_line_end] + PROFILE_INJECT + s[hp_line_end:]
    print('Part 4: User Profile injected into context before each AI call')


# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — bridge.py updated with user profile extraction')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
