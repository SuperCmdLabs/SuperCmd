#!/usr/bin/env python3
"""
fix_proactive_reminders.py — Add proactive reminder support to bridge.py.

Design:
  - !remind <text> in <time> / !remind <text> at <time> sets a reminder
  - remind me <text> in <time> / remind me <text> at <time> also works
  - Reminders persisted to ~/.cowork-bridge/reminders.json
  - Scheduler tick (_scheduler_loop) calls _check_reminders() every 60s
  - Fired reminders send an iMessage: "⏰ Reminder: <text>"
  - !reminders lists all pending (unfired) reminders

Supported time expressions:
  "in 5 minutes" / "in 2 hours" / "in 1 hour" / "in 30 mins"
  "at 3pm" / "at 15:30" / "at 3:30pm"  → today if future, else tomorrow
  "tomorrow at 9am" / "tomorrow morning" (=9am) / "tomorrow afternoon" (=2pm)
  "tonight at 8" / "tonight" (=9pm)

Parts:
  1. _parse_reminder_time(text)   — natural-language → UTC datetime
  2. Reminder persistence helpers — _save_reminder / _load_reminders / _clear_fired_reminders
  3. _check_reminders()           — fire due reminders via iMessage
  4. Wire !remind command         — parse + save + reply
  5. Wire !reminders command      — list pending reminders
  6. Wire _check_reminders() into _scheduler_loop tick
"""
import subprocess, sys, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ──────────────────────────────────────────────────────────────────────
if '_parse_reminder_time' in s:
    print('SKIPPED — proactive reminders already present')
    sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# Part 1 + 2 + 3: Reminder helper functions
# ══════════════════════════════════════════════════════════════════════════════

REMINDER_CODE = r'''
# ── Proactive Reminders ────────────────────────────────────────────────────────
import json as _rem_json, re as _rem_re
from pathlib import Path as _RemPath
from datetime import datetime as _RemDT, timezone as _RemTZ, timedelta as _RemTD

_REMINDERS_FILE = _RemPath.home() / 'cowork-bridge' / 'reminders.json'


def _parse_reminder_time(text):
    """
    Parse a natural-language time expression from the end of a reminder string.
    Returns a UTC-aware datetime, or None if the expression is not recognised.

    Accepted forms (case-insensitive):
      "in 5 minutes" / "in 2 hours" / "in 1 hour" / "in 30 mins"
      "at 3pm" / "at 15:30" / "at 3:30pm"    → today if future, else tomorrow
      "tomorrow at 9am" / "tomorrow morning"  → next calendar day at 9:00 / 14:00
      "tomorrow afternoon"                    → next calendar day at 14:00
      "tonight at 8" / "tonight"              → today at 20:00 / 21:00
    """
    import datetime as _dtrem

    txt = text.strip().lower()

    # ── "in N minutes/hours" ──────────────────────────────────────────────────
    m = _rem_re.search(r'\bin\s+(\d+(?:\.\d+)?)\s+(minute|min|minutes|mins|hour|hours|hr|hrs)\b', txt)
    if m:
        qty  = float(m.group(1))
        unit = m.group(2)
        if unit.startswith('h'):
            delta = _RemTD(hours=qty)
        else:
            delta = _RemTD(minutes=qty)
        return _dtrem.datetime.now(_RemTZ.utc) + delta

    # ── Helper: parse a clock string like "3pm", "15:30", "3:30pm", "8" ──────
    def _parse_clock(clock_str):
        """Return (hour, minute) tuple or None."""
        cs = clock_str.strip().lower()
        # HH:MM am/pm  or  HH:MM
        m2 = _rem_re.match(r'^(\d{1,2}):(\d{2})\s*(am|pm)?$', cs)
        if m2:
            h, mn = int(m2.group(1)), int(m2.group(2))
            ampm  = m2.group(3)
            if ampm == 'pm' and h != 12:
                h += 12
            elif ampm == 'am' and h == 12:
                h = 0
            return (h, mn)
        # HH am/pm  or bare HH
        m3 = _rem_re.match(r'^(\d{1,2})\s*(am|pm)?$', cs)
        if m3:
            h    = int(m3.group(1))
            ampm = m3.group(2)
            if ampm == 'pm' and h != 12:
                h += 12
            elif ampm == 'am' and h == 12:
                h = 0
            return (h, 0)
        return None

    # ── "tomorrow morning/afternoon" shorthand ────────────────────────────────
    if _rem_re.search(r'\btomorrow\s+morning\b', txt):
        d = _dtrem.date.today() + _RemTD(days=1)
        dt_local = _dtrem.datetime(d.year, d.month, d.day, 9, 0)
        return dt_local.astimezone(_RemTZ.utc)

    if _rem_re.search(r'\btomorrow\s+afternoon\b', txt):
        d = _dtrem.date.today() + _RemTD(days=1)
        dt_local = _dtrem.datetime(d.year, d.month, d.day, 14, 0)
        return dt_local.astimezone(_RemTZ.utc)

    # ── "tomorrow at <clock>" ─────────────────────────────────────────────────
    m = _rem_re.search(r'\btomorrow\s+at\s+([\d:apm]+)', txt)
    if m:
        clk = _parse_clock(m.group(1))
        if clk:
            d = _dtrem.date.today() + _RemTD(days=1)
            dt_local = _dtrem.datetime(d.year, d.month, d.day, clk[0], clk[1])
            return dt_local.astimezone(_RemTZ.utc)

    # ── bare "tomorrow" with no clock ─────────────────────────────────────────
    if _rem_re.search(r'\btomorrow\b', txt) and not _rem_re.search(r'\bat\s', txt):
        d = _dtrem.date.today() + _RemTD(days=1)
        dt_local = _dtrem.datetime(d.year, d.month, d.day, 9, 0)
        return dt_local.astimezone(_RemTZ.utc)

    # ── "tonight at <clock>" ──────────────────────────────────────────────────
    m = _rem_re.search(r'\btonight\s+at\s+([\d:apm]+)', txt)
    if m:
        clk = _parse_clock(m.group(1))
        if clk:
            d = _dtrem.date.today()
            dt_local = _dtrem.datetime(d.year, d.month, d.day, clk[0], clk[1])
            now_local = _dtrem.datetime.now()
            if dt_local <= now_local:
                dt_local += _RemTD(days=1)
            return dt_local.astimezone(_RemTZ.utc)

    # ── bare "tonight" ────────────────────────────────────────────────────────
    if _rem_re.search(r'\btonight\b', txt):
        d = _dtrem.date.today()
        dt_local = _dtrem.datetime(d.year, d.month, d.day, 21, 0)
        now_local = _dtrem.datetime.now()
        if dt_local <= now_local:
            dt_local += _RemTD(days=1)
        return dt_local.astimezone(_RemTZ.utc)

    # ── "at <clock>" — today if still future, else tomorrow ──────────────────
    m = _rem_re.search(r'\bat\s+([\d:apm]+)\b', txt)
    if m:
        clk = _parse_clock(m.group(1))
        if clk:
            d = _dtrem.date.today()
            dt_local = _dtrem.datetime(d.year, d.month, d.day, clk[0], clk[1])
            now_local = _dtrem.datetime.now()
            if dt_local <= now_local:
                dt_local += _RemTD(days=1)
            return dt_local.astimezone(_RemTZ.utc)

    return None


def _save_reminder(text, fire_at):
    """
    Append a new reminder to ~/.cowork-bridge/reminders.json.

    Args:
        text    (str):               Human-readable reminder body.
        fire_at (datetime, UTC-aware): When to fire.

    Returns:
        The new reminder dict (with its assigned id).
    """
    import datetime as _dtsave, uuid as _uuid
    reminders = _load_reminders()
    reminder = {
        'id':         str(_uuid.uuid4())[:8],
        'text':       text,
        'fire_at':    fire_at.isoformat(),
        'created_at': _dtsave.datetime.now(_RemTZ.utc).isoformat(),
        'fired':      False,
    }
    reminders.append(reminder)
    _REMINDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _REMINDERS_FILE.write_text(_rem_json.dumps(reminders, indent=2))
    return reminder


def _load_reminders():
    """Load all reminders from disk. Returns list of dicts (empty on error)."""
    try:
        if _REMINDERS_FILE.exists():
            data = _rem_json.loads(_REMINDERS_FILE.read_text())
            if isinstance(data, list):
                return data
    except Exception as _le:
        print(f'[reminders] Load error: {_le}', flush=True)
    return []


def _clear_fired_reminders():
    """
    Rewrite reminders.json keeping only unfired entries.
    Called after _check_reminders() to prune the list.
    """
    reminders = _load_reminders()
    pending = [r for r in reminders if not r.get('fired')]
    try:
        _REMINDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _REMINDERS_FILE.write_text(_rem_json.dumps(pending, indent=2))
    except Exception as _ce:
        print(f'[reminders] Could not prune fired reminders: {_ce}', flush=True)


def _check_reminders():
    """
    Check for due reminders and fire iMessage for each one whose
    fire_at <= now and fired == False.  Marks them fired and prunes list.
    Called from the scheduler loop on every tick.
    """
    import datetime as _dtchk
    now_utc = _dtchk.datetime.now(_RemTZ.utc)
    reminders = _load_reminders()
    fired_any = False

    for reminder in reminders:
        if reminder.get('fired'):
            continue
        try:
            fire_at = _dtchk.datetime.fromisoformat(reminder['fire_at'])
            # Make timezone-aware if stored naive (treat as UTC)
            if fire_at.tzinfo is None:
                fire_at = fire_at.replace(tzinfo=_RemTZ.utc)
        except (KeyError, ValueError) as _pe:
            print(f'[reminders] Bad fire_at for {reminder.get("id")}: {_pe}', flush=True)
            reminder['fired'] = True  # prevent infinite retry
            fired_any = True
            continue

        if fire_at <= now_utc:
            msg_text = reminder.get('text', '(no text)')
            print(f'[reminders] Firing reminder {reminder["id"]}: {msg_text!r}', flush=True)
            try:
                send_imessage(REPLY_TO, f'\u23f0 Reminder: {msg_text}')
            except Exception as _se:
                print(f'[reminders] iMessage send error: {_se}', flush=True)
            reminder['fired'] = True
            fired_any = True

    if fired_any:
        # Persist fired flags and prune
        try:
            _REMINDERS_FILE.write_text(_rem_json.dumps(reminders, indent=2))
        except Exception as _we:
            print(f'[reminders] Could not write after firing: {_we}', flush=True)
        _clear_fired_reminders()

'''

# Insert reminder helpers before a known anchor function
anchors = ['\ndef run_shell(', '\ndef execute_code_task(', '\ndef query_ollama(', '\ndef _scheduler_loop(']
inserted = False
for anchor in anchors:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + REMINDER_CODE + s[pos:]
        print(f'Parts 1-3: reminder helper functions inserted before "{anchor.strip()}"')
        inserted = True
        break

if not inserted:
    print('Parts 1-3 FAILED — no anchor function found for insertion')
    sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
# Part 4 + 5: Wire !remind and !reminders commands into the message loop
# ══════════════════════════════════════════════════════════════════════════════
# Strategy: find the !build dispatch block (16-space indent, inside the
# for-msg loop), and insert the !remind / !reminders blocks right before it.
# Fallback: look for any other well-known command anchor.

REMIND_DISPATCH = '''\
                # ── !remind / remind me — set a proactive reminder ──────────
                _tl = text.strip().lower()
                if _tl.startswith('!remind') or _tl.startswith('remind me'):
                    # Strip the command prefix to get the raw argument
                    if _tl.startswith('!remind'):
                        _rem_arg = text.strip()[len('!remind'):].strip()
                    else:
                        _rem_arg = text.strip()[len('remind me'):].strip()

                    # Split reminder text from time expression.
                    # Time keywords: "in", "at", "tomorrow", "tonight"
                    # We try each keyword in order and split on the last match.
                    _time_patterns = [
                        r'\\s+(in\\s+\\d+\\s+(?:minute|min|minutes|mins|hour|hours|hr|hrs))',
                        r'\\s+(at\\s+[\\d:apm]+)',
                        r'\\s+(tomorrow(?:\\s+(?:at\\s+[\\d:apm]+|morning|afternoon))?)',
                        r'\\s+(tonight(?:\\s+at\\s+[\\d:apm]+)?)',
                    ]
                    _reminder_body = _rem_arg
                    _time_expr     = None
                    for _tp in _time_patterns:
                        _m = __import__('re').search(_tp, _rem_arg, __import__('re').IGNORECASE)
                        if _m:
                            _time_expr     = _m.group(1).strip()
                            _reminder_body = _rem_arg[:_m.start()].strip()
                            break

                    if not _time_expr:
                        # No recognised time expression — treat the whole arg as time
                        _time_expr     = _rem_arg
                        _reminder_body = 'reminder'

                    _fire_at = _parse_reminder_time(_time_expr)
                    if _fire_at is None:
                        send_imessage(REPLY_TO,
                            f'\\u274c Could not parse time from: "{_time_expr}"\\n'
                            'Try: "in 30 minutes", "at 3pm", "tomorrow morning", "tonight at 8"')
                    else:
                        _saved = _save_reminder(_reminder_body or 'reminder', _fire_at)
                        import datetime as _remdt
                        _local_fire = _fire_at.astimezone().strftime('%b %-d at %-I:%M %p')
                        send_imessage(REPLY_TO,
                            f'\\u2705 Reminder set for {_local_fire}: {_reminder_body}')
                        print(f'[reminders] Saved {_saved["id"]}: {_reminder_body!r} → {_fire_at}', flush=True)
                    continue

                # ── !reminders — list pending reminders ──────────────────────
                if _tl.strip() in ('!reminders', '!reminder list', 'reminders', 'list reminders'):
                    _pending = [r for r in _load_reminders() if not r.get('fired')]
                    if not _pending:
                        send_imessage(REPLY_TO, '\\U0001f4cb No pending reminders.')
                    else:
                        import datetime as _remdt2
                        _lines = ['\\U0001f4cb Pending reminders:']
                        for _idx2, _r in enumerate(_pending, 1):
                            try:
                                _fat = _remdt2.datetime.fromisoformat(_r['fire_at'])
                                if _fat.tzinfo is None:
                                    _fat = _fat.replace(tzinfo=_remdt2.timezone.utc)
                                _lft = _fat.astimezone().strftime('%b %-d at %-I:%M %p')
                            except Exception:
                                _lft = _r.get('fire_at', '?')
                            _lines.append(f'  {_idx2}. {_lft} — {_r.get("text", "?")}')
                        send_imessage(REPLY_TO, '\\n'.join(_lines))
                    continue

'''

# ── Find insertion point: just before the !build dispatch ──────────────────
# The !build block starts with one of these recognisable anchors.
CMD_ANCHORS = [
    '                if text.strip().lower().startswith(\'!build\')',
    '                if text.strip().lower().startswith("!build")',
    '                if _tl.startswith(\'!build\')',
    '                if _tl.startswith("!build")',
]

inserted_cmds = False
for anchor in CMD_ANCHORS:
    idx = s.find(anchor)
    if idx != -1:
        s = s[:idx] + REMIND_DISPATCH + s[idx:]
        print(f'Parts 4-5: !remind / !reminders dispatch inserted before "{anchor.strip()[:60]}"')
        inserted_cmds = True
        break

if not inserted_cmds:
    # Fallback: look for the for-loop over messages and insert before its first
    # command dispatch (any 'if text.strip()' at 16-space indent inside the loop).
    fallback_pattern = re.search(
        r'(                if text\.strip\(\)\.lower\(\)\.startswith\()',
        s
    )
    if fallback_pattern:
        idx = fallback_pattern.start()
        s = s[:idx] + REMIND_DISPATCH + s[idx:]
        print('Parts 4-5: !remind / !reminders dispatch inserted (fallback — first command block)')
        inserted_cmds = True

if not inserted_cmds:
    print('Parts 4-5 WARNING: could not find insertion point for !remind — commands not wired')
    print('  → You may need to manually add the REMIND_DISPATCH block inside the for-msg loop')


# ══════════════════════════════════════════════════════════════════════════════
# Part 6: Wire _check_reminders() into _scheduler_loop
# ══════════════════════════════════════════════════════════════════════════════
# The scheduler loop sleeps 60s then processes jobs.  We call _check_reminders()
# at the top of the try block each tick, before job processing.
#
# Anchor pattern (from fix_scheduler.py):
#   while True:
#       _tsched.sleep(60)
#       try:
#           state = _load_job_state()
#
# We insert _check_reminders() right after the try: line.

SCHED_ANCHOR = '        try:\n            state = _load_job_state()'
SCHED_WITH_REMINDERS = (
    '        try:\n'
    '            _check_reminders()  # fire any due proactive reminders\n'
    '            state = _load_job_state()'
)

if SCHED_ANCHOR in s:
    s = s.replace(SCHED_ANCHOR, SCHED_WITH_REMINDERS, 1)
    print('Part 6: _check_reminders() wired into _scheduler_loop tick')
else:
    # Fallback: find _scheduler_loop and insert _check_reminders() in its while True body
    sched_fn_idx = s.find('def _scheduler_loop(')
    if sched_fn_idx != -1:
        # Find the while True: inside the function
        while_idx = s.find('    while True:', sched_fn_idx)
        if while_idx != -1:
            # Find the next line after while True:
            after_while = s.find('\n', while_idx) + 1
            # Find the first try: or sleep() inside the while
            next_sleep = s.find('sleep(', after_while)
            next_try   = s.find('try:', after_while)
            # Insert after the sleep line (end of sleep line)
            if next_sleep != -1 and (next_try == -1 or next_sleep < next_try):
                sleep_line_end = s.find('\n', next_sleep) + 1
                # Determine indent from the sleep line
                sleep_line_start = s.rfind('\n', 0, next_sleep) + 1
                ind = s[sleep_line_start:next_sleep]
                ind = ind[:len(ind) - len(ind.lstrip())]
                insertion = f'{ind}try:\n{ind}    _check_reminders()\n{ind}except Exception as _cre:\n{ind}    print(f\'[reminders] check error: {{_cre}}\', flush=True)\n'
                s = s[:sleep_line_end] + insertion + s[sleep_line_end:]
                print('Part 6: _check_reminders() wired into _scheduler_loop (fallback — after sleep)')
            else:
                print('Part 6 WARNING: could not wire _check_reminders() — patch manually')
        else:
            print('Part 6 WARNING: _scheduler_loop has no while True — patch manually')
    else:
        print('Part 6 WARNING: _scheduler_loop not found — _check_reminders() not wired')
        print('  → Add "_check_reminders()" inside the scheduler loop manually')


# ══════════════════════════════════════════════════════════════════════════════
# Write & validate
# ══════════════════════════════════════════════════════════════════════════════
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n\u2705 syntax OK — proactive reminders installed in bridge.py')
    print('\nUsage:')
    print('  !remind pick up kids in 2 hours')
    print('  !remind call dentist at 3pm')
    print('  !remind standup tomorrow morning')
    print('  remind me buy milk tonight at 7')
    print('  !reminders                         → list pending reminders')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original bridge.py — no changes applied')
    sys.exit(1)
