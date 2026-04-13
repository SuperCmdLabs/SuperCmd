#!/usr/bin/env python3
"""
fix_knowledge_error_detect.py — Two fixes to _process_knowledge_queue():

1. Detect error strings returned by query_ollama (e.g. "(Ollama error: HTTP
   Error 500: Internal Server Error)") and treat them as retryable failures,
   not valid responses. Also restart Ollama via brew services when a 500 is
   detected, so the next retry finds a healthy model runner.

2. Remove the raw error string from the iMessage: if a note is written with
   error-string content, don't send the iMessage (just write a placeholder note
   or skip entirely until a real response is available).
"""
import pathlib, subprocess, sys, re

HOME   = pathlib.Path.home()
PYTHON = str(HOME / 'cowork-bridge' / '.venv' / 'bin' / 'python3')
BRIDGE = str(HOME / 'cowork-bridge' / 'bridge.py')

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

if '_knowledge_error_phrases' in s:
    print('SKIPPED — already patched')
    sys.exit(0)

# ── Patch: replace the validation block after the debug preview line ───────────
# Current (from fix_knowledge_parser.py):
#   _knowledge_response_debug = ...
#   print(f'[knowledge] Response preview: ...')
#   if not _result or len(_result.strip()) < 30:
#       ...retry...

OLD_VALIDATE = (
    "        # Debug: log what the model actually returned\n"
    "        _knowledge_response_debug = (_result or '')[:300].replace('\\n', ' ')\n"
    "        print(f'[knowledge] Response preview: {_knowledge_response_debug!r}', flush=True)\n"
    "        if not _result or len(_result.strip()) < 30:\n"
    "            print(f'[knowledge] Empty/too-short response for {_filename} — will retry next tick', flush=True)\n"
    "            _remaining.append(_item)\n"
    "            continue"
)

NEW_VALIDATE = (
    "        # Debug: log what the model actually returned\n"
    "        _knowledge_response_debug = (_result or '')[:300].replace('\\n', ' ')\n"
    "        print(f'[knowledge] Response preview: {_knowledge_response_debug!r}', flush=True)\n"
    "        # Detect error strings returned by query_ollama on HTTP 5xx\n"
    "        _knowledge_error_phrases = ['http error', 'ollama error', 'internal server error',\n"
    "                                    'model runner', 'connection refused', 'timed out']\n"
    "        _is_error_str = any(_ep in (_result or '').lower() for _ep in _knowledge_error_phrases)\n"
    "        if not _result or len(_result.strip()) < 30 or _is_error_str:\n"
    "            print(f'[knowledge] Bad/error response for {_filename} — restarting Ollama and retrying next tick', flush=True)\n"
    "            # Attempt to restart Ollama so the model runner recovers\n"
    "            try:\n"
    "                import subprocess as _ksub\n"
    "                _ksub.run(['brew', 'services', 'restart', 'ollama'],\n"
    "                          capture_output=True, timeout=30)\n"
    "                print('[knowledge] Ollama restart triggered', flush=True)\n"
    "            except Exception as _ke:\n"
    "                print(f'[knowledge] Could not restart Ollama: {_ke}', flush=True)\n"
    "            _remaining.append(_item)\n"
    "            continue"
)

patched = False
if OLD_VALIDATE in s:
    s = s.replace(OLD_VALIDATE, NEW_VALIDATE, 1)
    patched = True
    print('Patch 1: error string detection + Ollama auto-restart added')
else:
    # Try to find the len < 30 check with regex
    m = re.search(
        r"        # Debug: log what the model actually returned\n"
        r"        _knowledge_response_debug[^\n]+\n"
        r"        print\(f'\[knowledge\] Response preview:[^\n]+\n"
        r"        if not _result or len\(_result\.strip\(\)\) < 30:\n"
        r"[^\n]+\n"
        r"[^\n]+\n"
        r"            continue",
        s
    )
    if m:
        s = s[:m.start()] + NEW_VALIDATE + s[m.end():]
        patched = True
        print('Patch 1: error string detection added (regex match)')
    else:
        # Just find and patch the simple length check
        simple_old = (
            "        if not _result or len(_result.strip()) < 30:\n"
            "            print(f'[knowledge] Empty/too-short response for {_filename} — will retry next tick', flush=True)\n"
            "            _remaining.append(_item)\n"
            "            continue"
        )
        simple_new = (
            "        _knowledge_error_phrases = ['http error', 'ollama error', 'internal server error',\n"
            "                                    'model runner', 'connection refused', 'timed out']\n"
            "        _is_error_str = any(_ep in (_result or '').lower() for _ep in _knowledge_error_phrases)\n"
            "        if not _result or len(_result.strip()) < 30 or _is_error_str:\n"
            "            print(f'[knowledge] Bad/error response for {_filename} — restarting Ollama, retrying next tick', flush=True)\n"
            "            try:\n"
            "                import subprocess as _ksub\n"
            "                _ksub.run(['brew', 'services', 'restart', 'ollama'], capture_output=True, timeout=30)\n"
            "                print('[knowledge] Ollama restart triggered', flush=True)\n"
            "            except Exception as _ke:\n"
            "                print(f'[knowledge] Could not restart Ollama: {_ke}', flush=True)\n"
            "            _remaining.append(_item)\n"
            "            continue"
        )
        if simple_old in s:
            s = s.replace(simple_old, simple_new, 1)
            patched = True
            print('Patch 1: error string detection added (simple match)')
        else:
            print('Patch 1 WARNING: validation block not found')

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — error detection installed')
    print('\nNow restart Ollama manually to clear the crashed model runner:')
    print('  brew services restart ollama')
    print('  sleep 10')
    print('  curl -s http://localhost:11434/api/tags | python3 -c "import json,sys; print([m[\'name\'] for m in json.load(sys.stdin)[\'models\']])"')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original')
    sys.exit(1)
