import { projectMessages, type ProjectionSettings } from "./context.js";
import type {
  AssistantMessage,
  ModelMessage,
  ToolCall,
  ToolSchema,
  UnifiedRequest,
} from "./protocol.js";
import { ServiceToken, type Plugin } from "./runtime.js";

interface EventBase {
  id: number;
  type: string;
}

export type SessionEvent =
  | (EventBase & { type: "turn/start"; turnId: string })
  | (EventBase & { type: "user/message"; turnId: string; content: string })
  | (EventBase & { type: "step/start"; turnId: string; stepId: string; ordinal: number })
  | (EventBase & {
      type: "request/header";
      stepId: string;
      provider: string;
      model: string;
      system: string;
      tools: ToolSchema[];
      dynamicContext: string;
      projection: ProjectionSettings;
    })
  | (EventBase & { type: "assistant/message"; stepId: string; content: string })
  | (EventBase & { type: "tool/call"; stepId: string; call: ToolCall })
  | (EventBase & {
      type: "tool/result";
      stepId: string;
      toolCallId: string;
      name: string;
      content: string;
    })
  | (EventBase & {
      type: "context/checkpoint";
      summary: string;
      coveredThroughEventId: number;
    })
  | (EventBase & { type: "runtime/plugin-mounted"; plugin: string })
  | (EventBase & { type: "runtime/plugin-unmounted"; plugin: string })
  | (EventBase & { type: "step/end"; stepId: string; outcome: "tool-calls" | "complete" })
  | (EventBase & {
      type: "turn/end";
      turnId: string;
      outcome: "completed" | "max-steps" | "failed";
    })
  | (EventBase & {
      type: "goal/created";
      goalId: string;
      objective: string;
      maxRounds: number;
    })
  | (EventBase & {
      type: "goal/round-started";
      goalId: string;
      round: number;
      label: string;
    })
  | (EventBase & {
      type: "goal/status-changed";
      goalId: string;
      status: "active" | "completed" | "blocked" | "max-rounds";
      reason: string;
    });

export type NewSessionEvent = SessionEvent extends infer Event
  ? Event extends SessionEvent
    ? Omit<Event, "id">
    : never
  : never;

export interface TraceItem {
  eventId: number;
  type: SessionEvent["type"];
  title: string;
  detail: string;
}

export class SessionLog {
  readonly #events: SessionEvent[] = [];
  #nextId = 1;
  #nextTurn = 1;

  get events(): readonly SessionEvent[] {
    return this.#events;
  }

  append(event: NewSessionEvent): SessionEvent {
    const stored = { ...structuredClone(event), id: this.#nextId++ } as SessionEvent;
    this.#events.push(stored);
    return stored;
  }

  nextTurnId(): string {
    return `turn-${this.#nextTurn++}`;
  }

  checkpoint(summary: string, coveredThroughEventId: number): SessionEvent {
    if (coveredThroughEventId >= this.#nextId) {
      throw new Error("A checkpoint may cover only events that already exist.");
    }
    return this.append({ type: "context/checkpoint", summary, coveredThroughEventId });
  }
}

export const SESSION_LOG = new ServiceToken<SessionLog>("session-log");

export function sessionPlugin(log: SessionLog): Plugin {
  return {
    name: "session-log",
    setup(context) {
      context.provide(SESSION_LOG, log);
      context.on("runtime/plugin-mounted", (payload) => {
        const plugin = pluginName(payload);
        log.append({ type: "runtime/plugin-mounted", plugin });
      });
      context.on("runtime/plugin-unmounted", (payload) => {
        const plugin = pluginName(payload);
        log.append({ type: "runtime/plugin-unmounted", plugin });
      });
    },
  };
}

export function buildRequest(events: readonly SessionEvent[], stepId: string): UnifiedRequest {
  const headerIndex = events.findIndex(
    (event) => event.type === "request/header" && event.stepId === stepId,
  );
  if (headerIndex === -1) throw new Error(`Missing request/header for ${stepId}.`);
  const header = events[headerIndex];
  if (header?.type !== "request/header") throw new Error(`Invalid request header for ${stepId}.`);

  const prefix = events.slice(0, headerIndex);
  const checkpoint = [...prefix]
    .reverse()
    .find((event): event is Extract<SessionEvent, { type: "context/checkpoint" }> =>
      event.type === "context/checkpoint",
    );
  const projectedEvents = checkpoint
    ? prefix.filter((event) => event.id > checkpoint.coveredThroughEventId)
    : prefix;
  const messages: ModelMessage[] = [];
  if (checkpoint) {
    messages.push({
      role: "system",
      content: `[Context checkpoint through event ${checkpoint.coveredThroughEventId}]\n${checkpoint.summary}`,
    });
  }

  const callsByStep = new Map<string, ToolCall[]>();
  for (const event of projectedEvents) {
    if (event.type === "tool/call") {
      const calls = callsByStep.get(event.stepId) ?? [];
      calls.push(structuredClone(event.call));
      callsByStep.set(event.stepId, calls);
    }
  }
  for (const event of projectedEvents) {
    switch (event.type) {
      case "user/message":
        messages.push({ role: "user", content: event.content });
        break;
      case "assistant/message":
        messages.push({
          role: "assistant",
          content: event.content,
          toolCalls: callsByStep.get(event.stepId) ?? [],
        });
        break;
      case "tool/result":
        messages.push({
          role: "tool",
          toolCallId: event.toolCallId,
          name: event.name,
          content: event.content,
        });
        break;
      default:
        break;
    }
  }

  return {
    system: header.system,
    tools: structuredClone(header.tools),
    messages: projectMessages(messages, header.projection),
    dynamicContext: header.dynamicContext,
  };
}

export function requestStepIds(events: readonly SessionEvent[]): string[] {
  return events
    .filter((event): event is Extract<SessionEvent, { type: "request/header" }> =>
      event.type === "request/header",
    )
    .map((event) => event.stepId);
}

export function replayTrace(events: readonly SessionEvent[]): TraceItem[] {
  return events.map((event) => ({
    eventId: event.id,
    type: event.type,
    title: traceTitle(event),
    detail: traceDetail(event),
  }));
}

function traceTitle(event: SessionEvent): string {
  switch (event.type) {
    case "request/header":
      return `${event.stepId} → ${event.provider}/${event.model}`;
    case "tool/call":
      return `call ${event.call.name}`;
    case "tool/result":
      return `result ${event.name}`;
    case "runtime/plugin-mounted":
    case "runtime/plugin-unmounted":
      return event.plugin;
    case "goal/round-started":
      return `round ${event.round} · ${event.label}`;
    default:
      return event.type;
  }
}

function traceDetail(event: SessionEvent): string {
  switch (event.type) {
    case "user/message":
    case "assistant/message":
      return event.content;
    case "tool/call":
      return JSON.stringify(event.call.arguments);
    case "tool/result":
      return event.content;
    case "context/checkpoint":
      return `${event.summary} (covers through #${event.coveredThroughEventId})`;
    case "request/header":
      return `${event.tools.length} tools · dynamic=${event.dynamicContext}`;
    case "turn/end":
    case "step/end":
      return event.outcome;
    case "goal/created":
      return event.objective;
    case "goal/status-changed":
      return `${event.status}: ${event.reason}`;
    default:
      return "";
  }
}

function pluginName(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "plugin" in payload &&
    typeof payload.plugin === "string"
  ) {
    return payload.plugin;
  }
  throw new Error("Runtime plugin event is missing its plugin name.");
}
