import { Agent } from "../src/agent.js";
import { DEFAULT_PROJECTION } from "../src/context.js";
import {
  createBugFixReplies,
  createCapabilityExperimentReplies,
  createLongTaskBugFixReplies,
  ScriptedLlm,
} from "../src/llm-fake.js";
import { composeM03Runtime, composeRuntime } from "../src/plugins.js";
import type { UnifiedRequest } from "../src/protocol.js";
import type { RuntimeInspection } from "../src/runtime.js";
import { runCheckoutLongTask } from "../src/scenario.js";
import { replayTrace, type SessionEvent, type TraceItem } from "../src/session.js";

interface ScenarioEvidence {
  requests: UnifiedRequest[];
  events: readonly SessionEvent[];
  inspection: RuntimeInspection | null;
  trace: TraceItem[];
  verdict: string;
}

const [id] = process.argv.slice(2);
if (!id) throw new Error("Usage: run-checkpoint <m01..m06>");

let evidence: ScenarioEvidence;
if (id === "m01" || id === "m02" || id === "m03" || id === "m04") {
  const llm = new ScriptedLlm(createBugFixReplies());
  const runtime = await composeM03Runtime(llm);
  const result = await new Agent({
    llm,
    context: runtime.context,
    systemPrompt: "You are a careful coding agent. Fix CHECKOUT-417 with the smallest tested patch.",
    projection: id === "m01"
      ? { maxToolResultChars: 100_000, toolResultHeadChars: 80_000, toolResultTailChars: 10_000 }
      : DEFAULT_PROJECTION,
    ...(id === "m04"
      ? {
          checkpointBeforeStep: ({ step, events }: { step: number; events: readonly { id: number }[] }) =>
            step === 5
              ? {
                  summary: "CHECKOUT-417 inspected, patched, tested, and accepted by the verifier.",
                  coveredThroughEventId: events.at(-1)?.id ?? 0,
                }
              : undefined,
        }
      : {}),
  }).runTurn("Fix CHECKOUT-417 and submit a tested patch.");
  const events = id === "m04" ? runtime.session.events : [];
  evidence = {
    requests: llm.requests,
    events,
    inspection: id === "m03" || id === "m04" ? runtime.context.inspect() : null,
    trace: id === "m04"
      ? replayTrace(runtime.session.events)
      : result.trace.map((item, index) => ({ ...item, eventId: index + 1 })),
    verdict: `${runtime.state.acceptedPatch ? "CHECKOUT-417 accepted" : "rejected"} · ${result.steps} model steps`,
  };
} else if (id === "m05") {
  const llm = new ScriptedLlm(createCapabilityExperimentReplies());
  const runtime = await composeRuntime(llm);
  const result = await new Agent({
    llm,
    context: runtime.context,
    systemPrompt: "Fix CHECKOUT-417, verify TypeScript callers, and clean up temporary experiments.",
    maxSteps: 10,
  }).runTurn("Inspect the runtime, fix CHECKOUT-417, verify callers, and submit the patch.");
  evidence = {
    requests: llm.requests,
    events: runtime.session.events,
    inspection: runtime.context.inspect(),
    trace: replayTrace(runtime.session.events),
    verdict: `${runtime.state.acceptedPatch ? "CHECKOUT-417 accepted" : "rejected"} · ${result.steps} model steps`,
  };
} else if (id === "m06") {
  const llm = new ScriptedLlm(createLongTaskBugFixReplies());
  const result = await runCheckoutLongTask(llm);
  evidence = {
    requests: llm.requests,
    events: result.session.events,
    inspection: result.context.inspect(),
    trace: replayTrace(result.session.events),
    verdict: `${result.goal.status} · ${result.goal.roundsStarted} rounds · CHECKOUT-417 accepted`,
  };
} else {
  throw new Error(`Unknown checkpoint id: ${id}`);
}

process.stdout.write(JSON.stringify(evidence));
