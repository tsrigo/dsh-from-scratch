import { resolve } from "node:path";
import { DeepSeekLlm } from "../src/llm-deepseek.js";
import { PythonHelloReplayLlm } from "../src/llm-replay.js";
import { runPythonHelloTask } from "../src/python-scenario.js";

const apiKey = process.env.DEEPSEEK_API_KEY;

const workspace = resolve(valueAfter("--workspace") ?? "./demo-python");
const llm = apiKey
  ? new DeepSeekLlm({
      apiKey,
      ...(process.env.DEEPSEEK_MODEL ? { model: process.env.DEEPSEEK_MODEL } : {}),
      ...(process.env.DEEPSEEK_BASE_URL ? { baseUrl: process.env.DEEPSEEK_BASE_URL } : {}),
    })
  : new PythonHelloReplayLlm();
const result = await runPythonHelloTask(llm, { workspace });

const color = createColorizer();
console.log(color.bold(`Python hello-world agentic task · mode=${apiKey ? "live" : "offline-replay"}`));
for (const event of result.session.events) {
  if (event.type === "assistant/message") {
    console.log(color.cyan(`assistant · ${event.content}`));
  }
  if (event.type === "tool/call") console.log(color.yellow(`call · ${event.call.name}`));
  if (event.type === "tool/result") console.log(color.gray(`result · ${event.name} · ${shorten(event.content, 120)}`));
}
console.log(color.green(`result=accepted output=${JSON.stringify(result.state.lastRun?.output.trim())} workspace=${workspace}`));

function valueAfter(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function createColorizer(): {
  bold(value: string): string;
  cyan(value: string): string;
  yellow(value: string): string;
  gray(value: string): string;
  green(value: string): string;
} {
  const enabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
  const wrap = (code: number) => (value: string) =>
    enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
  return {
    bold: wrap(1),
    cyan: wrap(36),
    yellow: wrap(33),
    gray: wrap(90),
    green: wrap(32),
  };
}
