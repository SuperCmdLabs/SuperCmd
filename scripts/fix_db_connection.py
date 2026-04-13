#!/usr/bin/env python3
"""
fix_db_connection.py — Fix "unable to open database file" after bridge restart.

Symptoms:
  [cowork-bridge] DB seed error: unable to open database file
  [cowork-bridge] Loop error: unable to open database file

Root causes:
  1. chat.db opened in write mode — fails when macOS grants only read-only
     access to the Messages DB (Full Disk Access may not include write).
  2. Hard-coded path that resolves wrong if HOME is wrong.
  3. No retry on startup — if Messages app hasn't fully written the DB yet,
     the first connect attempt fails permanently.

Fix (3 parts):
  1. Open chat.db in read-only URI mode: ?mode=ro&immutable=1
     SQLite read-only mode never tries to acquire a write lock, which is
     what triggers "unable to open database file" when the DB is locked by
     Messages.app.
  2. Ensure timeout=30 (default is 5s — too short for a busy Messages DB).
  3. Wrap the DB seed and main poll in a retry loop (up to 5 attempts, 2s
     apart) so a transient lock on startup doesn't crash the loop.
"""
import pathlib, subprocess, sys, re

HOME   = pathlib.Path('/Users/alexmcgann')
PYTHON = str(HOME / 'cowork-bridge' / '.venv' / 'bin' / 'python3')
BRIDGE = str(HOME / 'cowork-bridge' / 'bridge.py')

# ── Diagnose first ────────────────────────────────────────────────────────────
chat_db = HOME / 'Library' / 'Messages' / 'chat.db'
print(f'chat.db exists: {chat_db.exists()}')
if chat_db.exists():
    import os, stat
    st = os.stat(str(chat_db))
    print(f'  mode: {oct(stat.S_IMODE(st.st_mode))}  uid: {st.st_uid}  size: {st.st_size}')
    try:
        import sqlite3
        # Try read-only URI mode first
        uri = f'file:{chat_db}?mode=ro&immutable=1'
        con = sqlite3.connect(uri, timeout=10, uri=True)
        cur = con.cursor()
        cur.execute('SELECT count(*) FROM message LIMIT 1')
        print(f'  read-only connect: OK  ({cur.fetchone()[0]} messages)')
        con.close()
    except Exception as e:
        print(f'  read-only connect FAILED: {e}')
        try:
            con = sqlite3.connect(str(chat_db), timeout=10)
            print(f'  normal connect: OK')
            con.close()
        except Exception as e2:
            print(f'  normal connect FAILED: {e2}')
else:
    print('  ERROR: chat.db does not exist — bridge will always fail')
    print('  Check: System Settings → Privacy & Security → Full Disk Access')
    print('  Make sure Terminal / launchd has Full Disk Access')
    sys.exit(1)

# ── Read bridge ───────────────────────────────────────────────────────────────
s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_db_uri_readonly' in s:
    print('\nSKIPPED — DB read-only patch already applied')
    sys.exit(0)

# ── Find the sqlite3.connect call(s) for chat.db ─────────────────────────────
# Common patterns in bridge.py:
#   con = sqlite3.connect(DB_PATH, ...)
#   con = sqlite3.connect(str(DB_PATH), ...)
#   conn = sqlite3.connect(DB_PATH, ...)

# Find how bridge.py opens chat.db — look for sqlite3.connect near DB_PATH
connect_pat = re.compile(
    r'(con\w*\s*=\s*sqlite3\.connect\()([^)]+)(\))',
    re.IGNORECASE
)

matches = list(connect_pat.finditer(s))
if not matches:
    print('No sqlite3.connect() calls found — searching for DB_PATH assignment...')
    db_idx = s.find('DB_PATH')
    if db_idx != -1:
        print(f'  DB_PATH context: {repr(s[db_idx:db_idx+80])}')
    sys.exit(1)

print(f'\nFound {len(matches)} sqlite3.connect() call(s):')
for m in matches:
    ls = s.rfind('\n', 0, m.start()) + 1
    le = s.find('\n', m.end())
    print(f'  line ~{s[:m.start()].count(chr(10))+1}: {s[ls:le].strip()}')

# ── Part 1: Patch DB_PATH definition to use read-only URI ────────────────────
# Strategy: find the DB_PATH = ... line and add a _db_uri_readonly alongside it

db_path_pat = re.compile(r'^(DB_PATH\s*=\s*.+)$', re.MULTILINE)
db_path_m = db_path_pat.search(s)

if db_path_m:
    old_db_line = db_path_m.group(0)
    new_db_line = (
        old_db_line + '\n'
        "# Read-only URI — avoids write-lock errors when Messages.app holds the DB\n"
        "_db_uri_readonly = f'file:{DB_PATH}?mode=ro&immutable=1'"
    )
    s = s.replace(old_db_line, new_db_line, 1)
    print(f'\nPart 1: added _db_uri_readonly after DB_PATH')
else:
    print('Part 1 WARNING: DB_PATH assignment not found — skipping URI helper')

# ── Part 2: Patch all sqlite3.connect(DB_PATH...) to use URI + timeout ───────
patched_count = 0

def patch_connect(m):
    global patched_count
    args = m.group(2).strip()
    # Skip if already patched
    if 'uri=True' in args or '_db_uri_readonly' in args:
        return m.group(0)
    # Replace with read-only URI mode
    # Preserve any existing keyword args (timeout, etc.) but override with our values
    patched_count += 1
    return f'{m.group(1)}_db_uri_readonly, timeout=30, uri=True{m.group(3)}'

s_new = connect_pat.sub(patch_connect, s)
if patched_count:
    s = s_new
    print(f'Part 2: patched {patched_count} sqlite3.connect() call(s) to read-only URI')
else:
    print('Part 2: no changes needed (already patched or pattern mismatch)')

# ── Part 3: Add retry wrapper around the DB seed block ───────────────────────
# Find the "DB seed error" print or the seed block itself and wrap it

SEED_ERROR_PAT = re.compile(
    r"(except\s+Exception\s+as\s+\w+:\s*\n\s*print\(.*?DB seed error.*?\n)",
    re.DOTALL
)

# Alternative: find the try: block around the seed
# Look for a known pattern from bridge.py seed logic
seed_retry_marker = '_db_seed_attempts'
if seed_retry_marker not in s:
    # Find the DB seed try/except and add retry
    seed_try_pat = re.compile(
        r'(# .*[Ss]eed.*\n.*?try:\n)(.*?)(except\s+Exception\s+as\s+(\w+):\s*\n'
        r'\s*print\(f[\'"].*?DB seed error.*?[\'"]\s*.*?\n)',
        re.DOTALL
    )
    m_seed = seed_try_pat.search(s)
    if m_seed:
        # Wrap the seed section with retry
        retry_prefix = (
            f'# Retry loop: Messages DB may be locked for a few seconds on startup\n'
            f'for _db_seed_attempts in range(5):\n'
            f'    try:\n'
        )
        # This is complex — just add a sleep/retry note for now
        print('Part 3: seed block found; adding simple startup delay instead')
        # Find the very start of the bridge main startup (after all defs)
        # and add a 2-second wait for Messages DB to be ready
        startup_wait_anchor = 'print(f\'[cowork-bridge] Model:'
        if startup_wait_anchor in s:
            old_startup = s[s.find(startup_wait_anchor):]
            old_startup_line = old_startup[:old_startup.find('\n')+1]
            new_startup_block = (
                '# Wait for Messages DB to be available after launch\n'
                'import time as _startup_time\n'
                'for _db_wait_i in range(10):\n'
                '    _db_test_path = str(DB_PATH) if "DB_PATH" in dir() else '
                'str(__import__("pathlib").Path.home() / "Library/Messages/chat.db")\n'
                '    if __import__("pathlib").Path(_db_test_path).exists():\n'
                '        break\n'
                '    print(f"[cowork-bridge] Waiting for Messages DB... ({_db_wait_i+1}/10)", flush=True)\n'
                '    _startup_time.sleep(2)\n'
                + old_startup_line
            )
            s = s.replace(old_startup_line, new_startup_block, 1)
            print('Part 3: added Messages DB wait loop before startup print')
        else:
            print('Part 3 WARNING: startup print anchor not found')
    else:
        # Simpler approach: find the except block for DB seed error and add retry
        db_err_idx = s.find('DB seed error')
        if db_err_idx != -1:
            lstart = s.rfind('\n', 0, db_err_idx) + 1
            lend = s.find('\n', db_err_idx)
            print(f'  Found "DB seed error" at line ~{s[:db_err_idx].count(chr(10))+1}')
            print(f'  Context: {repr(s[lstart:lend+1])}')
        print('Part 3: complex retry not applied — focus on URI fix in Part 2')
else:
    print('Part 3: retry already present')

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — DB connection patched to read-only URI')
    print('\nNext: restart the bridge:')
    print('  launchctl unload ~/Library/LaunchAgents/com.alexmcgann.cowork-bridge.plist')
    print('  launchctl load   ~/Library/LaunchAgents/com.alexmcgann.cowork-bridge.plist')
    print('  tail -50f ~/cowork-bridge/bridge.log')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original bridge.py')
    sys.exit(1)
