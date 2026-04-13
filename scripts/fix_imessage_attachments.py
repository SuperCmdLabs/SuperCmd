#!/usr/bin/env python3
"""
fix_imessage_attachments.py — Add iMessage attachment processing to bridge.py.

Problem:
  bridge.py's get_new_messages() only returns (msg_id, text, is_voice) tuples.
  Files sent directly via iMessage are never routed to the knowledge pipeline.

Solution:
  Part 1: Add get_new_messages_with_attachments(con) — JOINs attachment tables,
          returns (msg_id, text, is_voice, attachment_path, mime_type) tuples.
  Part 2: Add _process_imessage_attachment(attachment_path, mime_type, sender) —
          routes images/PDFs to ~/Downloads (for knowledge_agent pickup) and
          reads text files directly into knowledge_queue.json.
  Part 3: Patch the main while-loop to call the enhanced query and dispatch
          attachment handling for each message that carries an attachment.
"""
import os
import sys
import pathlib
import subprocess
import tempfile

BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'
PYTHON = str(pathlib.Path.home() / 'cowork-bridge' / '.venv' / 'bin' / 'python3')

# ══════════════════════════════════════════════════════════════════════════════
# Code blocks to inject
# ══════════════════════════════════════════════════════════════════════════════

# Part 1 — enhanced message query with attachment JOIN
GET_NEW_MSGS_WITH_ATTACHMENTS = r'''
# ── iMessage Attachment Support ───────────────────────────────────────────────

def get_new_messages_with_attachments(con):
    """
    Enhanced version of get_new_messages() that also returns attachment info.
    Returns list of (msg_id, text, is_voice, attachment_path, mime_type) tuples.
    attachment_path and mime_type are None when no attachment is present.
    Attachment paths from chat.db start with ~/ and are expanded via os.path.expanduser.
    """
    import os as _os
    cur = con.cursor()
    try:
        cur.execute("""
            SELECT
                m.ROWID,
                m.text,
                m.is_from_me,
                a.filename,
                a.mime_type,
                a.transfer_name
            FROM message m
            LEFT JOIN message_attachment_join maj ON maj.message_id = m.ROWID
            LEFT JOIN attachment a ON a.ROWID = maj.attachment_id
            WHERE m.is_from_me = 0
              AND m.service = 'iMessage'
              AND (m.text IS NOT NULL OR a.filename IS NOT NULL)
            ORDER BY m.date DESC
            LIMIT 20
        """)
        rows = cur.fetchall()
    except Exception as _e:
        print(f'[attachments] Query error: {_e}', flush=True)
        return []

    results = []
    for row in rows:
        msg_id, text, _is_from_me, filename, mime_type, _transfer_name = row
        is_voice = bool(text and 'http' not in (text or '') and len((text or '').strip()) < 4)
        attachment_path = None
        if filename:
            attachment_path = _os.path.expanduser(filename)
        results.append((msg_id, text, is_voice, attachment_path, mime_type))
    return results

'''

# Part 2 — attachment routing function
PROCESS_ATTACHMENT = r'''
def _process_imessage_attachment(attachment_path, mime_type, sender):
    """
    Route an iMessage attachment into the knowledge pipeline.
    - Images (image/*) and PDFs: copy to ~/Downloads with a timestamped name
      so knowledge_agent picks them up on the next WatchPaths trigger.
    - Text files: read directly and enqueue to knowledge_queue.json.
    Sends an acknowledgment iMessage and returns True if handled,
    False if the type is unsupported or the file is not yet available.
    """
    import shutil as _shutil
    import json as _json
    import datetime as _dt
    import pathlib as _pl

    _path = _pl.Path(attachment_path)
    if not _path.exists():
        print(f'[attachments] File not yet downloaded: {attachment_path}', flush=True)
        return False

    _mime = (mime_type or '').lower()
    _suffix = _path.suffix.lower()
    _ts = _dt.datetime.now().strftime('%Y%m%d_%H%M%S')
    _downloads = _pl.Path.home() / 'Downloads'
    _downloads.mkdir(parents=True, exist_ok=True)

    _filename = _path.name
    send_imessage(REPLY_TO, f'\U0001f4ce Processing attachment: {_filename}...')

    # ── Images ────────────────────────────────────────────────────────────────
    if _mime.startswith('image/') or _suffix in {'.png', '.jpg', '.jpeg', '.heic', '.gif', '.webp', '.tiff'}:
        _dest = _downloads / f'imessage_{_ts}_{_filename}'
        try:
            _shutil.copy2(str(_path), str(_dest))
            print(f'[attachments] Image copied to Downloads: {_dest.name}', flush=True)
            return True
        except Exception as _e:
            print(f'[attachments] Failed to copy image: {_e}', flush=True)
            return False

    # ── PDFs ──────────────────────────────────────────────────────────────────
    if _mime == 'application/pdf' or _suffix == '.pdf':
        _dest = _downloads / f'imessage_{_ts}_{_filename}'
        try:
            _shutil.copy2(str(_path), str(_dest))
            print(f'[attachments] PDF copied to Downloads: {_dest.name}', flush=True)
            return True
        except Exception as _e:
            print(f'[attachments] Failed to copy PDF: {_e}', flush=True)
            return False

    # ── Text files ────────────────────────────────────────────────────────────
    _text_exts = {'.txt', '.md', '.py', '.js', '.ts', '.json', '.csv', '.html', '.xml', '.log'}
    if _mime.startswith('text/') or _suffix in _text_exts:
        try:
            _raw = _path.read_text(errors='ignore').strip()
        except Exception as _e:
            print(f'[attachments] Failed to read text file: {_e}', flush=True)
            return False

        if not _raw:
            print(f'[attachments] Text file is empty: {_filename}', flush=True)
            return False

        _queue_file = _pl.Path.home() / 'cowork-bridge' / 'knowledge_queue.json'
        try:
            _queue = _json.loads(_queue_file.read_text()) if _queue_file.exists() else []
        except Exception:
            _queue = []

        _queue.append({
            'path':     str(_path),
            'filename': _filename,
            'text':     _raw[:6000],
            'method':   'imessage-text',
            'added_at': _dt.datetime.now().isoformat(),
            'sender':   sender or '',
        })
        try:
            _queue_file.write_text(_json.dumps(_queue, indent=2))
            print(f'[attachments] Text file enqueued: {_filename}', flush=True)
            return True
        except Exception as _e:
            print(f'[attachments] Failed to write queue: {_e}', flush=True)
            return False

    # ── Unsupported ───────────────────────────────────────────────────────────
    print(f'[attachments] Unsupported MIME type: {_mime} ({_filename})', flush=True)
    return False

'''

# Part 3 — main-loop patch: replace get_new_messages(con) call + loop unpack
# Note: OLD_LOOP uses 8-space indent as a reference; the regex fallback below
# captures the actual indent from the file, making this the reliable path.
OLD_LOOP = (
    "            new_msgs = get_new_messages(con)\n"
    "            for msg_id, text, is_voice in new_msgs:"
)
NEW_LOOP = (
    "            new_msgs = get_new_messages_with_attachments(con)\n"
    "            for _msg_tuple in new_msgs:\n"
    "                # Unpack gracefully — supports both 3-tuple and 5-tuple formats\n"
    "                if len(_msg_tuple) == 5:\n"
    "                    msg_id, text, is_voice, _attach_path, _attach_mime = _msg_tuple\n"
    "                else:\n"
    "                    msg_id, text, is_voice = _msg_tuple[:3]\n"
    "                    _attach_path, _attach_mime = None, None\n"
    "                # Process attachment if present\n"
    "                if _attach_path:\n"
    "                    _process_imessage_attachment(_attach_path, _attach_mime, REPLY_TO)"
)
# The original loop body (at 16 spaces) continues unchanged as sibling statements
# inside the for loop — no extra indentation wrapper needed.

# ══════════════════════════════════════════════════════════════════════════════
# Apply patches
# ══════════════════════════════════════════════════════════════════════════════

bridge_path = pathlib.Path(BRIDGE)
if not bridge_path.exists():
    print(f'ERROR — bridge.py not found at {BRIDGE}')
    sys.exit(1)

s = bridge_path.read_text(encoding='utf-8', errors='replace')
orig = s

# ── Part 1 ────────────────────────────────────────────────────────────────────
if 'get_new_messages_with_attachments' in s:
    print('Part 1 SKIPPED — get_new_messages_with_attachments already in bridge.py')
else:
    # Insert before the `while True:` inside `def main():`
    main_pos = s.find('def main():')
    if main_pos == -1:
        print('Part 1 FAILED — def main(): not found')
        sys.exit(1)
    while_pos = s.find('    while True:', main_pos)
    if while_pos == -1:
        print('Part 1 FAILED — while True: not found inside main()')
        sys.exit(1)
    # Insert at the line boundary just before `    while True:`
    s = s[:while_pos] + GET_NEW_MSGS_WITH_ATTACHMENTS + s[while_pos:]
    print('Part 1: get_new_messages_with_attachments() inserted before while True:')

# ── Part 2 ────────────────────────────────────────────────────────────────────
if '_process_imessage_attachment' in s:
    print('Part 2 SKIPPED — _process_imessage_attachment already in bridge.py')
else:
    # Insert immediately after get_new_messages_with_attachments block we just added
    # (or before while True: again — idempotent anchor)
    main_pos = s.find('def main():')
    while_pos = s.find('    while True:', main_pos)
    if while_pos == -1:
        print('Part 2 FAILED — while True: not found after Part 1 insert')
        sys.exit(1)
    s = s[:while_pos] + PROCESS_ATTACHMENT + s[while_pos:]
    print('Part 2: _process_imessage_attachment() inserted before while True:')

# ── Part 3 ────────────────────────────────────────────────────────────────────
if 'get_new_messages_with_attachments(con)' in s:
    print('Part 3 SKIPPED — loop already patched to use get_new_messages_with_attachments')
else:
    if OLD_LOOP in s:
        s = s.replace(OLD_LOOP, NEW_LOOP, 1)
        print('Part 3: main loop patched — uses get_new_messages_with_attachments + attachment dispatch')
    else:
        # Flexible fallback: find `new_msgs = get_new_messages(con)` alone
        import re
        m = re.search(
            r'( *)new_msgs = get_new_messages\(con\)\s*\n'
            r'( *)for msg_id, text, is_voice in new_msgs:',
            s
        )
        if m:
            indent = m.group(1)
            body_indent = m.group(2)
            replacement = (
                f'{indent}new_msgs = get_new_messages_with_attachments(con)\n'
                f'{body_indent}for _msg_tuple in new_msgs:\n'
                f'{body_indent}    # Unpack gracefully — supports both 3-tuple and 5-tuple formats\n'
                f'{body_indent}    if len(_msg_tuple) == 5:\n'
                f'{body_indent}        msg_id, text, is_voice, _attach_path, _attach_mime = _msg_tuple\n'
                f'{body_indent}    else:\n'
                f'{body_indent}        msg_id, text, is_voice = _msg_tuple[:3]\n'
                f'{body_indent}        _attach_path, _attach_mime = None, None\n'
                f'{body_indent}    # Process attachment if present\n'
                f'{body_indent}    if _attach_path:\n'
                f'{body_indent}        _process_imessage_attachment(_attach_path, _attach_mime, REPLY_TO)'
            )
            s = s[:m.start()] + replacement + s[m.end():]
            print('Part 3: main loop patched (regex fallback)')
        else:
            print('Part 3 FAILED — could not locate get_new_messages(con) loop pattern')
            sys.exit(1)

# ── Syntax validation ─────────────────────────────────────────────────────────
tmp = tempfile.NamedTemporaryFile(suffix='.py', delete=False, mode='w', encoding='utf-8')
tmp.write(s)
tmp.close()

r = subprocess.run([sys.executable, '-m', 'py_compile', tmp.name],
                   capture_output=True, text=True)
os.unlink(tmp.name)

if r.returncode != 0:
    print(f'SYNTAX ERROR in patched bridge.py:\n{r.stderr}')
    print('No changes written — bridge.py unchanged')
    sys.exit(1)

bridge_path.write_text(s, encoding='utf-8')
print('\nSyntax OK — changes written to bridge.py')
print('\nRestart bridge to activate:')
print('  launchctl unload ~/Library/LaunchAgents/com.alexmcgann.cowork-bridge.plist')
print('  launchctl load  ~/Library/LaunchAgents/com.alexmcgann.cowork-bridge.plist')
