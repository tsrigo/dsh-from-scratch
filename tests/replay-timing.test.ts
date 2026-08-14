import { describe, expect, it } from "vitest";
import {
  REPLAY_BASELINE_SPEED,
  REPLAY_CONTEXT_HOLD_MS,
  REPLAY_IDLE_DELAY_MS,
  REPLAY_SESSION_HOLD_MS,
  nextReplayFrame,
  replayDelay,
  replayStageHold,
} from "../website/src/replay-timing.js";

describe("offline replay timing", () => {
  it("applies the configured baseline at every displayed speed", () => {
    expect(REPLAY_BASELINE_SPEED).toBe(1 / 2);
    expect(replayDelay(100, 1, "stream")).toBe(200);
    expect(replayDelay(100, 2, "stream")).toBe(100);
    expect(replayDelay(100, 0.25, "stream")).toBe(800);
  });

  it("uses a short fixed pause for blank waits and bookkeeping", () => {
    expect(replayDelay(2_000, 0.25, "idle")).toBe(REPLAY_IDLE_DELAY_MS);
    expect(replayDelay(2_000, 2, "idle")).toBe(REPLAY_IDLE_DELAY_MS);
    expect(replayDelay(100, 1, "transition")).toBe(280);
    expect(replayDelay(100, 1, "receipt")).toBe(90);
    expect(() => replayDelay(100, 0, "stream")).toThrow("greater than zero");
  });

  it("holds context and session poses long enough to read", () => {
    expect(replayStageHold("context", "prepare")).toBe(REPLAY_CONTEXT_HOLD_MS);
    expect(replayStageHold("session", "feedback")).toBe(REPLAY_SESSION_HOLD_MS);
    expect(replayStageHold("model", "generate")).toBe(0);
  });

  it("does not collapse same-timestamp tool results into the next request", () => {
    const events = [
      { atMs: 100, source: "model" as const, stepId: "step-1", event: { type: "response" } },
      { atMs: 100, source: "session" as const, event: { type: "assistant/message" } },
      { atMs: 100, source: "session" as const, event: { type: "tool/call", stepId: "step-1" } },
      { atMs: 100, source: "session" as const, event: { type: "tool/call", stepId: "step-1" } },
      { atMs: 100, source: "session" as const, event: { type: "tool/result", stepId: "step-1" } },
      { atMs: 100, source: "session" as const, event: { type: "step/end", stepId: "step-1" } },
      { atMs: 100, source: "session" as const, event: { type: "request/header", stepId: "step-2" } },
    ];

    expect(nextReplayFrame(events, 0)).toEqual({ start: 2, end: 3 });
    expect(nextReplayFrame(events, 3)).toEqual({ start: 4, end: 4 });
    expect(nextReplayFrame(events, 4)).toEqual({ start: 6, end: 6 });
  });
});
