#!/usr/bin/env python3
"""
fix_syntax.py — Repair the SyntaxError in bridge.py (unterminated string literal).

Root cause: fix_hermes.py's ARCHIVIST_CODE triple-quoted string contained
prompt lines like  "- topic: one-line context\\n\\n" .  When the triple-quoted
string was written to bridge.py, each \\n in the triple-quoted value became a
real backslash-n character pair, which is valid — BUT if any \\n was
accidentally a real newline (0x0A) it splits the double-quoted string across
two physical lines, producing an unterminated-string SyntaxError.

This script:
  1. Compiles bridge.py to confirm / locate the error.
  2. Shows context around the bad line.
  3. Scans for lines that are truncated double-quoted strings whose continuation
     is on the next line (just  \\n"  or  \\n\\n" ).
  4. Merges each such pair back into a single valid line.
  5. Re-validates with py_compile; restores original on failure.
"""
import subprocess, sys, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'


def compile_check(path):
    r = subprocess.run([PYTHON, '-m', 'py_compile', path],
                       capture_output=True, text=True)
    return r.returncode == 0, r.stderr.strip()


def show_context(lines, err_line, radius=12):
    start = max(0, err_line - radius - 1)
    end   = min(len(lines), err_line + radius)
    print(f'\n=== Context around line {err_line} ===')
    for i in range(start, end):
        marker = '>>>' if i + 1 == err_line else '   '
        print(f'{marker} {i+1:4}: {repr(lines[i])}')


# ── Read ──────────────────────────────────────────────────────────────────────
raw = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = raw

ok, err_msg = compile_check(BRIDGE)
if ok:
    print('✅ bridge.py already compiles fine — no fix needed.')
    sys.exit(0)

print(f'Compile error:\n  {err_msg}')

# Extract error line number
m_line = re.search(r'line (\d+)', err_msg)
err_line = int(m_line.group(1)) if m_line else None

lines = raw.splitlines(keepends=True)

if err_line:
    show_context(lines, err_line)

# ── Auto-fix strategy 1: join orphaned \\n" continuation lines ────────────────
# Broken pattern (two physical lines in bridge.py):
#
#   line i  : '                "- topic: one-line context\n'   ← real NL inside "
#   line i+1: '\\n"\n'                                         ← orphaned tail
#
# Fixed (one line):
#   '                "- topic: one-line context\\n"\n'
#
# The orphan tail matches:  optional-whitespace  (\\n)+ " [optional , or )] newline

ORPHAN_RE = re.compile(r'^\s*(\\n)+"[,):]?\s*$')

fixed = 0
new_lines = list(lines)
i = 0
while i < len(new_lines) - 1:
    curr = new_lines[i]
    nxt  = new_lines[i + 1]

    if ORPHAN_RE.match(nxt):
        # Make sure curr actually looks like an unterminated string opener
        curr_stripped = curr.rstrip('\n\r')
        # The current line should contain an opening " somewhere and not close it
        # Quick heuristic: ends without a closing "  (not "  or ",  or "(  etc.)
        last_char = curr_stripped.rstrip()[-1:] if curr_stripped.strip() else ''
        if last_char not in ('"', "'", ',', '(', ')'):
            nxt_stripped = nxt.strip()   # e.g.  \\n"  or  \\n\\n",
            merged = curr_stripped + nxt_stripped + '\n'
            print(f'\n✎ Merging split string at lines {i+1}/{i+2}:')
            print(f'   before[{i+1}]: {repr(curr)}')
            print(f'   before[{i+2}]: {repr(nxt)}')
            print(f'   after  [{i+1}]: {repr(merged)}')
            new_lines[i]     = merged
            new_lines[i + 1] = ''
            fixed += 1
            i += 2
            continue
    i += 1

if fixed == 0:
    # ── Auto-fix strategy 2: replace the whole archivist prompt block ──────────
    # Find _do_archive function and replace its prompt string with a triple-quoted
    # version that is immune to the newline problem.
    print('\nStrategy 1 found no patterns — trying strategy 2 (replace archivist prompt).')

    DO_ARCHIVE = 'def _do_archive(snap):'
    da_pos = s.find(DO_ARCHIVE) if 's' in dir() else raw.find(DO_ARCHIVE)
    src = raw

    if DO_ARCHIVE in src:
        # Find the prompt = ( ... ) block
        prompt_start = src.find('prompt = (', src.find(DO_ARCHIVE))
        if prompt_start != -1:
            prompt_end = src.find('\n            )\n', prompt_start)
            if prompt_end != -1:
                prompt_end += len('\n            )\n')
                indent = '            '
                new_prompt = (
                    indent + 'prompt = (\n'
                    + indent + '    "Extract structured knowledge from this conversation for Obsidian archival.\\n\\n"\n'
                    + indent + '    f"CONVERSATION:\\n{conv_text}\\n\\n"\n'
                    + indent + '    "Output ONLY a valid Obsidian markdown note with this exact structure "\n'
                    + indent + '    "(replace DATE with today\'s ISO date):\\n\\n"\n'
                    + indent + '    "---\\ndate: DATE\\ntags: [tag1, tag2, tag3]\\n---\\n\\n"\n'
                    + indent + '    "## Summary\\n"\n'
                    + indent + '    "2-3 sentence summary of what was discussed and decided.\\n\\n"\n'
                    + indent + '    "## Key Topics\\n- topic: one-line context\\n\\n"\n'
                    + indent + '    "## Entities\\n- Name/Project/Tool: brief context\\n\\n"\n'
                    + indent + '    "## Decisions & Actions\\n"\n'
                    + indent + '    "- [ ] action item (write None if none)\\n\\n"\n'
                    + indent + '    "## Vault Connections\\n"\n'
                    + indent + '    "- [[possible related note]] (write None if none)"\n'
                    + indent + ')\n'
                )
                old_prompt = src[prompt_start:prompt_end]
                new_src = src.replace(old_prompt, new_prompt, 1)
                open(BRIDGE, 'w').write(new_src)
                ok3, err3 = compile_check(BRIDGE)
                if ok3:
                    print('✅ Strategy 2: replaced archivist prompt — bridge.py compiles OK.')
                    sys.exit(0)
                else:
                    print(f'Strategy 2 also failed: {err3}')
                    open(BRIDGE, 'w').write(orig)

    print('\n⚠  Both auto-fix strategies failed.')
    print('Manual inspection required. Lines around error:')
    if err_line:
        show_context(lines, err_line, radius=20)
    sys.exit(1)

# ── Write strategy-1 result & validate ───────────────────────────────────────
print(f'\nMerged {fixed} split string(s).')
fixed_src = ''.join(new_lines)
open(BRIDGE, 'w').write(fixed_src)

ok2, err2 = compile_check(BRIDGE)
if ok2:
    print('✅ bridge.py now compiles OK.')
else:
    print(f'\nStill has errors after merge:\n  {err2}')
    lines2 = fixed_src.splitlines(keepends=True)
    m2 = re.search(r'line (\d+)', err2)
    if m2:
        show_context(lines2, int(m2.group(1)))
    open(BRIDGE, 'w').write(orig)
    print('\nRestored original — no changes applied.')
    sys.exit(1)
