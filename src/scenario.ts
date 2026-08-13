import { Agent } from "./agent.js";
import type { SubmissionState } from "./incident.js";
import type { IncidentPacket } from "./incident.js";
import { LongTaskRunner, type LongTaskState } from "./long-task.js";
import type { Llm } from "./protocol.js";
import { composeRuntime } from "./plugins.js";
import type { Context } from "./runtime.js";
import type { SessionLog } from "./session.js";

export interface MarsLongTaskResult {
  goal: LongTaskState;
  context: Context;
  session: SessionLog;
  submission: SubmissionState;
}

export async function runMarsLongTask(
  llm: Llm,
  options: { packet?: IncidentPacket } = {},
): Promise<MarsLongTaskResult> {
  const runtime = await composeRuntime(llm, options);
  const agent = new Agent({
    llm,
    context: runtime.context,
    systemPrompt:
      "You are a careful relay recovery auditor. Use only bounded tools. In each round, perform exactly the requested actions, then return a concise factual summary with no further tool calls. Never repeat an action whose tool result is already in history.",
    maxSteps: 8,
    dynamicContext: (step) => `Current model step within this round: ${step}`,
  });

  const runner = new LongTaskRunner({
    objective: "Recover incident MARS-RELAY-204 with a verified plan.",
    maxRounds: 3,
    session: runtime.session,
    rounds: [
      {
        label: "survey",
        input: "Round 1/3 — call inspect_runtime exactly once and read_incident_packet exactly once. After both results arrive, finish this turn with a concise survey; do not install anything.",
      },
      {
        label: "score",
        input: "Round 2/3 — install route_scoring exactly once. On the next model step, call the newly visible score_routes exactly once. After its result arrives, finish this turn; do not remove the capability yet and do not submit.",
      },
      {
        label: "submit",
        input: "Round 3/3 — remove route_scoring exactly once and submit the uniquely valid recovery plan exactly once. After both results arrive, finish this turn; do not reinstall anything.",
      },
    ],
    async runRound(round, roundNumber) {
      const before = runtime.session.events.length;
      await agent.runTurn(round.input);
      let names = toolResultNames(runtime.session.events.slice(before));
      const expected = expectedTool(roundNumber);
      const hasExpectedEvidence = () =>
        roundNumber === 3 ? runtime.state.acceptedPlan !== null : names.includes(expected);

      if (!hasExpectedEvidence() && hasConcretePartialProgress(roundNumber, names, runtime.context.inspect().plugins)) {
        await agent.runTurn(followUpInstruction(roundNumber, names));
        names = toolResultNames(runtime.session.events.slice(before));
      }

      const progressed = hasExpectedEvidence();
      const completed = roundNumber === 3 && runtime.state.acceptedPlan !== null &&
        !runtime.context.inspect().plugins.includes("capability:route_scoring");
      return { progressed, completed };
    },
  });

  const goal = await runner.run();
  return {
    goal,
    context: runtime.context,
    session: runtime.session,
    submission: runtime.state,
  };
}

function toolResultNames(events: readonly { type: string; name?: string }[]): string[] {
  return events.flatMap((event) => event.type === "tool/result" && event.name ? [event.name] : []);
}

function expectedTool(roundNumber: number): string {
  return roundNumber === 1
    ? "read_incident_packet"
    : roundNumber === 2
      ? "score_routes"
      : "submit_recovery_plan";
}

function hasConcretePartialProgress(
  roundNumber: number,
  names: string[],
  plugins: string[],
): boolean {
  if (roundNumber === 1) return names.includes("inspect_runtime");
  if (roundNumber === 2) {
    return names.includes("install_capability") && plugins.includes("capability:route_scoring");
  }
  return names.includes("remove_capability") || names.includes("submit_recovery_plan");
}

function followUpInstruction(roundNumber: number, names: string[]): string {
  if (roundNumber === 1) {
    return "Round 1 follow-up — inspect_runtime succeeded. Call read_incident_packet exactly once, then finish this turn.";
  }
  if (roundNumber === 2) {
    return "Round 2 follow-up — route_scoring is mounted and score_routes is now visible. Call score_routes exactly once, then finish this turn; do not remove it yet.";
  }
  const missing = [
    ...(names.includes("remove_capability") ? [] : ["remove route_scoring exactly once"]),
    ...(names.includes("submit_recovery_plan")
      ? ["the previous submission was rejected; submit a corrected ASTER / RELAY-7 / THERMAL_DRIFT plan exactly once"]
      : ["submit the ASTER / RELAY-7 / THERMAL_DRIFT recovery plan exactly once"]),
  ];
  return `Round 3 follow-up — ${missing.join(" and ")}. Then finish this turn without reinstalling anything.`;
}
