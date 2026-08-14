import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCheckoutWorkspace } from "../src/checkout-workspace.js";
import { DeepSeekLlm } from "../src/llm-deepseek.js";
import { ReplayRecorder } from "../src/replay.js";
import { runCheckoutLongTask } from "../src/scenario.js";
import { SessionLog } from "../src/session.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required to record the live replay.");

const root = resolve(import.meta.dirname, "..");
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const baseUrl = process.env.DEEPSEEK_BASE_URL;
const llm = new DeepSeekLlm({
  apiKey,
  model,
  ...(baseUrl ? { baseUrl } : {}),
});
const fixture = await loadCheckoutWorkspace(resolve(root, "demo-workspace"));
const session = new SessionLog();
const recorder = new ReplayRecorder({
  provider: llm.provider,
  model: llm.model,
  scenario: "修复购物车重复优惠 Bug",
});
const stopObserving = recorder.observeSession(session);

try {
  const result = await runCheckoutLongTask(llm, {
    fixture,
    session,
    responseLanguage: "zh-CN",
    onModelEvent: (event) => recorder.observeModel(event),
  });
  const recording = recorder.finish({
    goal: result.goal,
    acceptedPatch: result.workspace.acceptedPatch?.issueId ?? null,
    activePlugins: result.context.inspect().plugins,
  });
  const serialized = `${JSON.stringify(recording, null, 2)}\n`;
  if (serialized.includes(apiKey)) throw new Error("Refusing to write a replay containing the API key.");

  const directory = resolve(root, "docs/replays");
  const output = resolve(directory, "checkout-live.json");
  const temporary = resolve(directory, `.checkout-live-${process.pid}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, serialized, { flag: "wx" });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(
    `recorded ${recording.events.length} replay events · ${recording.provenance.durationMs} ms · ${recording.provenance.provider}/${recording.provenance.model}`,
  );
} finally {
  stopObserving();
}
