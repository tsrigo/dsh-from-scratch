import { Script, createContext } from "node:vm";
import type { JsonValue } from "./protocol.js";
import type { Context, Plugin } from "./runtime.js";

interface DynamicPluginDefinition {
  pluginId: string;
  name: string;
  purpose: string;
  code: string;
  dispose?: () => void;
}

export function runtimeToolsPlugin(): Plugin {
  return {
    name: "runtime-tools",
    setup(context) {
      const definitions = new Map<string, DynamicPluginDefinition>();
      let nextPluginId = 1;

      context.effect(() => {
        for (const definition of [...definitions.values()].reverse()) definition.dispose?.();
        definitions.clear();
      });

      context.contributePrompt(
        "runtime-evolution-guide",
        "Inspect the current Context, define a small Cordis Plugin when the task needs a new capability, run it, use its tools, then stop or undefine it after the experiment.",
      );
      context.registerTool({
        name: "cordis_inspect",
        description: "Inspect mounted plugins, services, tools, Prompt contributions, listeners, and relations.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => context.inspect() as unknown as JsonValue,
      });
      context.registerTool({
        name: "cordis_define",
        description: "Define a new Cordis Plugin from a JavaScript function body that returns the Plugin.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            purpose: { type: "string", minLength: 1 },
            code: { type: "string", minLength: 1 },
          },
          required: ["name", "purpose", "code"],
          additionalProperties: false,
        },
        execute(input) {
          const { name, purpose, code } = readDefinition(input);
          compilePlugin(code);
          const pluginId = `dyn-${nextPluginId}`;
          nextPluginId += 1;
          definitions.set(pluginId, { pluginId, name, purpose, code });
          return { ok: true, pluginId, name, status: "defined" };
        },
      });
      context.registerTool({
        name: "cordis_run",
        description: "Run one previously defined Cordis Plugin in the current Context.",
        inputSchema: pluginIdSchema(),
        async execute(input) {
          const pluginId = readPluginId(input);
          const definition = definitions.get(pluginId);
          if (!definition) return { ok: false, error: `Unknown dynamic Plugin: ${pluginId}` };
          if (definition.dispose) return { ok: false, error: `${pluginId} is already running.` };
          const plugin = instantiatePlugin(definition);
          definition.dispose = await context.mount(plugin);
          return {
            ok: true,
            pluginId,
            status: "running",
            tools: context.inspect().tools.map((tool) => tool.name),
          };
        },
      });
      context.registerTool({
        name: "cordis_stop",
        description: "Stop a running dynamic Plugin while retaining its definition.",
        inputSchema: pluginIdSchema(),
        execute(input) {
          const pluginId = readPluginId(input);
          const definition = definitions.get(pluginId);
          if (!definition) return { ok: false, error: `Unknown dynamic Plugin: ${pluginId}` };
          if (!definition.dispose) return { ok: false, error: `${pluginId} is not running.` };
          definition.dispose();
          delete definition.dispose;
          return { ok: true, pluginId, status: "stopped" };
        },
      });
      context.registerTool({
        name: "cordis_undefine",
        description: "Stop a dynamic Plugin if needed and remove its definition.",
        inputSchema: pluginIdSchema(),
        execute(input) {
          const pluginId = readPluginId(input);
          const definition = definitions.get(pluginId);
          if (!definition) return { ok: false, error: `Unknown dynamic Plugin: ${pluginId}` };
          definition.dispose?.();
          definitions.delete(pluginId);
          return { ok: true, pluginId, status: "undefined" };
        },
      });
    },
  };
}

function compilePlugin(code: string): Script {
  return new Script(`(() => {\n"use strict";\n${code}\n})()`);
}

function instantiatePlugin(definition: DynamicPluginDefinition): Plugin {
  const value = compilePlugin(definition.code).runInContext(createContext(Object.create(null)), {
    timeout: 100,
  }) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { apply?: unknown }).apply !== "function"
  ) {
    throw new Error("Dynamic code must return a Cordis Plugin with apply(context).");
  }
  const dynamic = value as { apply(context: Context): void | Promise<void> };
  return {
    name: `dynamic:${definition.name}`,
    setup: (context) => dynamic.apply(context),
  };
}

function pluginIdSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { pluginId: { type: "string", pattern: "^dyn-[1-9][0-9]*$" } },
    required: ["pluginId"],
    additionalProperties: false,
  };
}

function readDefinition(input: JsonValue): { name: string; purpose: string; code: string } {
  return input as { name: string; purpose: string; code: string };
}

function readPluginId(input: JsonValue): string {
  return (input as { pluginId: string }).pluginId;
}
