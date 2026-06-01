/**
 * constants.ts
 *
 * Shared string keys and magic numbers used across the renderer.
 * - localStorage keys for extension prefs, command args, hidden menu-bar entries, recent commands
 * - Global error messages and numeric limits
 *
 * Add new app-wide constants here instead of scattering them in individual files.
 */

export const LAST_EXT_KEY = 'sc-last-extension';
export const AI_CHAT_STORAGE_KEY = 'sc.aiChat.conversations';
export const EXT_PREFS_KEY_PREFIX = 'sc-ext-prefs:';
export const CMD_PREFS_KEY_PREFIX = 'sc-ext-cmd-prefs:';
export const CMD_ARGS_KEY_PREFIX = 'sc-ext-cmd-args:';
export const SCRIPT_CMD_ARGS_KEY_PREFIX = 'sc-script-cmd-args:';
export const HIDDEN_MENUBAR_CMDS_KEY = 'sc-hidden-menubar-cmds';
export const LAST_LAUNCHER_QUERY_KEY = 'sc-last-launcher-query';
export const MAX_LAUNCHER_QUERY_HISTORY = 50;
export const MAX_RECENT_COMMANDS = 30;
export const NO_AI_MODEL_ERROR = 'No AI model available. Configure one in Settings -> AI.';
