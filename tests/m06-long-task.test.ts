import { describe, expect, it, vi } from "vitest";
import { BUGGY_RETURN, FIXED_RETURN, SOURCE_PATH } from "../src/checkout-workspace.js";
import { LongTaskRunner } from "../src/long-task.js";
import { createLongTaskBugFixReplies, ScriptedLlm } from "../src/llm-fake.js";
import { runCheckoutLongTask } from "../src/scenario.js";
import { SessionLog } from "../src/session.js";

describe("M06 long task rounds", () => {
  it("advances CHECKOUT-417 through diagnosis, repair, and verified submission", async () => {
    const llm = new ScriptedLlm(createLongTaskBugFixReplies());
    const result = await runCheckoutLongTask(llm);

    expect(result.goal).toMatchObject({ status: "completed", roundsStarted: 3 });
    expect(result.workspace.acceptedPatch?.issueId).toBe("CHECKOUT-417");
    expect(result.context.inspect().plugins).not.toContain("capability:typescript_analysis");
    expect(
      result.session.events
        .filter((event) => event.type === "goal/round-started")
        .map((event) => (event.type === "goal/round-started" ? event.label : "")),
    ).toEqual(["diagnose", "repair", "verify-submit"]);
  });

  it("uses one bounded follow-up turn after concrete installation progress", async () => {
    const llm = new ScriptedLlm([
      ...createLongTaskBugFixReplies().slice(0, 5),
      {
        message: {
          role: "assistant",
          content: "Install first.",
          toolCalls: [{
            id: "install-only",
            name: "install_capability",
            arguments: { name: "typescript_analysis" },
          }],
        },
      },
      { message: { role: "assistant", content: "Installation complete.", toolCalls: [] } },
      {
        message: {
          role: "assistant",
          content: "Complete the explicit follow-up.",
          toolCalls: [
            { id: "references-follow-up", name: "find_references", arguments: { symbol: "calculateTotal" } },
            { id: "types-follow-up", name: "check_types", arguments: {} },
            { id: "remove-follow-up", name: "remove_capability", arguments: { name: "typescript_analysis" } },
            { id: "submit-follow-up", name: "submit_patch", arguments: { summary: "Fix duplicate discount." } },
          ],
        },
      },
      { message: { role: "assistant", content: "Patch accepted.", toolCalls: [] } },
    ]);
    const result = await runCheckoutLongTask(llm);

    expect(result.goal).toMatchObject({ status: "completed", roundsStarted: 3 });
    expect(result.session.events.filter((event) => event.type === "turn/start")).toHaveLength(4);
    expect(
      result.session.events.filter(
        (event) => event.type === "tool/result" && event.name === "find_references",
      ),
    ).toHaveLength(1);
  });

  it("uses one bounded follow-up after a rejected patch submission", async () => {
    const replies = createLongTaskBugFixReplies().slice(0, 7);
    replies.push(
      {
        message: {
          role: "assistant",
          content: "Accidentally restore the buggy line before submitting.",
          toolCalls: [
            {
              id: "regress-patch",
              name: "apply_patch",
              arguments: { path: SOURCE_PATH, oldText: FIXED_RETURN, newText: BUGGY_RETURN },
            },
            { id: "remove-before-rejection", name: "remove_capability", arguments: { name: "typescript_analysis" } },
            { id: "rejected-submit", name: "submit_patch", arguments: { summary: "Incorrect patch." } },
          ],
        },
      },
      { message: { role: "assistant", content: "That submission was rejected.", toolCalls: [] } },
      {
        message: {
          role: "assistant",
          content: "Restore, retest, and resubmit the exact fix.",
          toolCalls: [
            {
              id: "restore-fix",
              name: "apply_patch",
              arguments: { path: SOURCE_PATH, oldText: BUGGY_RETURN, newText: FIXED_RETURN },
            },
            { id: "retest", name: "run_tests", arguments: {} },
            { id: "correct-submit", name: "submit_patch", arguments: { summary: "Apply each discount once." } },
          ],
        },
      },
      { message: { role: "assistant", content: "Correction accepted.", toolCalls: [] } },
    );
    const result = await runCheckoutLongTask(new ScriptedLlm(replies));
    expect(result.goal.status).toBe("completed");
    expect(result.workspace.acceptedPatch?.issueId).toBe("CHECKOUT-417");
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
