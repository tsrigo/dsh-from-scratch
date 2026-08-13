import type { SessionLog } from "./session.js";

export type LongTaskStatus = "active" | "completed" | "blocked" | "max-rounds";

export interface LongTaskState {
  goalId: string;
  objective: string;
  status: LongTaskStatus;
  roundsStarted: number;
  maxRounds: number;
  reason: string;
}

export interface RoundDefinition {
  label: string;
  input: string;
}

export interface RoundResult {
  progressed: boolean;
  completed?: boolean;
  blockedReason?: string;
}

export interface LongTaskOptions {
  objective: string;
  rounds: RoundDefinition[];
  maxRounds: number;
  session: SessionLog;
  runRound(round: RoundDefinition, roundNumber: number): Promise<RoundResult>;
}

export class LongTaskRunner {
  readonly state: LongTaskState;
  readonly #rounds: RoundDefinition[];
  readonly #session: SessionLog;
  readonly #runRound: LongTaskOptions["runRound"];

  constructor(options: LongTaskOptions) {
    if (options.maxRounds < 1) throw new Error("maxRounds must be at least 1.");
    this.state = {
      goalId: "goal-1",
      objective: options.objective,
      status: "active",
      roundsStarted: 0,
      maxRounds: options.maxRounds,
      reason: "Ready to start.",
    };
    this.#rounds = options.rounds;
    this.#session = options.session;
    this.#runRound = options.runRound;
  }

  async run(): Promise<LongTaskState> {
    this.#session.append({
      type: "goal/created",
      goalId: this.state.goalId,
      objective: this.state.objective,
      maxRounds: this.state.maxRounds,
    });

    while (this.state.status === "active") {
      if (this.state.roundsStarted >= this.state.maxRounds) {
        return this.#finish(
          "max-rounds",
          `Stopped after the configured ${this.state.maxRounds} rounds.`,
        );
      }
      const definition = this.#rounds[this.state.roundsStarted];
      if (!definition) {
        return this.#finish("blocked", "No next round is defined for the active goal.");
      }

      this.state.roundsStarted += 1;
      this.#session.append({
        type: "goal/round-started",
        goalId: this.state.goalId,
        round: this.state.roundsStarted,
        label: definition.label,
      });
      const result = await this.#runRound(definition, this.state.roundsStarted);

      if (result.completed) {
        return this.#finish("completed", `Completed in round ${this.state.roundsStarted}.`);
      }
      if (result.blockedReason) return this.#finish("blocked", result.blockedReason);
      if (!result.progressed) {
        return this.#finish(
          "blocked",
          `Round ${this.state.roundsStarted} produced no observable progress.`,
        );
      }
      if (this.state.roundsStarted >= this.state.maxRounds) {
        return this.#finish(
          "max-rounds",
          `Stopped after the configured ${this.state.maxRounds} rounds.`,
        );
      }
      this.state.reason = `Round ${this.state.roundsStarted} made progress; continuing.`;
    }
    return structuredClone(this.state);
  }

  #finish(status: Exclude<LongTaskStatus, "active">, reason: string): LongTaskState {
    this.state.status = status;
    this.state.reason = reason;
    this.#session.append({
      type: "goal/status-changed",
      goalId: this.state.goalId,
      status,
      reason,
    });
    return structuredClone(this.state);
  }
}
