#!/usr/bin/env python3
"""
fix_scheduler.py — Add a Jobs.md-driven scheduling engine to bridge.py.

Design:
  - Jobs defined in AI Archive/Jobs.md in Obsidian vault
  - Each job has a name, schedule, and prompt
  - A background daemon thread checks every 60 seconds for due jobs
  - Due jobs are executed via query_ollama and replied via iMessage
  - Last-run state persisted to ~/cowork-bridge/job_state.json

Jobs.md format:
  # Jobs
  _Scheduling engine for cowork-bridge._

  ## Active

  ### Morning Brief
  - **schedule**: daily at 08:00
  - **prompt**: What's going on in the news today? Any weather alerts for Cache Valley, Utah?

  ### SpaceX Check
  - **schedule**: every monday at 09:00
  - **prompt**: Any SpaceX launches or major space news this week?

  ## Disabled
  (jobs under ## Disabled are skipped)

Supported schedule expressions:
  daily at HH:MM
  every monday at HH:MM  (or tue/wed/thu/fri/sat/sun)
  weekdays at HH:MM
  weekends at HH:MM
  hourly
"""
import subprocess, sys

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'
VAULT  = '/Users/alexmcgann/Library/Mobile Documents/iCloud~md~obsidian/Documents/LifeOS/AI Archive'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if '_scheduler_loop' in s or '_JOB_STATE_FILE' in s:
    print('SKIPPED — scheduler already present')
    sys.exit(0)

# ── Part 1: Scheduler helper code ─────────────────────────────────────────────
SCHEDULER_CODE = r'''
# ── Jobs.md Scheduling Engine ─────────────────────────────────────────────────
import json as _sched_json, re as _sched_re

_JOB_STATE_FILE = __import__('pathlib').Path.home() / 'cowork-bridge' / 'job_state.json'
_JOBS_MD_NAME   = 'Jobs.md'


def _load_job_state():
    try:
        if _JOB_STATE_FILE.exists():
            return _sched_json.loads(_JOB_STATE_FILE.read_text())
    except Exception:
        pass
    return {}


def _save_job_state(state):
    try:
        _JOB_STATE_FILE.write_text(_sched_json.dumps(state, indent=2))
    except Exception as _e:
        print(f'[scheduler] Could not save state: {_e}', flush=True)


def _parse_jobs_md(vault_path):
    """Parse Jobs.md, return list of active job dicts."""
    import pathlib as _pj
    jobs_path = _pj.Path(vault_path) / _JOBS_MD_NAME
    if not jobs_path.exists():
        return []
    try:
        text = jobs_path.read_text(errors='ignore')
    except Exception:
        return []

    # Extract only the ## Active section
    active_section = ''
    in_active = False
    for line in text.split('\n'):
        low = line.strip().lower()
        if low.startswith('## active'):
            in_active = True
            continue
        if low.startswith('## ') and in_active:
            break
        if in_active:
            active_section += line + '\n'

    jobs = []
    # Split on ### Job Name headings
    blocks = _sched_re.split(r'\n###\s+', '\n' + active_section)
    for block in blocks[1:]:
        lines = block.strip().split('\n')
        if not lines:
            continue
        name = lines[0].strip()
        job = {'name': name, 'schedule': None, 'prompt': None, 'send_to': None}
        prompt_lines = []
        in_prompt = False
        for ln in lines[1:]:
            m = _sched_re.match(r'-\s+\*\*schedule\*\*:\s*(.+)', ln)
            if m:
                job['schedule'] = m.group(1).strip()
                in_prompt = False
                continue
            m = _sched_re.match(r'-\s+\*\*send_to\*\*:\s*(.+)', ln)
            if m:
                job['send_to'] = m.group(1).strip()
                in_prompt = False
                continue
            m = _sched_re.match(r'-\s+\*\*prompt\*\*:\s*(.*)', ln)
            if m:
                first = m.group(1).strip()
                if first:
                    prompt_lines.append(first)
                in_prompt = True
                continue
            if in_prompt and ln.strip():
                prompt_lines.append(ln.strip())
        job['prompt'] = ' '.join(prompt_lines).strip()
        if job['schedule'] and job['prompt']:
            jobs.append(job)
    return jobs


def _parse_schedule(schedule_str):
    """
    Parse human-readable schedule string into a dict.
    Returns dict with keys: type, hour, minute, weekday (0=Mon..6=Sun)
    or None if unparseable.
    """
    s = schedule_str.lower().strip()
    DAYS = {
        'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
        'friday': 4, 'saturday': 5, 'sunday': 6,
        'mon': 0, 'tue': 1, 'wed': 2, 'thu': 3, 'fri': 4, 'sat': 5, 'sun': 6,
    }
    time_m = _sched_re.search(r'(\d{1,2}):(\d{2})', s)
    hour   = int(time_m.group(1)) if time_m else 0
    minute = int(time_m.group(2)) if time_m else 0

    if 'daily' in s or 'every day' in s:
        return {'type': 'daily', 'hour': hour, 'minute': minute}
    if 'weekday' in s:
        return {'type': 'weekdays', 'hour': hour, 'minute': minute}
    if 'weekend' in s:
        return {'type': 'weekends', 'hour': hour, 'minute': minute}
    if 'hourly' in s:
        return {'type': 'hourly', 'minute': minute}
    for day_name, day_num in DAYS.items():
        if day_name in s:
            return {'type': 'weekly', 'hour': hour, 'minute': minute, 'weekday': day_num}
    return None


def _job_is_due(job, state):
    """Return True if the job should run right now."""
    import datetime as _dtd
    sched = _parse_schedule(job.get('schedule', ''))
    if not sched:
        return False

    now = _dtd.datetime.now()
    last_run = None
    last_str = state.get(job['name'])
    if last_str:
        try:
            last_run = _dtd.datetime.fromisoformat(last_str)
        except Exception:
            pass

    if sched['type'] == 'hourly':
        target = now.replace(minute=sched['minute'], second=0, microsecond=0)
        if now < target:
            return False
        return last_run is None or last_run < target

    target_today = now.replace(
        hour=sched['hour'], minute=sched['minute'], second=0, microsecond=0
    )

    if sched['type'] == 'daily':
        if now < target_today:
            return False
        return last_run is None or last_run.date() < now.date()

    if sched['type'] == 'weekdays':
        if now.weekday() >= 5 or now < target_today:
            return False
        return last_run is None or last_run.date() < now.date()

    if sched['type'] == 'weekends':
        if now.weekday() < 5 or now < target_today:
            return False
        return last_run is None or last_run.date() < now.date()

    if sched['type'] == 'weekly':
        if now.weekday() != sched['weekday'] or now < target_today:
            return False
        return last_run is None or last_run.date() < now.date()

    return False


def _execute_job(job):
    """Execute a scheduled job: query LLM and send reply via iMessage."""
    import datetime as _dtx
    name    = job['name']
    prompt  = job['prompt']
    send_to = job.get('send_to') or MY_PHONE
    print(f'[scheduler] Running job: {name!r} → {send_to}', flush=True)
    try:
        msgs = [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user',   'content': f'[Scheduled job: {name}]\n\n{prompt}'},
        ]
        result = query_ollama(msgs)
        if result and result.strip():
            send_imessage(send_to, result.strip())
            print(f'[scheduler] Job {name!r} sent ({len(result)} chars)', flush=True)
        else:
            print(f'[scheduler] Job {name!r} returned empty response', flush=True)
    except Exception as _je:
        import traceback as _jtb
        print(f'[scheduler] Job {name!r} failed: {_je}', flush=True)
        print(_jtb.format_exc(), flush=True)


def _scheduler_loop(vault_path):
    """Daemon thread: check for due jobs every 60 seconds."""
    import time as _tsched
    print('[scheduler] Job scheduler started — watching Jobs.md', flush=True)
    while True:
        _tsched.sleep(60)
        try:
            state = _load_job_state()
            jobs  = _parse_jobs_md(vault_path)
            for job in jobs:
                if _job_is_due(job, state):
                    _execute_job(job)
                    state[job['name']] = __import__('datetime').datetime.now().isoformat()
                    _save_job_state(state)
        except Exception as _se:
            print(f'[scheduler] Loop error: {_se}', flush=True)

'''

# Insert helpers before a known anchor function
anchors = ['\ndef run_shell(', '\ndef execute_code_task(', '\ndef query_ollama(']
inserted = False
for anchor in anchors:
    pos = s.find(anchor)
    if pos != -1:
        s = s[:pos] + SCHEDULER_CODE + s[pos:]
        print(f'Part 1: scheduler helpers inserted before "{anchor.strip()}"')
        inserted = True
        break

if not inserted:
    print('Part 1 FAILED — no anchor found for helper insertion')
    sys.exit(1)


# ── Part 2: Start scheduler thread after "listening..." print ─────────────────
LISTEN_ANCHORS = ['listening...', 'Seeded', '[cowork-bridge] Watching']
lp = -1
for la in LISTEN_ANCHORS:
    lp = s.find(la)
    if lp != -1:
        break

if lp == -1:
    print('Part 2 FAILED — could not find startup anchor')
    sys.exit(1)

lp_line_end   = s.find('\n', lp) + 1
lp_line_start = s.rfind('\n', 0, lp) + 1
ind_raw       = s[lp_line_start:lp]
ind           = ind_raw[:len(ind_raw) - len(ind_raw.lstrip())]

vault_expr = (
    'str(SEARCH_DIR)' if 'SEARCH_DIR' in s else
    'str(VAULT)'      if 'VAULT'      in s else
    f'"{VAULT}"'
)

THREAD_START = (
    f'{ind}import threading as _sched_th\n'
    f'{ind}_sched_th.Thread(\n'
    f'{ind}    target=_scheduler_loop,\n'
    f'{ind}    args=({vault_expr},),\n'
    f'{ind}    daemon=True,\n'
    f'{ind}    name="job-scheduler",\n'
    f'{ind}).start()\n'
)

s = s[:lp_line_end] + THREAD_START + s[lp_line_end:]
print('Part 2: scheduler thread start wired after startup print')


# ── Part 3: Create initial Jobs.md in vault ───────────────────────────────────
import pathlib
jobs_path = pathlib.Path(VAULT) / 'Jobs.md'
if jobs_path.exists():
    print(f'Part 3 SKIPPED — Jobs.md already exists at {jobs_path}')
else:
    JOBS_MD = """\
# Jobs
_Scheduling engine for cowork-bridge. Edit freely — bridge re-reads this file every minute._
_State (last-run times) tracked in ~/cowork-bridge/job_state.json_

---

## Active

### Morning Brief
- **schedule**: daily at 08:00
- **prompt**: What's going on in the news today? Give me 3-5 top stories with brief context on why they matter. Also flag any weather worth knowing about for Cache Valley, Utah (Logan area).

### Weekly Digest
- **schedule**: every monday at 08:30
- **prompt**: It's Monday morning. Give me a big-picture view of what's happening this week — major news cycles, market themes, anything real-estate-relevant in Utah. Help me start the week oriented.

---

## Disabled

### SpaceX Watch
- **schedule**: every friday at 09:00
- **prompt**: Any SpaceX launches scheduled or completed this week? Any other major space news?

### Nightly Wind-Down
- **schedule**: daily at 21:30
- **prompt**: Quick end-of-day check: anything I should know before I wrap up? Any follow-ups or loose ends worth flagging based on what we discussed today?

---

_To add a new job: copy a block under ## Active, change the name/schedule/prompt._
_To disable a job: move it under ## Disabled._
_Schedules: `daily at HH:MM` · `every monday at HH:MM` · `weekdays at HH:MM` · `weekends at HH:MM` · `hourly`_
"""
    try:
        jobs_path.parent.mkdir(parents=True, exist_ok=True)
        jobs_path.write_text(JOBS_MD)
        print(f'Part 3: Jobs.md created at {jobs_path}')
    except Exception as e:
        print(f'Part 3 WARNING — could not write Jobs.md: {e}')


# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — bridge.py updated with scheduling engine')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
