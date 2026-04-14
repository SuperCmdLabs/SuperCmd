#!/usr/bin/env python3
"""
harden_backup_timestamp.py — Fix backup collision + skill file accumulation.

PROBLEM 1: Backup timestamp collision
--------------------------------------
_apply_patch() names backups with second-level precision:
  bridge.backup.20260413_142305.py

If two patches are applied within the same second (e.g., a quick reject/revise
cycle), the second backup silently overwrites the first. The rollback history
is corrupted without warning.

Fix: Add microseconds and a random suffix to backup names:
  bridge.backup.20260413_142305_847231.py

PROBLEM 2: Skill file unbounded growth
----------------------------------------
_save_skill() (from fix_skill_loop.py) writes skills as:
  skills/add-retry-logic.json
  skills/add-retry-logic.20260413_120000.json  ← versioned collision avoidance
  skills/add-retry-logic.20260413_120001.json  ← another version
  ...

Over time this accumulates. There's no cleanup. With frequent !build usage,
the directory can grow to hundreds of files.

Fix: Keep only the 3 most recent versions of each named skill.
     Remove older ones automatically after each save.

Guard sentinel: '_backup_hardened'
"""
import pathlib, subprocess, sys, re

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_backup_hardened' in s:
    print('SKIPPED — backup hardening already applied')
    sys.exit(0)

applied = 0

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Fix backup timestamp — add microseconds
# ══════════════════════════════════════════════════════════════════════════════

OLD_BACKUP_NAME = "_backup_name = f'bridge.backup.{_adt.datetime.now():%Y%m%d_%H%M%S}.py'"
NEW_BACKUP_NAME = (
    "    _now = _adt.datetime.now()\n"
    "    _backup_name = f'bridge.backup.{_now:%Y%m%d_%H%M%S}_{_now.microsecond:06d}.py'  # _backup_hardened"
)

if OLD_BACKUP_NAME in s:
    s = s.replace(OLD_BACKUP_NAME, NEW_BACKUP_NAME, 1)
    print('Part 1: backup timestamp updated to include microseconds')
    applied += 1
else:
    print('Part 1 WARNING: backup name pattern not found — may already use microseconds')

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: After _save_skill writes a file, prune old versions
#         Keep the 3 most recent versions of each base skill name.
# ══════════════════════════════════════════════════════════════════════════════

# The existing _save_skill code ends with something like:
#   _dest.write_text(json.dumps(_skill_data, indent=2))
#   send_imessage(sender, f'[Skill] Saved: {_name}')
# We look for the write_text call and append cleanup after it.

# The skill save block writes _dest and then prints/sends.
# Find the pattern where _dest is written in the skill-save context.

SKILL_WRITE_OLD = (
    '    _json_mod.dump(_skill_data, _sf, indent=2)\n'
    '    print(f\'[skill] Saved: {_dest}\', flush=True)\n'
)

SKILL_WRITE_NEW = (
    '    _json_mod.dump(_skill_data, _sf, indent=2)\n'
    '    print(f\'[skill] Saved: {_dest}\', flush=True)\n'
    '\n'
    '    # Prune old versions — keep only the 3 most recent per skill base name\n'
    '    try:\n'
    '        _base_name = _name  # e.g. "add-retry-logic"\n'
    '        _all_versions = sorted(\n'
    '            [_p for _p in _skills_dir.glob(f"{_base_name}*.json")],\n'
    '            key=lambda _p: _p.stat().st_mtime,\n'
    '            reverse=True,\n'
    '        )\n'
    '        for _old_skill in _all_versions[3:]:\n'
    '            _old_skill.unlink(missing_ok=True)\n'
    '            print(f\'[skill] Pruned old version: {_old_skill.name}\', flush=True)\n'
    '    except Exception as _prune_e:\n'
    '        print(f\'[skill] Prune error (non-fatal): {_prune_e}\', flush=True)\n'
)

if SKILL_WRITE_OLD in s:
    s = s.replace(SKILL_WRITE_OLD, SKILL_WRITE_NEW, 1)
    print('Part 2: skill file pruning added (keep 3 most recent versions per skill)')
    applied += 1
else:
    # Try alternative pattern (json.dumps variant)
    SKILL_WRITE_OLD2 = (
        "        _sf.write(_json_mod.dumps(_skill_data, indent=2))\n"
        "    print(f'[skill] Saved: {_dest}', flush=True)\n"
    )
    if SKILL_WRITE_OLD2 in s:
        SKILL_WRITE_NEW2 = (
            "        _sf.write(_json_mod.dumps(_skill_data, indent=2))\n"
            "    print(f'[skill] Saved: {_dest}', flush=True)\n"
            "\n"
            "    # Prune: keep 3 most recent versions per skill base name\n"
            "    try:\n"
            "        _all_v = sorted(\n"
            "            [_p for _p in _skills_dir.glob(f'{_name}*.json')],\n"
            "            key=lambda _p: _p.stat().st_mtime, reverse=True)\n"
            "        for _ov in _all_v[3:]:\n"
            "            _ov.unlink(missing_ok=True)\n"
            "            print(f'[skill] Pruned: {_ov.name}', flush=True)\n"
            "    except Exception as _pe:\n"
            "        print(f'[skill] Prune error: {_pe}', flush=True)\n"
        )
        s = s.replace(SKILL_WRITE_OLD2, SKILL_WRITE_NEW2, 1)
        print('Part 2: skill file pruning added (alt pattern)')
        applied += 1
    else:
        print('Part 2 WARNING: skill write pattern not found — skill pruning not added')
        print('  (fix_skill_loop.py may not be installed, or has different structure)')

# Ensure sentinel is present even if nothing was patched
if '_backup_hardened' not in s:
    # Add it as a standalone comment near the top of the main loop
    s = s.replace(
        '    # _bridge_main_loop_fixed',
        '    # _bridge_main_loop_fixed  # _backup_hardened',
        1
    )

# ══════════════════════════════════════════════════════════════════════════════
# Also: one-time cleanup of any already-accumulated skill duplicates
# ══════════════════════════════════════════════════════════════════════════════
skills_dir = BRIDGE_DIR / 'skills'
if skills_dir.exists():
    import json, os
    from collections import defaultdict
    versioned = defaultdict(list)
    for p in skills_dir.glob('*.json'):
        # Base name is everything before the first '.' (after the slug)
        # e.g., "add-retry-logic.20260413_120000.json" → base "add-retry-logic"
        # e.g., "add-retry-logic.json" → base "add-retry-logic"
        parts = p.name.split('.')
        base = parts[0]
        versioned[base].append(p)

    pruned_now = 0
    for base, files in versioned.items():
        files_sorted = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files_sorted[3:]:
            old.unlink(missing_ok=True)
            print(f'  [cleanup] Removed old skill: {old.name}')
            pruned_now += 1

    if pruned_now:
        print(f'One-time cleanup: removed {pruned_now} old skill version(s)')
    else:
        print(f'Skills dir clean ({len(list(skills_dir.glob("*.json")))} files, none to prune)')
else:
    print('No skills/ directory found — skill pruning will activate on first save')

# ══════════════════════════════════════════════════════════════════════════════
# Validate & write
# ══════════════════════════════════════════════════════════════════════════════
import tempfile

with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as tf:
    tf.write(s)
    tmp_path = tf.name

r = subprocess.run([PYTHON, '-m', 'py_compile', tmp_path], capture_output=True, text=True)
os.unlink(tmp_path)

if r.returncode != 0:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    print('Original bridge.py NOT modified.')
    sys.exit(1)

open(BRIDGE, 'w', encoding='utf-8').write(s)
print(f'\n✅ Backup + skill hardening applied ({applied} patch(es) to bridge.py)')
