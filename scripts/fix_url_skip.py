#!/usr/bin/env python3
"""
fix_url_skip.py — Skip known-problematic URLs before they're fetched.

Problem: ERA real-estate URLs (era.com/property/...) cause bridge to crash
after fetching, then launchd restarts and the same URL loops forever.

Fix:
  1. Add a URL skip-list (patterns) checked BEFORE any URL fetch attempt.
     Matching URLs get a polite canned reply instead of a fetch attempt.
  2. Also skip any URL where the domain has failed 3+ times this session
     (runtime domain-failure counter).

Injection anchor: the '[url] Fetching' print line — insert skip check just
BEFORE the fetch starts.
"""
import subprocess, sys, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if '_URL_SKIP_PATTERNS' in s or '_url_domain_failures' in s:
    print('SKIPPED — URL skip logic already present')
    sys.exit(0)

# ── Part 1: Add skip-list + domain-failure tracker as module-level globals ────
GLOBALS_BLOCK = '''
# ── URL skip list + domain failure tracker ────────────────────────────────────
import re as _url_re, urllib.parse as _url_parse

_URL_SKIP_PATTERNS = [
    r'era\\.com/property',          # ERA real estate (known crash)
    r'realtor\\.com/realestateandhomes',
    r'zillow\\.com/homes',
    r'redfin\\.com/.*-for-sale',
]
_url_domain_failures = {}   # domain -> fail count this session
_URL_DOMAIN_MAX_FAILS = 3   # skip domain after this many failures

def _url_should_skip(url: str) -> str | None:
    """Return a skip-reason string if the URL should be skipped, else None."""
    for pat in _URL_SKIP_PATTERNS:
        if _url_re.search(pat, url, _url_re.IGNORECASE):
            return f'URL matches skip pattern ({pat})'
    try:
        domain = _url_parse.urlparse(url).netloc.lower()
        if _url_domain_failures.get(domain, 0) >= _URL_DOMAIN_MAX_FAILS:
            return f'domain {domain!r} failed {_url_domain_failures[domain]} times this session'
    except Exception:
        pass
    return None

def _url_record_failure(url: str) -> None:
    """Increment failure counter for the URL's domain."""
    try:
        domain = _url_parse.urlparse(url).netloc.lower()
        _url_domain_failures[domain] = _url_domain_failures.get(domain, 0) + 1
        print(f'[url] Domain failure #{_url_domain_failures[domain]} for {domain!r}', flush=True)
    except Exception:
        pass

'''

# Insert before the first 'def run_shell' or 'def query_ollama' or 'def execute_code_task'
anchors = ['\ndef run_shell(', '\ndef execute_code_task(', '\ndef query_ollama(']
inserted = False
for anchor in anchors:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + GLOBALS_BLOCK + s[pos:]
        print(f'Part 1: URL skip globals inserted before "{anchor.strip()}"')
        inserted = True
        break

if not inserted:
    print('Part 1 FAILED — no anchor found for globals insertion')
    sys.exit(1)

# ── Part 2: Inject skip check just before '[url] Fetching' print ──────────────
URL_FETCH_PRINT = '[url] Fetching'
uf_pos = s.find(URL_FETCH_PRINT)

if uf_pos == -1:
    print('Part 2 FAILED — "[url] Fetching" print not found in bridge.py')
    sys.exit(1)

uf_line_start = s.rfind('\n', 0, uf_pos) + 1
ind_raw = s[uf_line_start:uf_pos]
ind = ind_raw[:len(ind_raw) - len(ind_raw.lstrip())]

# We need to find the url variable name used on the fetch print line
fetch_line = s[uf_line_start:s.find('\n', uf_pos)]
# Extract url variable — look for f-string or format: "[url] Fetching {url}" or similar
url_var_match = re.search(r'\{(\w+)\}', fetch_line)
url_var = url_var_match.group(1) if url_var_match else 'url'

SKIP_CHECK = (
    f'{ind}_skip_reason = _url_should_skip({url_var})\n'
    f'{ind}if _skip_reason:\n'
    f'{ind}    print(f"[url] SKIPPING {{repr({url_var}[:80])}}: {{_skip_reason}}", flush=True)\n'
    f'{ind}    reply = f"I\'m not able to fetch that URL ({{_skip_reason}}). Could you paste the relevant text directly?"\n'
    f'{ind}    # Send reply through whatever channel is appropriate\n'
    f'{ind}    if "send_imessage" in dir() and chat_id:\n'
    f'{ind}        send_imessage(chat_id, reply)\n'
    f'{ind}    elif "reply" in dir():\n'
    f'{ind}        reply = reply  # will be used by caller\n'
)

s = s[:uf_line_start] + SKIP_CHECK + s[uf_line_start:]
print(f'Part 2: URL skip check inserted before "[url] Fetching" at pos {uf_line_start}')

# ── Part 3: Record domain failure after any URL-related exception ─────────────
# Find where URL errors are caught (if fix_crash_logging.py has already run)
# OR look for existing URL error handling
URL_ERROR_PATTERNS = [
    '[url] ERROR processing URL',
    '[url] error',
    '[url] Error',
    'except Exception as _url_ex',
]
recorded = False
for pat in URL_ERROR_PATTERNS:
    err_pos = s.find(pat)
    if err_pos != -1:
        err_line_end = s.find('\n', err_pos) + 1
        err_line_start = s.rfind('\n', 0, err_pos) + 1
        ind_raw2 = s[err_line_start:err_pos]
        ind2 = ind_raw2[:len(ind_raw2) - len(ind_raw2.lstrip())]
        failure_record = f'{ind2}_url_record_failure({url_var})\n'
        s = s[:err_line_end] + failure_record + s[err_line_end:]
        print(f'Part 3: _url_record_failure() call inserted after "{pat}"')
        recorded = True
        break

if not recorded:
    print('Part 3 SKIPPED — no URL error handler found to attach failure recorder to')

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — bridge.py updated with URL skip list')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
