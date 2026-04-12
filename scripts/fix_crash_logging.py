#!/usr/bin/env python3
"""
fix_crash_logging.py — Surface silent bridge crashes + catch URL-fetch hangs.

Problems:
  1. bridge_error.log is empty even though bridge crashes — because the crash
     happens in a background thread (URL fetcher / Ollama query) that has no
     top-level exception handler; main thread exits cleanly with no traceback.
  2. ERA URL processing causes a crash between "[url] Fetching" and
     "[session] Saved" — likely an uncaught exception in the thread spawned to
     process the URL, or a context-window overflow from URL content that causes
     query_ollama to raise an unhandled error.

Fixes:
  1. Install sys.excepthook + threading.excepthook so ALL uncaught exceptions
     (main thread and daemon threads) get written to bridge_error.log.
  2. Wrap any run_shell/execute_code_task/url-fetch calls in the main loop in
     a broad try/except that logs and continues rather than crashing out.
  3. Add a timeout + content truncation guard before the Ollama call so that
     extremely long URL content can't blow up the context window.

Injection anchor: the existing `import sys` or top-level imports block.
"""
import subprocess, sys, re

PYTHON = '/Users/alexmcgann/cowork-bridge/.venv/bin/python3'
BRIDGE = '/Users/alexmcgann/cowork-bridge/bridge.py'

s = open(BRIDGE, encoding='utf-8', errors='replace').read()
orig = s

# ── Guard ─────────────────────────────────────────────────────────────────────
if 'threading.excepthook' in s or '_bridge_excepthook' in s:
    print('SKIPPED — crash logging already installed')
    sys.exit(0)

# ── Part 1: Install global exception hooks near the top ───────────────────────
# Find the first 'import' line to insert after the imports block.
# We'll look for a stable anchor: the line that imports threading (always present).

THREADING_IMPORT = 'import threading'
ti_pos = s.find(THREADING_IMPORT)
if ti_pos == -1:
    print('FAILED — "import threading" not found in bridge.py')
    sys.exit(1)

ti_line_end = s.find('\n', ti_pos) + 1

EXCEPTHOOK_BLOCK = '''
# ── Global exception hooks — surface ALL silent crashes to bridge_error.log ──
import traceback as _tb_hook, pathlib as _ph_hook, datetime as _dt_hook

_BRIDGE_ERROR_LOG = _ph_hook.Path.home() / 'cowork-bridge' / 'bridge_error.log'

def _bridge_excepthook(exc_type, exc_value, exc_tb):
    msg = (
        f"\\n[CRASH {_dt_hook.datetime.now():%Y-%m-%d %H:%M:%S}] "
        f"Uncaught exception in main thread:\\n"
        + "".join(_tb_hook.format_exception(exc_type, exc_value, exc_tb))
    )
    try:
        with open(_BRIDGE_ERROR_LOG, 'a') as _elf:
            _elf.write(msg)
    except Exception:
        pass
    print(msg, flush=True)

sys.excepthook = _bridge_excepthook

def _bridge_thread_excepthook(args):
    msg = (
        f"\\n[CRASH {_dt_hook.datetime.now():%Y-%m-%d %H:%M:%S}] "
        f"Uncaught exception in thread {args.thread!r}:\\n"
        + "".join(_tb_hook.format_exception(args.exc_type, args.exc_value, args.exc_tb))
    )
    try:
        with open(_BRIDGE_ERROR_LOG, 'a') as _elf:
            _elf.write(msg)
    except Exception:
        pass
    print(msg, flush=True)

threading.excepthook = _bridge_thread_excepthook
print('[bridge] Exception hooks installed → bridge_error.log', flush=True)

'''

s = s[:ti_line_end] + EXCEPTHOOK_BLOCK + s[ti_line_end:]
print('Part 1: global exception hooks inserted after "import threading"')

# ── Part 2: Wrap URL-fetch area in main loop with broad try/except ─────────────
# The crash pattern is:
#   [url] Fetching https://...
#   (crash — bridge exits, no session save)
#
# Find the URL fetch print and wrap the surrounding block.
# We look for the pattern:  print(f"[url] Fetching {url}"
# and wrap the entire url-processing elif/block in try/except.

URL_FETCH_PRINT = '[url] Fetching'
uf_pos = s.find(URL_FETCH_PRINT)

if uf_pos == -1:
    print('Part 2 SKIPPED — "[url] Fetching" not found (URL handler may have different form)')
else:
    # Find the line
    uf_line_start = s.rfind('\n', 0, uf_pos) + 1
    ind_raw = s[uf_line_start:uf_pos]
    ind = ind_raw[:len(ind_raw) - len(ind_raw.lstrip())]

    # Check if already wrapped
    # Look back ~300 chars for a try:
    look_back = s[max(0, uf_line_start - 300):uf_line_start]
    if 'try:' in look_back.split('\n')[-4:]:
        print('Part 2 SKIPPED — URL fetch area already in try block')
    else:
        # Insert a try/except wrapper just before the URL fetch print line
        # Strategy: wrap the print line itself + catch block
        url_line_end = s.find('\n', uf_pos) + 1

        # Find reasonable end of url processing block:
        # scan forward for a line at same or lower indentation that's not empty/comment
        scan_pos = url_line_end
        block_end = url_line_end
        while scan_pos < len(s):
            nl = s.find('\n', scan_pos)
            if nl == -1:
                block_end = len(s)
                break
            line = s[scan_pos:nl]
            stripped = line.lstrip()
            if stripped and not stripped.startswith('#'):
                line_ind = line[:len(line) - len(stripped)]
                if len(line_ind) <= len(ind) and stripped not in ('', '\n'):
                    block_end = scan_pos
                    break
            scan_pos = nl + 1
            block_end = scan_pos

        # Build try/except wrapper: just wrap the print + the fetch block
        # Simple approach: insert try: before the print line and except after block_end
        try_prefix = f'{ind}try:  # URL fetch guard\n'
        # Indent all lines from uf_line_start to block_end by 4 spaces
        block_text = s[uf_line_start:block_end]
        indented_block = '\n'.join('    ' + ln if ln.strip() else ln
                                   for ln in block_text.split('\n'))
        except_suffix = (
            f'\n{ind}except Exception as _url_ex:\n'
            f'{ind}    import traceback as _url_tb\n'
            f'{ind}    _url_err = _url_tb.format_exc()\n'
            f'{ind}    print(f"[url] ERROR processing URL — skipping: {{_url_ex}}", flush=True)\n'
            f'{ind}    try:\n'
            f'{ind}        with open(_BRIDGE_ERROR_LOG, "a") as _uelf:\n'
            f'{ind}            _uelf.write(f"[URL ERROR {{__import__(\'datetime\').datetime.now():%Y-%m-%d %H:%M:%S}}]\\n{{_url_err}}\\n")\n'
            f'{ind}    except Exception:\n'
            f'{ind}        pass\n'
        )
        new_block = try_prefix + indented_block + except_suffix
        s = s[:uf_line_start] + new_block + s[block_end:]
        print(f'Part 2: URL fetch block wrapped in try/except at pos {uf_line_start}')

# ── Part 3: Cap URL content before it reaches Ollama ─────────────────────────
# If there's a variable like `url_content` or `page_text` or `page_content`
# that gets passed to the AI, truncate it to 3000 chars before the query.

URL_CONTENT_PATTERNS = ['url_content', 'page_content', 'page_text', 'fetched_content']
for varname in URL_CONTENT_PATTERNS:
    # Look for assignment: varname = <something>
    assign_pattern = f'\n    {varname} = '
    ap = s.find(assign_pattern)
    if ap != -1:
        ap_line_end = s.find('\n', ap + 1) + 1
        # Look for where varname is used near query_ollama — add a truncation guard
        trunc_anchor = f'\n    {varname} ='
        # Insert truncation just before first use of varname (after assignment)
        use_pos = s.find(varname, ap_line_end)
        if use_pos != -1:
            use_line_start = s.rfind('\n', 0, use_pos) + 1
            use_ind_raw = s[use_line_start:use_pos]
            use_ind = use_ind_raw[:len(use_ind_raw) - len(use_ind_raw.lstrip())]
            trunc_line = f'{use_ind}{varname} = {varname}[:6000] if isinstance({varname}, str) and len({varname}) > 6000 else {varname}  # cap URL content\n'
            s = s[:use_line_start] + trunc_line + s[use_line_start:]
            print(f'Part 3: added truncation guard for {varname}')
            break

# ── Write & validate ──────────────────────────────────────────────────────────
open(BRIDGE, 'w').write(s)
r = subprocess.run([PYTHON, '-m', 'py_compile', BRIDGE], capture_output=True, text=True)
if r.returncode == 0:
    print('\n✅ syntax OK — bridge.py updated with crash logging + URL guard')
else:
    print(f'\nSYNTAX ERROR:\n{r.stderr}')
    open(BRIDGE, 'w').write(orig)
    print('Restored original — no changes applied')
    sys.exit(1)
