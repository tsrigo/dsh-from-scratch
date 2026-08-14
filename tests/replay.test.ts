import { describe, expect, it } from "vitest";
import { ReplayRecorder, assertValidLiveReplay } from "../src/replay.js";
import { SessionLog } from "../src/session.js";

describe("live replay recording", () => {
  it("combines timed session receipts with streamed model deltas", () => {
    let now = 100;
    const session = new SessionLog();
    const recorder = new ReplayRecorder({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      scenario: "test",
      clock: () => now,
      recordedAt: () => "2026-08-14T00:00:00.000Z",
    });
    recorder.observeSession(session);
    session.append({ type: "goal/created", goalId: "goal-1", objective: "Fix CHECKOUT-417", maxRounds: 3 });
    for (let round = 1; round <= 3; round += 1) {
      now += 10;
      session.append({ type: "goal/round-started", goalId: "goal-1", round, label: `round-${round}` });
      const stepId = `turn-${round}-step-1`;
      now += 5;
      recorder.observeModel({ stepId, event: { type: "content-delta", content: `第${round}轮` } });
      now += 5;
      recorder.observeModel({
        stepId,
        event: {
          type: "response",
          response: { message: { role: "assistant", content: `第${round}轮`, toolCalls: [] } },
        },
      });
    }
    session.append({ type: "goal/status-changed", goalId: "goal-1", status: "completed", reason: "done" });

    const recording = recorder.finish({
      goal: {
        goalId: "goal-1",
        objective: "Fix CHECKOUT-417",
        status: "completed",
        roundsStarted: 3,
        maxRounds: 3,
        reason: "done",
      },
      acceptedPatch: "CHECKOUT-417",
      activePlugins: [],
    });

    expect(recording.provenance.durationMs).toBe(60);
    expect(recording.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: recording.events.length }, (_, index) => index + 1),
    );
    expect(() => assertValidLiveReplay(structuredClone(recording))).not.toThrow();
  });

  it("rejects a completed response without a streamed delta", () => {
    const invalid = {
      schemaVersion: 2,
      provenance: {
        provider: "deepseek",
        model: "model",
        recordedAt: "2026-08-14T00:00:00.000Z",
        scenario: "test",
        stream: true,
        durationMs: 10,
      },
      goal: { status: "completed", roundsStarted: 3 },
      outcome: { acceptedPatch: "CHECKOUT-417", capabilityRemoved: true },
      events: [
        ...[1, 2, 3].map((round, index) => ({
          sequence: index + 1,
          atMs: index,
          source: "session",
          event: { type: "goal/round-started", round },
        })),
        {
          sequence: 4,
          atMs: 4,
          source: "model",
          stepId: "step-1",
          event: { type: "response", response: {} },
        },
      ],
    };
    expect(() => assertValidLiveReplay(invalid)).toThrow("streamed delta");
  });
});
