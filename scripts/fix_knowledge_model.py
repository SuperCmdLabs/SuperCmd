#!/usr/bin/env python3
"""
fix_knowledge_model.py — Stop forcing hermes3 in _process_knowledge_queue().

The bridge is configured to use gemma4:latest (working fine for morning briefs
and nightly reviews). _process_knowledge_queue() was forcing hermes3 via
model=MODELS.get('archivist', 'hermes3'), and hermes3 keeps returning HTTP 500
on the larger knowledge extraction prompts.

Fix: remove the model override — let query_ollama use the bridge's default.
"""
import pathlib, subprocess, sys

HOME   = pathlib.Path.home()
PYTHON = str(HOME / 'cowork-bridge' / '.venv' / 'bin' / 'python3')
BRIDGE = str(HOME / 'cowork-bridge' / 'bridge.py')

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

OLD = "        _result = query_ollama(_msgs, model=MODELS.get('archivist', 'hermes3'))"
NEW = "        _result = query_ollama(_msgs)  # use bridge default model (gemma4)"

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('Patched: removed hermes3 model override from _process_knowledge_queue')
else:
    # Try with slightly different spacing/quoting
    import re
    m = re.search(r"_result = query_ollama\(_msgs,\s*model=MODELS\.get\(['\"]archivist['\"],\s*['\"]hermes3['\"][^)]*\)\)", s)
    if m:
        s = s[:m.start()] + "_result = query_ollama(_msgs)  # use bridge default model" + s[m.end():]
        print('Patched (regex): removed hermes3 model override')
    else:
        # Show what we have
        idx = s.find('_process_knowledge_queue')
        if idx != -1:
            oidx = s.find('query_ollama(_msgs', idx)
            if oidx != -1:
                print(f'Found query_ollama call: {repr(s[oidx:oidx+80])}')
                # Replace whatever model= arg is there
                new_s = re.sub(
                    r'(query_ollama\(_msgs)[^)]*\)',
                    r'\1)',
                    s[oidx:oidx+120]
                )
                s = s[:oidx] + new_s + s[oidx+120:]
                print('Patched (broad regex): stripped model= arg from query_ollama call')
            else:
                print('ERROR: query_ollama(_msgs call not found in _process_knowledge_queue')
                sys.exit(1)

open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('✅ syntax OK')
else:
    print(f'SYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    sys.exit(1)
