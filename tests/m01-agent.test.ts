import { describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent.js";
import { createCheckoutState, createWorkspaceTools } from "../src/checkout-workspace.js";
import { DeepSeekLlm } from "../src/llm-deepseek.js";
import { createBugFixReplies, ScriptedLlm } from "../src/llm-fake.js";
import { composeM03Runtime } from "../src/plugins.js";
import type { Llm, LlmResponse } from "../src/protocol.js";

describe("M01 ordinary tool Agent Loop", () => {
  it("fixes CHECKOUT-417 and submits a tested patch over five steps", async () => {
    const llm = new ScriptedLlm(createBugFixReplies());
    const { context, state } = await composeM03Runtime(llm);
    const agent = new Agent({
      llm,
      context,
      systemPrompt: "Fix the bounded checkout bug.",
    });

    const result = await agent.runTurn("Fix CHECKOUT-417 and submit a tested patch.");

    expect(result.steps).toBe(5);
    expect(state.acceptedPatch?.issueId).toBe("CHECKOUT-417");
    expect(llm.requests).toHaveLength(5);
    expect(result.trace.filter((event) => event.type === "tool/result")).toHaveLength(7);
  });

  it("returns unknown and invalid calls to the model as tool results", async () => {
    const llm = new ScriptedLlm([
      {
        message: {
          role: "assistant",
          content: "Trying two bad calls.",
          toolCalls: [
            { id: "unknown", name: "shell", arguments: {} },
            { id: "invalid", name: "submit_patch", arguments: {} },
          ],
        },
      },
      (request) => {
        const toolMessages = request.messages.filter((message) => message.role === "tool");
        expect(toolMessages[0]?.content).toContain("Unknown tool");
        expect(toolMessages[1]?.content).toContain("Invalid tool arguments");
        return { message: { role: "assistant", content: "Errors observed.", toolCalls: [] } };
      },
    ]);
    const { context } = await composeM03Runtime(llm);
    const result = await new Agent({
      llm,
      context,
      systemPrompt: "Audit.",
    }).runTurn("Try invalid calls.");
    expect(result.steps).toBe(2);
  });

  it("maps the same unified request to DeepSeek Chat Completions", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        sse(
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "c1",
                  function: { name: "read_workspace_file", arguments: "{\"path\":\"issue.md\"}" },
                }],
              },
            }],
          },
          { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } },
        ),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    const llm = new DeepSeekLlm({ apiKey: "test-key", fetch: fetchMock });
    const state = createCheckoutState();
    const response = await collectResponse(llm.stream({
      system: "system",
      dynamicContext: "step=1",
      messages: [{ role: "user", content: "inspect" }],
      tools: createWorkspaceTools(state).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));

    expect(response.message.toolCalls[0]?.name).toBe("read_workspace_file");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "deepseek-v4-flash",
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: "disabled" },
    });
  });

  it("omits an empty tool_calls field from assistant history", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        sse({ choices: [{ delta: { content: "next" } }] }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    const llm = new DeepSeekLlm({ apiKey: "test-key", fetch: fetchMock });
    await collectResponse(llm.stream({
      system: "system",
      dynamicContext: "round=2",
      tools: [],
      messages: [
        { role: "user", content: "round one" },
        { role: "assistant", content: "round one complete", toolCalls: [] },
        { role: "user", content: "round two" },
      ],
    }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    const assistant = body.messages.find((message) => message.role === "assistant");
    expect(assistant).toEqual({ role: "assistant", content: "round one complete" });
    expect(assistant).not.toHaveProperty("tool_calls");
  });

  it("assembles content and tool arguments across fragmented SSE chunks", async () => {
    const payload = sse(
      { choices: [{ delta: { content: "正在" } }] },
      { choices: [{ delta: { content: "检查。", tool_calls: [{ index: 0, id: "call-1", function: { name: "submit_", arguments: "{\"summary\":" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "patch", arguments: "\"fix duplicate discount\"}" } }] } }] },
    );
    const encoded = new TextEncoder().encode(payload);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const boundary of [7, 29, 61, encoded.length]) {
          const previous = [0, 7, 29, 61][[7, 29, 61, encoded.length].indexOf(boundary)] ?? 0;
          controller.enqueue(encoded.slice(previous, boundary));
        }
        controller.close();
      },
    });
    const llm = new DeepSeekLlm({
      apiKey: "test-key",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 })),
    });

    const response = await collectResponse(llm.stream({
      system: "system",
      dynamicContext: "",
      messages: [],
      tools: [],
    }));

    expect(response.message.content).toBe("正在检查。");
    expect(response.message.toolCalls).toEqual([
      { id: "call-1", name: "submit_patch", arguments: { summary: "fix duplicate discount" } },
    ]);
  });

  it("keeps streamed deltas out of the canonical Session Log", async () => {
    const llm: Llm = {
      provider: "stream-test",
      model: "stream-test-v1",
      async *stream() {
        yield { type: "content-delta", content: "流式" };
        yield { type: "content-delta", content: "完成" };
        yield {
          type: "response",
          response: { message: { role: "assistant", content: "流式完成", toolCalls: [] } },
        };
      },
    };
    const observed: string[] = [];
    const { context, session } = await composeM03Runtime(llm);
    const result = await new Agent({
      llm,
      context,
      systemPrompt: "Audit.",
      onModelEvent: ({ event }) => observed.push(event.type),
    }).runTurn("Recover.");

    expect(result.finalMessage.content).toBe("流式完成");
    expect(observed).toEqual(["content-delta", "content-delta", "response"]);
    expect(session.events.filter((event) => event.type === "assistant/message")).toEqual([
      expect.objectContaining({ content: "流式完成" }),
    ]);
    expect(session.events.some((event) => event.type.includes("delta"))).toBe(false);
  });

  it("reports HTTP failures, malformed stream JSON, and missing completion markers", async () => {
    const request = { system: "system", dynamicContext: "", messages: [], tools: [] };
    const httpFailure = new DeepSeekLlm({
      apiKey: "test-key",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ error: { message: "quota exhausted" } }),
        { status: 429 },
      )),
    });
    await expect(collectResponse(httpFailure.stream(request))).rejects.toThrow(
      "DeepSeek request failed (429): quota exhausted",
    );

    const malformed = new DeepSeekLlm({
      apiKey: "test-key",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("data: {bad}\n\ndata: [DONE]\n\n")),
    });
    await expect(collectResponse(malformed.stream(request))).rejects.toThrow("malformed JSON");

    const truncated = new DeepSeekLlm({
      apiKey: "test-key",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`,
      )),
    });
    await expect(collectResponse(truncated.stream(request))).rejects.toThrow("before [DONE]");
  });
});

function sse(...payloads: unknown[]): string {
  return `${payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("")}data: [DONE]\n\n`;
}

async function collectResponse(stream: AsyncIterable<import("../src/protocol.js").LlmStreamEvent>): Promise<LlmResponse> {
  let response: LlmResponse | undefined;
  for await (const event of stream) {
    if (event.type === "response") response = event.response;
  }
  if (!response) throw new Error("missing response");
  return response;
}
