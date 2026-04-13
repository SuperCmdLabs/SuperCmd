#!/usr/bin/env python3
"""
fix_morning_brief_live.py — Patch bridge.py to enrich the Morning Brief
with live weather and calendar data.

Design:
  1. Add _get_weather() — fetches current weather via wttr.in (no API key).
  2. Add _get_calendar_events(n_days=1) — reads macOS Calendar via icalBuddy CLI.
  3. Add _morning_brief() — assembles weather + calendar + recent vault context,
     calls Ollama, sends via iMessage, writes to vault Daily Review.
  4. Wire into _execute_job() — dispatch type='morning-brief' to _morning_brief().
  5. Update Jobs.md — set type: morning-brief on the Morning Brief job.
     Also note job_state.json Morning Brief prior type=None.

Guard: skipped if '_morning_brief' is already present in bridge.py.
"""
import subprocess, sys, pathlib, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'
VAULT  = '/Users/alexmcgann/Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if '_morning_brief' in s:
    print('SKIPPED — morning brief already present in bridge.py')
    sys.exit(0)

# ── Resolve VAULT_DIR from line 33 of bridge.py ───────────────────────────────
# Per spec, VAULT_DIR is defined at line 33; read it and use as authoritative
# source for vault path if it differs from our default.
_lines = s.splitlines()
_vault_line = _lines[32] if len(_lines) > 32 else ''   # 0-indexed → line 33
_vault_match = re.search(r'VAULT_DIR\s*=\s*(.+)', _vault_line)
if _vault_match:
    # Use the literal vault expression from source so path stays in sync
    _vault_expr_raw = _vault_match.group(1).strip()
    print(f'VAULT_DIR expression from line 33: {_vault_expr_raw}')
else:
    _vault_expr_raw = None
    print('Note: VAULT_DIR not found on line 33 — using default VAULT path')


# ── Part 1: _get_weather() ────────────────────────────────────────────────────

WEATHER_CODE = r'''
# ── Morning Brief helpers ──────────────────────────────────────────────────────

def _get_weather():
    """
    Fetch current weather via wttr.in (no API key needed).
    Returns a 1-line string like "Partly cloudy 72°F 45% humidity 8mph wind"
    or empty string on any failure.
    """
    import urllib.request as _ur
    try:
        req = _ur.Request(
            'http://wttr.in/?format=%C+%t+%h+humidity+%w+wind',
            headers={'User-Agent': 'curl/7.64.1'},
        )
        with _ur.urlopen(req, timeout=8) as resp:
            weather = resp.read().decode('utf-8', errors='replace').strip()
        print(f'[morning-brief] Weather: {weather}', flush=True)
        return weather
    except Exception as _we:
        print(f'[morning-brief] Weather fetch failed: {_we}', flush=True)
        return ''


def _get_calendar_events(n_days=1):
    """
    Read macOS Calendar events using icalBuddy CLI.
    Returns a formatted string of today's events or "No events found".
    Gracefully handles missing icalBuddy (FileNotFoundError).
    """
    import subprocess as _sp
    try:
        result = _sp.run(
            [
                'icalBuddy',
                '-n',
                '-iep', 'title,datetime',
                '-df', '%Y-%m-%d',
                'eventsFrom:today to:+1 days',
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        output = result.stdout.strip()
        if not output:
            return 'No events found'
        print(f'[morning-brief] Calendar events retrieved ({len(output)} chars)', flush=True)
        return output
    except FileNotFoundError:
        print('[morning-brief] icalBuddy not installed — skipping calendar', flush=True)
        return 'No events found'
    except Exception as _ce:
        print(f'[morning-brief] Calendar fetch failed: {_ce}', flush=True)
        return 'No events found'

'''

# ── Part 2: _morning_brief() ──────────────────────────────────────────────────

MORNING_BRIEF_CODE = r'''
def _morning_brief():
    """
    Morning Brief handler:
      1. Fetch live weather and calendar events.
      2. Read last 2 session files from vault for context.
      3. Build prompt and call Ollama.
      4. Send via iMessage and write to vault Daily Review.
    """
    import datetime as _dtmb, pathlib as _plmb
    today_str  = _dtmb.date.today().strftime('%Y-%m-%d')
    vault_path = _plmb.Path(str(VAULT_DIR))

    # ── Step 1: live data ─────────────────────────────────────────────────────
    weather  = _get_weather()
    calendar = _get_calendar_events()

    # ── Step 2: read last 2 session files for context ─────────────────────────
    search_dirs = [
        _plmb.Path.home() / 'cowork-bridge',
        vault_path,
        vault_path / 'Sessions',
        vault_path / 'AI Archive',
    ]
    session_files = []
    for d in search_dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob('*session*.md'), key=lambda p: p.stat().st_mtime, reverse=True):
            session_files.append(f)
            if len(session_files) >= 2:
                break
        if len(session_files) >= 2:
            break

    session_texts = []
    for f in session_files[:2]:
        try:
            txt = f.read_text(errors='ignore').strip()
            if txt:
                session_texts.append(f'### {f.name}\n{txt[:2000]}')
                print(f'[morning-brief] Session context: {f.name}', flush=True)
        except Exception as _se:
            print(f'[morning-brief] Could not read {f}: {_se}', flush=True)

    sessions = '\n\n---\n\n'.join(session_texts) if session_texts else 'No recent sessions.'

    # ── Step 3: build prompt ──────────────────────────────────────────────────
    weather_str  = weather  if weather  else 'Weather unavailable.'
    calendar_str = calendar if calendar else 'No events found.'

    brief_prompt = (
        f'Generate a morning brief for Alex. Today is {today_str}. '
        f'Weather: {weather_str}. '
        f'Calendar: {calendar_str}. '
        f'Recent context: {sessions[:2500]}. '
        'Include: '
        '1) Good morning greeting with weather '
        '2) Today\'s schedule '
        '3) Top 3 priorities based on recent context '
        '4) One motivating insight. '
        'Keep it under 200 words.'
    )

    msgs = [
        {
            'role': 'system',
            'content': (
                'You are a helpful personal assistant delivering a concise, '
                'upbeat morning brief. Be specific, grounded, and brief.'
            ),
        },
        {'role': 'user', 'content': brief_prompt},
    ]

    print(f'[morning-brief] Generating brief for {today_str}...', flush=True)
    result = query_ollama(msgs)

    if not result or not result.strip():
        print('[morning-brief] Empty response from model — skipping', flush=True)
        return

    # ── Step 4a: send via iMessage ────────────────────────────────────────────
    send_imessage(REPLY_TO, f'\u2600\ufe0f Morning Brief \u2014 {today_str}\n\n{result.strip()}')
    print(f'[morning-brief] iMessage sent ({len(result)} chars)', flush=True)

    # ── Step 4b: write to vault ───────────────────────────────────────────────
    review_dir = vault_path / 'Daily Review'
    review_dir.mkdir(parents=True, exist_ok=True)
    morning_path = review_dir / f'{today_str}_morning.md'
    header = (
        f'# Morning Brief \u2014 {today_str}\n'
        f'_Auto-generated by bridge at {_dtmb.datetime.now():%H:%M}_\n\n'
        f'**Weather:** {weather_str}\n'
        f'**Calendar:** {calendar_str}\n\n'
        '---\n\n'
    )
    morning_path.write_text(header + result.strip())
    print(f'[morning-brief] Wrote {morning_path}', flush=True)

'''

# Combine into a single insertion block (Part 1 + Part 2 together)
MORNING_BRIEF_BLOCK = WEATHER_CODE + MORNING_BRIEF_CODE

# Insert before run_shell / query_ollama anchor (same pattern as other fix scripts)
anchors = ['\ndef run_shell(', '\ndef execute_code_task(', '\ndef query_ollama(']
inserted = False
for anchor in anchors:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + MORNING_BRIEF_BLOCK + s[pos:]
        print(f'Parts 1+2: _get_weather, _get_calendar_events, _morning_brief inserted before "{anchor.strip()}"')
        inserted = True
        break

if not inserted:
    print('Parts 1+2 FAILED — no anchor found for helper insertion')
    sys.exit(1)


# ── Part 3: Wire _execute_job — dispatch type='morning-brief' ─────────────────
# The type='review' dispatch was added by fix_nightly_review.py; add morning-brief
# right after it (or right at the top of _execute_job if review dispatch not present).

# Preferred: insert after the existing type='review' block
OLD_REVIEW_DISPATCH = (
    "    if job.get('type') == 'review':\n"
    "        _nightly_review()\n"
    "        return\n"
)
NEW_REVIEW_DISPATCH = (
    "    if job.get('type') == 'review':\n"
    "        _nightly_review()\n"
    "        return\n"
    "    if job.get('type') == 'morning-brief':\n"
    "        _morning_brief()\n"
    "        return\n"
)

part3_done = False
if OLD_REVIEW_DISPATCH in s:
    s = s.replace(OLD_REVIEW_DISPATCH, NEW_REVIEW_DISPATCH, 1)
    print("Part 3: morning-brief dispatch added after type='review' in _execute_job")
    part3_done = True

if not part3_done:
    # Fallback: add at top of _execute_job body (covers case where review dispatch
    # was added via the fallback path in fix_nightly_review.py)
    idx = s.find('def _execute_job(job):')
    if idx != -1:
        body_start = s.find('\n', idx) + 1
        # Detect existing dispatch block and insert after it
        existing_review_pos = s.find("if job.get('type') == 'review':", body_start)
        if existing_review_pos != -1:
            # Find the 'return' that closes that if-block
            ret_pos = s.find('        return\n', existing_review_pos)
            if ret_pos != -1:
                insert_after = ret_pos + len('        return\n')
                dispatch_snippet = (
                    "    if job.get('type') == 'morning-brief':\n"
                    "        _morning_brief()\n"
                    "        return\n"
                )
                s = s[:insert_after] + dispatch_snippet + s[insert_after:]
                print("Part 3: morning-brief dispatch inserted after review block (offset search)")
                part3_done = True

if not part3_done:
    # Last resort: prepend to _execute_job body
    idx = s.find('def _execute_job(job):')
    if idx != -1:
        body_start = s.find('\n', idx) + 1
        dispatch_snippet = (
            "    # Dispatch special job types\n"
            "    if job.get('type') == 'morning-brief':\n"
            "        _morning_brief()\n"
            "        return\n"
        )
        s = s[:body_start] + dispatch_snippet + s[body_start:]
        print("Part 3: morning-brief dispatch prepended to _execute_job (fallback)")
        part3_done = True

if not part3_done:
    print("Part 3 FAILED — could not locate _execute_job")
    sys.exit(1)


# ── Part 4: Update Jobs.md — add type: morning-brief + fix VAULT_DIR path ─────
jobs_path = pathlib.Path(VAULT) / 'Jobs.md'
if not jobs_path.exists():
    # Also try the parent directory (LifeOS)
    jobs_path_alt = pathlib.Path(VAULT).parent / 'Jobs.md'
    if jobs_path_alt.exists():
        jobs_path = jobs_path_alt

if not jobs_path.exists():
    print('Part 4 SKIPPED — Jobs.md not found (run fix_scheduler.py first)')
else:
    jobs_text = jobs_path.read_text()
    jobs_orig = jobs_text
    changed_jobs = False

    # Patch: add type: morning-brief to the Morning Brief job block
    # Pattern: ### Morning Brief section — insert type after schedule line
    morning_brief_section = re.search(
        r'(### Morning Brief\n(?:.*\n)*?)'          # heading + lines before schedule
        r'(-\s+\*\*schedule\*\*:[^\n]+\n)'          # schedule line
        r'(?!-\s+\*\*type\*\*)',                    # only if type not already set
        jobs_text
    )
    if morning_brief_section:
        insert_pos = morning_brief_section.end()
        jobs_text = (
            jobs_text[:insert_pos]
            + '- **type**: morning-brief\n'
            + jobs_text[insert_pos:]
        )
        print('Part 4: type: morning-brief added to Morning Brief job in Jobs.md')
        changed_jobs = True
    elif 'type: morning-brief' in jobs_text or '**type**: morning-brief' in jobs_text:
        print('Part 4 SKIPPED — type: morning-brief already set in Jobs.md')
    else:
        # Looser fallback: find schedule line inside Morning Brief block
        mb_idx = jobs_text.find('### Morning Brief')
        if mb_idx != -1:
            sched_idx = jobs_text.find('**schedule**', mb_idx)
            if sched_idx != -1:
                eol = jobs_text.find('\n', sched_idx) + 1
                jobs_text = jobs_text[:eol] + '- **type**: morning-brief\n' + jobs_text[eol:]
                print('Part 4: type: morning-brief inserted (fallback) in Jobs.md')
                changed_jobs = True
            else:
                print('Part 4 WARNING: **schedule** not found in Morning Brief block')
        else:
            print('Part 4 WARNING: ### Morning Brief section not found in Jobs.md')

    if changed_jobs:
        jobs_path.write_text(jobs_text)


# ── Part 5: Note job_state.json Morning Brief prior type=None ─────────────────
job_state_path = pathlib.Path.home() / 'cowork-bridge' / 'job_state.json'
if job_state_path.exists():
    import json
    try:
        job_state = json.loads(job_state_path.read_text())
        note = job_state.get('_morning_brief_type_note')
        if note:
            print(f'Part 5 SKIPPED — note already present: {note}')
        else:
            job_state['_morning_brief_type_note'] = (
                'Morning Brief job previously ran with type=None (generic query_ollama). '
                'Now dispatched as type=morning-brief to _morning_brief() with live weather '
                'and calendar data. Patched by fix_morning_brief_live.py.'
            )
            job_state_path.write_text(json.dumps(job_state, indent=2))
            print('Part 5: job_state.json annotated — Morning Brief prior type=None noted')
    except Exception as _jse:
        print(f'Part 5 WARNING: could not update job_state.json: {_jse}')
else:
    print('Part 5 SKIPPED — job_state.json does not exist yet')


# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n[OK] syntax OK — morning brief with live data installed')
    print('\nWhat was added:')
    print('  _get_weather()           — fetches wttr.in (urllib, no API key)')
    print('  _get_calendar_events()   — reads macOS Calendar via icalBuddy')
    print('  _morning_brief()         — live brief → iMessage + vault write')
    print('  _execute_job dispatch    — type=morning-brief routes to _morning_brief()')
    print('  Jobs.md                  — type: morning-brief set on Morning Brief job')
    print('  job_state.json           — prior type=None noted (if file exists)')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original bridge.py — no changes applied')
    sys.exit(1)
