#!/usr/bin/env python3
"""
fix_recall.py — Add cross-session memory recall to bridge.py.

Problem: The bridge saves sessions to *_session.md files in the Obsidian vault
and the vault IS indexed, but when the user asks "what did we talk about
yesterday?" the hybrid embedding search returns generic chunks that the model
can't use to answer properly.

Root cause: embedding search returns ~500-char chunks sorted by cosine similarity
to "what did we talk about yesterday" — those chunks are generic vault text, not
the actual session transcript.  The model gets no useful context and says it
can't recall.

Fix (3 parts):
  1. Add get_session_context(vault_path, query, n_days) — reads recent
     *_session.md files directly and returns a formatted summary block.
  2. Add is_recall_query(text) — detects recall-intent keywords.
  3. Inject session context into the conversation's system message when the
     query is a recall request.

Anchors used (in order of preference):
  - Print "[memory] Hybrid search" line (to insert after it)
  - The system_msg / sys_prompt assignment near the AI call
"""
import subprocess, sys, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard: already patched? ───────────────────────────────────────────────────
if 'get_session_context' in s or 'is_recall_query' in s:
    print('SKIPPED — recall patch already present')
    sys.exit(0)

# ── Part 1: inject helper functions before the main message loop ──────────────
SESSION_HELPERS = r'''

# ── Cross-session recall helpers ──────────────────────────────────────────────
_RECALL_KEYWORDS = [
    'yesterday', 'last week', 'last month', 'earlier today',
    'what were we', 'what did we', 'what was', 'we talked about',
    'we discussed', 'remind me', 'previous conversation',
    'remember when', 'last time', 'what have we', 'our conversation',
    'you told me', 'i told you', 'we were working on', 'we were discussing',
]


def is_recall_query(text: str) -> bool:
    """Return True if the message is asking about past conversations."""
    low = text.lower()
    return any(kw in low for kw in _RECALL_KEYWORDS)


def get_session_context(vault_path: str, query: str = '', n_days: int = 14,
                        max_sessions: int = 5, max_chars_per: int = 2000) -> str:
    """
    Find recent *_session.md files in the vault and return a formatted
    summary block suitable for injection into the system prompt.

    Sessions are sorted newest-first; only those within n_days are included.
    Returns an empty string if no sessions found.
    """
    import pathlib as _pl, datetime as _dt, os as _os

    vault = _pl.Path(vault_path)
    cutoff = _dt.datetime.now() - _dt.timedelta(days=n_days)

    # Search vault root and one level of subdirectories for session files
    session_files = []
    for pattern in ['*_session.md', '**/*_session.md']:
        session_files.extend(vault.glob(pattern))

    # Also check the parent directory in case sessions are stored there
    parent = vault.parent
    session_files.extend(parent.glob('*_session.md'))

    if not session_files:
        return ''

    # Deduplicate and sort by mtime (newest first)
    seen = set()
    unique = []
    for sf in session_files:
        k = str(sf.resolve())
        if k not in seen:
            seen.add(k)
            unique.append(sf)

    unique.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    blocks = []
    for sf in unique[:max_sessions * 3]:      # read more, filter by date
        try:
            mtime = _dt.datetime.fromtimestamp(sf.stat().st_mtime)
            if mtime < cutoff:
                continue
            content = sf.read_text(errors='ignore').strip()
            if not content:
                continue
            date_label = mtime.strftime('%A %Y-%m-%d %H:%M')
            snippet = content[:max_chars_per]
            if len(content) > max_chars_per:
                snippet += '\n… (truncated)'
            blocks.append(f'--- Session: {date_label} ---\n{snippet}')
            if len(blocks) >= max_sessions:
                break
        except Exception as _e:
            continue

    if not blocks:
        return ''

    header = (
        f'[PAST SESSIONS — {len(blocks)} most recent, up to {n_days} days]\n'
        'Use this to answer questions about past conversations.\n\n'
    )
    return header + '\n\n'.join(blocks)

'''

# Find a stable insertion anchor: just before the main while/for loop that
# processes messages.  A reliable nearby anchor is the hybrid_search function
# definition or the vault/SEARCH_DIR constant.

anchors_for_helpers = [
    '\ndef run_shell(',           # added by fix_features
    '\ndef execute_code_task(',   # original
    '\ndef query_ollama(',        # core function
    '\n# ── main loop',
    '\nwhile True:',
]

inserted_helpers = False
for anchor in anchors_for_helpers:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + SESSION_HELPERS + s[pos:]
        print(f'Part 1: session helpers inserted before "{anchor.strip()}"')
        inserted_helpers = True
        break

if not inserted_helpers:
    print('Part 1 FAILED — no anchor found for helper insertion')
    sys.exit(1)


# ── Part 2+3: inject recall logic after the hybrid search print ───────────────
# Find the line that prints "[memory] Hybrid search"
HYBRID_PRINT = '[memory] Hybrid search'
hp = s.find(HYBRID_PRINT)
if hp == -1:
    # Try alternate spelling
    for alt in ['[memory] hybrid search', 'Hybrid search:', 'hybrid_search(']:
        hp = s.find(alt)
        if hp != -1:
            HYBRID_PRINT = alt
            break

if hp == -1:
    print('Part 2 FAILED — hybrid search print not found; showing candidates:')
    for needle in ['memory', 'embed_search', 'vault_search', 'search_vault']:
        idx = s.find(needle)
        if idx != -1:
            ls = s.rfind('\n', 0, idx) + 1
            le = s.find('\n', idx)
            print(f'  {repr(s[ls:le].strip())}')
    sys.exit(1)

# Find the end of the line containing the hybrid search print
hp_line_end = s.find('\n', hp) + 1

# Detect indentation from that line
hp_line_start = s.rfind('\n', 0, hp) + 1
raw_ind = s[hp_line_start:hp]
ind = raw_ind[:len(raw_ind) - len(raw_ind.lstrip())]

# Build the recall injection block
# We need to find the system prompt / messages list being built nearby.
# We'll look for where the memory context is appended to the system prompt
# (usually a variable like sys_content, system_msg, memory_context, etc.)
# Since we can't know the exact variable name, we inject a block that
# appends to the conversation as a special "memory" user message if it's
# a recall query.

RECALL_INJECT = (
    f'{ind}# ── Cross-session recall injection ──────────────────────────────────────\n'
    f'{ind}if is_recall_query(text):\n'
    f'{ind}    _sess_ctx = get_session_context(\n'
    f'{ind}        str(VAULT) if "VAULT" in dir() else\n'
    f'{ind}        str(SEARCH_DIR) if "SEARCH_DIR" in dir() else\n'
    f'{ind}        "/Users/alexmcgann/Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive",\n'
    f'{ind}        query=text\n'
    f'{ind}    )\n'
    f'{ind}    if _sess_ctx:\n'
    f'{ind}        print(f"[memory] Session recall: injecting {{len(_sess_ctx)}} chars", flush=True)\n'
    f'{ind}        # Inject as an assistant-side memory note before the user query\n'
    f'{ind}        conversation.insert(-1, {{\n'
    f'{ind}            "role": "user",\n'
    f'{ind}            "content": (\n'
    f'{ind}                "[SYSTEM: The following are your recent conversation transcripts from Obsidian.\\n"\n'
    f'{ind}                "Use them to answer the user\'s question about past conversations.]\\n\\n"\n'
    f'{ind}                + _sess_ctx\n'
    f'{ind}            )\n'
    f'{ind}        }})\n'
    f'{ind}        conversation.insert(-1, {{\n'
    f'{ind}            "role": "assistant",\n'
    f'{ind}            "content": "I have retrieved our past conversation transcripts. I\'ll use them to answer your question."\n'
    f'{ind}        }})\n'
    f'{ind}    else:\n'
    f'{ind}        print("[memory] Session recall: no session files found", flush=True)\n'
)

s = s[:hp_line_end] + RECALL_INJECT + s[hp_line_end:]
print(f'Part 2+3: recall injection added after hybrid search at pos {hp}')


# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — bridge.py updated with session recall')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
