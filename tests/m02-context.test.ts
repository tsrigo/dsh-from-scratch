import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import {
  clipToolResult,
  compareRequestPrefix,
  DEFAULT_PROJECTION,
  describeRequest,
} from "../src/context.js";
import { createMarsAuditReplies, ScriptedLlm } from "../src/llm-fake.js";
import { composeM03Runtime } from "../src/plugins.js";

describe("M02 context projection", () => {
  it("clips model-visible telemetry while preserving an explicit omission marker", () => {
    const original = "head" + "x".repeat(1_200) + "tail";
    const clipped = clipToolResult(original, DEFAULT_PROJECTION);
    expect(clipped.content.length).toBeLessThan(original.length);
    expect(clipped.content).toContain("characters omitted from the model projection");
    expect(clipped.content.startsWith("head")).toBe(true);
    expect(clipped.content.endsWith("tail")).toBe(true);
    expect(clipped.omittedCharacters).toBeGreaterThan(0);
  });

  it("places stable prompt and tool schemas before append-only history and variable context", async () => {
    const llm = new ScriptedLlm(createMarsAuditReplies());
    const { context } = await composeM03Runtime(llm);
    const result = await new Agent({
      llm,
      context,
      systemPrompt: "Stable system prompt.",
      dynamicContext: (step) => `step=${step}`,
    }).runTurn("Recover the relay.");

    const firstParts = describeRequest(result.requests[0]!);
    expect(firstParts.map((part) => part.kind)).toEqual(["system", "tools", "message", "dynamic"]);
    const incidentResult = result.requests[1]!.messages.find(
      (message) => message.role === "tool" && message.name === "read_incident_packet",
    );
    expect(incidentResult?.content).toContain("characters omitted");

    const prefix = compareRequestPrefix(result.requests[0], result.requests[1]!);
    expect(prefix.sharedParts).toBe(3);
    expect(prefix.firstInvalidation).toBe("assistant");
    expect(prefix.note).toContain("not provider cache usage");
  });
});
