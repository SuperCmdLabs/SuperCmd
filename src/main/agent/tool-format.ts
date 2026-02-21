/**
 * Tool Format — converts provider-agnostic ToolDefinitions to
 * the format each LLM provider expects.
 */

import type { ToolDefinition } from './tool-definitions';

// ─── OpenAI / OpenAI-Compatible / Ollama ─────────────────────────────

export function toOpenAITools(tools: ToolDefinition[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          t.parameters.map((p) => [
            p.name,
            {
              type: p.type,
              description: p.description,
              ...(p.enum ? { enum: p.enum } : {}),
              ...(p.items ? { items: p.items } : {}),
            },
          ])
        ),
        required: t.parameters.filter((p) => p.required).map((p) => p.name),
      },
    },
  }));
}

// ─── Anthropic ───────────────────────────────────────────────────────

export function toAnthropicTools(tools: ToolDefinition[]): any[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        t.parameters.map((p) => [
          p.name,
          {
            type: p.type,
            description: p.description,
            ...(p.enum ? { enum: p.enum } : {}),
            ...(p.items ? { items: p.items } : {}),
          },
        ])
      ),
      required: t.parameters.filter((p) => p.required).map((p) => p.name),
    },
  }));
}
