import { resolve } from "node:path";
import { loadIncidentPacket } from "./incident.js";
import { DeepSeekLlm } from "./llm-deepseek.js";
import { createLongTaskAuditReplies, ScriptedLlm } from "./llm-fake.js";
import type { Llm } from "./protocol.js";
import { runMarsLongTask } from "./scenario.js";

const args = new Set(process.argv.slice(2));
const provider = valueAfter("--provider") ?? "fake";
const workspace = resolve(valueAfter("--workspace") ?? "./demo-workspace");
const packet = await loadIncidentPacket(workspace);

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
  llm = new ScriptedLlm(createLongTaskAuditReplies());
} else {
  throw new Error(`Unknown provider: ${provider}`);
}

const result = await runMarsLongTask(llm, { packet });

console.log("Mars relay audit");
for (const event of result.session.events) {
  if (event.type === "goal/round-started") {
    console.log(`round/${event.round} · ${event.label}`);
  } else if (event.type === "tool/call") {
    console.log(`call · ${event.call.name}`);
  } else if (event.type === "tool/result") {
    console.log(`result · ${event.name} · ${shorten(event.content, 86)}`);
  } else if (event.type === "runtime/plugin-mounted" && event.plugin.startsWith("capability:")) {
    console.log(`mounted · ${event.plugin}`);
  } else if (event.type === "runtime/plugin-unmounted" && event.plugin.startsWith("capability:")) {
    console.log(`unmounted · ${event.plugin}`);
  } else if (event.type === "goal/status-changed") {
    console.log(`goal/${event.status} · ${event.reason}`);
  }
}
console.log(
  `result=${result.submission.acceptedPlan ? "accepted" : "rejected"} rounds=${result.goal.roundsStarted} provider=${llm.provider} workspace=${workspace}`,
);

function valueAfter(flag: string): string | undefined {
  const values = [...args];
  const index = values.indexOf(flag);
  return index === -1 ? undefined : values[index + 1];
}

function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
