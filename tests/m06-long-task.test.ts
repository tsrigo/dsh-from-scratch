import { describe, expect, it, vi } from "vitest";
import { LongTaskRunner } from "../src/long-task.js";
import { createLongTaskAuditReplies, ScriptedLlm } from "../src/llm-fake.js";
import { runMarsLongTask } from "../src/scenario.js";
import { SessionLog } from "../src/session.js";

describe("M06 long task rounds", () => {
  it("advances the same relay goal through survey, score, and submit rounds", async () => {
    const llm = new ScriptedLlm(createLongTaskAuditReplies());
    const result = await runMarsLongTask(llm);

    expect(result.goal).toMatchObject({ status: "completed", roundsStarted: 3 });
    expect(result.submission.acceptedPlan?.routeId).toBe("ASTER");
    expect(result.context.inspect().plugins).not.toContain("capability:route_scoring");
    expect(
      result.session.events
        .filter((event) => event.type === "goal/round-started")
        .map((event) => (event.type === "goal/round-started" ? event.label : "")),
    ).toEqual(["survey", "score", "submit"]);
  });

  it("uses one bounded follow-up turn after concrete installation progress", async () => {
    const llm = new ScriptedLlm([
      ...createLongTaskAuditReplies().slice(0, 2),
      {
        message: {
          role: "assistant",
          content: "Install first.",
          toolCalls: [{ id: "install-only", name: "install_capability", arguments: { name: "route_scoring" } }],
        },
      },
      { message: { role: "assistant", content: "Installation complete.", toolCalls: [] } },
      {
        message: {
          role: "assistant",
          content: "Now use the newly visible tool.",
          toolCalls: [{ id: "score-follow-up", name: "score_routes", arguments: {} }],
        },
      },
      { message: { role: "assistant", content: "ASTER is eligible.", toolCalls: [] } },
      ...createLongTaskAuditReplies().slice(5),
    ]);
    const result = await runMarsLongTask(llm);

    expect(result.goal).toMatchObject({ status: "completed", roundsStarted: 3 });
    expect(
      result.session.events.filter((event) => event.type === "turn/start"),
    ).toHaveLength(4);
    expect(
      result.session.events.filter(
        (event) => event.type === "tool/result" && event.name === "score_routes",
      ),
    ).toHaveLength(1);
  });

  it("uses one bounded follow-up after a rejected submission", async () => {
    const replies = createLongTaskAuditReplies().slice(0, 5);
    replies.push(
      {
        message: {
          role: "assistant",
          content: "Remove the experiment and attempt a plan.",
          toolCalls: [
            { id: "remove-before-correction", name: "remove_capability", arguments: { name: "route_scoring" } },
            {
              id: "rejected-plan",
              name: "submit_recovery_plan",
              arguments: {
                routeId: "BOREAL",
                isolateRelay: "RELAY-7",
                reasonCode: "THERMAL_DRIFT",
              },
            },
          ],
        },
      },
      { message: { role: "assistant", content: "That attempt finished.", toolCalls: [] } },
      {
        message: {
          role: "assistant",
          content: "Correcting the rejected plan.",
          toolCalls: [
            {
              id: "corrected-plan",
              name: "submit_recovery_plan",
              arguments: {
                reasonCode: "THERMAL_DRIFT",
                isolateRelay: "RELAY-7",
                routeId: "ASTER",
              },
            },
          ],
        },
      },
      { message: { role: "assistant", content: "Correction accepted.", toolCalls: [] } },
    );
    const result = await runMarsLongTask(new ScriptedLlm(replies));
    expect(result.goal.status).toBe("completed");
    expect(result.submission.acceptedPlan?.routeId).toBe("ASTER");
  });

  it("stops blocked when a round reports no progress", async () => {
    const session = new SessionLog();
    const runRound = vi.fn().mockResolvedValue({ progressed: false });
    const result = await new LongTaskRunner({
      objective: "Blocked fixture",
      rounds: [{ label: "stuck", input: "try" }],
      maxRounds: 3,
      session,
      runRound,
    }).run();

    expect(result).toMatchObject({ status: "blocked", roundsStarted: 1 });
    expect(result.reason).toContain("no observable progress");
    expect(session.events.at(-1)).toMatchObject({
      type: "goal/status-changed",
      status: "blocked",
    });
  });

  it("stops explicitly at the configured round limit", async () => {
    const session = new SessionLog();
    const result = await new LongTaskRunner({
      objective: "Bounded fixture",
      rounds: [
        { label: "one", input: "one" },
        { label: "two", input: "two" },
      ],
      maxRounds: 2,
      session,
      runRound: async () => ({ progressed: true }),
    }).run();

    expect(result).toMatchObject({ status: "max-rounds", roundsStarted: 2 });
    expect(result.reason).toContain("configured 2 rounds");
  });
});
