import { createIncidentTools, type SubmissionState } from "./incident.js";
import type { Llm } from "./protocol.js";
import { Context, ServiceToken, type Plugin } from "./runtime.js";

export const LLM = new ServiceToken<Llm>("llm");
export const SUBMISSION_STATE = new ServiceToken<SubmissionState>("submission-state");

export function llmPlugin(llm: Llm): Plugin {
  return {
    name: `provider:${llm.provider}`,
    setup(context) {
      context.provide(LLM, llm);
    },
  };
}

export function submissionStatePlugin(state: SubmissionState): Plugin {
  return {
    name: "submission-state",
    setup(context) {
      context.provide(SUBMISSION_STATE, state);
    },
  };
}

export function incidentPlugin(): Plugin {
  return {
    name: "mars-incident",
    setup(context) {
      const state = context.use(SUBMISSION_STATE);
      context.contributePrompt(
        "incident-guardrails",
        "Use only the bounded incident tools. A recovery plan must satisfy every stated constraint.",
      );
      for (const tool of createIncidentTools(state)) context.registerTool(tool);
      context.on("tool/executed", () => {
        // The no-op listener exists to make lifecycle ownership observable in M03.
      });
    },
  };
}

export async function composeM03Runtime(llm: Llm): Promise<{
  context: Context;
  state: SubmissionState;
}> {
  const context = new Context();
  const state: SubmissionState = { acceptedPlan: null };
  await context.mount(llmPlugin(llm));
  await context.mount(submissionStatePlugin(state));
  await context.mount(incidentPlugin());
  return { context, state };
}
