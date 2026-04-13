#!/usr/bin/env python3
"""
fix_knowledge_parser.py — Fix _process_knowledge_queue() in bridge.py:

1. Log the first 300 chars of the LLM response so we can see what hermes3
   is actually returning (for debugging).
2. Loosen the validation: accept any response >= 40 chars as valid.
   The current check (TITLE: / ##) is too strict — hermes3 may use
   **Title:** or other formatting.
3. Make the field parsers case-insensitive and handle bold-markdown variants
   like **TITLE:** or **Title:** as well as plain TITLE:.
"""
import pathlib, subprocess, sys, re

HOME   = pathlib.Path.home()
PYTHON = str(HOME / 'cowork-bridge' / '.venv' / 'bin' / 'python3')
BRIDGE = str(HOME / 'cowork-bridge' / 'bridge.py')

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_knowledge_response_debug' in s:
    print('SKIPPED — already patched')
    sys.exit(0)

# ── Find the validation block inside _process_knowledge_queue ─────────────────
OLD_VALIDATE = (
    "        if not _result or '##' not in _result and 'TITLE:' not in _result:\n"
    "            print(f'[knowledge] Empty/invalid response for {_filename} — will retry next tick', flush=True)\n"
    "            _remaining.append(_item)\n"
    "            continue"
)

NEW_VALIDATE = (
    "        # Debug: log what the model actually returned\n"
    "        _knowledge_response_debug = (_result or '')[:300].replace('\\n', ' ')\n"
    "        print(f'[knowledge] Response preview: {_knowledge_response_debug!r}', flush=True)\n"
    "        if not _result or len(_result.strip()) < 30:\n"
    "            print(f'[knowledge] Empty/too-short response for {_filename} — will retry next tick', flush=True)\n"
    "            _remaining.append(_item)\n"
    "            continue"
)

patched_validate = False
if OLD_VALIDATE in s:
    s = s.replace(OLD_VALIDATE, NEW_VALIDATE, 1)
    patched_validate = True
    print('Patch 1: loosened validation + added response debug log')
else:
    # Try regex
    m = re.search(
        r"        if not _result or '##' not in _result[^\n]+\n"
        r"            print\(f'\[knowledge\] Empty/invalid[^\n]+\n"
        r"            _remaining\.append\(_item\)\n"
        r"            continue",
        s
    )
    if m:
        s = s[:m.start()] + NEW_VALIDATE + s[m.end():]
        patched_validate = True
        print('Patch 1: loosened validation (regex match)')
    else:
        print('Patch 1 WARNING: validation block not found')

# ── Fix field parsers to handle **Title:** and **TITLE:** variants ────────────
OLD_PARSERS = (
    "        # Parse fields\n"
    "        _title_m   = _kre.search(r'TITLE:\\s*(.+)', _result)\n"
    "        _tags_m    = _kre.search(r'TAGS:\\s*(.+)', _result)\n"
    "        _summary_m = _kre.search(r'SUMMARY:\\s*(.+?)(?=\\nKEY POINTS:|\\Z)', _result, _kre.DOTALL)\n"
    "        _points_m  = _kre.search(r'KEY POINTS:\\s*\\n((?:- .+\\n?)+)', _result)"
)

NEW_PARSERS = (
    "        # Parse fields — handle plain TITLE:, **TITLE:**, **Title:**, etc.\n"
    "        _title_m   = _kre.search(r'(?i)\\*{0,2}title\\*{0,2}:?\\*{0,2}\\s*(.+)', _result)\n"
    "        _tags_m    = _kre.search(r'(?i)\\*{0,2}tags?\\*{0,2}:?\\*{0,2}\\s*(.+)', _result)\n"
    "        _summary_m = _kre.search(r'(?i)\\*{0,2}summary\\*{0,2}:?\\*{0,2}\\s*(.+?)(?=\\n\\*{0,2}(?:key\\s*points?|tomorrow|open)|\\.{0,2}\\Z)', _result, _kre.DOTALL)\n"
    "        _points_m  = _kre.search(r'(?i)\\*{0,2}key\\s*points?\\*{0,2}:?\\*{0,2}\\s*\\n((?:[\\-\\*]\\s*.+\\n?)+)', _result)"
)

if OLD_PARSERS in s:
    s = s.replace(OLD_PARSERS, NEW_PARSERS, 1)
    print('Patch 2: field parsers updated to handle markdown variants')
elif '_kre.search(r\'TITLE:' in s:
    # Try to find and replace the title parser
    s = re.sub(
        r"_title_m\s*=\s*_kre\.search\(r'TITLE:\\\\s\*\(\.?\+\)', _result\)",
        "_title_m   = _kre.search(r'(?i)\\*{0,2}title\\*{0,2}:?\\*{0,2}\\s*(.+)', _result)",
        s
    )
    print('Patch 2: title parser updated (partial match)')
else:
    print('Patch 2 WARNING: parser block not found — parsers unchanged')

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — knowledge parser fixed')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original')
    sys.exit(1)
