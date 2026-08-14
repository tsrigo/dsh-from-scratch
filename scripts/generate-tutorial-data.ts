import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  compareRequestPrefix,
  DEFAULT_PROJECTION,
  describeRequest,
  projectMessages,
} from "../src/context.js";
import { WORD_COUNT_PLUGIN_CODE } from "../src/catalog/word-count.js";
import type { ToolSchema, UnifiedRequest } from "../src/protocol.js";
import { assertValidLiveReplay, type LiveReplayRecording } from "../src/replay.js";
import {
  buildRequest,
  replayTrace,
  requestStepIds,
  type SessionEvent,
  type TraceItem,
} from "../src/session.js";

interface CheckpointConfig {
  id: string;
  number: string;
  tag: string;
  previousTag: string;
  scenario: string;
  sourcePath: string;
  sourceMode?: "worktree";
  lessonPath: string;
  shortTitle: string;
  title: string;
  question: string;
  sourceRange: { start: number; end: number };
  codeGuide: {
    title: string;
    description: string;
    observations: Array<{ title: string; text: string; lines: [number, number] }>;
    fills?: Array<{ label: string; kind: "skeleton" | "body"; ranges: Array<[number, number]> }>;
  };  changeStory: {
    title: string;
    summary: string;
    harnessRole: string;
    connection: string;
    outcomes: string[];
  };
}

interface TeachingGraph {
  stepId: string;
  eventId: number;
  plugins: string[];
  tools: Array<{ name: string; owner: string }>;
  prompts: Array<{ id: string; text: string; owner: string }>;
  services: Array<{ name: string; provider: string }>;
  relations: Array<{ consumer: string; service: string; provider: string }>;
  nodes: Array<{ id: string; label: string; kind: string }>;
  edges: Array<{ from: string; to: string; label: string }>;
}

interface TeachingEvidence {
  requests: UnifiedRequest[];
  events: readonly SessionEvent[];
  trace: TraceItem[];
  graphs: TeachingGraph[];
}

const root = resolve(import.meta.dirname, "..");
const tutorialLocale = process.env.TUTORIAL_LOCALE === "en" ? "en" : "zh";
const english = tutorialLocale === "en";
/** 六个教学主文件（与章节一一对应，nano-dsh FILE_ORDER 精神）：
 * 文件 tab 展示「该章为止已出现」的主文件（按此顺序），内容为该 tag 的历史快照。 */
const SIX_MAIN_FILES = [
  "src/agent.ts",
  "src/context.ts",
  "src/runtime.ts",
  "src/session.ts",
  "src/runtime-tools.ts",
  "src/long-task.ts",
];

function fileExistsInTag(tag: string, path: string): boolean {
  return git("ls-tree", "--name-only", tag, "--", path).trim() !== "";
}
const configs = JSON.parse(
  await readFile(resolve(root, english ? "docs/checkpoints.en.json" : "docs/checkpoints.json"), "utf8"),
) as CheckpointConfig[];
const primer = await readFile(resolve(root, english ? "docs/typescript-primer.en.md" : "docs/typescript-primer.md"), "utf8");
const liveReplay = JSON.parse(
  await readFile(resolve(root, "docs/replays/checkout-live.json"), "utf8"),
) as unknown;
assertValidLiveReplay(liveReplay);

const chapters = [];
for (const config of configs) {
  const evidence = teachingEvidence(config.id);
  verifyReconstruction(evidence);
  const source = config.sourceMode === "worktree"
    ? await readFile(resolve(root, config.sourcePath), "utf8")
    : git("show", `${config.tag}:${config.sourcePath}`);
  const lessonPath = english
    ? config.lessonPath.replace("docs/lessons/", "docs/lessons-en/")
    : config.lessonPath;
  const lesson = await readFile(resolve(root, lessonPath), "utf8");
  const diff = config.sourceMode === "worktree"
    ? git(
        "diff",
        "--no-ext-diff",
        "--unified=3",
        config.previousTag,
        "--",
        config.sourcePath,
      )
    : git(
        "diff",
        "--no-ext-diff",
        "--unified=3",
        config.previousTag,
        config.tag,
        "--",
        config.sourcePath,
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
  verifyCodeGuideCoverage(config, sourceLines.length);
  verifyFills(config, sourceLines);
  // 文件 tab：主文件 + 该章为止已出现的其余主文件（历史 tag 快照）。
  // 章节越靠后，tab 越多：第一章只有 agent.ts，第六章集齐全部六个。
  const mainIndex = SIX_MAIN_FILES.indexOf(config.sourcePath);
  const extraFiles = [];
  for (const path of mainIndex > 0 ? SIX_MAIN_FILES.slice(0, mainIndex) : []) {
    const owner = configs.find((candidate) => candidate.sourcePath === path);
    if (owner?.sourceMode === "worktree" && Number(owner.number) <= Number(config.number)) {
      extraFiles.push({ path, content: await readFile(resolve(root, path), "utf8") });
    } else if (fileExistsInTag(config.tag, path)) {
      extraFiles.push({ path, content: git("show", `${config.tag}:${path}`) });
    }
  }
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
    extraFiles,
    diff: sanitizePublicText(diff),
    diffStats: summarizeDiff(diff),
    requests: english ? translateEvidence(requests) : requests,
    events: english ? translateEvidence(evidence.events) : evidence.events,
    trace: english ? translateEvidence(evidence.trace) : evidence.trace,
    graphs: english ? translateEvidence(evidence.graphs) : evidence.graphs,
  });
}

const output = {
  schemaVersion: 5,
  project: {
    name: "dsh-from-scratch",
    language: "typescript",
    languageLabel: "TypeScript",
    scenario: english ? "Six independent minimal mechanism examples" : "六个彼此独立的最小机制样本",
    dataPolicy: english
      ? "Chapter source comes from six mechanism checkpoints. Requests, events, and capability graphs are minimal deterministic examples built around one concept. The static replay at the top retains a complete coding task. Text size and shared-prefix figures are teaching estimates."
      : "章节源码来自六个机制 checkpoint；请求、事件与能力图是为单一概念生成的最小确定性样本。顶部静态回放仍保留完整编码任务。文本量与相同前缀均为教学估算。",
    selectedScope: {
      jsonl: false,
      overflowRetry: false,
      longTask: true,
      codeRuntime: false,
      presetLoader: false,
    },
    primer,
  },
  liveReplay: liveReplay satisfies LiveReplayRecording,
  chapters,
};

const outDir = resolve(root, "website/public/generated");
await mkdir(outDir, { recursive: true });
const outputName = english ? "tutorial.en.json" : "tutorial.json";
await writeFile(resolve(outDir, outputName), `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `generated ${outputName} · ${chapters.length} chapters · ${chapters.reduce((sum, chapter) => sum + chapter.events.length, 0)} events · ${chapters.reduce((sum, chapter) => sum + chapter.requests.length, 0)} requests`,
);

function teachingEvidence(id: string): TeachingEvidence {
  switch (id) {
    case "m01": {
      const first = baseRequest({
        messages: [{ role: "user", content: "查一下北京现在的时间。" }],
        dynamicContext: "Step 1：先取得事实。",
      });
      const second = baseRequest({
        messages: [
          ...first.messages,
          {
            role: "assistant",
            content: "我先查询时间。",
            toolCalls: [{ id: "call-time", name: "get_time", arguments: { city: "北京" } }],
          },
          {
            role: "tool",
            toolCallId: "call-time",
            name: "get_time",
            content: JSON.stringify({ city: "北京", time: "14:30" }),
          },
        ],
        dynamicContext: "Step 2：根据工具结果回答。",
      });
      return manualEvidence([first, second]);
    }
    case "m02": {
      const tools = [readNoteTool()];
      const first = baseRequest({
        system: "先读取事实，再给出简短回答。",
        tools,
        messages: [{ role: "user", content: "备忘录里写了什么？" }],
        dynamicContext: "Step 1：读取备忘录。",
      });
      const second = baseRequest({
        system: first.system,
        tools,
        messages: projectMessages([
          ...first.messages,
          {
            role: "assistant",
            content: "我先读取备忘录。",
            toolCalls: [{ id: "call-note", name: "read_note", arguments: { name: "today" } }],
          },
          {
            role: "tool",
            toolCallId: "call-note",
            name: "read_note",
            content: [
              "备忘录 today · 会议准备记录\n",
              "背景材料：",
              "项目状态、待确认问题与讨论过程。".repeat(36),
              "\n最终结论：下午三点开会。",
            ].join(""),
          },
        ]),
        dynamicContext: "Step 2：只回答备忘录内容。",
      });
      return manualEvidence([first, second]);
    }
    case "m03": {
      const graph = graphSnapshot({
        stepId: "plugin-ready",
        eventId: 1,
        plugins: ["clock-core", "clock-tools"],
        tools: [{ name: "get_time", owner: "clock-tools" }],
        prompts: [{ id: "clock-rule", text: "回答时间问题前先调用 get_time。", owner: "clock-tools" }],
        services: [{ name: "clock", provider: "clock-core" }],
        relations: [{ consumer: "clock-tools", service: "clock", provider: "clock-core" }],
      });
      return manualEvidence([baseRequest({ dynamicContext: "Clock plugin ready." })], [], [graph]);
    }
    case "m04": {
      const tools = [timeTool()];
      const events: SessionEvent[] = [
        { id: 1, type: "user/message", turnId: "turn-1", content: "北京现在几点？" },
        {
          id: 2,
          type: "request/header",
          stepId: "turn-1-step-1",
          provider: "demo",
          model: "tiny-model",
          system: "需要事实时使用工具。",
          tools,
          dynamicContext: "Step 1",
          projection: DEFAULT_PROJECTION,
        },
        { id: 3, type: "assistant/message", stepId: "turn-1-step-1", content: "我先查询时间。" },
        {
          id: 4,
          type: "tool/call",
          stepId: "turn-1-step-1",
          call: { id: "call-time", name: "get_time", arguments: { city: "北京" } },
        },
        {
          id: 5,
          type: "tool/result",
          stepId: "turn-1-step-1",
          toolCallId: "call-time",
          name: "get_time",
          content: JSON.stringify({ time: "14:30" }),
        },
        {
          id: 6,
          type: "request/header",
          stepId: "turn-1-step-2",
          provider: "demo",
          model: "tiny-model",
          system: "需要事实时使用工具。",
          tools,
          dynamicContext: "Step 2",
          projection: DEFAULT_PROJECTION,
        },
      ];
      return evidenceFromEvents(events);
    }
    case "m05": {
      const baseTools = [
        inspectTool(),
        definePluginTool(),
        runPluginTool(),
        stopPluginTool(),
        undefinePluginTool(),
      ];
      const wordCount = wordCountTool();
      const basePlugins = ["session-log", "runtime-tools"];
      const basePrompts = [{
        id: "runtime-evolution-guide",
        text: "检查当前 Context，定义并运行任务需要的 Cordis 插件，验证后停止或移除。",
        owner: "runtime-tools",
      }];
      const baseServices = [{ name: "session-log", provider: "session-log" }];
      const baseRelations: TeachingGraph["relations"] = [];
      const before = graphSnapshot({
        stepId: "before-install",
        eventId: 2,
        plugins: basePlugins,
        tools: baseTools.map((item) => ({ name: item.name, owner: "runtime-tools" })),
        prompts: basePrompts,
        services: baseServices,
        relations: baseRelations,
      });
      const installed = graphSnapshot({
        stepId: "after-install",
        eventId: 6,
        plugins: [...basePlugins, "dynamic:word_count"],
        tools: [
          ...baseTools.map((item) => ({ name: item.name, owner: "runtime-tools" })),
          { name: wordCount.name, owner: "dynamic:word_count" },
        ],
        prompts: basePrompts,
        services: baseServices,
        relations: baseRelations,
      });
      const removed = graphSnapshot({
        stepId: "after-remove",
        eventId: 11,
        plugins: basePlugins,
        tools: baseTools.map((item) => ({ name: item.name, owner: "runtime-tools" })),
        prompts: basePrompts,
        services: baseServices,
        relations: baseRelations,
      });
      const requests = [
        requestWithTools(baseTools, "检查当前能力并定义 word_count 插件。"),
        requestWithTools([...baseTools, wordCount], "调用刚刚定义的 word_count 工具。"),
        requestWithTools(baseTools, "动态插件已经移除。"),
      ];
      const events: SessionEvent[] = [
        {
          id: 1,
          type: "tool/call",
          stepId: "inspect-step",
          call: { id: "call-inspect", name: "cordis_inspect", arguments: {} },
        },
        {
          id: 2,
          type: "tool/result",
          stepId: "inspect-step",
          toolCallId: "call-inspect",
          name: "cordis_inspect",
          content: JSON.stringify({
            plugins: basePlugins,
            tools: baseTools.map((tool) => tool.name),
            prompts: basePrompts.map((prompt) => prompt.id),
            services: baseServices.map((service) => service.name),
            relations: baseRelations,
          }),
        },
        {
          id: 3,
          type: "tool/call",
          stepId: "define-step",
          call: { id: "call-define", name: "cordis_define", arguments: { name: "word_count", purpose: "统计单词", code: WORD_COUNT_PLUGIN_CODE } },
        },
        {
          id: 4,
          type: "tool/result",
          stepId: "define-step",
          toolCallId: "call-define",
          name: "cordis_define",
          content: JSON.stringify({ ok: true, pluginId: "dyn-1", status: "defined" }),
        },
        {
          id: 5,
          type: "tool/call",
          stepId: "run-step",
          call: { id: "call-run", name: "cordis_run", arguments: { pluginId: "dyn-1" } },
        },
        { id: 6, type: "runtime/plugin-mounted", plugin: "dynamic:word_count" },
        {
          id: 7,
          type: "tool/result",
          stepId: "run-step",
          toolCallId: "call-run",
          name: "cordis_run",
          content: JSON.stringify({ ok: true, pluginId: "dyn-1", status: "running" }),
        },
        {
          id: 8,
          type: "tool/call",
          stepId: "experiment-step",
          call: { id: "call-count", name: "word_count", arguments: { text: "one two three" } },
        },
        {
          id: 9,
          type: "tool/result",
          stepId: "experiment-step",
          toolCallId: "call-count",
          name: "word_count",
          content: JSON.stringify({ words: 3 }),
        },
        {
          id: 10,
          type: "tool/call",
          stepId: "remove-step",
          call: { id: "call-undefine", name: "cordis_undefine", arguments: { pluginId: "dyn-1" } },
        },
        { id: 11, type: "runtime/plugin-unmounted", plugin: "dynamic:word_count" },
        {
          id: 12,
          type: "tool/result",
          stepId: "remove-step",
          toolCallId: "call-undefine",
          name: "cordis_undefine",
          content: JSON.stringify({ ok: true, pluginId: "dyn-1", status: "undefined" }),
        },
      ];
      return manualEvidence(requests, events, [before, installed, removed]);
    }
    case "m06": {
      const events: SessionEvent[] = [
        { id: 1, type: "goal/created", goalId: "goal-1", objective: "整理三条发布说明", maxRounds: 2 },
        { id: 2, type: "goal/round-started", goalId: "goal-1", round: 1, label: "收集已有信息" },
        { id: 3, type: "goal/round-started", goalId: "goal-1", round: 2, label: "补全并交付" },
        { id: 4, type: "goal/status-changed", goalId: "goal-1", status: "completed", reason: "三项均已写入交付物。" },
      ];
      const first = baseRequest({
        tools: [],
        messages: [{ role: "user", content: "目标：整理三条发布说明。\n本轮：收集已有信息。" }],
        dynamicContext: "Round 1 / 2",
      });
      const second = baseRequest({
        tools: [],
        messages: [
          ...first.messages,
          { role: "assistant", content: "已找到两项，仍缺一项。", toolCalls: [] },
          { role: "user", content: "目标：整理三条发布说明。\n本轮：补全并交付。" },
        ],
        dynamicContext: "Round 2 / 2",
      });
      return manualEvidence([first, second], events);
    }
    default:
      throw new Error(`Unknown tutorial chapter: ${id}`);
  }
}

function translateEvidence<T>(value: T): T {
  if (typeof value === "string") return translateEvidenceString(value) as T;
  if (Array.isArray(value)) return value.map((item) => translateEvidence(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, translateEvidence(item)]),
    ) as T;
  }
  return value;
}

function translateEvidenceString(value: string): string {
  const exact = ({
    "Step 1：先取得事实。": "Step 1: retrieve the current facts.",
    "Step 2：根据工具结果回答。": "Step 2: answer from the Tool Result.",
    "Step 1：读取备忘录。": "Step 1: read the note.",
    "Step 2：只回答备忘录内容。": "Step 2: answer only from the note.",
    "先读取事实，再给出简短回答。": "Retrieve the facts first, then answer briefly.",
    "需要事实时使用工具。": "Use a tool when the answer requires external facts.",
    "需要事实时使用工具；拿到结果后直接回答。": "Use a tool when the answer requires external facts. Answer directly after receiving the result.",
    "查一下北京现在的时间。": "Find the current time in Beijing.",
    "北京现在几点？": "What time is it in Beijing?",
    "我先查询时间。": "I will check the time first.",
    "北京": "Beijing",
    "备忘录里写了什么？": "What does the note say?",
    "我先读取备忘录。": "I will read the note first.",
    "回答时间问题前先调用 get_time。": "Call get_time before answering a question about the current time.",
    "检查当前 Context，定义并运行任务需要的 Cordis 插件，验证后停止或移除。": "Inspect the current Context, define and run the Cordis plugin needed for the task, then stop or remove it after verification.",
    "检查当前能力并定义 word_count 插件。": "Inspect the current capabilities and define the word_count plugin.",
    "调用刚刚定义的 word_count 工具。": "Call the newly defined word_count tool.",
    "动态插件已经移除。": "The dynamic plugin has been removed.",
    "先检查当前 Context。需要新能力时，定义并运行一个 Cordis 插件；验证后停止或移除。": "Inspect the current Context first. If the task needs a new capability, define and run a Cordis plugin, then stop or remove it after verification.",
    "统计 ‘one two three’ 的单词数；完成后恢复原能力。": "Count the words in 'one two three', then restore the original capabilities.",
    "查询一个城市的当前时间。": "Get the current time in a city.",
    "读取一条命名备忘录。": "Read a note by name.",
    "查看当前 Context 中的插件及其能力。": "List the plugins and capabilities in the current Context.",
    "登记 Agent 编写的 Cordis 插件代码。": "Register Cordis plugin code written by the Agent.",
    "运行已经定义的 Cordis 插件。": "Run a defined Cordis plugin.",
    "停止插件并保留定义。": "Stop the plugin and retain its definition.",
    "停止插件并删除定义。": "Stop the plugin and delete its definition.",
    "统计一段文本中以空白分隔的单词数。": "Count whitespace-separated words in a string.",
    "统计单词": "count words",
    "收集已有信息": "collect existing information",
    "补全并交付": "complete and deliver",
    "整理三条发布说明": "prepare three release notes",
    "已找到两项，仍缺一项。": "Two items are ready; one is still missing.",
    "三项均已写入交付物。": "All three items have been added to the deliverable.",
  } as Record<string, string>)[value];
  if (exact) return exact;

  return value
    .replaceAll("目标：整理三条发布说明。", "Goal: prepare three release notes.")
    .replaceAll("本轮：收集已有信息。", "This Round: collect existing information.")
    .replaceAll("本轮：补全并交付。", "This Round: complete and deliver.")
    .replaceAll("completed: 三项均已写入交付物。", "completed: all three items have been added to the deliverable.")
    .replaceAll("round 1 · 收集已有信息", "round 1 · collect existing information")
    .replaceAll("round 2 · 补全并交付", "round 2 · complete and deliver")
    .replaceAll("\"city\":\"北京\"", "\"city\":\"Beijing\"")
    .replaceAll("\"purpose\":\"统计单词\"", "\"purpose\":\"count words\"")
    .replaceAll("备忘录 today · 会议准备记录", "Note: today · meeting preparation")
    .replaceAll("背景材料：", "Background: ")
    .replaceAll("项目状态、待确认问题与讨论过程。", "Project status, open questions, and discussion notes. ")
    .replaceAll("最终结论：下午三点开会。", "Conclusion: the meeting starts at 3:00 p.m.");
}

function baseRequest(options: {
  system?: string;
  tools?: ToolSchema[];
  messages?: UnifiedRequest["messages"];
  dynamicContext: string;
}): UnifiedRequest {
  return {
    system: options.system ?? "需要事实时使用工具；拿到结果后直接回答。",
    tools: options.tools ?? [timeTool()],
    messages: options.messages ?? [{ role: "user", content: "北京现在几点？" }],
    dynamicContext: options.dynamicContext,
  };
}

function requestWithTools(tools: ToolSchema[], dynamicContext: string): UnifiedRequest {
  return baseRequest({
    system: "先检查当前 Context。需要新能力时，定义并运行一个 Cordis 插件；验证后停止或移除。",
    tools,
    messages: [{ role: "user", content: "统计 ‘one two three’ 的单词数；完成后恢复原能力。" }],
    dynamicContext,
  });
}

function timeTool(): ToolSchema {
  return {
    name: "get_time",
    description: "查询一个城市的当前时间。",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    },
  };
}

function readNoteTool(): ToolSchema {
  return {
    name: "read_note",
    description: "读取一条命名备忘录。",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  };
}

function inspectTool(): ToolSchema {
  return simpleTool("cordis_inspect", "查看当前 Context 中的插件及其能力。");
}

function definePluginTool(): ToolSchema {
  return simpleTool("cordis_define", "登记 Agent 编写的 Cordis 插件代码。");
}

function runPluginTool(): ToolSchema {
  return simpleTool("cordis_run", "运行已经定义的 Cordis 插件。");
}

function stopPluginTool(): ToolSchema {
  return simpleTool("cordis_stop", "停止插件并保留定义。");
}

function undefinePluginTool(): ToolSchema {
  return simpleTool("cordis_undefine", "停止插件并删除定义。");
}

function wordCountTool(): ToolSchema {
  return {
    name: "word_count",
    description: "统计一段文本中以空白分隔的单词数。",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  };
}

function simpleTool(name: string, description: string): ToolSchema {
  return { name, description, inputSchema: { type: "object", properties: {}, additionalProperties: false } };
}

function evidenceFromEvents(events: SessionEvent[], graphs: TeachingGraph[] = []): TeachingEvidence {
  const requests = requestStepIds(events).map((stepId) => buildRequest(events, stepId));
  return { requests, events, trace: replayTrace(events), graphs };
}

function manualEvidence(
  requests: UnifiedRequest[],
  events: SessionEvent[] = [],
  graphs: TeachingGraph[] = [],
): TeachingEvidence {
  return { requests, events, trace: replayTrace(events), graphs };
}

function graphSnapshot(options: {
  stepId: string;
  eventId: number;
  plugins: string[];
  tools: Array<{ name: string; owner: string }>;
  prompts?: Array<{ id: string; text: string; owner: string }>;
  services?: Array<{ name: string; provider: string }>;
  relations?: Array<{ consumer: string; service: string; provider: string }>;
}): TeachingGraph {
  const prompts = options.prompts ?? [];
  const services = options.services ?? [];
  const relations = options.relations ?? [];
  return {
    stepId: options.stepId,
    eventId: options.eventId,
    plugins: options.plugins,
    tools: options.tools,
    prompts,
    services,
    relations,
    nodes: [
      ...options.plugins.map((plugin) => ({ id: plugin, label: plugin, kind: "plugin" })),
      ...options.tools.map((tool) => ({ id: `tool:${tool.name}`, label: tool.name, kind: "tool" })),
      ...prompts.map((prompt) => ({ id: prompt.id, label: "Prompt", kind: "prompt" })),
    ],
    edges: [
      ...options.tools.map((tool) => ({ from: tool.owner, to: `tool:${tool.name}`, label: "contributes" })),
      ...prompts.map((prompt) => ({ from: prompt.owner, to: prompt.id, label: "contributes" })),
      ...relations.map((relation) => ({ from: relation.provider, to: relation.consumer, label: relation.service })),
    ],
  };
}

function verifyReconstruction(evidence: TeachingEvidence): void {
  const stepIds = requestStepIds(evidence.events);
  if (stepIds.length === 0) return;
  assert.equal(stepIds.length, evidence.requests.length);
  for (const [index, stepId] of stepIds.entries()) {
    assert.deepEqual(
      buildRequest(evidence.events, stepId),
      evidence.requests[index],
      `reconstructed request drifted at ${stepId}`,
    );
  }
}

function verifyCodeGuideCoverage(config: CheckpointConfig, sourceLineCount: number): void {
  const { start, end } = config.sourceRange;
  assert(start >= 1 && start <= end, `${config.id}: invalid source range ${start}-${end}`);
  assert(end <= sourceLineCount, `${config.id}: source range ends after line ${sourceLineCount}`);

  assert(config.codeGuide.observations.length > 0, `${config.id}: code guide needs observations`);
  for (const observation of config.codeGuide.observations) {
    const [observationStart, observationEnd] = observation.lines;
    assert(
      observationStart >= start && observationStart <= observationEnd && observationEnd <= end,
      `${config.id}: observation range ${observationStart}-${observationEnd} falls outside ${start}-${end}`,
    );
  }
}

function verifyFills(config: CheckpointConfig, sourceLines: string[]): void {
  const fills = config.codeGuide.fills;
  if (!fills || fills.length === 0) return;
  assert(fills[0]?.kind === "skeleton", `${config.id}: the first fill must be a skeleton`);

  let previousBodyEnd = 0;
  for (const fill of fills) {
    assert(fill.label.trim().length > 0, `${config.id}: fill needs a label`);
    assert(
      fill.kind === "skeleton" || fill.kind === "body",
      `${config.id}: fill ${fill.label} has unknown kind ${fill.kind}`,
    );
    assert(fill.ranges.length > 0, `${config.id}: fill ${fill.label} needs ranges`);
    for (const [fillStart, fillEnd] of fill.ranges) {
      assert(
        fillStart >= 1 && fillStart <= fillEnd && fillEnd <= sourceLines.length,
        `${config.id}: fill ${fill.label} range ${fillStart}-${fillEnd} falls outside 1-${sourceLines.length}`,
      );
      if (fill.kind === "body") {
        assert(
          fillStart > previousBodyEnd,
          `${config.id}: body fill ${fill.label} range ${fillStart}-${fillEnd} overlaps or is out of order after ${previousBodyEnd}`,
        );
        previousBodyEnd = fillEnd;
      }
    }
  }

  // 观察点逐行覆盖（空行豁免：空行不承载内容，允许落在 fills 之外）
  const covered = new Set<number>();
  for (const fill of fills) {
    for (const [fillStart, fillEnd] of fill.ranges) {
      for (let line = fillStart; line <= fillEnd; line += 1) covered.add(line);
    }
  }
  const assertCovered = (label: string, start: number, end: number): void => {
    for (let line = start; line <= end; line += 1) {
      if (!covered.has(line) && sourceLines[line - 1]?.trim() !== "") {
        throw new Error(`${config.id}: ${label} line ${line} is not covered by any fill`);
      }
    }
  };
  for (const observation of config.codeGuide.observations) {
    assertCovered(`observation ${observation.title}`, observation.lines[0], observation.lines[1]);
  }
}

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

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}
