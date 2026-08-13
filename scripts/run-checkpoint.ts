import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { UnifiedRequest } from "../src/protocol.js";
import type { RuntimeInspection } from "../src/runtime.js";
import type { SessionEvent, TraceItem } from "../src/session.js";

interface HistoricalTraceItem {
  label: string;
  detail?: string;
}

interface HistoricalAgentModule {
  Agent: new (options: {
    llm: unknown;
    tools?: unknown[];
    context?: unknown;
    systemPrompt: string;
    projection?: {
      maxToolResultChars: number;
      toolResultHeadChars: number;
      toolResultTailChars: number;
    };
    maxSteps?: number;
    checkpointBeforeStep?: (input: {
      step: number;
      events: readonly { id: number }[];
    }) => { summary: string; coveredThroughEventId: number } | undefined;
  }) => {
    runTurn(input: string): Promise<{
      steps: number;
      trace: HistoricalTraceItem[];
    }>;
  };
}

interface HistoricalFakeModule {
  ScriptedLlm: new (replies: unknown[]) => { requests: UnifiedRequest[] };
  createMarsAuditReplies(): unknown[];
  createCapabilityAuditReplies(): unknown[];
  createLongTaskAuditReplies(): unknown[];
}

interface HistoricalRuntime {
  context: { inspect(): RuntimeInspection };
  state: { acceptedPlan: unknown };
  session: { events: SessionEvent[] };
}

interface HistoricalPluginsModule {
  composeM03Runtime(llm: unknown): Promise<HistoricalRuntime>;
  composeRuntime(llm: unknown): Promise<HistoricalRuntime>;
}

interface HistoricalSessionModule {
  replayTrace(events: readonly SessionEvent[]): TraceItem[];
}

const [id, checkpointRoot] = process.argv.slice(2);
if (!id || !checkpointRoot) throw new Error("Usage: run-checkpoint <m01..m06> <checkpoint-root>");

const fromCheckpoint = async <T>(path: string): Promise<T> =>
  import(pathToFileURL(resolve(checkpointRoot, path)).href) as Promise<T>;

if (id === "m01" || id === "m02") {
  const [{ Agent }, incident, fake] = await Promise.all([
    fromCheckpoint<HistoricalAgentModule>("src/agent.ts"),
    fromCheckpoint<{
      createIncidentTools(state: { acceptedPlan: unknown }): unknown[];
    }>("src/incident.ts"),
    fromCheckpoint<HistoricalFakeModule>("src/llm-fake.ts"),
  ]);
  const llm = new fake.ScriptedLlm(fake.createMarsAuditReplies());
  const state: { acceptedPlan: unknown } = { acceptedPlan: null };
  const result = await new Agent({
    llm,
    tools: incident.createIncidentTools(state),
    systemPrompt: "You are a careful relay recovery auditor.",
    ...(id === "m01"
      ? {}
      : {
          projection: {
            maxToolResultChars: 720,
            toolResultHeadChars: 430,
            toolResultTailChars: 170,
          },
        }),
  });
  const turn = await result.runTurn(
    "Audit MARS-RELAY-204 and submit the uniquely valid recovery plan.",
  );
  emit({
    requests: llm.requests,
    events: [],
    inspection: null,
    trace: turn.trace.map((item, index) => ({
      eventId: index + 1,
      type: item.label,
      title: item.label,
      detail: item.detail ?? "",
    })),
    verdict: `${state.acceptedPlan ? "ASTER accepted" : "rejected"} · ${turn.steps} model steps`,
  });
} else if (id === "m03") {
  const [{ Agent }, fake, plugins] = await Promise.all([
    fromCheckpoint<HistoricalAgentModule>("src/agent.ts"),
    fromCheckpoint<HistoricalFakeModule>("src/llm-fake.ts"),
    fromCheckpoint<HistoricalPluginsModule>("src/plugins.ts"),
  ]);
  const llm = new fake.ScriptedLlm(fake.createMarsAuditReplies());
  const runtime = await plugins.composeM03Runtime(llm);
  const result = await new Agent({
    llm,
    context: runtime.context,
    systemPrompt: "You are a careful relay recovery auditor.",
  }).runTurn("Audit MARS-RELAY-204 and submit the uniquely valid recovery plan.");
  emit({
    requests: llm.requests,
    events: [],
    inspection: runtime.context.inspect(),
    trace: result.trace.map((item, index) => ({
      eventId: index + 1,
      type: item.label,
      title: item.label,
      detail: item.detail ?? "",
    })),
    verdict: `${runtime.state.acceptedPlan ? "ASTER accepted" : "rejected"} · ${result.steps} model steps`,
  });
} else if (id === "m04" || id === "m05") {
  const [{ Agent }, fake, plugins, session] = await Promise.all([
    fromCheckpoint<HistoricalAgentModule>("src/agent.ts"),
    fromCheckpoint<HistoricalFakeModule>("src/llm-fake.ts"),
    fromCheckpoint<HistoricalPluginsModule>("src/plugins.ts"),
    fromCheckpoint<HistoricalSessionModule>("src/session.ts"),
  ]);
  const isM05 = id === "m05";
  const llm = new fake.ScriptedLlm(
    isM05 ? fake.createCapabilityAuditReplies() : fake.createMarsAuditReplies(),
  );
  const runtime = isM05
    ? await plugins.composeRuntime(llm)
    : await plugins.composeM03Runtime(llm);
  const result = await new Agent({
    llm,
    context: runtime.context,
    systemPrompt: "You are a careful relay recovery auditor.",
    maxSteps: 8,
    ...(id === "m04"
      ? {
          checkpointBeforeStep: ({ step, events }: { step: number; events: readonly { id: number }[] }) =>
            step === 3
              ? {
                  summary: "Incident inspected; ASTER selected and accepted by the verifier.",
                  coveredThroughEventId: events.at(-1)?.id ?? 0,
                }
              : undefined,
        }
      : {}),
  }).runTurn(
    isM05
      ? "Inspect the runtime, test route scoring, remove the experiment, and recover MARS-RELAY-204."
      : "Audit MARS-RELAY-204 and submit the uniquely valid recovery plan.",
  );
  emit({
    requests: llm.requests,
    events: runtime.session.events,
    inspection: runtime.context.inspect(),
    trace: session.replayTrace(runtime.session.events),
    verdict: `${runtime.state.acceptedPlan ? "ASTER accepted" : "rejected"} · ${result.steps} model steps`,
  });
} else if (id === "m06") {
  const [fake, scenario, session] = await Promise.all([
    fromCheckpoint<HistoricalFakeModule>("src/llm-fake.ts"),
    fromCheckpoint<{
      runMarsLongTask(llm: unknown): Promise<{
        session: { events: SessionEvent[] };
        context: { inspect(): RuntimeInspection };
        goal: { status: string; roundsStarted: number };
      }>;
    }>("src/scenario.ts"),
    fromCheckpoint<HistoricalSessionModule>("src/session.ts"),
  ]);
  const llm = new fake.ScriptedLlm(fake.createLongTaskAuditReplies());
  const result = await scenario.runMarsLongTask(llm);
  emit({
    requests: llm.requests,
    events: result.session.events,
    inspection: result.context.inspect(),
    trace: session.replayTrace(result.session.events),
    verdict: `${result.goal.status} · ${result.goal.roundsStarted} rounds · ASTER accepted`,
  });
} else {
  throw new Error(`Unknown checkpoint id: ${id}`);
}

function emit(value: unknown): void {
  process.stdout.write(JSON.stringify(value));
}
