import type { Llm, LlmResponse, UnifiedRequest } from "./protocol.js";

export type ScriptedReply =
  | LlmResponse
  | ((request: UnifiedRequest, requestIndex: number) => LlmResponse);

export class ScriptedLlm implements Llm {
  readonly provider = "fake";
  readonly model = "scripted-mars-audit-v1";
  readonly requests: UnifiedRequest[] = [];
  #nextReply = 0;

  constructor(private readonly replies: ScriptedReply[]) {}

  async complete(request: UnifiedRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone(request));
    const reply = this.replies[this.#nextReply];
    if (!reply) throw new Error(`Fake LLM has no reply for request ${this.#nextReply + 1}.`);
    const index = this.#nextReply++;
    return structuredClone(typeof reply === "function" ? reply(request, index) : reply);
  }
}

export function createMarsAuditReplies(): ScriptedReply[] {
  return [
    {
      message: {
        role: "assistant",
        content: "I will inspect the bounded incident packet first.",
        toolCalls: [{ id: "call-read", name: "read_incident_packet", arguments: {} }],
      },
    },
    {
      message: {
        role: "assistant",
        content: "ASTER is the only candidate within latency, loss, and energy limits.",
        toolCalls: [
          {
            id: "call-submit",
            name: "submit_recovery_plan",
            arguments: {
              routeId: "ASTER",
              isolateRelay: "RELAY-7",
              reasonCode: "THERMAL_DRIFT",
            },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "Recovery plan accepted: isolate RELAY-7 and reroute through ASTER.",
        toolCalls: [],
      },
    },
  ];
}
