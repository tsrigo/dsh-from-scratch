import { Agent } from "./agent.js";
import {
  BUGGY_RETURN,
  FIXED_RETURN,
  ISSUE_ID,
  SOURCE_PATH,
  type CheckoutWorkspaceFixture,
  type CheckoutWorkspaceState,
} from "./checkout-workspace.js";
import { LongTaskRunner, type LongTaskState } from "./long-task.js";
import type { Llm, LlmStreamEvent } from "./protocol.js";
import { composeRuntime } from "./plugins.js";
import type { Context } from "./runtime.js";
import type { SessionEvent, SessionLog } from "./session.js";

export interface CheckoutLongTaskResult {
  goal: LongTaskState;
  context: Context;
  session: SessionLog;
  workspace: CheckoutWorkspaceState;
}

export async function runCheckoutLongTask(
  llm: Llm,
  options: {
    fixture?: CheckoutWorkspaceFixture;
    session?: SessionLog;
    responseLanguage?: "zh-CN";
    onModelEvent?: (event: { stepId: string; event: LlmStreamEvent }) => void;
  } = {},
): Promise<CheckoutLongTaskResult> {
  const runtime = await composeRuntime(llm, {
    ...(options.fixture ? { fixture: options.fixture } : {}),
    ...(options.session ? { session: options.session } : {}),
  });
  const agent = new Agent({
    llm,
    context: runtime.context,
    systemPrompt:
      "You are a careful coding agent working on CHECKOUT-417. Use only bounded workspace tools. Read before editing, make the smallest exact patch, run tests, and never claim success without an accepted submit_patch result. In each round, perform exactly the requested actions and do not repeat actions whose successful results are already in history." +
      (options.responseLanguage === "zh-CN"
        ? " Write narrative responses in concise Simplified Chinese; keep tool names, paths, symbols, and patch text unchanged."
        : ""),
    maxSteps: 10,
    dynamicContext: (step) => `Current model step within this round: ${step}`,
    ...(options.onModelEvent ? { onModelEvent: options.onModelEvent } : {}),
  });

  const runner = new LongTaskRunner({
    objective: `Fix ${ISSUE_ID}, verify every calculateTotal caller, and submit an accepted patch.`,
    maxRounds: 3,
    session: runtime.session,
    rounds: [
      {
        label: "diagnose",
        input: "Round 1/3 — call inspect_runtime exactly once. Read issue.md, src/checkout.ts, tests/checkout.test.ts, and ci.log exactly once each. Diagnose the duplicate discount, then finish this turn without editing.",
      },
      {
        label: "repair",
        input: `Round 2/3 — apply one exact patch in ${SOURCE_PATH}: replace ${JSON.stringify(BUGGY_RETURN)} with ${JSON.stringify(FIXED_RETURN)}. Then call run_tests exactly once and finish this turn without installing capabilities or submitting.`,
      },
      {
        label: "verify-submit",
        input: "Round 3/3 — install typescript_analysis exactly once. On the next model step call find_references for calculateTotal and check_types exactly once each. Then remove typescript_analysis, submit the tested patch exactly once, and finish.",
      },
    ],
    async runRound(round, roundNumber) {
      const before = runtime.session.events.length;
      await agent.runTurn(round.input);
      let events = runtime.session.events.slice(before);

      if (
        !hasExpectedEvidence(roundNumber, events, runtime.state) &&
        hasConcretePartialProgress(roundNumber, events, runtime.context.inspect().plugins)
      ) {
        await agent.runTurn(followUpInstruction(roundNumber, events, runtime.state));
        events = runtime.session.events.slice(before);
      }

      const progressed = hasExpectedEvidence(roundNumber, events, runtime.state);
      const completed =
        roundNumber === 3 &&
        runtime.state.acceptedPatch !== null &&
        !runtime.context.inspect().plugins.includes("capability:typescript_analysis");
      return { progressed, completed };
    },
  });

  const goal = await runner.run();
  return {
    goal,
    context: runtime.context,
    session: runtime.session,
    workspace: runtime.state,
  };
}

function toolResultNames(events: readonly SessionEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "tool/result" ? [event.name] : [],
  );
}

function hasExpectedEvidence(
  roundNumber: number,
  events: readonly SessionEvent[],
  state: CheckoutWorkspaceState,
): boolean {
  const names = toolResultNames(events);
  if (roundNumber === 1) {
    return names.includes("inspect_runtime") && names.filter((name) => name === "read_workspace_file").length >= 4;
  }
  if (roundNumber === 2) {
    return names.includes("apply_patch") && names.includes("run_tests") && state.testsPassed;
  }
  return state.acceptedPatch !== null && names.includes("find_references") && names.includes("check_types");
}

function hasConcretePartialProgress(
  roundNumber: number,
  events: readonly SessionEvent[],
  plugins: string[],
): boolean {
  const names = toolResultNames(events);
  if (roundNumber === 1) return names.includes("inspect_runtime") || names.includes("read_workspace_file");
  if (roundNumber === 2) return names.includes("apply_patch") || names.includes("run_tests");
  return (
    names.some((name) =>
      [
        "install_capability",
        "find_references",
        "check_types",
        "remove_capability",
        "submit_patch",
      ].includes(name),
    ) || plugins.includes("capability:typescript_analysis")
  );
}

function followUpInstruction(
  roundNumber: number,
  events: readonly SessionEvent[],
  state: CheckoutWorkspaceState,
): string {
  const names = toolResultNames(events);
  if (roundNumber === 1) {
    const reads = names.filter((name) => name === "read_workspace_file").length;
    return `Round 1 follow-up — inspection made concrete progress, but only ${reads}/4 required files were read. Read each missing fixed path exactly once, then finish without editing.`;
  }
  if (roundNumber === 2) {
    const actions = [
      ...(names.includes("apply_patch")
        ? []
        : [`apply the exact ${SOURCE_PATH} replacement from ${JSON.stringify(BUGGY_RETURN)} to ${JSON.stringify(FIXED_RETURN)}`]),
      ...(state.testsPassed ? [] : ["call run_tests exactly once after the patch"]),
    ];
    return `Round 2 follow-up — ${actions.join(" and ")}. Then finish without installing or submitting.`;
  }
  const installed = names.includes("install_capability") ||
    names.includes("find_references") ||
    names.includes("check_types");
  const actions = [
    ...(installed ? [] : ["install typescript_analysis exactly once"]),
    ...(names.includes("find_references") ? [] : ["call find_references for calculateTotal exactly once after installation"]),
    ...(names.includes("check_types") ? [] : ["call check_types exactly once after installation"]),
    ...(names.includes("remove_capability") ? [] : ["remove typescript_analysis exactly once after analysis"]),
    ...(!state.testsPassed
      ? [
          `restore the exact ${SOURCE_PATH} fix from ${JSON.stringify(BUGGY_RETURN)} to ${JSON.stringify(FIXED_RETURN)}`,
          "call run_tests exactly once after restoring the fix",
        ]
      : []),
    ...(state.acceptedPatch ? [] : ["submit the tested CHECKOUT-417 patch exactly once"]),
  ];
  return `Round 3 follow-up — ${actions.join(", then ")}. Finish after submit_patch returns accepted; do not reinstall anything.`;
}
