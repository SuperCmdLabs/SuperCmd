#!/usr/bin/env python3
"""
fix_scheduler_vault_path.py — Patch _parse_jobs_md to find Jobs.md even
when vault_path points to the LifeOS parent dir instead of LifeOS/AI Archive.

Problem:
  The scheduler thread is started with args=(str(SEARCH_DIR),) where SEARCH_DIR
  resolves to .../LifeOS.  But Jobs.md lives at .../LifeOS/AI Archive/Jobs.md.
  So _parse_jobs_md looks for .../LifeOS/Jobs.md and finds nothing.

Fix:
  Patch _parse_jobs_md so that, after the primary jobs_path check fails, it also
  tries vault_path / 'AI Archive' / Jobs.md before giving up.
"""
import subprocess, sys

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if 'AI Archive' in s and "/ 'AI Archive' /" in s:
    print('SKIPPED — AI Archive fallback already present in _parse_jobs_md')
    sys.exit(0)

# ── Patch _parse_jobs_md: add AI Archive fallback ─────────────────────────────
# Current pattern (written by fix_scheduler.py):
OLD_PATH_CHECK = (
    "    jobs_path = _pj.Path(vault_path) / _JOBS_MD_NAME\n"
    "    if not jobs_path.exists():\n"
    "        return []"
)

NEW_PATH_CHECK = (
    "    jobs_path = _pj.Path(vault_path) / _JOBS_MD_NAME\n"
    "    if not jobs_path.exists():\n"
    "        # Fallback: Jobs.md may live inside an 'AI Archive' subdirectory\n"
    "        jobs_path = _pj.Path(vault_path) / 'AI Archive' / _JOBS_MD_NAME\n"
    "    if not jobs_path.exists():\n"
    "        print(f'[scheduler] Jobs.md not found under {vault_path}', flush=True)\n"
    "        return []"
)

# Also handle the verbose variant that has an explicit print
OLD_PATH_CHECK_V2 = (
    "    jobs_path = _pj.Path(vault_path) / _JOBS_MD_NAME\n"
    "    if not jobs_path.exists():\n"
    "        print(f'[scheduler] Jobs.md not found at {jobs_path}', flush=True)\n"
    "        return []"
)

NEW_PATH_CHECK_V2 = (
    "    jobs_path = _pj.Path(vault_path) / _JOBS_MD_NAME\n"
    "    if not jobs_path.exists():\n"
    "        # Fallback: Jobs.md may live inside an 'AI Archive' subdirectory\n"
    "        jobs_path = _pj.Path(vault_path) / 'AI Archive' / _JOBS_MD_NAME\n"
    "    if not jobs_path.exists():\n"
    "        print(f'[scheduler] Jobs.md not found under {vault_path}', flush=True)\n"
    "        return []"
)

patched = False

if OLD_PATH_CHECK_V2 in s:
    s = s.replace(OLD_PATH_CHECK_V2, NEW_PATH_CHECK_V2, 1)
    print('Patched _parse_jobs_md (verbose variant) with AI Archive fallback')
    patched = True
elif OLD_PATH_CHECK in s:
    s = s.replace(OLD_PATH_CHECK, NEW_PATH_CHECK, 1)
    print('Patched _parse_jobs_md with AI Archive fallback')
    patched = True
else:
    # Try a flexible approach
    import re
    m = re.search(
        r"(    jobs_path = _pj\.Path\(vault_path\) / _JOBS_MD_NAME\n"
        r"    if not jobs_path\.exists\(\):[^\n]*\n"
        r"(?:        print[^\n]*\n)?"
        r"        return \[\])",
        s
    )
    if m:
        replacement = (
            "    jobs_path = _pj.Path(vault_path) / _JOBS_MD_NAME\n"
            "    if not jobs_path.exists():\n"
            "        # Fallback: Jobs.md may live inside an 'AI Archive' subdirectory\n"
            "        jobs_path = _pj.Path(vault_path) / 'AI Archive' / _JOBS_MD_NAME\n"
            "    if not jobs_path.exists():\n"
            "        print(f'[scheduler] Jobs.md not found under {vault_path}', flush=True)\n"
            "        return []"
        )
        s = s[:m.start()] + replacement + s[m.end():]
        print('Patched _parse_jobs_md (regex match) with AI Archive fallback')
        patched = True
    else:
        # Show what we have around _parse_jobs_md for diagnosis
        idx = s.find('def _parse_jobs_md(')
        if idx != -1:
            print('_parse_jobs_md found but pattern did not match. Showing first 400 chars:')
            print(repr(s[idx:idx+400]))
        else:
            print('_parse_jobs_md not found in bridge.py — is the scheduler installed?')
        sys.exit(1)

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — vault path fallback installed')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
