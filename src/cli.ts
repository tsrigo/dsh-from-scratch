import { Agent } from "./agent.js";
import { DeepSeekLlm } from "./llm-deepseek.js";
import { createMarsAuditReplies, ScriptedLlm } from "./llm-fake.js";
import { composeM03Runtime } from "./plugins.js";
import type { Llm } from "./protocol.js";

const args = new Set(process.argv.slice(2));
const provider = valueAfter("--provider") ?? "fake";

let llm: Llm;
if (provider === "deepseek") {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required only for --provider deepseek.");
  const model = process.env.DEEPSEEK_MODEL;
  const baseUrl = process.env.DEEPSEEK_BASE_URL;
  llm = new DeepSeekLlm({
    apiKey,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });
} else if (provider === "fake") {
  llm = new ScriptedLlm(createMarsAuditReplies());
} else {
  throw new Error(`Unknown provider: ${provider}`);
}

const runtime = await composeM03Runtime(llm);
const runtimeAgent = new Agent({
  llm,
  context: runtime.context,
  systemPrompt:
    "You are a careful relay recovery auditor. Use only the incident tools and submit a constraint-valid plan.",
});
const result = await runtimeAgent.runTurn(
  "Audit incident MARS-RELAY-204 and submit the uniquely valid recovery plan.",
);

console.log("Mars relay audit");
for (const entry of result.trace) {
  console.log(`${entry.label}${entry.detail ? ` · ${shorten(entry.detail, 92)}` : ""}`);
}
console.log(`result=${runtime.state.acceptedPlan ? "accepted" : "rejected"} steps=${result.steps} provider=${llm.provider}`);

function valueAfter(flag: string): string | undefined {
  const values = [...args];
  const index = values.indexOf(flag);
  return index === -1 ? undefined : values[index + 1];
}

function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
