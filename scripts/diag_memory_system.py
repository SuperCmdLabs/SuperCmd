#!/usr/bin/env python3
"""
diag_memory_system.py — Read and report the existing memory/embedding system in bridge.py.

Prints all lines and function definitions related to:
  - memory, embed, vector, index, cache, similarity, cosine, numpy, faiss, chroma
  - search_vault (our addition)
  - any import of sentence_transformers, sklearn, numpy, faiss, chromadb, etc.

Output is diagnostic only — bridge.py is NOT modified.
"""
import pathlib, re, sys

HOME       = pathlib.Path.home()
BRIDGE_DIR = HOME / 'cowork-bridge'
BRIDGE     = str(BRIDGE_DIR / 'bridge.py')

try:
    lines = open(BRIDGE, encoding='utf-8', errors='replace').read().splitlines()
except FileNotFoundError:
    print(f'ERROR: bridge.py not found at {BRIDGE}')
    sys.exit(1)

print(f'bridge.py: {len(lines)} lines')
print()

KEYWORDS = [
    'embed', 'vector', 'cosine', 'similarity', 'faiss', 'chroma',
    'numpy', 'sklearn', 'sentence_transform', 'memory', 'cached_embed',
    'index', 'reindex', 're-index', 'nomic', 'ollama.*embed',
    'search_vault',  # our addition
]

pattern = re.compile('|'.join(KEYWORDS), re.IGNORECASE)

# Collect matching line numbers
matches = [(i+1, line) for i, line in enumerate(lines) if pattern.search(line)]

print(f'=== Lines matching memory/embedding keywords ({len(matches)} lines) ===')
for lineno, line in matches:
    print(f'  {lineno:5d}: {line.rstrip()}')

print()

# Find all def/class names related to memory
print('=== Function/class definitions related to memory ===')
fn_pattern = re.compile(r'^(def |class |async def )', re.IGNORECASE)
for i, line in enumerate(lines):
    if fn_pattern.match(line) and pattern.search(line):
        print(f'  {i+1:5d}: {line.rstrip()}')

print()

# Show all imports
print('=== All imports ===')
for i, line in enumerate(lines[:100]):  # imports usually near top
    if line.strip().startswith(('import ', 'from ')):
        print(f'  {i+1:5d}: {line.rstrip()}')

print()

# Find memory-related data structures (dict/list names containing 'embed' or 'memory')
print('=== Memory-related variable assignments ===')
var_pattern = re.compile(r'^(embed|memory|vector|index|cache)\w*\s*=', re.IGNORECASE)
for i, line in enumerate(lines):
    if var_pattern.match(line.strip()):
        print(f'  {i+1:5d}: {line.rstrip()}')

print()

# Show context around [memory] log lines
print('=== Context around [memory] log statements ===')
for i, line in enumerate(lines):
    if '[memory]' in line:
        start = max(0, i - 5)
        end   = min(len(lines), i + 6)
        print(f'  --- match at line {i+1} ---')
        for j in range(start, end):
            marker = '>>>' if j == i else '   '
            print(f'  {marker} {j+1:5d}: {lines[j].rstrip()}')
        print()
