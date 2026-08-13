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
      "You are a careful relay recovery auditor. Use bounded tools, make each round's requested progress, and clean up experiments.",
    maxSteps: 5,
    dynamicContext: (step) => `Current model step within this round: ${step}`,
  });

  const runner = new LongTaskRunner({
    objective: "Recover incident MARS-RELAY-204 with a verified plan.",
    maxRounds: 3,
    session: runtime.session,
    rounds: [
      {
        label: "survey",
        input: "Round 1/3 — inspect the runtime and read the incident packet. Stop after the facts are observed.",
      },
      {
        label: "score",
        input: "Round 2/3 — install route_scoring from the trusted catalog, score the routes, and retain the result for submission.",
      },
      {
        label: "submit",
        input: "Round 3/3 — remove route_scoring, submit the uniquely valid recovery plan, and report completion.",
      },
    ],
    async runRound(round, roundNumber) {
      const before = runtime.session.events.length;
      await agent.runTurn(round.input);
      const events = runtime.session.events.slice(before);
      const results = events.filter((event) => event.type === "tool/result");
      const names = results.map((event) => (event.type === "tool/result" ? event.name : ""));
      const expected = roundNumber === 1 ? "read_incident_packet" : roundNumber === 2 ? "score_routes" : "submit_recovery_plan";
      const progressed = names.includes(expected);
      const completed =
        roundNumber === 3 &&
        runtime.state.acceptedPlan !== null &&
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
