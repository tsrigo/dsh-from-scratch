import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { createMarsAuditReplies, ScriptedLlm } from "../src/llm-fake.js";
import { composeM03Runtime } from "../src/plugins.js";
import { buildRequest, replayTrace, requestStepIds } from "../src/session.js";

describe("M04 append-only Session Log", () => {
  it("rebuilds every actually sent request from events alone", async () => {
    const llm = new ScriptedLlm(createMarsAuditReplies());
    const { context, session } = await composeM03Runtime(llm);
    const result = await new Agent({
      llm,
      context,
      systemPrompt: "Audit the relay.",
      dynamicContext: (step) => `step=${step}`,
    }).runTurn("Recover MARS-RELAY-204.");

    const stepIds = requestStepIds(session.events);
    expect(stepIds).toEqual(result.stepIds);
    expect(stepIds.map((stepId) => buildRequest(session.events, stepId))).toEqual(
      llm.requests,
    );
  });

  it("keeps raw telemetry while the rebuilt request contains only its projection", async () => {
    const llm = new ScriptedLlm(createMarsAuditReplies());
    const { context, session } = await composeM03Runtime(llm);
    await new Agent({ llm, context, systemPrompt: "Audit." }).runTurn("Recover.");

    const raw = session.events.find(
      (event) => event.type === "tool/result" && event.name === "read_incident_packet",
    );
    expect(raw?.type === "tool/result" ? raw.content : "").toContain("T+35");
    expect(raw?.type === "tool/result" ? raw.content : "").not.toContain("characters omitted");

    const request = buildRequest(session.events, "turn-1-step-2");
    const projected = request.messages.find(
      (message) => message.role === "tool" && message.name === "read_incident_packet",
    );
    expect(projected?.content).toContain("characters omitted");
  });

  it("uses the newest checkpoint for projection without deleting covered events", async () => {
    const llm = new ScriptedLlm(createMarsAuditReplies());
    const { context, session } = await composeM03Runtime(llm);
    await new Agent({
      llm,
      context,
      systemPrompt: "Audit.",
      checkpointBeforeStep: ({ step, events }) =>
        step === 3
          ? {
              summary: "Incident inspected; ASTER selected and accepted by the verifier.",
              coveredThroughEventId: events.at(-1)?.id ?? 0,
            }
          : undefined,
    }).runTurn("Recover.");

    const checkpoint = session.events.find((event) => event.type === "context/checkpoint");
    const rawTelemetry = session.events.find(
      (event) => event.type === "tool/result" && event.name === "read_incident_packet",
    );
    expect(checkpoint).toBeDefined();
    expect(rawTelemetry).toBeDefined();

    const third = buildRequest(session.events, "turn-1-step-3");
    expect(third.messages).toEqual([
      expect.objectContaining({ role: "system", content: expect.stringContaining("ASTER selected") }),
    ]);
    expect(llm.requests[2]).toEqual(third);
  });

  it("replays a trace from the same events", async () => {
    const llm = new ScriptedLlm(createMarsAuditReplies());
    const { context, session } = await composeM03Runtime(llm);
    await new Agent({ llm, context, systemPrompt: "Audit." }).runTurn("Recover.");
    const trace = replayTrace(session.events);
    expect(trace.map((item) => item.type)).toEqual(session.events.map((event) => event.type));
    expect(trace.find((item) => item.type === "tool/call")?.title).toBe(
      "call read_incident_packet",
    );
  });
});
