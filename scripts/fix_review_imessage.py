#!/usr/bin/env python3
"""
fix_review_imessage.py — Fix two bugs in _nightly_review():

1. Validate result before writing to vault: if the LLM returned an error or
   empty/garbage (no ## section headers), skip writing and log a warning.

2. Replace the second query_ollama summary call with a direct excerpt of the
   review itself.  The second LLM call is a second point of failure — if
   the first call succeeds, just send the first ~600 chars of the result as
   the iMessage.  No summarisation needed; the review is already concise.
"""
import subprocess, sys, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if '_review_excerpt' in s or 'no section headers' in s:
    print('SKIPPED — review iMessage fix already present')
    sys.exit(0)

# ── Locate _nightly_review() ──────────────────────────────────────────────────
start = s.find('def _nightly_review(')
if start == -1:
    print('ERROR — _nightly_review() not found')
    sys.exit(1)

# ── Patch 1: validate result before writing to vault ─────────────────────────
# Replace:
#   if not result or not result.strip():
#       print('[review] Empty response from model — skipping', flush=True)
#       return
OLD_EMPTY_CHECK = (
    "    if not result or not result.strip():\n"
    "        print('[review] Empty response from model — skipping', flush=True)\n"
    "        return"
)
NEW_EMPTY_CHECK = (
    "    if not result or not result.strip():\n"
    "        print('[review] Empty response from model — skipping', flush=True)\n"
    "        return\n"
    "    # Validate: real review must have at least one ## section header\n"
    "    if '##' not in result:\n"
    "        print(f'[review] Response has no section headers — likely an error: {result[:120]!r}', flush=True)\n"
    "        return"
)

if OLD_EMPTY_CHECK in s:
    s = s.replace(OLD_EMPTY_CHECK, NEW_EMPTY_CHECK, 1)
    print('Patch 1: added section-header validation before vault write')
else:
    print('Patch 1 WARNING: empty-check pattern not found, skipping')

# ── Patch 2: replace second query_ollama call with direct excerpt ─────────────
# Replace the entire "Send brief iMessage summary" block.
OLD_SUMMARY = (
    "    # ── Send brief iMessage summary ───────────────────────────────────────────\n"
    "    summary_msgs = [\n"
    "        {'role': 'system', 'content': 'Write a brief, friendly 3-4 sentence summary of this daily review for an iMessage notification. Be specific.'},\n"
    "        {'role': 'user',   'content': result[:2500]},\n"
    "    ]\n"
    "    summary = query_ollama(summary_msgs)\n"
    "    if summary and summary.strip():\n"
    "        send_imessage(MY_PHONE, f'[Nightly Review — {today_str}]\\n\\n{summary.strip()}')\n"
    "        print(f'[review] iMessage summary sent', flush=True)"
)

NEW_SUMMARY = (
    "    # ── Send brief iMessage summary (direct excerpt — no second LLM call) ─────\n"
    "    _review_excerpt = result.strip()[:700].rstrip()\n"
    "    # Trim to last complete sentence/word to avoid mid-word cuts\n"
    "    if len(result.strip()) > 700:\n"
    "        _review_excerpt = _review_excerpt.rsplit(' ', 1)[0] + ' …'\n"
    "    send_imessage(MY_PHONE, f'[Nightly Review — {today_str}]\\n\\n{_review_excerpt}')\n"
    "    print(f'[review] iMessage summary sent', flush=True)"
)

if OLD_SUMMARY in s:
    s = s.replace(OLD_SUMMARY, NEW_SUMMARY, 1)
    print('Patch 2: replaced second query_ollama call with direct excerpt')
else:
    # Try a more flexible match
    m = re.search(
        r"    # ── Send brief iMessage summary[^\n]*\n"
        r"    summary_msgs = \[.*?\]\n"
        r"    summary = query_ollama\(summary_msgs\)\n"
        r"    if summary and summary\.strip\(\):\n"
        r"        send_imessage\([^\n]+\)\n"
        r"        print\([^\n]+\)",
        s, re.DOTALL
    )
    if m:
        s = s[:m.start()] + NEW_SUMMARY + s[m.end():]
        print('Patch 2: replaced second query_ollama call (regex match)')
    else:
        idx = s.find('summary_msgs', start)
        if idx != -1:
            print(f'Patch 2 WARNING: pattern not matched. Context:')
            print(repr(s[idx:idx+300]))
        else:
            print('Patch 2 WARNING: summary_msgs not found in _nightly_review')

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — review iMessage fixes installed')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
