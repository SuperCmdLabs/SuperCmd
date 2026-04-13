#!/usr/bin/env python3
"""
fix_web_search.py — Add web search capability for current/temporal queries.

Patches /Users/alexmcgann/cowork-bridge/bridge.py to:

  Part 1: _web_search(query, n=5) — searches DuckDuckGo instant answer API
          with an HTML fallback. Uses only urllib.request; never raises.

  Part 2: _is_web_search_query(text) — detects queries that need current/web
          information based on temporal keywords, news patterns, and question
          prefixes. Excludes clearly personal/vault questions.

  Part 3: Wire into AI response flow — before calling query_ollama for normal
          messages, auto-trigger a search if _is_web_search_query returns True
          and inject results into a shallow copy of the conversation messages.

  Part 4: !search <query> explicit command — format results as a numbered list
          and send via iMessage without calling query_ollama.
"""
import subprocess, sys, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard: already patched? ───────────────────────────────────────────────────
if '_web_search' in s:
    print('SKIPPED — web search patch already present')
    sys.exit(0)


# ── Part 1 + 2: inject helper functions ───────────────────────────────────────
WEB_SEARCH_HELPERS = r'''

# ── Web search helpers ────────────────────────────────────────────────────────

def _web_search(query: str, n: int = 5) -> list:
    """
    Search DuckDuckGo for current/temporal information.

    Primary: DuckDuckGo instant answer API (JSON).
    Fallback: DuckDuckGo HTML results parsed with regex.

    Returns a list of up to n snippet strings.
    Returns an empty list on any failure — never raises.
    """
    import urllib.request as _ur, urllib.parse as _up, json as _json, re as _re

    _UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    snippets = []

    # ── Primary: instant answer JSON API ─────────────────────────────────────
    try:
        params = _up.urlencode({
            'q': query, 'format': 'json', 'no_html': '1', 'skip_disambig': '1'
        })
        req = _ur.Request(
            f'https://api.duckduckgo.com/?{params}',
            headers={'User-Agent': _UA}
        )
        with _ur.urlopen(req, timeout=8) as resp:
            data = _json.loads(resp.read().decode('utf-8', errors='replace'))

        # AbstractText / Abstract (may be the same or different)
        for field in ('AbstractText', 'Abstract'):
            val = (data.get(field) or '').strip()
            if val and val not in snippets:
                snippets.append(val)
                if len(snippets) >= n:
                    break

        # RelatedTopics[0..2].Text
        for topic in (data.get('RelatedTopics') or [])[:3]:
            if not isinstance(topic, dict):
                continue
            val = (topic.get('Text') or '').strip()
            if val and val not in snippets:
                snippets.append(val)
                if len(snippets) >= n:
                    break
    except Exception as _e1:
        pass  # fall through to HTML fallback

    if len(snippets) >= n:
        return snippets[:n]

    # ── Fallback: HTML results ────────────────────────────────────────────────
    try:
        params = _up.urlencode({'q': query})
        req = _ur.Request(
            f'https://html.duckduckgo.com/html/?{params}',
            headers={'User-Agent': _UA}
        )
        with _ur.urlopen(req, timeout=8) as resp:
            html = resp.read().decode('utf-8', errors='replace')

        # Extract result titles and snippets from HTML
        titles   = _re.findall(r'<a class="result__a"[^>]*>([^<]+)</a>', html)
        snippets_html = _re.findall(r'<a class="result__snippet"[^>]*>([^<]+)</a>', html)

        # Pair title + snippet; fall back to just snippet if titles run short
        for i in range(min(3, max(len(titles), len(snippets_html)))):
            title   = titles[i].strip()   if i < len(titles)        else ''
            snippet = snippets_html[i].strip() if i < len(snippets_html) else ''
            if title and snippet:
                combined = f'{title} — {snippet}'
            elif snippet:
                combined = snippet
            elif title:
                combined = title
            else:
                continue
            if combined not in snippets:
                snippets.append(combined)
            if len(snippets) >= n:
                break
    except Exception as _e2:
        pass

    return snippets[:n]


def _is_web_search_query(text: str) -> bool:
    """
    Return True if the message is likely asking about current/web information.

    Detects:
      - Temporal keywords (today, this week, latest, 2024/2025/2026, ...)
      - News/event keywords (news, what happened, price of, weather in, ...)
      - Question patterns starting with what/who/when/where + an entity name
        (at least one non-personal word after the question word)

    Returns False if the query is clearly personal/vault-directed
    (contains "I", "my", "we", "you", "our" as standalone words).
    """
    import re as _re

    low = text.lower().strip()

    # Exclude personal / vault questions
    _personal = _re.compile(r'\b(i|my|we|you|our)\b')
    if _personal.search(low):
        return False

    # Temporal keywords
    _temporal = [
        'today', 'this week', 'this month', 'latest', 'recent',
        'current', ' now ', 'right now', '2024', '2025', '2026',
    ]
    for kw in _temporal:
        if kw in low:
            return True

    # News / event keywords
    _news = [
        'news', 'what happened', 'did ', 'has ', 'is  still',
        'how much is', 'price of', 'score', 'weather in',
        'is still', 'stock price', 'exchange rate',
    ]
    for kw in _news:
        if kw in low:
            return True

    # Question patterns: starts with what/who/when/where followed by
    # at least one entity-like word (not just a pronoun)
    _q_pat = _re.compile(
        r'^(what is|what are|who is|who are|when did|when is|where is|where are)\s+\S'
    )
    if _q_pat.match(low):
        return True

    return False

'''

# Insert helpers before a stable anchor (prefer run_shell, then query_ollama)
_HELP_ANCHORS = [
    '\ndef run_shell(',
    '\ndef execute_code_task(',
    '\ndef query_ollama(',
    '\n# ── main loop',
    '\nwhile True:',
]

inserted_helpers = False
for anchor in _HELP_ANCHORS:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + WEB_SEARCH_HELPERS + s[pos:]
        print(f'Part 1+2: web search helpers inserted before "{anchor.strip()}"')
        inserted_helpers = True
        break

if not inserted_helpers:
    print('Part 1+2 FAILED — no anchor found for helper insertion')
    sys.exit(1)


# ── Part 4: !search explicit command ─────────────────────────────────────────
# Find an existing command dispatch block (e.g. !summarize, !help, !reminder)
# and insert the !search handler alongside it.
#
# Strategy: find the pattern where text.strip().lower().startswith('!') is
# checked, or find a known command like '!summarize' / '!help'.  We insert
# our block BEFORE the fallback / else that builds the normal AI response.

SEARCH_CMD_BLOCK = r'''
                # ── !search explicit web search ──────────────────────────────
                if text.strip().lower().startswith('!search '):
                    _sq = text.strip()[8:].strip()
                    print(f'[web] Explicit !search: {repr(_sq[:60])}', flush=True)
                    _sr = _web_search(_sq)
                    if _sr:
                        _lines = '\n'.join(f'{_i+1}. {_snip}' for _i, _snip in enumerate(_sr))
                        send_imessage(REPLY_TO, f'Search results for "{_sq}":\n\n{_lines}')
                    else:
                        send_imessage(REPLY_TO, 'No results found.')
                    continue
'''

# Locate an anchor inside the message-processing loop.
# We look for a series of known command checks; we want to add our !search
# block before the normal AI response path.
_CMD_ANCHORS = [
    "startswith('!summarize')",
    "startswith('!help')",
    "startswith('!reminder')",
    "startswith('!note')",
    "startswith('!',",
    "startswith('!')",
]

inserted_cmd = False
for anchor in _CMD_ANCHORS:
    pos = s.find(anchor)
    if pos != -1:
        # Walk back to the start of the enclosing if-statement line
        line_start = s.rfind('\n', 0, pos) + 1
        # Insert our block just before this line
        s = s[:line_start] + SEARCH_CMD_BLOCK + s[line_start:]
        print(f'Part 4: !search command inserted before "{anchor}"')
        inserted_cmd = True
        break

if not inserted_cmd:
    # Fallback: find the for/while loop that iterates new_msgs and insert
    # after the text assignment, before the AI response section
    new_msgs_pat = re.compile(
        r'(for\s+msg_id\s*,\s*text\s*,\s*is_voice\s+in\s+new_msgs\s*:)'
    )
    m_loop = new_msgs_pat.search(s)
    if m_loop:
        # Find end of the for-loop header line
        loop_line_end = s.find('\n', m_loop.end()) + 1
        # Detect body indentation from the next non-blank line
        rest = s[loop_line_end:]
        first_stmt = re.match(r'(\s+)\S', rest)
        ind = first_stmt.group(1) if first_stmt else '                '
        # Re-indent our block to match
        cmd_block_indented = '\n'.join(
            (ind + line[16:] if line.startswith(' ' * 16) else line)
            for line in SEARCH_CMD_BLOCK.splitlines()
        ) + '\n'
        s = s[:loop_line_end] + cmd_block_indented + s[loop_line_end:]
        print('Part 4: !search command inserted at top of new_msgs loop (fallback)')
        inserted_cmd = True

if not inserted_cmd:
    print('Part 4 WARNING: could not find anchor for !search command — skipping')


# ── Part 3: wire auto-search into the AI response flow ───────────────────────
# Strategy: find the main AI response call specifically.
# Bridge.py uses `reply = query_ollama(msgs)` (or similar variable name) in the
# message loop.  Helper functions (_morning_brief, etc.) use `result = ...` or
# local underscore-prefixed vars, so we prioritise `reply` first.
#
# We anchor to the for-loop `for msg_id, text, is_voice in new_msgs:` to make
# sure we only patch calls INSIDE the message loop, where `text` is defined.

# Find the message-loop for header
_for_loop_pat = re.compile(
    r'for\s+(?:_msg_tuple|msg_id,\s*text,\s*is_voice)\s+in\s+new_msgs\s*:'
)
_for_m = _for_loop_pat.search(s)
_search_from = _for_m.end() if _for_m else 0
if not _for_m:
    print('Part 3 WARNING: message for-loop not found — searching whole file')

# Prefer `reply = query_ollama(...)` (the main response variable name)
_OLLAMA_CALL_PAT = re.compile(
    r'^(\s*)(reply\s*=\s*query_ollama\(\s*([^\n)]+)\s*\))',
    re.MULTILINE
)
ollama_matches = list(_OLLAMA_CALL_PAT.finditer(s, _search_from))

if not ollama_matches:
    # Broader: any `<var> = query_ollama(msgs|conversation)` after the loop
    _OLLAMA_CALL_PAT2 = re.compile(
        r'^(\s*)([\w]+\s*=\s*query_ollama\(\s*(msgs|conversation|messages)\s*\))',
        re.MULTILINE
    )
    ollama_matches = list(_OLLAMA_CALL_PAT2.finditer(s, _search_from))

if not ollama_matches:
    print('Part 3 FAILED — could not locate reply = query_ollama() inside message loop')
    sys.exit(1)

m_call = ollama_matches[0]
ind = m_call.group(1)  # indentation of that line
call_pos = m_call.start()

WEB_INJECT = (
    f'{ind}# ── Auto web search injection ────────────────────────────────────────\n'
    f'{ind}_msgs_for_ollama = msgs\n'
    f'{ind}if _is_web_search_query(text):\n'
    f'{ind}    print(f\'[web] Search triggered for: {{repr(text[:60])}}\', flush=True)\n'
    f'{ind}    _wsq = text[:200]\n'
    f'{ind}    _wsr = _web_search(_wsq)\n'
    f'{ind}    if _wsr:\n'
    f'{ind}        _ws_note = (\n'
    f'{ind}            f"[Web search results for \'{{_wsq}}\':\\n"\n'
    f'{ind}            + "\\n".join(f\'- {{_s}}\' for _s in _wsr)\n'
    f'{ind}            + "\\n\\nUse these results to inform your response if relevant.]"\n'
    f'{ind}        )\n'
    f'{ind}        # Shallow copy — do not mutate the persistent conversation list\n'
    f'{ind}        _msgs_for_ollama = list(msgs) + [{{\n'
    f'{ind}            "role": "user",\n'
    f'{ind}            "content": _ws_note,\n'
    f'{ind}        }}]\n'
    f'{ind}# ─────────────────────────────────────────────────────────────────────\n'
)

# Replace the first occurrence of the query_ollama call variable name
# so it uses _msgs_for_ollama instead of the original msgs variable
original_call_line = m_call.group(0)
patched_call_line  = original_call_line.replace(
    m_call.group(3),   # e.g. 'msgs' or 'conversation'
    '_msgs_for_ollama',
    1
)

s = s[:call_pos] + WEB_INJECT + patched_call_line + s[call_pos + len(original_call_line):]
print(f'Part 3: web search injection added before query_ollama() call '
      f'(line ~{s[:call_pos].count(chr(10)) + 1})')


# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\nOK syntax OK — bridge.py updated with web search')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
