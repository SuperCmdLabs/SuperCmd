#!/usr/bin/env python3
"""
diag_memory_system2.py — Targeted diagnostic showing key bridge.py sections.

Shows:
  1. Lines 148–215  (retrieve_memories / hybrid search function body)
  2. Lines 490–530  (the non-vault semantic search)
  3. Lines 730–800  (our injected search_vault at line 735)
  4. Lines 1055–1115 (tool definitions: original + our duplicate)
  5. Lines 1165–1230 (dispatch: original if + our shadowed elif)
  6. Lines 3915–3940 (retrieve_memories call site in message loop)

Bridge.py is NOT modified.
"""
import pathlib, sys

HOME       = pathlib.Path.home()
BRIDGE     = str(HOME / 'cowork-bridge' / 'bridge.py')

try:
    lines = open(BRIDGE, encoding='utf-8', errors='replace').read().splitlines()
except FileNotFoundError:
    print(f'ERROR: {BRIDGE} not found'); sys.exit(1)

def show(label, start, end):
    print(f'\n{"="*70}')
    print(f'  {label}  (lines {start}–{end})')
    print('='*70)
    for i in range(start-1, min(end, len(lines))):
        print(f'  {i+1:5d}: {lines[i]}')

show('retrieve_memories / hybrid search body', 148, 215)
show('non-vault semantic search (line ~500)', 490, 530)
show('our injected search_vault fn (line 735)', 730, 800)
show('tool definitions: search_vault x2', 1055, 1115)
show('dispatch: original if + shadowed elif', 1165, 1235)
show('retrieve_memories call + memory injection', 3915, 3945)
