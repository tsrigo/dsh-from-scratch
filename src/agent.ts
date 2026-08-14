import { Ajv, type ValidateFunction } from "ajv";
import {
  DEFAULT_PROJECTION,
  toolSchemas,
  type ProjectionSettings,
} from "./context.js";
import type {
  AssistantMessage,
  JsonValue,
  Llm,
  LlmStreamEvent,
  UnifiedRequest,
} from "./protocol.js";
import type { Context } from "./runtime.js";
import {
  buildRequest,
  replayTrace,
  SESSION_LOG,
  type SessionEvent,
  type SessionLog,
  type TraceItem,
} from "./session.js";

export interface RunTurnResult {
  finalMessage: AssistantMessage;
  steps: number;
  turnId: string;
  stepIds: string[];
  trace: TraceItem[];
  requests: UnifiedRequest[];
}

export interface CheckpointProposal {
  summary: string;
  coveredThroughEventId: number;
}

export interface AgentOptions {
  llm: Llm;
  context: Context;
  systemPrompt: string;
  dynamicContext?: (step: number) => string;
  projection?: ProjectionSettings;
  checkpointBeforeStep?: (input: {
    step: number;
    events: readonly SessionEvent[];
  }) => CheckpointProposal | undefined;
  maxSteps?: number;
  onModelEvent?: (event: { stepId: string; event: LlmStreamEvent }) => void;
}

export class Agent {
  readonly #llm: Llm;
  readonly #context: Context;
  readonly #validators = new Map<string, { schema: string; validate: ValidateFunction }>();
  readonly #ajv = new Ajv({ allErrors: true, strict: false });
  readonly #systemPrompt: string;
  readonly #dynamicContext: (step: number) => string;
  readonly #maxSteps: number;
  readonly #projection: ProjectionSettings;
  readonly #session: SessionLog;
  readonly #checkpointBeforeStep?: AgentOptions["checkpointBeforeStep"];
  readonly #onModelEvent?: AgentOptions["onModelEvent"];

  constructor(options: AgentOptions) {
    this.#llm = options.llm;
    this.#context = options.context;
    this.#systemPrompt = options.systemPrompt;
    this.#dynamicContext = options.dynamicContext ?? ((step) => `Current step: ${step}`);
    this.#maxSteps = options.maxSteps ?? 8;
    this.#projection = options.projection ?? DEFAULT_PROJECTION;
    this.#session = this.#context.use(SESSION_LOG);
    this.#checkpointBeforeStep = options.checkpointBeforeStep;
    this.#onModelEvent = options.onModelEvent;
  }

  async runTurn(userInput: string): Promise<RunTurnResult> {
    const eventStart = this.#session.events.length;
    const turnId = this.#session.nextTurnId();
    this.#session.append({ type: "turn/start", turnId });
    this.#session.append({ type: "user/message", turnId, content: userInput });
    const requests: UnifiedRequest[] = [];
    const stepIds: string[] = [];

    for (let step = 1; step <= this.#maxSteps; step += 1) {
      const checkpoint = this.#checkpointBeforeStep?.({ step, events: this.#session.events });
      if (checkpoint) {
        this.#session.checkpoint(checkpoint.summary, checkpoint.coveredThroughEventId);
      }
      const stepId = `${turnId}-step-${step}`;
      stepIds.push(stepId);
      this.#session.append({ type: "step/start", turnId, stepId, ordinal: step });
      this.#session.append({
        type: "request/header",
        stepId,
        provider: this.#llm.provider,
        model: this.#llm.model,
        system: this.#context.compilePrompt(this.#systemPrompt),
        tools: toolSchemas(this.#context.listTools()),
        dynamicContext: this.#dynamicContext(step),
        projection: this.#projection,
      });
      const request = buildRequest(this.#session.events, stepId);
      requests.push(structuredClone(request));

      let response;
      for await (const event of this.#llm.stream(request)) {
        this.#onModelEvent?.({ stepId, event: structuredClone(event) });
        if (event.type === "response") {
          if (response) throw new Error("LLM stream returned more than one final response.");
          response = event.response;
        }
      }
      if (!response) throw new Error("LLM stream ended without a final response.");
      const assistant = response.message;
      this.#session.append({ type: "assistant/message", stepId, content: assistant.content });
      for (const call of assistant.toolCalls) {
        this.#session.append({ type: "tool/call", stepId, call });
      }

      if (assistant.toolCalls.length === 0) {
        this.#session.append({ type: "step/end", stepId, outcome: "complete" });
        this.#session.append({ type: "turn/end", turnId, outcome: "completed" });
        return {
          finalMessage: assistant,
          steps: step,
          turnId,
          stepIds,
          trace: replayTrace(this.#session.events.slice(eventStart)),
          requests,
        };
      }

      for (const call of assistant.toolCalls) {
        const result = await this.#executeTool(call.name, call.arguments);
        this.#session.append({
          type: "tool/result",
          stepId,
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(result),
        });
      }
      this.#session.append({ type: "step/end", stepId, outcome: "tool-calls" });
    }

    this.#session.append({ type: "turn/end", turnId, outcome: "max-steps" });
    throw new Error(`Agent exceeded maxSteps (${this.#maxSteps}) before finishing the turn.`);
  }

  async #executeTool(name: string, input: JsonValue): Promise<JsonValue> {
    const tool = this.#context.getTool(name);
    if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
    const schema = JSON.stringify(tool.inputSchema);
    const cached = this.#validators.get(name);
    const validate = cached?.schema === schema ? cached.validate : this.#ajv.compile(tool.inputSchema);
    this.#validators.set(name, { schema, validate });
    if (!validate?.(input)) {
      return {
        ok: false,
        error: "Invalid tool arguments",
        issues: (validate?.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`),
      };
    }
    try {
      const result = await tool.execute(input);
      this.#context.emit("tool/executed", { name, input, result });
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
