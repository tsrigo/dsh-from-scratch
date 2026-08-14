import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  compareRequestPrefix,
  describeRequest,
} from "../src/context.js";
import { PTC_PRESENTATION_EXAMPLE } from "../src/ptc-comparison.js";
import type { RuntimeInspection } from "../src/runtime.js";
import {
  buildRequest,
  requestStepIds,
  type SessionEvent,
  type TraceItem,
} from "../src/session.js";
import type { UnifiedRequest } from "../src/protocol.js";

interface CheckpointConfig {
  id: string;
  number: string;
  tag: string;
  previousTag: string;
  scenario: string;
  sourcePath: string;
  lessonPath: string;
  shortTitle: string;
  title: string;
  question: string;
  sourceRange: { start: number; end: number };
  codeGuide: {
    title: string;
    description: string;
    observations: Array<{ text: string; lines: [number, number] }>;
  };
  changeStory: {
    title: string;
    summary: string;
    outcomes: string[];
  };
}

interface ScenarioEvidence {
  requests: UnifiedRequest[];
  events: readonly SessionEvent[];
  inspection: RuntimeInspection | null;
  trace: TraceItem[];
  verdict: string;
}

const root = resolve(import.meta.dirname, "..");
const configs = JSON.parse(
  await readFile(resolve(root, "docs/checkpoints.json"), "utf8"),
) as CheckpointConfig[];
const primer = await readFile(resolve(root, "docs/typescript-primer.md"), "utf8");

const chapters = [];
for (const config of configs) {
  const evidence = await runTaggedScenario(config);
  verifyReconstruction(evidence);
  const source = git("show", `${config.tag}:${config.sourcePath}`);
  const lesson = await readFile(resolve(root, config.lessonPath), "utf8");
  const diff = git(
    "diff",
    "--no-ext-diff",
    "--unified=3",
    config.previousTag,
    config.tag,
    "--",
    "src",
    "tests",
  );
  const requests = evidence.requests.map((request, index) => {
    const parts = describeRequest(request);
    return {
      step: index + 1,
      stepId: requestStepIds(evidence.events)[index],
      request,
      parts,
      totalApproximateTokens: parts.reduce((sum, part) => sum + part.approximateTokens, 0),
      prefix: compareRequestPrefix(evidence.requests[index - 1], request),
    };
  });
  const sourceLines = source.split(/\r?\n/u);
  chapters.push({
    id: `chapter-${Number(config.number)}`,
    number: config.number,
    shortTitle: config.shortTitle,
    title: config.title,
    question: config.question,
    codeGuide: config.codeGuide,
    changeStory: config.changeStory,
    lesson,
    source: {
      path: config.sourcePath,
      content: source,
      excerpt: sourceLines
        .slice(config.sourceRange.start - 1, config.sourceRange.end)
        .join("\n"),
      startLine: config.sourceRange.start,
      endLine: config.sourceRange.end,
    },
    diff: sanitizePublicText(diff),
    diffStats: summarizeDiff(diff),
    verdict: evidence.verdict,
    requests,
    events: evidence.events,
    trace: evidence.trace,
    graphs: buildGraphSnapshots(evidence.events, evidence.inspection, evidence.requests),
    ...(config.id === "m01"
      ? { ptc: { program: PTC_PRESENTATION_EXAMPLE } }
      : {}),
  });
}

const output = {
  schemaVersion: 3,
  project: {
    name: "dsh-from-scratch",
    scenario: "火星中继站恢复审计",
    dataPolicy: "过程样本由确定性模型模拟器生成；文本量与相同前缀均为教学估算。",
    selectedScope: {
      jsonl: false,
      overflowRetry: false,
      longTask: true,
      codeRuntime: false,
      presetLoader: false,
    },
    primer,
  },
  chapters,
};

const outDir = resolve(root, "website/public/generated");
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "tutorial.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `generated ${chapters.length} chapters · ${chapters.reduce((sum, chapter) => sum + chapter.events.length, 0)} events · ${chapters.reduce((sum, chapter) => sum + chapter.requests.length, 0)} requests`,
);

function summarizeDiff(diff: string): {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: Array<{ path: string; additions: number; deletions: number }>;
} {
  const files: Array<{ path: string; additions: number; deletions: number }> = [];
  let current: { path: string; additions: number; deletions: number } | undefined;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
    if (header) {
      current = { path: sanitizePublicText(header[2] ?? header[1] ?? "unknown"), additions: 0, deletions: 0 };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }
  return {
    filesChanged: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
  };
}

function sanitizePublicText(value: string): string {
  return value
    .replace(/tutorial-m0[1-6]/gu, "internal-stage")
    .replace(/tests\/m01-agent\.test\.ts/giu, "tests/agent.test.ts")
    .replace(/tests\/m02-context\.test\.ts/giu, "tests/context.test.ts")
    .replace(/tests\/m03-runtime\.test\.ts/giu, "tests/runtime.test.ts")
    .replace(/tests\/m04-session\.test\.ts/giu, "tests/session.test.ts")
    .replace(/tests\/m05-runtime-tools\.test\.ts/giu, "tests/runtime-tools.test.ts")
    .replace(/tests\/m06-long-task\.test\.ts/giu, "tests/long-task.test.ts")
    .replace(/composeM0[1-6]Runtime/gu, "composeHistoricalRuntime")
    .replace(/createM0[1-6]/gu, "createHistorical")
    .replace(/\bm0[1-6]\b/giu, "the tutorial stage");
}

async function runTaggedScenario(config: CheckpointConfig): Promise<ScenarioEvidence> {
  const checkpointRoot = await mkdtemp(resolve(root, `.tutorial-checkpoint-${config.id}-`));
  try {
    const archive = execFileSync("git", ["archive", "--format=tar", config.tag], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
    });
    execFileSync("tar", ["-xf", "-", "-C", checkpointRoot], {
      input: archive,
      maxBuffer: 32 * 1024 * 1024,
    });
    const output = execFileSync(
      resolve(root, "node_modules/.bin/tsx"),
      [resolve(root, "scripts/run-checkpoint.ts"), config.id, checkpointRoot],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    return JSON.parse(output) as ScenarioEvidence;
  } finally {
    await rm(checkpointRoot, { recursive: true, force: true });
  }
}

function verifyReconstruction(evidence: ScenarioEvidence): void {
  if (evidence.events.length === 0) return;
  const stepIds = requestStepIds(evidence.events);
  assert.equal(stepIds.length, evidence.requests.length);
  for (const [index, stepId] of stepIds.entries()) {
    assert.deepEqual(
      buildRequest(evidence.events, stepId),
      evidence.requests[index],
      `reconstructed request drifted at ${stepId}`,
    );
  }
}

function buildGraphSnapshots(
  events: readonly SessionEvent[],
  finalInspection: RuntimeInspection | null,
  requests: UnifiedRequest[],
): Array<Record<string, unknown>> {
  if (!finalInspection) return [];
  const activePlugins = new Set<string>(["session-log"]);
  const baseToolOwners = new Map(finalInspection.tools.map((tool) => [tool.name, tool.plugin]));
  const promptOwners = new Map(finalInspection.prompts.map((prompt) => [prompt.text, prompt.plugin]));
  const latestCapability = (): string | undefined =>
    [...activePlugins].reverse().find((plugin) => plugin.startsWith("capability:"));
  const snapshots: Array<Record<string, unknown>> = [];

  for (const event of events) {
    if (event.type === "runtime/plugin-mounted") activePlugins.add(event.plugin);
    if (event.type === "runtime/plugin-unmounted") activePlugins.delete(event.plugin);
    if (event.type !== "request/header") continue;

    const tools = event.tools.map((tool) => ({
      name: tool.name,
      owner: baseToolOwners.get(tool.name) ?? latestCapability() ?? "direct",
    }));
    const promptParagraphs = event.system.split("\n\n").slice(1);
    const prompts = promptParagraphs.map((text, index) => ({
      id: `prompt-${index + 1}`,
      text,
      owner: promptOwners.get(text) ?? latestCapability() ?? "base",
    }));
    const nodes = [
      ...[...activePlugins].map((plugin) => ({ id: plugin, label: plugin, kind: "plugin" })),
      ...tools.map((tool) => ({ id: `tool:${tool.name}`, label: tool.name, kind: "tool" })),
      ...prompts.map((prompt) => ({ id: prompt.id, label: "Prompt", kind: "prompt" })),
    ];
    const edges = [
      ...tools.map((tool) => ({ from: tool.owner, to: `tool:${tool.name}`, label: "contributes" })),
      ...prompts.map((prompt) => ({ from: prompt.owner, to: prompt.id, label: "contributes" })),
      ...finalInspection.relations
        .filter(
          (relation) =>
            activePlugins.has(relation.provider) && activePlugins.has(relation.consumer),
        )
        .map((relation) => ({
          from: relation.provider,
          to: relation.consumer,
          label: relation.service,
        })),
    ];
    snapshots.push({
      stepId: event.stepId,
      eventId: event.id,
      plugins: [...activePlugins],
      tools,
      prompts,
      services: finalInspection.services.filter((service) =>
        activePlugins.has(service.provider),
      ),
      relations: finalInspection.relations.filter(
        (relation) =>
          activePlugins.has(relation.provider) && activePlugins.has(relation.consumer),
      ),
      nodes,
      edges,
    });
  }
  if (snapshots.length === 0) {
    for (const [index, request] of requests.entries()) {
      snapshots.push({
        stepId: `step-${index + 1}`,
        eventId: index + 1,
        plugins: finalInspection.plugins,
        tools: finalInspection.tools,
        prompts: finalInspection.prompts,
        services: finalInspection.services,
        relations: finalInspection.relations,
        nodes: [
          ...finalInspection.plugins.map((plugin) => ({ id: plugin, label: plugin, kind: "plugin" })),
          ...request.tools.map((tool) => ({ id: `tool:${tool.name}`, label: tool.name, kind: "tool" })),
        ],
        edges: finalInspection.tools.map((tool) => ({
          from: tool.plugin,
          to: `tool:${tool.name}`,
          label: "contributes",
        })),
      });
    }
  }
  return snapshots;
}

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}
