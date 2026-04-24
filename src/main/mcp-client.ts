/**
 * Minimal MCP (Model Context Protocol) stdio client.
 *
 * Spawns a child process and speaks JSON-RPC 2.0 over newline-delimited
 * messages on its stdin/stdout (per the MCP stdio transport spec). After
 * `initialize` we call `tools/list` to discover the server's tools and
 * expose them to the agent runtime via a simple pool.
 *
 * Keeps connections alive across agent runs; reconcile() starts any newly
 * configured servers and stops any that were removed from settings.
 */

import { spawn, type ChildProcess } from 'child_process';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
}

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const PROTOCOL_VERSION = '2024-11-05';
const REQUEST_TIMEOUT_MS = 30_000;

class McpClient {
  private proc: ChildProcess | null = null;
  private stdoutBuf = '';
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  tools: McpTool[] = [];
  private started = false;

  async start(config: McpServerConfig): Promise<void> {
    if (this.started) return;
    this.proc = spawn(config.command, config.args || [], {
      env: { ...process.env, ...(config.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.cwd,
    });
    this.proc.stdout!.on('data', (buf) => this.onStdout(buf));
    this.proc.stderr!.on('data', () => {}); // swallow server logs
    this.proc.on('exit', () => this.onExit());
    this.proc.on('error', () => this.onExit());

    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'SuperCmd', version: '1.0' },
    });
    this.notify('notifications/initialized', {});
    const toolsResult = await this.request('tools/list', {});
    this.tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
    this.started = true;
  }

  async stop(): Promise<void> {
    // Reject any in-flight requests.
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('MCP client stopping'));
    }
    this.pending.clear();
    if (this.proc) {
      try { this.proc.kill('SIGTERM'); } catch {}
      // Give it a moment, then SIGKILL if still alive.
      setTimeout(() => { try { this.proc?.kill('SIGKILL'); } catch {} }, 2000);
    }
    this.proc = null;
    this.started = false;
    this.tools = [];
  }

  async callTool(name: string, args: Record<string, any>): Promise<string> {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError) {
      const text = String(result?.content?.[0]?.text || 'MCP tool error');
      throw new Error(text);
    }
    const parts: string[] = [];
    for (const c of result?.content || []) {
      if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text);
      else if (c?.type === 'resource' && c.resource?.text) parts.push(String(c.resource.text));
      else parts.push(JSON.stringify(c));
    }
    return parts.join('\n') || '[empty response]';
  }

  private onStdout(buf: Buffer | string): void {
    this.stdoutBuf += typeof buf === 'string' ? buf : buf.toString();
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, nl).replace(/\r$/, '').trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg && typeof msg.id !== 'undefined' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error.message || 'MCP error'));
      } else {
        p.resolve(msg.result);
      }
    }
    // We ignore server-initiated requests/notifications for now.
  }

  private onExit(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('MCP server exited'));
    }
    this.pending.clear();
    this.started = false;
  }

  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: any): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(obj: any): void {
    if (!this.proc || !this.proc.stdin) throw new Error('MCP client not started');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }
}

export class McpServerPool {
  private clients = new Map<string, McpClient>();
  private toolRegistry = new Map<string, { serverId: string; originalName: string }>();
  private currentConfigs: Record<string, McpServerConfig> = {};

  async reconcile(configs: Record<string, McpServerConfig>): Promise<void> {
    // Stop servers removed or whose config changed.
    for (const [id, client] of this.clients) {
      const next = configs[id];
      const prev = this.currentConfigs[id];
      const changed = !next || JSON.stringify(next) !== JSON.stringify(prev);
      if (changed) {
        await client.stop();
        this.clients.delete(id);
      }
    }
    // Start newly-added or changed servers.
    for (const [id, cfg] of Object.entries(configs || {})) {
      if (!this.clients.has(id)) {
        const client = new McpClient();
        try {
          await client.start(cfg);
          this.clients.set(id, client);
        } catch (err) {
          console.error(`[mcp] failed to start server "${id}":`, err);
        }
      }
    }
    this.currentConfigs = { ...configs };
    this.rebuildToolRegistry();
  }

  private rebuildToolRegistry(): void {
    this.toolRegistry.clear();
    for (const [serverId, client] of this.clients) {
      const safeServer = sanitizeIdentifier(serverId);
      for (const tool of client.tools) {
        const safeTool = sanitizeIdentifier(tool.name);
        let prefixed = `${safeServer}__${safeTool}`.slice(0, 64);
        // Avoid collisions by suffixing if needed (rare).
        let i = 2;
        while (this.toolRegistry.has(prefixed)) {
          const suffix = `_${i++}`;
          prefixed = `${safeServer}__${safeTool}`.slice(0, 64 - suffix.length) + suffix;
        }
        this.toolRegistry.set(prefixed, { serverId, originalName: tool.name });
      }
    }
  }

  listToolSchemas(): Array<{ name: string; description: string; parameters: any }> {
    const out: Array<{ name: string; description: string; parameters: any }> = [];
    for (const [prefixedName, ref] of this.toolRegistry) {
      const client = this.clients.get(ref.serverId);
      const tool = client?.tools.find((t) => t.name === ref.originalName);
      if (!tool) continue;
      out.push({
        name: prefixedName,
        description: tool.description ? `[${ref.serverId}] ${tool.description}` : `[${ref.serverId}] ${tool.name}`,
        parameters:
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? tool.inputSchema
            : { type: 'object', properties: {}, additionalProperties: true },
      });
    }
    return out;
  }

  hasTool(prefixedName: string): boolean {
    return this.toolRegistry.has(prefixedName);
  }

  async callTool(prefixedName: string, args: Record<string, any>): Promise<string> {
    const ref = this.toolRegistry.get(prefixedName);
    if (!ref) throw new Error(`Unknown MCP tool: ${prefixedName}`);
    const client = this.clients.get(ref.serverId);
    if (!client) throw new Error(`MCP server "${ref.serverId}" is not connected`);
    return await client.callTool(ref.originalName, args);
  }

  async shutdown(): Promise<void> {
    for (const [, client] of this.clients) {
      try { await client.stop(); } catch {}
    }
    this.clients.clear();
    this.toolRegistry.clear();
    this.currentConfigs = {};
  }
}

function sanitizeIdentifier(s: string): string {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'x';
}

// Singleton shared across the main process.
export const mcpPool = new McpServerPool();
