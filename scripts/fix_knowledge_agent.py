#!/usr/bin/env python3
"""
fix_knowledge_agent.py — Install a personal knowledge agent that watches
~/Downloads and ~/Desktop/Screenshots, extracts text via macOS Spotlight OCR,
summarises with Ollama (hermes3), and writes linked notes to the Obsidian vault.

What this creates:
  ~/cowork-bridge/knowledge_agent.py   — the extraction + vault-write script
  ~/Library/LaunchAgents/com.alexmcgann.knowledge-agent.plist  — WatchPaths daemon

Trigger flow:
  File lands in ~/Downloads or ~/Desktop/Screenshots
  → launchd fires knowledge_agent.py (throttled to once per 30 s)
  → agent finds new files (newer than last run, not yet processed)
  → extracts text via mdls (Spotlight OCR) or direct read
  → sends to hermes3: title + summary + tags + key points
  → writes AI Archive/Knowledge Inbox/YYYY-MM-DD_slug.md
  → sends brief iMessage notification
"""
import pathlib, subprocess, sys, os

HOME    = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PLIST_DIR  = HOME / 'Library' / 'LaunchAgents'
VAULT  = HOME / 'Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive'
PYTHON = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
AGENT  = str(BRIDGE_DIR / 'knowledge_agent.py')
PLIST  = str(PLIST_DIR / 'com.alexmcgann.knowledge-agent.plist')
LOG    = str(BRIDGE_DIR / 'knowledge_agent.log')

# ── Guard ─────────────────────────────────────────────────────────────────────
if pathlib.Path(AGENT).exists():
    print('SKIPPED — knowledge_agent.py already exists')
    sys.exit(0)

# ── knowledge_agent.py ────────────────────────────────────────────────────────
AGENT_CODE = r'''#!/usr/bin/env python3
"""
knowledge_agent.py — Personal knowledge extraction agent.
Invoked by launchd WatchPaths when Downloads or Screenshots changes.
"""
import json, os, pathlib, subprocess, sys, datetime, re, time

HOME       = pathlib.Path.home()
VAULT      = HOME / 'Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive'
INBOX      = VAULT / 'Knowledge Inbox'
PROCESSED  = HOME / 'cowork-bridge' / '.processed_knowledge'
BRIDGE_PY  = HOME / 'cowork-bridge' / 'bridge.py'
MY_PHONE   = '+14356805405'
LOG_PREFIX = '[knowledge]'

WATCHED_DIRS = [
    HOME / 'Downloads',
    HOME / 'Desktop' / 'Screenshots',
    HOME / 'Desktop',   # screenshots also land here on default macOS settings
]

# File types we handle
TEXT_EXTS  = {'.txt', '.md', '.py', '.js', '.ts', '.json', '.csv', '.html', '.xml'}
IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.heic', '.gif', '.webp', '.tiff'}
PDF_EXTS   = {'.pdf'}
SKIP_EXTS  = {'.dmg', '.pkg', '.zip', '.app', '.exe', '.ipa', '.iso',
              '.mp4', '.mov', '.avi', '.mp3', '.wav', '.aac'}

# Only process files modified within the last N seconds on each invocation
RECENCY_WINDOW = 90   # seconds — files modified in the last 90 s


def log(msg):
    ts = datetime.datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {LOG_PREFIX} {msg}', flush=True)


def load_processed():
    try:
        if PROCESSED.exists():
            return set(json.loads(PROCESSED.read_text()))
    except Exception:
        pass
    return set()


def save_processed(seen):
    try:
        PROCESSED.write_text(json.dumps(sorted(seen), indent=2))
    except Exception as e:
        log(f'Could not save processed set: {e}')


def extract_text_spotlight(path):
    """Use Spotlight (mdls) to get OCR or indexed text content."""
    try:
        r = subprocess.run(
            ['mdls', '-name', 'kMDItemTextContent', '-raw', str(path)],
            capture_output=True, text=True, timeout=15
        )
        text = r.stdout.strip()
        if text and text != '(null)':
            return text
    except Exception:
        pass
    return None


def extract_text_pdftotext(path):
    """Fall back to pdftotext for PDFs."""
    try:
        r = subprocess.run(
            ['pdftotext', str(path), '-'],
            capture_output=True, text=True, timeout=30
        )
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return None


def extract_text(path):
    """Extract readable text from a file. Returns (text, method) or (None, None)."""
    suffix = path.suffix.lower()

    if suffix in SKIP_EXTS:
        return None, None

    # Direct read for text files
    if suffix in TEXT_EXTS:
        try:
            content = path.read_text(errors='ignore').strip()
            if content:
                return content, 'text'
        except Exception:
            pass
        return None, None

    # Spotlight OCR for images
    if suffix in IMAGE_EXTS:
        text = extract_text_spotlight(path)
        if text:
            return text, 'ocr'
        log(f'No OCR text in Spotlight for {path.name} (may not be indexed yet)')
        return None, None

    # PDFs: try Spotlight first, then pdftotext
    if suffix in PDF_EXTS:
        text = extract_text_spotlight(path)
        if text:
            return text, 'spotlight-pdf'
        text = extract_text_pdftotext(path)
        if text:
            return text, 'pdftotext'
        log(f'No text extracted from PDF {path.name}')
        return None, None

    return None, None


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
        return None


def send_imessage_local(phone, text):
    """Send iMessage via AppleScript."""
    safe = text.replace('"', '\\"').replace('\\', '\\\\')
    script = f'tell application "Messages" to send "{safe}" to buddy "{phone}" of (service 1 whose service type is iMessage)'
    try:
        subprocess.run(['osascript', '-e', script], capture_output=True, timeout=30)
    except Exception as e:
        log(f'iMessage send error: {e}')


def slugify(text, maxlen=40):
    text = re.sub(r'[^\w\s-]', '', text.lower())
    text = re.sub(r'[\s_-]+', '-', text).strip('-')
    return text[:maxlen]


def process_file(path):
    """Extract, summarise, write vault note. Returns True on success."""
    log(f'Processing: {path.name}')

    raw_text, method = extract_text(path)
    if not raw_text:
        log(f'Skipping {path.name} — no extractable text')
        return False

    # Truncate for LLM
    text_for_llm = raw_text[:4000]
    if len(raw_text) > 4000:
        text_for_llm += '\n\n[...truncated...]'

    today = datetime.date.today().strftime('%Y-%m-%d')
    now   = datetime.datetime.now().strftime('%H:%M')

    prompt = (
        f"File: {path.name}\n"
        f"Extracted via: {method}\n\n"
        f"Content:\n{text_for_llm}\n\n"
        "Write a structured knowledge note with EXACTLY this format (no extra text before or after):\n\n"
        "TITLE: [concise descriptive title, 6 words max]\n"
        "TAGS: #tag1 #tag2 #tag3\n"
        "SUMMARY: [2-3 sentence summary of what this is and why it matters]\n"
        "KEY POINTS:\n"
        "- [point 1]\n"
        "- [point 2]\n"
        "- [point 3]\n\n"
        "Be specific and factual. Use the actual content — no filler."
    )
    sys_prompt = (
        "You are a personal knowledge assistant. Extract structured information "
        "from the provided file content. Be concise and specific."
    )
    msgs = [
        {'role': 'system', 'content': sys_prompt},
        {'role': 'user',   'content': prompt},
    ]

    log(f'Querying Ollama for {path.name}...')
    result = query_ollama_local(msgs)

    if not result:
        log(f'Empty Ollama response for {path.name}')
        return False

    # Validate: must have TITLE and SUMMARY
    if 'TITLE:' not in result or 'SUMMARY:' not in result:
        log(f'Unexpected LLM response format for {path.name}: {result[:80]!r}')
        return False

    # Parse fields
    title_m   = re.search(r'TITLE:\s*(.+)', result)
    tags_m    = re.search(r'TAGS:\s*(.+)', result)
    summary_m = re.search(r'SUMMARY:\s*(.+?)(?=\nKEY POINTS:|\Z)', result, re.DOTALL)
    points_m  = re.search(r'KEY POINTS:\s*\n((?:- .+\n?)+)', result)

    title   = title_m.group(1).strip()   if title_m   else path.stem
    tags    = tags_m.group(1).strip()    if tags_m    else '#inbox'
    summary = summary_m.group(1).strip() if summary_m else ''
    points  = points_m.group(1).strip()  if points_m  else ''

    # Normalise tags line — ensure each tag starts with #
    tag_words = [w if w.startswith('#') else f'#{w}' for w in tags.split()]
    tags_line = ' '.join(tag_words)

    # Build vault note
    rel_source = str(path).replace(str(pathlib.Path.home()), '~')
    note = (
        f'# {title}\n'
        f'Source: `{rel_source}`  |  Added: {today} {now}  |  Method: {method}\n'
        f'Tags: {tags_line}\n\n'
        f'## Summary\n{summary}\n\n'
    )
    if points:
        note += f'## Key Points\n{points}\n\n'

    note += f'## Raw Extract\n```\n{raw_text[:1200]}\n```\n'
    if len(raw_text) > 1200:
        note += f'\n_({len(raw_text):,} chars total — excerpt shown)_\n'

    # Write to vault
    INBOX.mkdir(parents=True, exist_ok=True)
    slug      = slugify(title)
    note_path = INBOX / f'{today}_{slug}.md'
    # Avoid clobbering if slug collides
    counter = 1
    while note_path.exists():
        note_path = INBOX / f'{today}_{slug}_{counter}.md'
        counter += 1

    note_path.write_text(note)
    log(f'Wrote {note_path.name}')

    # iMessage notification
    short = f'[Knowledge] {title}\n{summary[:200]}'
    if len(summary) > 200:
        short += '…'
    send_imessage_local(MY_PHONE, short)
    log(f'iMessage sent for {path.name}')

    return True


def main():
    log('Knowledge agent started')
    seen = load_processed()
    now_ts = time.time()
    processed_any = False

    for watch_dir in WATCHED_DIRS:
        if not watch_dir.exists():
            continue
        for f in sorted(watch_dir.iterdir()):
            if not f.is_file():
                continue
            if f.suffix.lower() in SKIP_EXTS:
                continue
            # Only files modified within the recency window
            try:
                mtime = f.stat().st_mtime
            except Exception:
                continue
            if now_ts - mtime > RECENCY_WINDOW:
                continue
            key = str(f)
            if key in seen:
                log(f'Already processed: {f.name}')
                continue
            # Mark as seen immediately (even if extraction fails) to avoid
            # repeatedly attempting unextractable files on every trigger
            seen.add(key)
            try:
                process_file(f)
                processed_any = True
            except Exception as e:
                import traceback
                log(f'Error processing {f.name}: {e}')
                log(traceback.format_exc())

    save_processed(seen)
    if not processed_any:
        log('No new files to process')
    log('Done')


if __name__ == '__main__':
    main()
'''

# ── launchd plist ──────────────────────────────────────────────────────────────
PLIST_XML = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.alexmcgann.knowledge-agent</string>

  <key>ProgramArguments</key>
  <array>
    <string>{PYTHON}</string>
    <string>{AGENT}</string>
  </array>

  <key>WatchPaths</key>
  <array>
    <string>{HOME}/Downloads</string>
    <string>{HOME}/Desktop/Screenshots</string>
    <string>{HOME}/Desktop</string>
  </array>

  <key>ThrottleInterval</key>
  <integer>30</integer>

  <key>StandardOutPath</key>
  <string>{LOG}</string>

  <key>StandardErrorPath</key>
  <string>{LOG}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    <key>HOME</key>
    <string>{HOME}</string>
  </dict>
</dict>
</plist>'''

# ── Write files ────────────────────────────────────────────────────────────────
# Syntax-check the agent before writing
import tempfile
tmp = tempfile.NamedTemporaryFile(suffix='.py', delete=False, mode='w')
tmp.write(AGENT_CODE)
tmp.close()
r = subprocess.run([sys.executable, '-m', 'py_compile', tmp.name],
                   capture_output=True, text=True)
os.unlink(tmp.name)
if r.returncode != 0:
    print(f'SYNTAX ERROR in agent code:\n{r.stderr}')
    sys.exit(1)

# Write agent
pathlib.Path(AGENT).write_text(AGENT_CODE)
pathlib.Path(AGENT).chmod(0o755)
print(f'Wrote {AGENT}')

# Write plist
PLIST_DIR.mkdir(parents=True, exist_ok=True)
pathlib.Path(PLIST).write_text(PLIST_XML)
print(f'Wrote {PLIST}')

# Load launchd agent
subprocess.run(['launchctl', 'unload', PLIST], capture_output=True)
r = subprocess.run(['launchctl', 'load', PLIST], capture_output=True, text=True)
if r.returncode == 0:
    print(f'\n✅ knowledge agent loaded — watching Downloads + Desktop/Screenshots')
    print(f'   Drop any file to test: tail -f {LOG}')
else:
    print(f'launchctl load error: {r.stderr}')
    sys.exit(1)
