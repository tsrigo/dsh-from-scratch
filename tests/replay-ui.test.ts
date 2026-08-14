import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildReplayGenerations, extractReplayInstructions } from "../website/src/App.js";
import type { LiveReplay, LiveReplayEvent } from "../website/src/types.js";

describe("live replay reading flow", () => {
  it("keeps each Harness result beside the model tool call that produced it", () => {
    const events: LiveReplayEvent[] = [
      {
        sequence: 1,
        atMs: 0,
        source: "session",
        event: { type: "request/header", stepId: "turn-1-step-1" },
      },
      {
        sequence: 2,
        atMs: 10,
        source: "model",
        stepId: "turn-1-step-1",
        event: {
          type: "tool-call-delta",
          index: 0,
          id: "call-inspect",
          name: "inspect_runtime",
          arguments: "{}",
        },
      },
      {
        sequence: 3,
        atMs: 20,
        source: "model",
        stepId: "turn-1-step-1",
        event: {
          type: "response",
          response: {
            providerMetadata: { completionTokens: 47 },
          },
        },
      },
      {
        sequence: 4,
        atMs: 30,
        source: "session",
        event: {
          type: "tool/result",
          stepId: "turn-1-step-1",
          toolCallId: "call-inspect",
          name: "inspect_runtime",
          content: "{}",
        },
      },
    ];

    expect(buildReplayGenerations(events)).toEqual([
      expect.objectContaining({
        stepId: "turn-1-step-1",
        done: true,
        completionTokens: 47,
        tools: [
          expect.objectContaining({
            name: "inspect_runtime",
            arguments: "{}",
            result: {
              name: "inspect_runtime",
              summary: "当前插件、服务和受信任能力目录已返回。",
            },
          }),
        ],
      }),
    ]);
  });

  it("extracts the exact system, user, and dynamic instructions from the recording", () => {
    const events: LiveReplayEvent[] = [
      {
        sequence: 1,
        atMs: 0,
        source: "session",
        event: {
          type: "user/message",
          turnId: "turn-1",
          content: "Call inspect_runtime exactly once.",
        },
      },
      {
        sequence: 2,
        atMs: 0,
        source: "session",
        event: {
          type: "request/header",
          stepId: "turn-1-step-1",
          system: "Use only bounded tools.",
          dynamicContext: "Current step: 1",
        },
      },
    ];

    expect(extractReplayInstructions(events)).toEqual({
      systems: [{ stepId: "turn-1-step-1", content: "Use only bounded tools." }],
      users: [{ turnId: "turn-1", content: "Call inspect_runtime exactly once." }],
      dynamicContexts: ["Current step: 1"],
    });
  });

  it("keeps the committed live recording complete and self-contained", () => {
    const replay = JSON.parse(
      readFileSync(new URL("../docs/replays/checkout-live.json", import.meta.url), "utf8"),
    ) as LiveReplay;
    const generations = buildReplayGenerations(replay.events);
    const instructions = extractReplayInstructions(replay.events);

    expect(replay.provenance.scenario).toBe("修复购物车重复优惠 Bug");
    expect(replay.goal.status).toBe("completed");
    expect(generations).toHaveLength(10);
    expect(generations.every((generation) => generation.done)).toBe(true);
    expect(generations.flatMap((generation) => generation.tools)).toHaveLength(12);
    expect(
      generations.flatMap((generation) => generation.tools).every((tool) => tool.result),
    ).toBe(true);
    expect(instructions.users).toHaveLength(3);
    expect(instructions.users[0]?.content).toContain("Read issue.md");
    expect(instructions.systems[0]?.content).toContain("CHECKOUT-417");
    expect(instructions.dynamicContexts).toEqual([
      "Current model step within this round: 1",
      "Current model step within this round: 2",
      "Current model step within this round: 3",
      "Current model step within this round: 4",
      "Current model step within this round: 5",
    ]);
  });
});
