#!/usr/bin/env python3
"""
fix_knowledge_queue.py — Decouple knowledge agent LLM calls from file watching.

Problem:
  knowledge_agent.py calls Ollama (hermes3) immediately when a file appears.
  If bridge.py is also using Ollama, the model runner crashes with OOM.

Solution:
  1. Patch knowledge_agent.py: extract text only, write to a queue file.
     No Ollama call — returns immediately.
  2. Add _process_knowledge_queue() to bridge.py: reads the queue, calls
     query_ollama for each item, writes vault notes, sends iMessages.
  3. Add 'Knowledge Processor' job to Jobs.md (type: knowledge-process,
     hourly) so the scheduler calls _process_knowledge_queue() every hour.
  4. Patch _execute_job to dispatch type='knowledge-process'.

Queue file: ~/cowork-bridge/knowledge_queue.json
  [{"path": "...", "text": "...", "method": "...", "filename": "...",
    "added_at": "2026-04-13T20:58:00"}, ...]
"""
import pathlib, subprocess, sys, re, json, datetime

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')
AGENT      = str(BRIDGE_DIR / 'knowledge_agent.py')
VAULT      = str(HOME / 'Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive')
JOBS_MD    = str(HOME / 'Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive/Jobs.md')

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Rewrite knowledge_agent.py — text extraction only, no Ollama
# ══════════════════════════════════════════════════════════════════════════════

NEW_AGENT = r'''#!/usr/bin/env python3
"""
knowledge_agent.py — Personal knowledge extraction agent (queue writer).
Invoked by launchd WatchPaths when Downloads or Desktop changes.
Extracts text from new files and writes to knowledge_queue.json.
LLM processing happens separately via the bridge scheduler (no concurrent load).
"""
import json, os, pathlib, subprocess, sys, datetime, re, time

HOME       = pathlib.Path.home()
QUEUE_FILE = HOME / 'cowork-bridge' / 'knowledge_queue.json'
PROCESSED  = HOME / 'cowork-bridge' / '.processed_knowledge'
LOG_PREFIX = '[knowledge]'

WATCHED_DIRS = [
    HOME / 'Downloads',
    HOME / 'Desktop',   # default macOS screenshot location
]

TEXT_EXTS  = {'.txt', '.md', '.py', '.js', '.ts', '.json', '.csv', '.html', '.xml'}
IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.heic', '.gif', '.webp', '.tiff'}
PDF_EXTS   = {'.pdf'}
SKIP_EXTS  = {'.dmg', '.pkg', '.zip', '.app', '.exe', '.ipa', '.iso',
              '.mp4', '.mov', '.avi', '.mp3', '.wav', '.aac', '.DS_Store',
              '.localized', '.plist'}

RECENCY_WINDOW = 90   # seconds


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


def load_queue():
    try:
        if QUEUE_FILE.exists():
            return json.loads(QUEUE_FILE.read_text())
    except Exception:
        pass
    return []


def save_queue(items):
    try:
        QUEUE_FILE.write_text(json.dumps(items, indent=2))
    except Exception as e:
        log(f'Could not save queue: {e}')


def extract_text_spotlight(path):
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
    """Extract text. Returns (text, method) or (None, None)."""
    suffix = path.suffix.lower()
    if suffix in SKIP_EXTS or suffix == '':
        return None, None
    if suffix in TEXT_EXTS:
        try:
            content = path.read_text(errors='ignore').strip()
            if content:
                return content, 'text'
        except Exception:
            pass
        return None, None
    if suffix in IMAGE_EXTS:
        text = extract_text_spotlight(path)
        if text:
            return text, 'ocr'
        log(f'No OCR text in Spotlight for {path.name}')
        return None, None
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


def main():
    log('Knowledge agent started (queue mode)')
    seen  = load_processed()
    queue = load_queue()
    queued_paths = {item['path'] for item in queue}
    now_ts = time.time()
    added_count = 0

    for watch_dir in WATCHED_DIRS:
        if not watch_dir.exists():
            continue
        for f in sorted(watch_dir.iterdir()):
            if not f.is_file():
                continue
            if f.suffix.lower() in SKIP_EXTS or f.name.startswith('.'):
                continue
            try:
                mtime = f.stat().st_mtime
            except Exception:
                continue
            if now_ts - mtime > RECENCY_WINDOW:
                continue
            key = str(f)
            if key in seen or key in queued_paths:
                log(f'Already queued/processed: {f.name}')
                continue
            seen.add(key)

            raw_text, method = extract_text(f)
            if not raw_text:
                log(f'No extractable text from {f.name} — skipping')
                continue

            queue.append({
                'path':     str(f),
                'filename': f.name,
                'text':     raw_text[:6000],
                'method':   method,
                'added_at': datetime.datetime.now().isoformat(),
            })
            queued_paths.add(key)
            added_count += 1
            log(f'Queued: {f.name} ({method}, {len(raw_text):,} chars)')

    save_processed(seen)
    save_queue(queue)
    if added_count:
        log(f'Added {added_count} item(s) to queue — LLM processing at next hourly tick')
    else:
        log('No new files to queue')
    log('Done')


if __name__ == '__main__':
    main()
'''

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Add _process_knowledge_queue() to bridge.py
# ══════════════════════════════════════════════════════════════════════════════

QUEUE_PROCESSOR = r'''
# ── Knowledge Queue Processor ─────────────────────────────────────────────────

def _process_knowledge_queue():
    """
    Read knowledge_queue.json, run LLM extraction for each item,
    write vault notes to AI Archive/Knowledge Inbox/, send iMessage pings.
    Called by the scheduler (type: knowledge-process, hourly).
    """
    import json as _kjson, pathlib as _kpl, re as _kre, datetime as _kdt

    _queue_file = _kpl.Path.home() / 'cowork-bridge' / 'knowledge_queue.json'
    _vault      = _kpl.Path(str(SEARCH_DIR)) / 'AI Archive'
    _inbox      = _vault / 'Knowledge Inbox'

    if not _queue_file.exists():
        print('[knowledge] Queue empty — nothing to process', flush=True)
        return

    try:
        _queue = _kjson.loads(_queue_file.read_text())
    except Exception as _qe:
        print(f'[knowledge] Could not read queue: {_qe}', flush=True)
        return

    if not _queue:
        print('[knowledge] Queue empty — nothing to process', flush=True)
        return

    print(f'[knowledge] Processing {len(_queue)} queued item(s)...', flush=True)
    _remaining = []

    for _item in _queue:
        _filename = _item.get('filename', 'unknown')
        _raw_text = _item.get('text', '')
        _method   = _item.get('method', 'unknown')
        _added_at = _item.get('added_at', '')
        _path_str = _item.get('path', '')

        if not _raw_text:
            print(f'[knowledge] Skipping {_filename} — no text in queue item', flush=True)
            continue

        _text_for_llm = _raw_text[:4000]
        if len(_raw_text) > 4000:
            _text_for_llm += '\n\n[...truncated...]'

        _today = _kdt.date.today().strftime('%Y-%m-%d')
        _now   = _kdt.datetime.now().strftime('%H:%M')

        _prompt = (
            f"File: {_filename}\n"
            f"Extracted via: {_method}\n\n"
            f"Content:\n{_text_for_llm}\n\n"
            "Write a structured knowledge note with EXACTLY this format:\n\n"
            "TITLE: [concise descriptive title, 6 words max]\n"
            "TAGS: #tag1 #tag2 #tag3\n"
            "SUMMARY: [2-3 sentence summary of what this is and why it matters]\n"
            "KEY POINTS:\n"
            "- [point 1]\n"
            "- [point 2]\n"
            "- [point 3]\n\n"
            "Be specific. No filler."
        )
        _msgs = [
            {'role': 'system', 'content': 'You are a personal knowledge assistant. Extract structured information from file content. Be concise and specific.'},
            {'role': 'user',   'content': _prompt},
        ]

        print(f'[knowledge] Querying Ollama for {_filename}...', flush=True)
        _result = query_ollama(_msgs, model=MODELS.get('archivist', 'hermes3'))

        if not _result or '##' not in _result and 'TITLE:' not in _result:
            print(f'[knowledge] Empty/invalid response for {_filename} — will retry next tick', flush=True)
            _remaining.append(_item)
            continue

        # Parse fields
        _title_m   = _kre.search(r'TITLE:\s*(.+)', _result)
        _tags_m    = _kre.search(r'TAGS:\s*(.+)', _result)
        _summary_m = _kre.search(r'SUMMARY:\s*(.+?)(?=\nKEY POINTS:|\Z)', _result, _kre.DOTALL)
        _points_m  = _kre.search(r'KEY POINTS:\s*\n((?:- .+\n?)+)', _result)

        _title   = _title_m.group(1).strip()   if _title_m   else _filename
        _tags    = _tags_m.group(1).strip()    if _tags_m    else '#inbox'
        _summary = _summary_m.group(1).strip() if _summary_m else ''
        _points  = _points_m.group(1).strip()  if _points_m  else ''

        _tag_words = [w if w.startswith('#') else f'#{w}' for w in _tags.split()]
        _tags_line = ' '.join(_tag_words)

        _rel_src = _path_str.replace(str(_kpl.Path.home()), '~')
        _note = (
            f'# {_title}\n'
            f'Source: `{_rel_src}`  |  Added: {_today} {_now}  |  Method: {_method}\n'
            f'Tags: {_tags_line}\n\n'
            f'## Summary\n{_summary}\n\n'
        )
        if _points:
            _note += f'## Key Points\n{_points}\n\n'
        _note += f'## Raw Extract\n```\n{_raw_text[:1200]}\n```\n'
        if len(_raw_text) > 1200:
            _note += f'\n_({len(_raw_text):,} chars total — excerpt shown)_\n'

        _inbox.mkdir(parents=True, exist_ok=True)
        _slug = _kre.sub(r'[^\w\s-]', '', _title.lower())
        _slug = _kre.sub(r'[\s_-]+', '-', _slug).strip('-')[:40]
        _note_path = _inbox / f'{_today}_{_slug}.md'
        _counter = 1
        while _note_path.exists():
            _note_path = _inbox / f'{_today}_{_slug}_{_counter}.md'
            _counter += 1

        _note_path.write_text(_note)
        print(f'[knowledge] Wrote {_note_path.name}', flush=True)

        _short = f'[Knowledge] {_title}\n{_summary[:200]}'
        if len(_summary) > 200:
            _short += '…'
        send_imessage(MY_PHONE, _short)
        print(f'[knowledge] iMessage sent for {_filename}', flush=True)

    # Write back only unprocessed items
    _queue_file.write_text(_kjson.dumps(_remaining, indent=2))
    print(f'[knowledge] Queue done. {len(_queue) - len(_remaining)} processed, {len(_remaining)} remaining.', flush=True)

'''

# ══════════════════════════════════════════════════════════════════════════════
# Apply patches
# ══════════════════════════════════════════════════════════════════════════════

# ── Part 1: Rewrite knowledge_agent.py ───────────────────────────────────────
import tempfile, os

# Syntax check new agent
tmp = tempfile.NamedTemporaryFile(suffix='.py', delete=False, mode='w')
tmp.write(NEW_AGENT)
tmp.close()
r = subprocess.run([sys.executable, '-m', 'py_compile', tmp.name],
                   capture_output=True, text=True)
os.unlink(tmp.name)
if r.returncode != 0:
    print(f'SYNTAX ERROR in new knowledge_agent.py:\n{r.stderr}')
    sys.exit(1)

pathlib.Path(AGENT).write_text(NEW_AGENT)
pathlib.Path(AGENT).chmod(0o755)
print('Part 1: knowledge_agent.py rewritten (queue mode, no Ollama)')

# ── Part 2 & 3: Patch bridge.py ───────────────────────────────────────────────
s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig_bridge = s

# Guard
if '_process_knowledge_queue' in s:
    print('Part 2 SKIPPED — _process_knowledge_queue already in bridge.py')
else:
    # Insert before run_shell / query_ollama anchor
    anchors = ['\ndef run_shell(', '\ndef execute_code_task(', '\ndef query_ollama(']
    inserted = False
    for anchor in anchors:
        pos = s.find(anchor)
        if pos != -1:
            s = s[:pos] + QUEUE_PROCESSOR + s[pos:]
            print(f'Part 2: _process_knowledge_queue() inserted before "{anchor.strip()}"')
            inserted = True
            break
    if not inserted:
        print('Part 2 FAILED — no anchor found in bridge.py')
        sys.exit(1)

# Patch _execute_job to dispatch type='knowledge-process'
if "job.get('type') == 'knowledge-process'" in s:
    print('Part 3 SKIPPED — knowledge-process dispatch already in _execute_job')
else:
    OLD_DISPATCH = (
        "    if job.get('type') == 'review':\n"
        "        _nightly_review()\n"
        "        return\n"
    )
    NEW_DISPATCH = (
        "    if job.get('type') == 'review':\n"
        "        _nightly_review()\n"
        "        return\n"
        "    if job.get('type') == 'knowledge-process':\n"
        "        _process_knowledge_queue()\n"
        "        return\n"
    )
    if OLD_DISPATCH in s:
        s = s.replace(OLD_DISPATCH, NEW_DISPATCH, 1)
        print('Part 3: knowledge-process dispatch added to _execute_job')
    else:
        # Fallback: find _execute_job and insert at top of body
        idx = s.find('def _execute_job(job):')
        if idx != -1:
            body_start = s.find('\n', idx) + 1
            fallback = (
                "    if job.get('type') == 'knowledge-process':\n"
                "        _process_knowledge_queue()\n"
                "        return\n"
            )
            s = s[:body_start] + fallback + s[body_start:]
            print('Part 3: knowledge-process dispatch added (fallback method)')
        else:
            print('Part 3 WARNING: _execute_job not found')

# Validate & write bridge.py
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('Part 2+3: syntax OK')
else:
    print(f'SYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig_bridge)
    print('Restored original bridge.py')
    sys.exit(1)

# ── Part 4: Add Knowledge Processor job to Jobs.md ───────────────────────────
jobs_path = pathlib.Path(JOBS_MD)
if not jobs_path.exists():
    print('Part 4 SKIPPED — Jobs.md not found')
else:
    jobs_text = jobs_path.read_text()
    if 'knowledge-process' in jobs_text or 'Knowledge Processor' in jobs_text:
        print('Part 4 SKIPPED — Knowledge Processor job already in Jobs.md')
    else:
        KNOWLEDGE_JOB = """
### Knowledge Processor
- **schedule**: hourly
- **type**: knowledge-process
- **prompt**: (reads knowledge_queue.json automatically)

"""
        if '## Disabled' in jobs_text:
            jobs_text = jobs_text.replace('## Disabled', KNOWLEDGE_JOB + '## Disabled', 1)
        else:
            jobs_text = jobs_text.rstrip() + '\n' + KNOWLEDGE_JOB
        jobs_path.write_text(jobs_text)
        print('Part 4: Knowledge Processor job added to Jobs.md')

print('\n✅ All done — restart bridge for changes to take effect')
print('  launchctl unload ~/Library/LaunchAgents/com.alexmcgann.cowork-bridge.plist')
print('  launchctl load  ~/Library/LaunchAgents/com.alexmcgann.cowork-bridge.plist')
print('\nDrop a file in ~/Downloads to queue it.')
print('It will be processed at the next hourly scheduler tick.')
print('Force immediate processing:')
print('  echo \'{"name":"Knowledge Processor","schedule":"daily at HH:MM","type":"knowledge-process","prompt":""}\' | ...')
print('  (or just edit job_state.json to clear Knowledge Processor last-run)')
