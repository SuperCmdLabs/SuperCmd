/**
 * Tool Definitions — provider-agnostic schemas for all agent tools.
 *
 * Each definition describes a tool the LLM can call, its parameters,
 * and whether it requires user confirmation before execution.
 */

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  items?: { type: string };
}

export type ToolCategory =
  | 'shell'
  | 'filesystem'
  | 'clipboard'
  | 'applescript'
  | 'http'
  | 'app_control'
  | 'memory';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: ToolParameter[];
  dangerous: boolean;
  confirmationMessage?: (args: Record<string, any>) => string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ─── Shell ──────────────────────────────────────────────────────
  {
    name: 'exec_command',
    description:
      'Execute a shell command and return stdout, stderr, and exit code. Use this for running CLI tools, scripts, or system commands.',
    category: 'shell',
    parameters: [
      {
        name: 'command',
        type: 'string',
        description: 'The shell command to run (executed via /bin/sh -c)',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (defaults to user home)',
      },
    ],
    dangerous: true,
    confirmationMessage: (args) =>
      `Run shell command:\n\`${String(args.command || '').slice(0, 300)}\``,
  },

  // ─── AppleScript ────────────────────────────────────────────────
  {
    name: 'run_applescript',
    description:
      'Execute AppleScript code on macOS. Useful for automating apps, controlling system UI, sending keystrokes, and interacting with macOS-native features.',
    category: 'applescript',
    parameters: [
      {
        name: 'script',
        type: 'string',
        description: 'The AppleScript source code to execute',
        required: true,
      },
    ],
    dangerous: true,
    confirmationMessage: (args) =>
      `Run AppleScript:\n\`${String(args.script || '').slice(0, 300)}\``,
  },

  // ─── Filesystem ─────────────────────────────────────────────────
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given absolute path.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Absolute file path to read',
        required: true,
      },
    ],
    dangerous: false,
  },
  {
    name: 'write_file',
    description:
      'Write text content to a file at the given absolute path, creating it if it does not exist.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Absolute file path to write to',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'The text content to write',
        required: true,
      },
    ],
    dangerous: true,
    confirmationMessage: (args) =>
      `Write to file: ${args.path}`,
  },
  {
    name: 'create_directory',
    description:
      'Create a directory path. Can create parent directories recursively.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Directory path to create',
        required: true,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'Create parent directories automatically (default true)',
      },
    ],
    dangerous: false,
  },
  {
    name: 'copy_path',
    description:
      'Copy a file or directory from source to destination.',
    category: 'filesystem',
    parameters: [
      {
        name: 'source',
        type: 'string',
        description: 'Source file or directory path',
        required: true,
      },
      {
        name: 'destination',
        type: 'string',
        description: 'Destination path',
        required: true,
      },
      {
        name: 'overwrite',
        type: 'boolean',
        description: 'Overwrite destination if it exists',
      },
    ],
    dangerous: true,
    confirmationMessage: (args) =>
      `Copy path:\n${String(args.source || '')}\n→ ${String(args.destination || '')}`,
  },
  {
    name: 'move_path',
    description:
      'Move or rename a file/directory from source to destination.',
    category: 'filesystem',
    parameters: [
      {
        name: 'source',
        type: 'string',
        description: 'Source file or directory path',
        required: true,
      },
      {
        name: 'destination',
        type: 'string',
        description: 'Destination path',
        required: true,
      },
      {
        name: 'overwrite',
        type: 'boolean',
        description: 'Overwrite destination if it exists',
      },
    ],
    dangerous: true,
    confirmationMessage: (args) =>
      `Move path:\n${String(args.source || '')}\n→ ${String(args.destination || '')}`,
  },
  {
    name: 'rename_path',
    description:
      'Rename a file/directory within the same parent directory.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Existing file or directory path',
        required: true,
      },
      {
        name: 'newName',
        type: 'string',
        description: 'New file or directory name (not a full path)',
        required: true,
      },
      {
        name: 'overwrite',
        type: 'boolean',
        description: 'Overwrite the target name if it exists',
      },
    ],
    dangerous: true,
    confirmationMessage: (args) =>
      `Rename path:\n${String(args.path || '')}\n→ ${String(args.newName || '')}`,
  },
  {
    name: 'delete_path',
    description:
      'Delete a file or directory path. Use recursive for directories.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path to delete',
        required: true,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'Delete directories recursively (default true)',
      },
    ],
    dangerous: true,
    confirmationMessage: (args) =>
      `Delete path: ${String(args.path || '')}`,
  },
  {
    name: 'read_dir',
    description:
      'List the files and subdirectories in a directory. Returns one entry per line.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Absolute directory path to list',
        required: true,
      },
    ],
    dangerous: false,
  },
  {
    name: 'search_file_content',
    description:
      'Search text content in files under a directory and return matching lines with file paths.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Base directory to search in',
        required: true,
      },
      {
        name: 'query',
        type: 'string',
        description: 'Text to search for',
        required: true,
      },
      {
        name: 'caseSensitive',
        type: 'boolean',
        description: 'Case-sensitive search (default false)',
      },
      {
        name: 'maxDepth',
        type: 'number',
        description: 'Maximum recursion depth (default 6)',
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum number of matches to return (default 80, max 500)',
      },
      {
        name: 'includeHidden',
        type: 'boolean',
        description: 'Whether to include dotfiles/dotfolders',
      },
    ],
    dangerous: false,
  },
  {
    name: 'replace_in_file',
    description:
      'Replace text in a file and write changes back. Supports single or global replacement.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'File path to modify',
        required: true,
      },
      {
        name: 'find',
        type: 'string',
        description: 'Text to find',
        required: true,
      },
      {
        name: 'replace',
        type: 'string',
        description: 'Replacement text',
        required: true,
      },
      {
        name: 'all',
        type: 'boolean',
        description: 'Replace all matches (default true)',
      },
      {
        name: 'caseSensitive',
        type: 'boolean',
        description: 'Case-sensitive matching (default true)',
      },
      {
        name: 'dryRun',
        type: 'boolean',
        description: 'Return planned changes without writing',
      },
    ],
    dangerous: true,
    confirmationMessage: (args) =>
      `Replace text in file: ${String(args.path || '')}`,
  },
  {
    name: 'path_info',
    description:
      'Get metadata about a file or directory (type, size, timestamps, and basic permissions).',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path to inspect',
        required: true,
      },
    ],
    dangerous: false,
  },
  {
    name: 'find_paths',
    description:
      'Search for files/folders by name under a base directory. Supports filtering by type and depth.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Base directory to search in',
        required: true,
      },
      {
        name: 'query',
        type: 'string',
        description: 'Case-insensitive name substring to match',
        required: true,
      },
      {
        name: 'type',
        type: 'string',
        description: 'Filter by entry type',
        enum: ['all', 'file', 'directory'],
      },
      {
        name: 'maxDepth',
        type: 'number',
        description: 'Maximum recursion depth (default 5)',
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum matches to return (default 50, max 200)',
      },
      {
        name: 'includeHidden',
        type: 'boolean',
        description: 'Whether to include dotfiles/dotfolders',
      },
    ],
    dangerous: false,
  },
  {
    name: 'top_largest_entries',
    description:
      'Return the largest files/folders directly inside a directory, including human-readable sizes. Great for disk usage questions.',
    category: 'filesystem',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Directory to analyze',
        required: true,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Number of entries to return (default 15, max 100)',
      },
      {
        name: 'includeHidden',
        type: 'boolean',
        description: 'Whether to include dotfiles/dotfolders',
      },
      {
        name: 'recursiveDirSize',
        type: 'boolean',
        description:
          'If true (default), directory size includes all nested files. If false, only direct file sizes are counted.',
      },
    ],
    dangerous: false,
  },

  // ─── Clipboard ──────────────────────────────────────────────────
  {
    name: 'clipboard_read',
    description: 'Read the current text content from the system clipboard.',
    category: 'clipboard',
    parameters: [],
    dangerous: false,
  },
  {
    name: 'clipboard_write',
    description: 'Write text to the system clipboard.',
    category: 'clipboard',
    parameters: [
      {
        name: 'text',
        type: 'string',
        description: 'Text content to copy to clipboard',
        required: true,
      },
    ],
    dangerous: false,
  },

  // ─── HTTP ───────────────────────────────────────────────────────
  {
    name: 'http_request',
    description:
      'Make an HTTP/HTTPS request and return the response. Useful for fetching data from APIs or web pages.',
    category: 'http',
    parameters: [
      {
        name: 'url',
        type: 'string',
        description: 'The full URL to request',
        required: true,
      },
      {
        name: 'method',
        type: 'string',
        description: 'HTTP method',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      },
      {
        name: 'headers',
        type: 'object',
        description: 'Request headers as key-value pairs',
      },
      {
        name: 'body',
        type: 'string',
        description: 'Request body (for POST/PUT/PATCH)',
      },
    ],
    dangerous: false,
  },

  // ─── App Control ────────────────────────────────────────────────
  {
    name: 'get_frontmost_application',
    description:
      'Get the name, path, and bundle ID of the currently active (frontmost) application.',
    category: 'app_control',
    parameters: [],
    dangerous: false,
  },
  {
    name: 'get_applications',
    description: 'List all installed applications on this Mac.',
    category: 'app_control',
    parameters: [],
    dangerous: false,
  },

  // ─── Memory ─────────────────────────────────────────────────────
  {
    name: 'memory_search',
    description:
      'Search the user\'s long-term memory for relevant information. Returns matching memories ranked by relevance.',
    category: 'memory',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query to find relevant memories',
        required: true,
      },
    ],
    dangerous: false,
  },
  {
    name: 'memory_add',
    description:
      'Save a piece of information to the user\'s long-term memory for future reference.',
    category: 'memory',
    parameters: [
      {
        name: 'text',
        type: 'string',
        description: 'The information to remember',
        required: true,
      },
    ],
    dangerous: false,
  },
];
