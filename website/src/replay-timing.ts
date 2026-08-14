// Only streamed model chunks follow the selected speed. Empty network waits and
// Harness bookkeeping use short semantic pauses so the replay never looks stuck.
export const REPLAY_BASELINE_SPEED = 1 / 2;
export const REPLAY_IDLE_DELAY_MS = 650;
export const REPLAY_TRANSITION_DELAY_MS = 280;
export const REPLAY_RECEIPT_DELAY_MS = 90;
export const REPLAY_CONTEXT_HOLD_MS = 1_400;
export const REPLAY_TOOL_HOLD_MS = 1_100;
export const REPLAY_SESSION_HOLD_MS = 1_400;
export const REPLAY_MODEL_SETTLE_HOLD_MS = 420;

export type ReplayDelayKind = "stream" | "idle" | "transition" | "receipt";
export type ReplayStageNode = "context" | "model" | "tool" | "session" | null;

export interface ReplayTimingEvent {
  atMs: number;
  source: "session" | "model";
  stepId?: string;
  event: Record<string, unknown> & { type: string };
}

export interface ReplayFrame {
  start: number;
  end: number;
}

export function replayDelay(rawGap: number, speed: number, kind: ReplayDelayKind): number {
  if (speed <= 0) throw new Error("Replay speed must be greater than zero.");
  if (kind === "idle") return REPLAY_IDLE_DELAY_MS;
  if (kind === "transition") return REPLAY_TRANSITION_DELAY_MS;
  if (kind === "receipt") return REPLAY_RECEIPT_DELAY_MS;
  return Math.min(Math.max(0, rawGap), 120) / (speed * REPLAY_BASELINE_SPEED);
}

export function replayStageHold(node: ReplayStageNode, phase: string): number {
  if (node === "context") return REPLAY_CONTEXT_HOLD_MS;
  if (node === "tool") return REPLAY_TOOL_HOLD_MS;
  if (node === "session") return REPLAY_SESSION_HOLD_MS;
  if (node === "model" && phase === "settle") return REPLAY_MODEL_SETTLE_HOLD_MS;
  return 0;
}

export function replayEventGroup(item: ReplayTimingEvent): string | null {
  const type = item.event.type;
  if (item.source === "model") return `${type}:${item.stepId ?? "unknown"}`;
  if (type === "runtime/plugin-mounted" || type === "runtime/plugin-unmounted") {
    const plugin = typeof item.event.plugin === "string" ? item.event.plugin : "";
    return plugin.startsWith("capability:") ? type : null;
  }
  if (
    type === "goal/created" ||
    type === "goal/round-started" ||
    type === "goal/status-changed" ||
    type === "user/message" ||
    type === "request/header" ||
    type === "tool/call" ||
    type === "tool/result"
  ) {
    return type;
  }
  return null;
}

export function nextReplayFrame(
  events: readonly ReplayTimingEvent[],
  cursor: number,
): ReplayFrame | null {
  let nextIndex = cursor + 1;
  while (nextIndex < events.length && replayEventGroup(events[nextIndex]!) === null) {
    nextIndex += 1;
  }
  const next = events[nextIndex];
  if (!next) return null;
  const group = replayEventGroup(next);
  let batchEnd = nextIndex;
  while (
    events[batchEnd + 1]?.atMs === next.atMs &&
    replayEventGroup(events[batchEnd + 1]!) === group
  ) {
    batchEnd += 1;
  }
  return { start: nextIndex, end: batchEnd };
}
