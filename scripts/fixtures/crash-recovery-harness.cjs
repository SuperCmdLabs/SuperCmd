// Electron harness that reproduces the blank-window bug end to end:
//
//   1. Open a hidden (offscreen) window and render visible content.
//   2. Crash its renderer for real with process.crash() — the same way an
//      extension OOM / native crash kills the launcher renderer.
//   3. Let the REAL production recovery logic (renderer-recovery.ts) decide to
//      reload, mirroring what main.ts does on 'render-process-gone'.
//   4. Assert the window comes back and paints content again (not blank).
//
// Prints a single line `RESULT <json>` to stdout for the test runner to parse,
// then quits.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

// Load the REAL production decision logic by transpiling the .ts on the fly.
function loadRendererRecovery() {
  const tsPath = path.join(__dirname, '..', '..', 'src', 'main', 'renderer-recovery.ts');
  const { code } = esbuild.transformSync(fs.readFileSync(tsPath, 'utf8'), {
    loader: 'ts',
    format: 'cjs',
  });
  const module = { exports: {} };
  new Function('exports', 'require', 'module', code)(module.exports, require, module);
  return module.exports;
}

const { getRendererCrashState, evaluateRendererCrash, RENDERER_RECOVERY_DELAY_MS } =
  loadRendererRecovery();

// A tiny page that announces it mounted, then crashes itself on request.
const PAGE = `<!doctype html><html><body><div id="status">RENDERED</div>
<script>
  const { ipcRenderer } = require('electron');
  ipcRenderer.send('mounted');
  ipcRenderer.on('crash-now', () => { process.crash(); });
</script></body></html>`;
const PAGE_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(PAGE);

function finish(result) {
  process.stdout.write('RESULT ' + JSON.stringify(result) + '\n');
  // Give stdout a tick to flush before tearing down.
  setTimeout(() => app.quit(), 50);
}

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  let mountCount = 0;
  let crashObserved = false;
  let crashState = getRendererCrashState();
  const watchdog = setTimeout(
    () => finish({ ok: false, error: 'timeout', mountCount, crashObserved }),
    15000,
  );

  ipcMain.on('mounted', async (event) => {
    if (event.sender !== win.webContents) return;
    mountCount += 1;

    if (mountCount === 1) {
      // First healthy render — now crash the renderer for real.
      win.webContents.send('crash-now');
      return;
    }

    // Second mount = the window recovered after the crash. Prove it's not blank
    // by reading the DOM the recovered renderer actually painted.
    try {
      const text = await win.webContents.executeJavaScript(
        "document.getElementById('status') && document.getElementById('status').innerText",
      );
      clearTimeout(watchdog);
      finish({ ok: text === 'RENDERED' && crashObserved, crashObserved, mountCount, paintedText: text });
    } catch (err) {
      clearTimeout(watchdog);
      finish({ ok: false, error: String(err), crashObserved, mountCount });
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    const reason = String((details && details.reason) || 'unknown');
    crashObserved = true;
    // Run the SAME decision the production handler runs.
    const decision = evaluateRendererCrash(crashState, reason, Date.now());
    crashState = decision.nextState;
    if (!decision.reload) {
      clearTimeout(watchdog);
      finish({ ok: false, error: 'recovery-declined', reason, mountCount });
      return;
    }
    // Deferred reload, exactly like main.ts.
    setTimeout(() => {
      if (win.isDestroyed()) return;
      win.loadURL(PAGE_URL);
    }, RENDERER_RECOVERY_DELAY_MS);
  });

  win.loadURL(PAGE_URL);
});

// Don't let the app stay alive on its own if something goes sideways.
app.on('window-all-closed', () => app.quit());
