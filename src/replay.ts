import type { LongTaskState } from "./long-task.js";
import type { LlmStreamEvent } from "./protocol.js";
import type { SessionEvent, SessionLog } from "./session.js";

export interface ReplayProvenance {
  provider: string;
  model: string;
  recordedAt: string;
  scenario: string;
  stream: true;
  durationMs: number;
}

export type ReplayEvent =
  | {
      sequence: number;
      atMs: number;
      source: "session";
      event: SessionEvent;
    }
  | {
      sequence: number;
      atMs: number;
      source: "model";
      stepId: string;
      event: LlmStreamEvent;
    };

export interface LiveReplayRecording {
  schemaVersion: 2;
  provenance: ReplayProvenance;
  goal: LongTaskState;
  outcome: {
    acceptedPatch: string;
    capabilityRemoved: boolean;
  };
  events: ReplayEvent[];
}

export interface ReplayRecorderOptions {
  provider: string;
  model: string;
  scenario: string;
  clock?: () => number;
  recordedAt?: () => string;
}

export class ReplayRecorder {
  readonly #options: ReplayRecorderOptions;
  readonly #clock: () => number;
  readonly #startedAt: number;
  readonly #events: ReplayEvent[] = [];
  #lastAtMs = 0;

  constructor(options: ReplayRecorderOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => performance.now());
    this.#startedAt = this.#clock();
  }

  observeSession(session: SessionLog): () => void {
    return session.subscribe((event) => this.#push({ source: "session", event }));
  }

  observeModel(observation: { stepId: string; event: LlmStreamEvent }): void {
    this.#push({ source: "model", ...observation });
  }

  finish(input: {
    goal: LongTaskState;
    acceptedPatch: string | null;
    activePlugins: readonly string[];
  }): LiveReplayRecording {
    const recording: LiveReplayRecording = {
      schemaVersion: 2,
      provenance: {
        provider: this.#options.provider,
        model: this.#options.model,
        recordedAt: this.#options.recordedAt?.() ?? new Date().toISOString(),
        scenario: this.#options.scenario,
        stream: true,
        durationMs: this.#elapsed(),
      },
      goal: structuredClone(input.goal),
      outcome: {
        acceptedPatch: input.acceptedPatch ?? "",
        capabilityRemoved: !input.activePlugins.includes("capability:typescript_analysis"),
      },
      events: structuredClone(this.#events),
    };
    assertValidLiveReplay(recording);
    return recording;
  }

  #push(value: Omit<ReplayEvent, "sequence" | "atMs">): void {
    const event = {
      ...structuredClone(value),
      sequence: this.#events.length + 1,
      atMs: this.#elapsed(),
    } as ReplayEvent;
    this.#events.push(event);
  }

  #elapsed(): number {
    const elapsed = Math.max(this.#lastAtMs, Math.round(this.#clock() - this.#startedAt));
    this.#lastAtMs = elapsed;
    return elapsed;
  }
}

export function assertValidLiveReplay(value: unknown): asserts value is LiveReplayRecording {
  if (!isRecord(value)) throw new Error("Live replay must be a JSON object.");
  if (value.schemaVersion !== 2) throw new Error("Unsupported live replay schema version.");
  const provenance = value.provenance;
  if (
    !isRecord(provenance) ||
    !nonEmptyString(provenance.provider) ||
    !nonEmptyString(provenance.model) ||
    !nonEmptyString(provenance.recordedAt) ||
    !nonEmptyString(provenance.scenario) ||
    provenance.stream !== true ||
    !nonNegativeNumber(provenance.durationMs)
  ) {
    throw new Error("Live replay provenance is incomplete.");
  }
  const goal = value.goal;
  if (!isRecord(goal) || goal.status !== "completed" || goal.roundsStarted !== 3) {
    throw new Error("Live replay must contain one completed three-round goal.");
  }
  const outcome = value.outcome;
  if (
    !isRecord(outcome) ||
    outcome.acceptedPatch !== "CHECKOUT-417" ||
    outcome.capabilityRemoved !== true
  ) {
    throw new Error("Live replay did not finish with CHECKOUT-417 accepted and the experiment removed.");
  }
  if (!Array.isArray(value.events) || value.events.length === 0) {
    throw new Error("Live replay contains no events.");
  }

  let lastAtMs = 0;
  const deltaSteps = new Set<string>();
  const responseSteps = new Set<string>();
  let roundCount = 0;
  for (const [index, rawEvent] of value.events.entries()) {
    if (
      !isRecord(rawEvent) ||
      rawEvent.sequence !== index + 1 ||
      !nonNegativeNumber(rawEvent.atMs) ||
      rawEvent.atMs < lastAtMs
    ) {
      throw new Error(`Live replay event ${index + 1} has an invalid sequence or timestamp.`);
    }
    lastAtMs = rawEvent.atMs;
    if (rawEvent.source === "session") {
      if (!isRecord(rawEvent.event) || !nonEmptyString(rawEvent.event.type)) {
        throw new Error(`Live replay session event ${index + 1} is invalid.`);
      }
      if (rawEvent.event.type === "goal/round-started") roundCount += 1;
      continue;
    }
    if (
      rawEvent.source !== "model" ||
      !nonEmptyString(rawEvent.stepId) ||
      !isRecord(rawEvent.event) ||
      !nonEmptyString(rawEvent.event.type)
    ) {
      throw new Error(`Live replay model event ${index + 1} is invalid.`);
    }
    if (rawEvent.event.type === "content-delta" || rawEvent.event.type === "tool-call-delta") {
      deltaSteps.add(rawEvent.stepId);
    }
    if (rawEvent.event.type === "response") responseSteps.add(rawEvent.stepId);
  }
  if (roundCount !== 3) throw new Error("Live replay must contain all three round-started events.");
  if (responseSteps.size === 0 || [...responseSteps].some((stepId) => !deltaSteps.has(stepId))) {
    throw new Error("Every recorded model response must include at least one streamed delta.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
