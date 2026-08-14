import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { WORD_COUNT_PLUGIN_CODE } from "../src/catalog/word-count.js";
import {
  createCapabilityExperimentReplies,
  ScriptedLlm,
} from "../src/llm-fake.js";
import { composeRuntime } from "../src/plugins.js";
import { buildRequest } from "../src/session.js";

describe("M05 dynamic Cordis Plugin experiment", () => {
  it("changes the next request through ordinary mount and disposer lifecycles", async () => {
    const llm = new ScriptedLlm(createCapabilityExperimentReplies());
    const { context, session, state } = await composeRuntime(llm);
    const result = await new Agent({
      llm,
      context,
      systemPrompt: "Fix CHECKOUT-417 and clean up temporary experiments.",
      maxSteps: 8,
    }).runTurn("Fix CHECKOUT-417.");

    expect(state.acceptedPatch?.issueId).toBe("CHECKOUT-417");
    expect(result.steps).toBe(7);
    expect(llm.requests[2]!.tools.map((tool) => tool.name)).not.toContain("find_references");
    expect(llm.requests[3]!.tools.map((tool) => tool.name)).not.toContain("find_references");
    expect(llm.requests[4]!.tools.map((tool) => tool.name)).toContain("find_references");
    expect(llm.requests[4]!.tools.map((tool) => tool.name)).toContain("check_types");
    expect(llm.requests[4]!.system).toContain("inspect calculateTotal references");
    expect(llm.requests[6]!.tools.map((tool) => tool.name)).not.toContain("find_references");
    expect(llm.requests[6]!.system).not.toContain("inspect calculateTotal references");

    const runtimeEvents = session.events.filter(
      (event) =>
        (event.type === "runtime/plugin-mounted" || event.type === "runtime/plugin-unmounted") &&
        event.plugin === "dynamic:typescript_analysis",
    );
    expect(runtimeEvents.map((event) => event.type)).toEqual([
      "runtime/plugin-mounted",
      "runtime/plugin-unmounted",
    ]);
    for (const stepId of result.stepIds) {
      expect(buildRequest(session.events, stepId)).toEqual(
        llm.requests[result.stepIds.indexOf(stepId)],
      );
    }
  });

  it("defines, runs, uses, and undefines a word_count Plugin", async () => {
    const replies = [
      {
        message: {
          role: "assistant" as const,
          content: "Define the small mechanism example.",
          toolCalls: [
            {
              id: "define",
              name: "cordis_define",
              arguments: {
                name: "word_count",
                purpose: "Count words in supplied text.",
                code: WORD_COUNT_PLUGIN_CODE,
              },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant" as const,
          content: "Run it.",
          toolCalls: [
            {
              id: "run",
              name: "cordis_run",
              arguments: { pluginId: "dyn-1" },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant" as const,
          content: "Use the new tool.",
          toolCalls: [
            {
              id: "count",
              name: "word_count",
              arguments: { text: "one two three" },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant" as const,
          content: "Undefine it.",
          toolCalls: [
            {
              id: "undefine",
              name: "cordis_undefine",
              arguments: { pluginId: "dyn-1" },
            },
          ],
        },
      },
      { message: { role: "assistant" as const, content: "Done.", toolCalls: [] } },
    ];
    const llm = new ScriptedLlm(replies);
    const { context, session } = await composeRuntime(llm);
    await new Agent({ llm, context, systemPrompt: "Test lifecycle." }).runTurn("Count words.");

    expect(llm.requests[0]!.tools.map((tool) => tool.name)).not.toContain("word_count");
    expect(llm.requests[1]!.tools.map((tool) => tool.name)).not.toContain("word_count");
    expect(llm.requests[2]!.tools.map((tool) => tool.name)).toContain("word_count");
    expect(llm.requests[4]!.tools.map((tool) => tool.name)).not.toContain("word_count");
    const count = session.events.find(
      (event) => event.type === "tool/result" && event.name === "word_count",
    );
    expect(count?.type === "tool/result" ? JSON.parse(count.content) : null).toEqual({ words: 3 });
  });

  it("reports invalid Plugin code through the ordinary tool result", async () => {
    const llm = new ScriptedLlm([
      {
        message: {
          role: "assistant",
          content: "Try invalid Plugin code.",
          toolCalls: [
            {
              id: "bad",
              name: "cordis_define",
              arguments: { name: "broken", purpose: "Broken syntax fixture.", code: "return {" },
            },
          ],
        },
      },
      (request) => {
        const result = request.messages.find(
          (message) => message.role === "tool" && message.toolCallId === "bad",
        );
        expect(result?.content).toContain("Unexpected token");
        return { message: { role: "assistant", content: "Rejected.", toolCalls: [] } };
      },
    ]);
    const { context } = await composeRuntime(llm);
    await new Agent({ llm, context, systemPrompt: "Dynamic runtime." }).runTurn("Try define.");
  });
});
