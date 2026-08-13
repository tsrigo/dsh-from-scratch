import type { ToolDefinition } from "./protocol.js";

export class ServiceToken<T> {
  readonly key = Symbol();
  constructor(readonly name: string) {}
}

export interface Plugin {
  name: string;
  setup(context: Context): void | Promise<void>;
}

export interface RuntimeInspection {
  plugins: string[];
  services: Array<{ name: string; provider: string }>;
  tools: Array<{ name: string; plugin: string }>;
  prompts: Array<{ id: string; plugin: string; text: string }>;
  listeners: Array<{ event: string; plugin: string }>;
  relations: Array<{ consumer: string; service: string; provider: string }>;
}

type Disposer = () => void;
type Listener = (payload: unknown) => void;

interface MountRecord {
  name: string;
  effects: Disposer[];
  state: "installing" | "mounted" | "unmounted";
}

interface Owned<T> {
  owner: string;
  value: T;
}

export class Context {
  readonly #mounts = new Map<string, MountRecord>();
  readonly #services = new Map<symbol, Owned<unknown> & { token: ServiceToken<unknown> }>();
  readonly #tools = new Map<string, Owned<ToolDefinition>>();
  readonly #prompts = new Map<string, Owned<string>>();
  readonly #listeners = new Map<string, Set<Owned<Listener>>>();
  readonly #relations: RuntimeInspection["relations"] = [];
  #activeMount: MountRecord | null = null;

  async mount(plugin: Plugin): Promise<Disposer> {
    if (this.#mounts.has(plugin.name)) throw new Error(`Plugin already mounted: ${plugin.name}`);
    if (this.#activeMount) throw new Error("Nested plugin mounting is not supported during setup.");
    const record: MountRecord = { name: plugin.name, effects: [], state: "installing" };
    this.#mounts.set(plugin.name, record);
    this.#activeMount = record;
    try {
      await plugin.setup(this);
      record.state = "mounted";
    } catch (error) {
      this.#rollback(record);
      this.#mounts.delete(plugin.name);
      throw error;
    } finally {
      this.#activeMount = null;
    }

    this.emit("runtime/plugin-mounted", { plugin: plugin.name });
    return once(() => {
      if (record.state === "unmounted") return;
      this.emit("runtime/plugin-unmounting", { plugin: plugin.name });
      this.#rollback(record);
      this.#mounts.delete(plugin.name);
      this.#relations.splice(
        0,
        this.#relations.length,
        ...this.#relations.filter(
          (relation) => relation.consumer !== plugin.name && relation.provider !== plugin.name,
        ),
      );
      this.emit("runtime/plugin-unmounted", { plugin: plugin.name });
    });
  }

  effect(cleanup: Disposer): Disposer {
    const mount = this.#requireMount();
    const dispose = once(cleanup);
    mount.effects.push(dispose);
    return dispose;
  }

  provide<T>(token: ServiceToken<T>, value: T): Disposer {
    const owner = this.#requireMount().name;
    if (this.#services.has(token.key)) throw new Error(`Service already provided: ${token.name}`);
    this.#services.set(token.key, { owner, value, token: token as ServiceToken<unknown> });
    return this.effect(() => {
      const service = this.#services.get(token.key);
      if (service?.owner === owner) this.#services.delete(token.key);
    });
  }

  use<T>(token: ServiceToken<T>): T {
    const service = this.#services.get(token.key);
    if (!service) throw new Error(`Missing service: ${token.name}`);
    const consumer = this.#activeMount?.name;
    if (consumer) {
      const relation = { consumer, service: token.name, provider: service.owner };
      if (!this.#relations.some((item) => sameRelation(item, relation))) this.#relations.push(relation);
    }
    return service.value as T;
  }

  registerTool(tool: ToolDefinition): Disposer {
    const owner = this.#requireMount().name;
    if (this.#tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.#tools.set(tool.name, { owner, value: tool });
    return this.effect(() => {
      if (this.#tools.get(tool.name)?.owner === owner) this.#tools.delete(tool.name);
    });
  }

  contributePrompt(id: string, text: string): Disposer {
    const owner = this.#requireMount().name;
    if (this.#prompts.has(id)) throw new Error(`Prompt contribution already registered: ${id}`);
    this.#prompts.set(id, { owner, value: text });
    return this.effect(() => {
      if (this.#prompts.get(id)?.owner === owner) this.#prompts.delete(id);
    });
  }

  on(event: string, listener: Listener): Disposer {
    const owner = this.#requireMount().name;
    const entry = { owner, value: listener };
    const listeners = this.#listeners.get(event) ?? new Set<Owned<Listener>>();
    listeners.add(entry);
    this.#listeners.set(event, listeners);
    return this.effect(() => {
      listeners.delete(entry);
      if (listeners.size === 0) this.#listeners.delete(event);
    });
  }

  emit(event: string, payload: unknown): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) listener.value(payload);
  }

  listTools(): ToolDefinition[] {
    return [...this.#tools.values()].map((entry) => entry.value);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.#tools.get(name)?.value;
  }

  compilePrompt(base = ""): string {
    return [base, ...[...this.#prompts.values()].map((entry) => entry.value)]
      .filter(Boolean)
      .join("\n\n");
  }

  inspect(): RuntimeInspection {
    return {
      plugins: [...this.#mounts.values()]
        .filter((mount) => mount.state === "mounted")
        .map((mount) => mount.name),
      services: [...this.#services.values()].map((entry) => ({
        name: entry.token.name,
        provider: entry.owner,
      })),
      tools: [...this.#tools.entries()].map(([name, entry]) => ({ name, plugin: entry.owner })),
      prompts: [...this.#prompts.entries()].map(([id, entry]) => ({
        id,
        plugin: entry.owner,
        text: entry.value,
      })),
      listeners: [...this.#listeners.entries()].flatMap(([event, entries]) =>
        [...entries].map((entry) => ({ event, plugin: entry.owner })),
      ),
      relations: structuredClone(this.#relations),
    };
  }

  #requireMount(): MountRecord {
    if (!this.#activeMount) throw new Error("Runtime contributions must be registered during plugin setup.");
    return this.#activeMount;
  }

  #rollback(record: MountRecord): void {
    const failures: unknown[] = [];
    for (const dispose of [...record.effects].reverse()) {
      try {
        dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    record.state = "unmounted";
    if (failures.length > 0) throw new AggregateError(failures, `Failed to clean up ${record.name}`);
  }
}

function once(action: Disposer): Disposer {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    action();
  };
}

function sameRelation(
  left: RuntimeInspection["relations"][number],
  right: RuntimeInspection["relations"][number],
): boolean {
  return (
    left.consumer === right.consumer &&
    left.service === right.service &&
    left.provider === right.provider
  );
}
