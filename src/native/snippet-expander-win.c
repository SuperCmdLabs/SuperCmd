/**
 * snippet-expander-win.c
 *
 * Windows global snippet keyword watcher.
 *
 * Args:
 *   <keywords-json>
 *
 * Emits newline-delimited JSON payloads to stdout:
 *   {"ready":true}
 *   {"keyword":"sig","delimiter":" "}
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_KEYWORDS 512
#define MAX_KEYWORD_LEN 128
#define MAX_TOKEN_LEN 512

static HHOOK g_hook = NULL;
static char g_keywords[MAX_KEYWORDS][MAX_KEYWORD_LEN + 1];
static int g_keyword_count = 0;
static int g_max_keyword_len = 1;

static unsigned char g_allowed[256];
static unsigned char g_delimiters[256];

static char g_token[MAX_TOKEN_LEN + 1];
static int g_token_len = 0;

static void emit_ready(void) {
    printf("{\"ready\":true}\n");
    fflush(stdout);
}

static void emit_error(const char* msg) {
    printf("{\"error\":\"%s\"}\n", msg ? msg : "unknown");
    fflush(stdout);
}

static int is_modifier_down(void) {
    if (GetAsyncKeyState(VK_CONTROL) & 0x8000) return 1;
    if (GetAsyncKeyState(VK_MENU) & 0x8000) return 1;
    if (GetAsyncKeyState(VK_LWIN) & 0x8000) return 1;
    if (GetAsyncKeyState(VK_RWIN) & 0x8000) return 1;
    return 0;
}

static void clear_token(void) {
    g_token_len = 0;
    g_token[0] = '\0';
}

static void trim_token_to_max(void) {
    if (g_token_len <= g_max_keyword_len) return;
    int keep = g_max_keyword_len;
    int remove = g_token_len - keep;
    memmove(g_token, g_token + remove, (size_t)keep);
    g_token_len = keep;
    g_token[g_token_len] = '\0';
}

static int keyword_index(const char* text) {
    if (!text || !*text) return -1;
    for (int i = 0; i < g_keyword_count; i++) {
        if (strcmp(g_keywords[i], text) == 0) return i;
    }
    return -1;
}

static void json_escape_char(char c, char* out, size_t out_size) {
    if (!out || out_size == 0) return;
    if (c == '\\') snprintf(out, out_size, "\\\\");
    else if (c == '"') snprintf(out, out_size, "\\\"");
    else if (c == '\n') snprintf(out, out_size, "\\n");
    else if (c == '\r') snprintf(out, out_size, "\\r");
    else if (c == '\t') snprintf(out, out_size, "\\t");
    else snprintf(out, out_size, "%c", c);
}

static void emit_keyword(const char* keyword, char delimiter) {
    char delim_escaped[16] = {0};
    json_escape_char(delimiter, delim_escaped, sizeof(delim_escaped));
    printf("{\"keyword\":\"%s\",\"delimiter\":\"%s\"}\n", keyword, delim_escaped);
    fflush(stdout);
}

static void process_char(char raw) {
    unsigned char c = (unsigned char)tolower((unsigned char)raw);

    if (g_allowed[c]) {
        if (g_token_len < MAX_TOKEN_LEN) {
            g_token[g_token_len++] = (char)c;
            g_token[g_token_len] = '\0';
        }
        trim_token_to_max();

        if (keyword_index(g_token) >= 0) {
            emit_keyword(g_token, '\0');
            clear_token();
        }
        return;
    }

    if (g_delimiters[c]) {
        if (g_token_len > 0 && keyword_index(g_token) >= 0) {
            emit_keyword(g_token, (char)c);
        }
        clear_token();
        return;
    }

    clear_token();
}

static void seed_charsets(void) {
    memset(g_allowed, 0, sizeof(g_allowed));
    memset(g_delimiters, 0, sizeof(g_delimiters));

    for (int c = 'a'; c <= 'z'; c++) g_allowed[(unsigned char)c] = 1;
    for (int c = '0'; c <= '9'; c++) g_allowed[(unsigned char)c] = 1;
    g_allowed[(unsigned char)'-'] = 1;
    g_allowed[(unsigned char)'_'] = 1;

    const char* delimiters = " \t\r\n.,!?;:()[]{}<>/\\|@#$%^&*+=`~\"'";
    for (const char* p = delimiters; *p; p++) {
        g_delimiters[(unsigned char)(*p)] = 1;
    }
}

static void apply_keyword_chars_to_charsets(void) {
    for (int i = 0; i < g_keyword_count; i++) {
        const char* kw = g_keywords[i];
        for (int j = 0; kw[j]; j++) {
            unsigned char c = (unsigned char)tolower((unsigned char)kw[j]);
            if (c == '\r' || c == '\n' || c == '\t' || c == ' ') continue;
            g_allowed[c] = 1;
            g_delimiters[c] = 0;
        }
    }
}

static int append_keyword(const char* src) {
    if (!src) return 0;
    if (g_keyword_count >= MAX_KEYWORDS) return 0;

    char buf[MAX_KEYWORD_LEN + 1] = {0};
    int n = 0;
    for (int i = 0; src[i] && n < MAX_KEYWORD_LEN; i++) {
        unsigned char c = (unsigned char)tolower((unsigned char)src[i]);
        buf[n++] = (char)c;
    }
    buf[n] = '\0';
    if (n == 0) return 0;

    for (int i = 0; i < g_keyword_count; i++) {
        if (strcmp(g_keywords[i], buf) == 0) return 1;
    }

    strcpy(g_keywords[g_keyword_count++], buf);
    if (n > g_max_keyword_len) g_max_keyword_len = n;
    return 1;
}

static int parse_keywords_json(const char* json) {
    if (!json) return 0;
    int in_string = 0;
    int escaped = 0;
    char current[MAX_KEYWORD_LEN + 1] = {0};
    int cur_len = 0;

    for (const char* p = json; *p; p++) {
        char ch = *p;
        if (!in_string) {
            if (ch == '"') {
                in_string = 1;
                escaped = 0;
                cur_len = 0;
                current[0] = '\0';
            }
            continue;
        }

        if (escaped) {
            char out = ch;
            if (ch == 'n') out = '\n';
            else if (ch == 'r') out = '\r';
            else if (ch == 't') out = '\t';
            if (cur_len < MAX_KEYWORD_LEN) {
                current[cur_len++] = out;
                current[cur_len] = '\0';
            }
            escaped = 0;
            continue;
        }

        if (ch == '\\') {
            escaped = 1;
            continue;
        }

        if (ch == '"') {
            in_string = 0;
            append_keyword(current);
            continue;
        }

        if (cur_len < MAX_KEYWORD_LEN) {
            current[cur_len++] = ch;
            current[cur_len] = '\0';
        }
    }

    return g_keyword_count > 0;
}

static void process_key_event(DWORD vk, DWORD scan_code) {
    if (vk == VK_BACK) {
        if (g_token_len > 0) {
            g_token_len--;
            g_token[g_token_len] = '\0';
        }
        return;
    }

    if (is_modifier_down()) {
        clear_token();
        return;
    }

    BYTE key_state[256];
    memset(key_state, 0, sizeof(key_state));
    if (!GetKeyboardState(key_state)) {
        clear_token();
        return;
    }

    key_state[vk] |= 0x80;

    WCHAR wbuf[8];
    HKL layout = GetKeyboardLayout(0);
    int rc = ToUnicodeEx((UINT)vk, (UINT)scan_code, key_state, wbuf, 8, 0, layout);
    if (rc <= 0) {
        if (rc < 0) {
            BYTE empty_state[256] = {0};
            WCHAR dummy[8];
            ToUnicodeEx((UINT)vk, (UINT)scan_code, empty_state, dummy, 8, 0, layout);
        }
        return;
    }

    for (int i = 0; i < rc; i++) {
        WCHAR wc = wbuf[i];
        if (wc <= 0 || wc > 127) {
            clear_token();
            continue;
        }
        process_char((char)wc);
    }
}

static LRESULT CALLBACK keyboard_hook(int nCode, WPARAM wp, LPARAM lp) {
    if (nCode == HC_ACTION && (wp == WM_KEYDOWN || wp == WM_SYSKEYDOWN)) {
        KBDLLHOOKSTRUCT* kb = (KBDLLHOOKSTRUCT*)lp;
        process_key_event(kb->vkCode, kb->scanCode);
    }
    return CallNextHookEx(g_hook, nCode, wp, lp);
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        emit_error("Usage: snippet-expander-win <keywords-json>");
        return 1;
    }

    seed_charsets();
    if (!parse_keywords_json(argv[1])) {
        emit_error("Invalid or empty keywords JSON");
        return 1;
    }
    apply_keyword_chars_to_charsets();

    g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_hook, GetModuleHandleW(NULL), 0);
    if (!g_hook) {
        emit_error("SetWindowsHookEx failed");
        return 2;
    }

    emit_ready();

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    UnhookWindowsHookEx(g_hook);
    return 0;
}
