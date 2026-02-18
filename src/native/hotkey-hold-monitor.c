/**
 * hotkey-hold-monitor.c — Windows global keyboard-hold monitor
 *
 * Installs a WH_KEYBOARD_LL hook, monitors a specific key + modifier
 * combination, and emits newline-delimited JSON to stdout:
 *
 *   {"ready":true}                         — hook installed successfully
 *   {"pressed":true}                       — target key + mods pressed
 *   {"released":true,"reason":"key-up"}    — target key released
 *   {"released":true,"reason":"modifier-up"} — a required modifier released
 *   {"error":"..."}                        — fatal error, exits non-zero
 *
 * Arguments:
 *   <cgKeyCode> <cmd:0|1> <ctrl:0|1> <alt:0|1> <shift:0|1> <fn:0|1>
 *
 * cgKeyCode is the macOS CGKeyCode used by parseHoldShortcutConfig in
 * main.ts. This file maps it to a Windows Virtual Key code.
 * The "cmd" and "fn" arguments are accepted but ignored (Windows has no
 * Command or Fn keys at the Win32 API level).
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>

/* ── macOS CGKeyCode → Windows Virtual Key code ─────────────────────────── */

static int cg_to_vk(int cg) {
    switch (cg) {
        /* Letters (ANSI layout) */
        case  0: return 'A';
        case 11: return 'B';
        case  8: return 'C';
        case  2: return 'D';
        case 14: return 'E';
        case  3: return 'F';
        case  5: return 'G';
        case  4: return 'H';
        case 34: return 'I';
        case 38: return 'J';
        case 40: return 'K';
        case 37: return 'L';
        case 46: return 'M';
        case 45: return 'N';
        case 31: return 'O';
        case 35: return 'P';
        case 12: return 'Q';
        case 15: return 'R';
        case  1: return 'S';
        case 17: return 'T';
        case 32: return 'U';
        case  9: return 'V';
        case 13: return 'W';
        case  7: return 'X';
        case 16: return 'Y';
        case  6: return 'Z';
        /* Digits */
        case 18: return '1';
        case 19: return '2';
        case 20: return '3';
        case 21: return '4';
        case 23: return '5';
        case 22: return '6';
        case 26: return '7';
        case 28: return '8';
        case 25: return '9';
        case 29: return '0';
        /* Punctuation */
        case 24: return VK_OEM_PLUS;   /* = */
        case 27: return VK_OEM_MINUS;  /* - */
        case 30: return VK_OEM_6;      /* ] */
        case 33: return VK_OEM_4;      /* [ */
        case 39: return VK_OEM_7;      /* ' */
        case 41: return VK_OEM_1;      /* ; */
        case 42: return VK_OEM_5;      /* \ */
        case 43: return VK_OEM_COMMA;  /* , */
        case 44: return VK_OEM_2;      /* / */
        case 47: return VK_OEM_PERIOD; /* . */
        case 50: return VK_OEM_3;      /* ` */
        /* Special keys */
        case 36: return VK_RETURN;
        case 48: return VK_TAB;
        case 49: return VK_SPACE;
        case 53: return VK_ESCAPE;
        /* Fn (63): not exposed by Win32 — return -1 */
        default: return -1;
    }
}

/* ── Global state ────────────────────────────────────────────────────────── */

static HHOOK g_hook       = NULL;
static int   g_vk         = -1;
static int   g_need_ctrl  = 0;
static int   g_need_alt   = 0;
static int   g_need_shift = 0;
static int   g_pressed    = 0;

static void emit(const char *json) {
    printf("%s\n", json);
    fflush(stdout);
}

/* ── Low-level keyboard hook ─────────────────────────────────────────────── */

static LRESULT CALLBACK kbhook(int nCode, WPARAM wp, LPARAM lp) {
    if (nCode == HC_ACTION) {
        KBDLLHOOKSTRUCT *kb = (KBDLLHOOKSTRUCT *)lp;
        int vk    = (int)kb->vkCode;
        int ctrl  = (GetAsyncKeyState(VK_CONTROL) & 0x8000) ? 1 : 0;
        int alt   = (GetAsyncKeyState(VK_MENU)    & 0x8000) ? 1 : 0;
        int shift = (GetAsyncKeyState(VK_SHIFT)   & 0x8000) ? 1 : 0;

        if (wp == WM_KEYDOWN || wp == WM_SYSKEYDOWN) {
            if (!g_pressed && vk == g_vk &&
                ctrl  == g_need_ctrl &&
                alt   == g_need_alt  &&
                shift == g_need_shift) {
                g_pressed = 1;
                emit("{\"pressed\":true}");
            }
        } else if (wp == WM_KEYUP || wp == WM_SYSKEYUP) {
            if (g_pressed) {
                if (vk == g_vk) {
                    emit("{\"released\":true,\"reason\":\"key-up\"}");
                    PostQuitMessage(0);
                } else {
                    /* A required modifier key was released */
                    int mods_ok = (ctrl  == g_need_ctrl) &&
                                  (alt   == g_need_alt)  &&
                                  (shift == g_need_shift);
                    if (!mods_ok) {
                        emit("{\"released\":true,\"reason\":\"modifier-up\"}");
                        PostQuitMessage(0);
                    }
                }
            }
        }
    }
    return CallNextHookEx(g_hook, nCode, wp, lp);
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

int main(int argc, char *argv[]) {
    if (argc < 7) {
        emit("{\"error\":\"Usage: hotkey-hold-monitor cgKeyCode cmd ctrl alt shift fn\"}");
        return 1;
    }

    int cg_code = atoi(argv[1]);
    /* argv[2] = cmd  — no Command key on Windows; ignored */
    g_need_ctrl  = strcmp(argv[3], "1") == 0 ? 1 : 0;
    g_need_alt   = strcmp(argv[4], "1") == 0 ? 1 : 0;
    g_need_shift = strcmp(argv[5], "1") == 0 ? 1 : 0;
    /* argv[6] = fn   — not exposed by Win32; ignored */

    g_vk = cg_to_vk(cg_code);
    if (g_vk < 0) {
        emit("{\"error\":\"Key code not supported on Windows\"}");
        return 1;
    }

    g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, kbhook,
                               GetModuleHandleW(NULL), 0);
    if (!g_hook) {
        emit("{\"error\":\"SetWindowsHookEx failed\"}");
        return 2;
    }

    emit("{\"ready\":true}");

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    UnhookWindowsHookEx(g_hook);
    return 0;
}
