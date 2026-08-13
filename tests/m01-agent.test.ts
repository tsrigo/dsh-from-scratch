import { describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent.js";
import { createIncidentTools, type SubmissionState } from "../src/incident.js";
import { DeepSeekLlm } from "../src/llm-deepseek.js";
import { createMarsAuditReplies, ScriptedLlm } from "../src/llm-fake.js";
import { composeM03Runtime } from "../src/plugins.js";

describe("M01 ordinary tool Agent Loop", () => {
  it("completes the deterministic relay audit over three steps", async () => {
    const llm = new ScriptedLlm(createMarsAuditReplies());
    const { context, state } = await composeM03Runtime(llm);
    const agent = new Agent({
      llm,
      context,
      systemPrompt: "Audit the relay incident.",
    });

    const result = await agent.runTurn("Recover MARS-RELAY-204.");

    expect(result.steps).toBe(3);
    expect(state.acceptedPlan?.routeId).toBe("ASTER");
    expect(llm.requests).toHaveLength(3);
    expect(result.trace.filter((event) => event.type === "tool/result")).toHaveLength(2);
  });

  it("returns unknown and invalid calls to the model as tool results", async () => {
    const llm = new ScriptedLlm([
      {
        message: {
          role: "assistant",
          content: "Trying two bad calls.",
          toolCalls: [
            { id: "unknown", name: "shell", arguments: {} },
            { id: "invalid", name: "submit_recovery_plan", arguments: { routeId: "ASTER" } },
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
    const state: SubmissionState = { acceptedPlan: null };
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
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: "c1", function: { name: "read_incident_packet", arguments: "{}" } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const llm = new DeepSeekLlm({ apiKey: "test-key", fetch: fetchMock });
    const response = await llm.complete({
      system: "system",
      dynamicContext: "step=1",
      messages: [{ role: "user", content: "inspect" }],
      tools: createIncidentTools({ acceptedPlan: null }).map(({ execute: _, ...schema }) => schema),
    });

    expect(response.message.toolCalls[0]?.name).toBe("read_incident_packet");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "deepseek-v4-flash",
      stream: false,
      thinking: { type: "disabled" },
    });
  });
});
