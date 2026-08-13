import type { JsonValue } from "./protocol.js";
import { ServiceToken, type Context, type Plugin } from "./runtime.js";

export type CapabilityFactory = () => Plugin;

export class TrustedCapabilityCatalog {
  readonly #factories: Map<string, CapabilityFactory>;

  constructor(entries: Record<string, CapabilityFactory>) {
    this.#factories = new Map(Object.entries(entries));
  }

  names(): string[] {
    return [...this.#factories.keys()].sort();
  }

  create(name: string): Plugin | undefined {
    return this.#factories.get(name)?.();
  }
}

export const CAPABILITY_CATALOG = new ServiceToken<TrustedCapabilityCatalog>(
  "trusted-capability-catalog",
);

export function capabilityCatalogPlugin(catalog: TrustedCapabilityCatalog): Plugin {
  return {
    name: "trusted-capability-catalog",
    setup(context) {
      context.provide(CAPABILITY_CATALOG, catalog);
    },
  };
}

export function runtimeToolsPlugin(): Plugin {
  return {
    name: "runtime-tools",
    setup(context) {
      const catalog = context.use(CAPABILITY_CATALOG);
      const installed = new Map<string, () => void>();
      context.effect(() => {
        for (const dispose of [...installed.values()].reverse()) dispose();
        installed.clear();
      });

      context.contributePrompt(
        "runtime-experiment-boundary",
        `You may inspect this runtime and temporarily install only trusted capabilities: ${catalog.names().join(", ")}. Remove experiments after use.`,
      );
      context.registerTool({
        name: "inspect_runtime",
        description: "Inspect mounted plugins, services, tools, Prompt contributions, listeners, and relations.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => context.inspect() as unknown as JsonValue,
      });
      context.registerTool({
        name: "install_capability",
        description: "Temporarily mount one named capability from the trusted in-process catalog.",
        inputSchema: capabilityNameSchema(catalog),
        async execute(input) {
          const name = readName(input);
          if (installed.has(name)) return { ok: false, error: `${name} is already installed.` };
          const plugin = catalog.create(name);
          if (!plugin) return { ok: false, error: `${name} is not in the trusted catalog.` };
          const dispose = await context.mount(plugin);
          installed.set(name, dispose);
          return {
            ok: true,
            installed: name,
            tools: context.inspect().tools.map((tool) => tool.name),
            nextAction:
              "The capability's tools will be visible in the next model request. Use the requested new tool before ending this experiment.",
          };
        },
      });
      context.registerTool({
        name: "remove_capability",
        description: "Unmount a capability previously installed by install_capability.",
        inputSchema: capabilityNameSchema(catalog),
        execute(input) {
          const name = readName(input);
          const dispose = installed.get(name);
          if (!dispose) return { ok: false, error: `${name} is not installed.` };
          installed.delete(name);
          dispose();
          return {
            ok: true,
            removed: name,
            tools: context.inspect().tools.map((tool) => tool.name),
            nextAction:
              "Continue the current task with permanent tools; removed tools will be absent from the next request.",
          };
        },
      });
    },
  };
}

function capabilityNameSchema(catalog: TrustedCapabilityCatalog): Record<string, unknown> {
  return {
    type: "object",
    properties: { name: { type: "string", enum: catalog.names() } },
    required: ["name"],
    additionalProperties: false,
  };
}

function readName(input: JsonValue): string {
  return (input as { name: string }).name;
}
