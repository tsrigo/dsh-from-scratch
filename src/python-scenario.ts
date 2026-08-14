import { Agent, type RunTurnResult } from "./agent.js";
import { llmPlugin } from "./plugins.js";
import type { Llm } from "./protocol.js";
import { SessionLog, sessionPlugin } from "./session.js";
import { Context } from "./runtime.js";
import {
  PYTHON_HELLO_WORKSPACE,
  pythonHelloWorkspacePlugin,
  type PythonHelloWorkspaceState,
} from "./python-workspace.js";

export interface PythonHelloTaskResult {
  turn: RunTurnResult;
  state: PythonHelloWorkspaceState;
  session: SessionLog;
}

export async function runPythonHelloTask(
  llm: Llm,
  options: { workspace: string },
): Promise<PythonHelloTaskResult> {
  const context = new Context();
  const session = new SessionLog();
  await context.mount(sessionPlugin(session));
  await context.mount(llmPlugin(llm));
  await context.mount(pythonHelloWorkspacePlugin(options.workspace));

  const agent = new Agent({
    llm,
    context,
    systemPrompt:
      "You are a careful coding agent completing a bounded Python hello-world task. Use the available tools, write the file, run the verifier, and never claim success without a passed run_python_hello result.",
    maxSteps: 5,
  });
  const turn = await agent.runTurn(
    'Create hello.py containing the minimal Python 3 program that prints exactly "Hello, world!". Run it with the provided verifier, then finish.',
  );
  const state = context.use(PYTHON_HELLO_WORKSPACE);
  if (!state.lastRun?.passed) {
    throw new Error("The Python hello-world verifier did not pass.");
  }
  return { turn, state, session };
}
