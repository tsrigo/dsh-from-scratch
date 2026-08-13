import { Ajv, type ValidateFunction } from "ajv";
import {
  DEFAULT_PROJECTION,
  projectMessages,
  toolSchemas,
  type ProjectionSettings,
} from "./context.js";
import type {
  AssistantMessage,
  JsonValue,
  Llm,
  ModelMessage,
  ToolDefinition,
  UnifiedRequest,
} from "./protocol.js";

export interface AgentTraceEntry {
  kind: "turn" | "step" | "request" | "assistant" | "tool";
  label: string;
  detail?: string;
}

export interface RunTurnResult {
  finalMessage: AssistantMessage;
  steps: number;
  trace: AgentTraceEntry[];
  requests: UnifiedRequest[];
}

export interface AgentOptions {
  llm: Llm;
  tools: ToolDefinition[];
  systemPrompt: string;
  dynamicContext?: (step: number) => string;
  projection?: ProjectionSettings;
  maxSteps?: number;
}

export class Agent {
  readonly #llm: Llm;
  readonly #tools: Map<string, ToolDefinition>;
  readonly #validators: Map<string, ValidateFunction>;
  readonly #systemPrompt: string;
  readonly #dynamicContext: (step: number) => string;
  readonly #maxSteps: number;
  readonly #projection: ProjectionSettings;
  readonly #messages: ModelMessage[] = [];

  constructor(options: AgentOptions) {
    this.#llm = options.llm;
    this.#tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    const ajv = new Ajv({ allErrors: true, strict: false });
    this.#validators = new Map(
      options.tools.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]),
    );
    this.#systemPrompt = options.systemPrompt;
    this.#dynamicContext = options.dynamicContext ?? ((step) => `Current step: ${step}`);
    this.#maxSteps = options.maxSteps ?? 8;
    this.#projection = options.projection ?? DEFAULT_PROJECTION;
  }

  async runTurn(userInput: string): Promise<RunTurnResult> {
    this.#messages.push({ role: "user", content: userInput });
    const trace: AgentTraceEntry[] = [{ kind: "turn", label: "turn/start", detail: userInput }];
    const requests: UnifiedRequest[] = [];

    for (let step = 1; step <= this.#maxSteps; step += 1) {
      trace.push({ kind: "step", label: `step/${step}/start` });
      const request: UnifiedRequest = {
        system: this.#systemPrompt,
        tools: toolSchemas([...this.#tools.values()]),
        messages: projectMessages(this.#messages, this.#projection),
        dynamicContext: this.#dynamicContext(step),
      };
      requests.push(structuredClone(request));
      trace.push({ kind: "request", label: "llm/request", detail: `${request.tools.length} tools` });

      const response = await this.#llm.complete(request);
      const assistant = response.message;
      this.#messages.push(assistant);
      trace.push({ kind: "assistant", label: "assistant/message", detail: assistant.content });

      if (assistant.toolCalls.length === 0) {
        trace.push({ kind: "turn", label: "turn/end", detail: "completed" });
        return { finalMessage: assistant, steps: step, trace, requests };
      }

      for (const call of assistant.toolCalls) {
        const result = await this.#executeTool(call.name, call.arguments);
        this.#messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(result),
        });
        trace.push({ kind: "tool", label: call.name, detail: JSON.stringify(result) });
      }
    }

    throw new Error(`Agent exceeded maxSteps (${this.#maxSteps}) before finishing the turn.`);
  }

  async #executeTool(name: string, input: JsonValue): Promise<JsonValue> {
    const tool = this.#tools.get(name);
    if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
    const validate = this.#validators.get(name);
    if (!validate?.(input)) {
      return {
        ok: false,
        error: "Invalid tool arguments",
        issues: (validate?.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`),
      };
    }
    try {
      return await tool.execute(input);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
