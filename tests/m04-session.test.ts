import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { createBugFixReplies, ScriptedLlm } from "../src/llm-fake.js";
import { composeM03Runtime } from "../src/plugins.js";
import { buildRequest, replayTrace, requestStepIds, SessionLog } from "../src/session.js";

describe("M04 append-only Session Log", () => {
  it("rebuilds every actually sent request from events alone", async () => {
    const llm = new ScriptedLlm(createBugFixReplies());
    const { context, session } = await composeM03Runtime(llm);
    const result = await new Agent({
      llm,
      context,
      systemPrompt: "Fix the checkout bug.",
      dynamicContext: (step) => `step=${step}`,
    }).runTurn("Fix CHECKOUT-417.");

    const stepIds = requestStepIds(session.events);
    expect(stepIds).toEqual(result.stepIds);
    expect(stepIds.map((stepId) => buildRequest(session.events, stepId))).toEqual(
      llm.requests,
    );
  });

  it("keeps the raw CI log while the rebuilt request contains only its projection", async () => {
    const llm = new ScriptedLlm(createBugFixReplies());
    const { context, session } = await composeM03Runtime(llm);
    await new Agent({ llm, context, systemPrompt: "Fix." }).runTurn("Fix CHECKOUT-417.");

    const raw = session.events.find(
      (event) =>
        event.type === "tool/result" &&
        event.name === "read_workspace_file" &&
        event.content.includes("ci.log"),
    );
    expect(raw?.type === "tool/result" ? raw.content : "").toContain("expected 80 to be 100");
    expect(raw?.type === "tool/result" ? raw.content : "").not.toContain("characters omitted");

    const request = buildRequest(session.events, "turn-1-step-2");
    const projected = request.messages.find(
      (message) =>
        message.role === "tool" &&
        message.name === "read_workspace_file" &&
        message.content.includes("ci.log"),
    );
    expect(projected?.content).toContain("characters omitted");
  });

  it("uses the newest checkpoint for projection without deleting covered events", async () => {
    const llm = new ScriptedLlm(createBugFixReplies());
    const { context, session } = await composeM03Runtime(llm);
    await new Agent({
      llm,
      context,
      systemPrompt: "Fix.",
      checkpointBeforeStep: ({ step, events }) =>
        step === 5
          ? {
              summary: "CHECKOUT-417 inspected, patched, tested, and accepted by the verifier.",
              coveredThroughEventId: events.at(-1)?.id ?? 0,
            }
          : undefined,
    }).runTurn("Fix CHECKOUT-417.");

    const checkpoint = session.events.find((event) => event.type === "context/checkpoint");
    const rawCiLog = session.events.find(
      (event) =>
        event.type === "tool/result" &&
        event.name === "read_workspace_file" &&
        event.content.includes("ci.log"),
    );
    expect(checkpoint).toBeDefined();
    expect(rawCiLog).toBeDefined();

    const fifth = buildRequest(session.events, "turn-1-step-5");
    expect(fifth.messages).toEqual([
      expect.objectContaining({ role: "system", content: expect.stringContaining("patched, tested") }),
    ]);
    expect(llm.requests[4]).toEqual(fifth);
  });

  it("replays a trace from the same events", async () => {
    const llm = new ScriptedLlm(createBugFixReplies());
    const { context, session } = await composeM03Runtime(llm);
    await new Agent({ llm, context, systemPrompt: "Fix." }).runTurn("Fix.");
    const trace = replayTrace(session.events);
    expect(trace.map((item) => item.type)).toEqual(session.events.map((event) => event.type));
    expect(trace.find((item) => item.type === "tool/call")?.title).toBe(
      "call read_workspace_file",
    );
  });

  it("notifies observers with immutable copies of newly appended events", () => {
    const observed: Array<{ type: string; content?: string }> = [];
    const session = new SessionLog();
    const stop = session.subscribe((event) => {
      observed.push(event);
      if (event.type === "user/message") event.content = "changed by observer";
    });
    session.append({ type: "turn/start", turnId: "turn-1" });
    session.append({ type: "user/message", turnId: "turn-1", content: "original" });
    stop();
    session.append({ type: "turn/end", turnId: "turn-1", outcome: "completed" });

    expect(observed).toHaveLength(2);
    expect(session.events[1]).toMatchObject({ content: "original" });
  });
});
