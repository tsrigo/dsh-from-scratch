import { resolve } from "node:path";
import { DeepSeekLlm } from "../src/llm-deepseek.js";
import { runPythonHelloTask } from "../src/python-scenario.js";

const provider = valueAfter("--provider") ?? "deepseek";
if (provider !== "deepseek") throw new Error("The Python hello demo currently uses --provider deepseek.");
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for the Python hello demo.");

const workspace = resolve(valueAfter("--workspace") ?? "./demo-python");
const llm = new DeepSeekLlm({
  apiKey,
  ...(process.env.DEEPSEEK_MODEL ? { model: process.env.DEEPSEEK_MODEL } : {}),
  ...(process.env.DEEPSEEK_BASE_URL ? { baseUrl: process.env.DEEPSEEK_BASE_URL } : {}),
});
const result = await runPythonHelloTask(llm, { workspace });

console.log("Python hello-world agentic task");
for (const event of result.session.events) {
  if (event.type === "tool/call") console.log(`call · ${event.call.name}`);
  if (event.type === "tool/result") console.log(`result · ${event.name} · ${shorten(event.content, 120)}`);
}
console.log(`result=accepted output=${JSON.stringify(result.state.lastRun?.output.trim())} workspace=${workspace}`);

function valueAfter(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
