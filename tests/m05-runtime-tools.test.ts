import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import {
  createCapabilityExperimentReplies,
  ScriptedLlm,
} from "../src/llm-fake.js";
import { composeRuntime } from "../src/plugins.js";
import { buildRequest } from "../src/session.js";

describe("M05 trusted capability experiment", () => {
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
    expect(result.steps).toBe(6);
    expect(llm.requests[2]!.tools.map((tool) => tool.name)).not.toContain("find_references");
    expect(llm.requests[3]!.tools.map((tool) => tool.name)).toContain("find_references");
    expect(llm.requests[3]!.tools.map((tool) => tool.name)).toContain("check_types");
    expect(llm.requests[3]!.system).toContain("inspect calculateTotal references");
    expect(llm.requests[5]!.tools.map((tool) => tool.name)).not.toContain("find_references");
    expect(llm.requests[5]!.system).not.toContain("inspect calculateTotal references");

    const runtimeEvents = session.events.filter(
      (event) =>
        (event.type === "runtime/plugin-mounted" || event.type === "runtime/plugin-unmounted") &&
        event.plugin === "capability:typescript_analysis",
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

  it("provides word_count as a separate install-use-remove mechanism check", async () => {
    const replies = [
      {
        message: {
          role: "assistant" as const,
          content: "Install the small mechanism example.",
          toolCalls: [
            {
              id: "install",
              name: "install_capability",
              arguments: { name: "word_count" },
            },
          ],
        },
      },
      {
        message: {
          role: "assistant" as const,
          content: "Use it.",
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
          content: "Remove it.",
          toolCalls: [
            {
              id: "remove",
              name: "remove_capability",
              arguments: { name: "word_count" },
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
    expect(llm.requests[1]!.tools.map((tool) => tool.name)).toContain("word_count");
    expect(llm.requests[3]!.tools.map((tool) => tool.name)).not.toContain("word_count");
    const count = session.events.find(
      (event) => event.type === "tool/result" && event.name === "word_count",
    );
    expect(count?.type === "tool/result" ? JSON.parse(count.content) : null).toEqual({ words: 3 });
  });

  it("rejects names outside the trusted catalog at argument validation", async () => {
    const llm = new ScriptedLlm([
      {
        message: {
          role: "assistant",
          content: "Try an untrusted name.",
          toolCalls: [
            {
              id: "bad",
              name: "install_capability",
              arguments: { name: "remote_package" },
            },
          ],
        },
      },
      (request) => {
        const result = request.messages.find(
          (message) => message.role === "tool" && message.toolCallId === "bad",
        );
        expect(result?.content).toContain("Invalid tool arguments");
        return { message: { role: "assistant", content: "Rejected.", toolCalls: [] } };
      },
    ]);
    const { context } = await composeRuntime(llm);
    await new Agent({ llm, context, systemPrompt: "Bounded runtime." }).runTurn("Try install.");
  });
});
