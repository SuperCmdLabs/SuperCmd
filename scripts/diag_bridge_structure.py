#!/usr/bin/env python3
"""
diag_bridge_structure.py — Show key sections of bridge.py needed to write
the soul.md + auto-vault-search fix.
"""
import pathlib, re, sys

bridge = pathlib.Path.home() / "cowork-bridge" / "bridge.py"
if not bridge.exists():
    print(f"ERROR: {bridge} not found"); sys.exit(1)

src = bridge.read_text()
lines = src.splitlines()

def show_block(label, start, end):
    print(f"\n{'='*60}")
    print(f"  {label}  (lines {start+1}–{end+1})")
    print('='*60)
    for i, l in enumerate(lines[start:end+1], start+1):
        print(f"{i:4}: {l}")

def find_line(pattern, start=0):
    rx = re.compile(pattern)
    for i, l in enumerate(lines[start:], start):
        if rx.search(l): return i
    return -1

# 1. SYSTEM_PROMPT definition (already seen) — find where {memory} is filled
mem_format = find_line(r'memory.*format|format.*memory|\.format\(.*now|\.format\(.*memory')
if mem_format >= 0:
    show_block("SYSTEM_PROMPT.format() call", max(0,mem_format-3), min(len(lines)-1,mem_format+15))
else:
    print("\n[!] Could not find SYSTEM_PROMPT.format() — searching for 'memory':")
    for i, l in enumerate(lines):
        if '{memory}' in l or 'memory=' in l:
            print(f"  {i+1}: {l}")

# 2. Where vault/obsidian search happens
vault_fn = find_line(r'def.*search_vault|def.*vault_search|def.*search_obsidian')
if vault_fn >= 0:
    show_block("search_vault function", vault_fn, min(len(lines)-1, vault_fn+30))

# 3. The tool dispatch for search_vault
dispatch = find_line(r"search_vault|vault.*search", vault_fn+1 if vault_fn>=0 else 0)
if dispatch >= 0:
    show_block("search_vault dispatch/call site", max(0,dispatch-2), min(len(lines)-1,dispatch+8))

# 4. Main message processing — where ollama is called
ollama_call = find_line(r'call_ollama|ollama.*generate|ask_ollama|def call_llm|def ask_llm|stream_ollama')
if ollama_call >= 0:
    show_block("Ollama call function", ollama_call, min(len(lines)-1, ollama_call+40))

# 5. The memory/context builder
ctx_builder = find_line(r'def.*build.*context|def.*get.*context|def.*make.*context|def.*build.*memory|def.*get.*memory|recent_context|context_str')
if ctx_builder >= 0:
    show_block("Context builder", ctx_builder, min(len(lines)-1, ctx_builder+30))

# 6. Existing soul/persona file references
for i, l in enumerate(lines):
    if any(k in l.lower() for k in ['soul', 'persona', 'about.md', 'profile.md', 'user_profile']):
        print(f"\n[soul/persona reference] {i+1}: {l}")

# 7. VAULT_PATH / obsidian path constant
for i, l in enumerate(lines[:100]):
    if any(k in l.upper() for k in ['VAULT', 'OBSIDIAN', 'VAULT_PATH']):
        print(f"\n[vault path] {i+1}: {l}")

print("\n\nDone.")
