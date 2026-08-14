import {
  CHECKOUT_FIXTURE,
  CHECKOUT_WORKSPACE,
  createCheckoutState,
  createTestTools,
  createWorkspaceTools,
  type CheckoutWorkspaceFixture,
  type CheckoutWorkspaceState,
} from "./checkout-workspace.js";
import { typescriptAnalysisPlugin } from "./catalog/typescript-analysis.js";
import { wordCountPlugin } from "./catalog/word-count.js";
import type { Llm } from "./protocol.js";
import { Context, ServiceToken, type Plugin } from "./runtime.js";
import { SessionLog, sessionPlugin } from "./session.js";
import {
  capabilityCatalogPlugin,
  runtimeToolsPlugin,
  TrustedCapabilityCatalog,
} from "./runtime-tools.js";

export const LLM = new ServiceToken<Llm>("llm");

export function llmPlugin(llm: Llm): Plugin {
  return {
    name: `provider:${llm.provider}`,
    setup(context) {
      context.provide(LLM, llm);
    },
  };
}

export function checkoutWorkspaceStatePlugin(state: CheckoutWorkspaceState): Plugin {
  return {
    name: "checkout-workspace-state",
    setup(context) {
      context.provide(CHECKOUT_WORKSPACE, state);
    },
  };
}

export function checkoutWorkspacePlugin(): Plugin {
  return {
    name: "checkout-workspace",
    setup(context) {
      const state = context.use(CHECKOUT_WORKSPACE);
      context.contributePrompt(
        "checkout-editing-rules",
        "Work only inside the bounded CHECKOUT-417 workspace. Read before editing and make the smallest exact replacement.",
      );
      for (const tool of createWorkspaceTools(state)) context.registerTool(tool);
      context.on("tool/executed", () => {
        // This listener makes the workspace plugin's lifecycle visible in M03.
      });
    },
  };
}

export function checkoutTestsPlugin(): Plugin {
  return {
    name: "checkout-tests",
    setup(context) {
      const state = context.use(CHECKOUT_WORKSPACE);
      context.contributePrompt(
        "checkout-verification-rules",
        "Run the regression suite after editing. Submit only after run_tests reports that every test passed.",
      );
      for (const tool of createTestTools(state)) context.registerTool(tool);
    },
  };
}

export async function composeM03Runtime(
  llm: Llm,
  options: { fixture?: CheckoutWorkspaceFixture; session?: SessionLog } = {},
): Promise<{
  context: Context;
  state: CheckoutWorkspaceState;
  session: SessionLog;
}> {
  const context = new Context();
  const state = createCheckoutState(options.fixture ?? CHECKOUT_FIXTURE);
  const session = options.session ?? new SessionLog();
  await context.mount(sessionPlugin(session));
  await context.mount(llmPlugin(llm));
  await context.mount(checkoutWorkspaceStatePlugin(state));
  await context.mount(checkoutWorkspacePlugin());
  await context.mount(checkoutTestsPlugin());
  return { context, state, session };
}

export async function composeRuntime(
  llm: Llm,
  options: { fixture?: CheckoutWorkspaceFixture; session?: SessionLog } = {},
): Promise<{
  context: Context;
  state: CheckoutWorkspaceState;
  session: SessionLog;
}> {
  const runtime = await composeM03Runtime(llm, options);
  await runtime.context.mount(
    capabilityCatalogPlugin(
      new TrustedCapabilityCatalog({
        typescript_analysis: typescriptAnalysisPlugin,
        word_count: wordCountPlugin,
      }),
    ),
  );
  await runtime.context.mount(runtimeToolsPlugin());
  return runtime;
}
