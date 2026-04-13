#!/usr/bin/env python3
"""
fix_knowledge_agent_retry.py — Two fixes to knowledge_agent.py:

1. Add retry logic to query_ollama_local: 3 attempts with 10s backoff.
   The agent was silently dropping files when Ollama was busy (HTTP 500).

2. Remove ~/Desktop/Screenshots from WATCHED_DIRS — that directory doesn't
   exist; macOS screenshots land on ~/Desktop directly (already watched).
"""
import pathlib, subprocess, sys

HOME  = pathlib.Path.home()
AGENT = HOME / 'cowork-bridge' / 'knowledge_agent.py'

if not AGENT.exists():
    print(f'ERROR — {AGENT} not found. Run fix_knowledge_agent.py first.')
    sys.exit(1)

s = open(AGENT, encoding='utf-8', errors='replace').read()
orig = s

# ── Fix 1: retry in query_ollama_local ───────────────────────────────────────
OLD_OLLAMA = '''\
def query_ollama_local(messages, model='hermes3'):
    """Minimal Ollama query — avoid importing bridge globals."""
    import http.client, json as _json, urllib.parse
    try:
        payload = _json.dumps({'model': model, 'messages': messages, 'stream': False})
        conn = http.client.HTTPConnection('localhost', 11434, timeout=120)
        conn.request('POST', '/api/chat',
                     body=payload.encode(),
                     headers={'Content-Type': 'application/json'})
        resp = conn.getresponse()
        if resp.status != 200:
            log(f'Ollama HTTP {resp.status}')
            return None
        data = _json.loads(resp.read())
        return data.get('message', {}).get('content', '').strip()
    except Exception as e:
        log(f'Ollama error: {e}')
        return None'''

NEW_OLLAMA = '''\
def query_ollama_local(messages, model='hermes3', retries=3, retry_delay=10):
    """Minimal Ollama query with retry on 500/transient errors."""
    import http.client, json as _json, time as _time
    for attempt in range(1, retries + 1):
        try:
            payload = _json.dumps({'model': model, 'messages': messages, 'stream': False})
            conn = http.client.HTTPConnection('localhost', 11434, timeout=120)
            conn.request('POST', '/api/chat',
                         body=payload.encode(),
                         headers={'Content-Type': 'application/json'})
            resp = conn.getresponse()
            if resp.status == 200:
                data = _json.loads(resp.read())
                return data.get('message', {}).get('content', '').strip()
            body = resp.read()[:200]
            log(f'Ollama HTTP {resp.status} (attempt {attempt}/{retries}): {body}')
            if attempt < retries:
                log(f'Retrying in {retry_delay}s...')
                _time.sleep(retry_delay)
        except Exception as e:
            log(f'Ollama error (attempt {attempt}/{retries}): {e}')
            if attempt < retries:
                _time.sleep(retry_delay)
    return None'''

if OLD_OLLAMA in s:
    s = s.replace(OLD_OLLAMA, NEW_OLLAMA, 1)
    print('Fix 1: added retry logic to query_ollama_local')
else:
    # Try to find it without exact match
    import re
    m = re.search(r'def query_ollama_local\(messages.*?return None\n', s, re.DOTALL)
    if m and 'retries' not in m.group(0):
        s = s[:m.start()] + NEW_OLLAMA + '\n' + s[m.end():]
        print('Fix 1: added retry logic (regex match)')
    else:
        print('Fix 1 WARNING: query_ollama_local pattern not matched — already patched or changed')

# ── Fix 2: remove non-existent Desktop/Screenshots from WATCHED_DIRS ─────────
OLD_WATCHED = '''\
WATCHED_DIRS = [
    HOME / 'Downloads',
    HOME / 'Desktop' / 'Screenshots',
    HOME / 'Desktop',   # screenshots also land here on default macOS settings
]'''

NEW_WATCHED = '''\
WATCHED_DIRS = [
    HOME / 'Downloads',
    HOME / 'Desktop',   # default macOS screenshot location
]'''

if OLD_WATCHED in s:
    s = s.replace(OLD_WATCHED, NEW_WATCHED, 1)
    print('Fix 2: removed non-existent Desktop/Screenshots from WATCHED_DIRS')
elif "HOME / 'Desktop' / 'Screenshots'" in s:
    s = s.replace("    HOME / 'Desktop' / 'Screenshots',\n", '', 1)
    print('Fix 2: removed Desktop/Screenshots line')
else:
    print('Fix 2 SKIPPED: Desktop/Screenshots not found (already removed)')

# ── Write & validate ──────────────────────────────────────────────────────────
if s == orig:
    print('No changes made')
    sys.exit(0)

AGENT.write_text(s)
r = subprocess.run([sys.executable, '-m', 'py_compile', str(AGENT)],
                   capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — knowledge agent updated')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    AGENT.write_text(orig)
    print('Restored original')
    sys.exit(1)
