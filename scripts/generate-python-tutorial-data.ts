import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface PythonChapterConfig {
  sourcePath: string;
  lessonPath: string;
  range: [number, number];
  observations: Array<{ title: string; text: string; lines: [number, number] }>;
  fills: Array<{ label: string; kind: "skeleton" | "body"; ranges: Array<[number, number]> }>;
  changeStory?: ChangeStory;
}

interface PythonEnglishOverlay {
  observations: Array<{ title: string; text: string; lines: [number, number] }>;
  fills: Array<{ label: string }>;
  changeStory?: ChangeStory;
}

interface ChangeStory {
  title: string;
  summary: string;
  harnessRole: string;
  connection: string;
  outcomes: string[];
}

interface PythonToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface PythonMessage {
  role: string;
  content: string;
  name?: string;
}

interface PythonRequest {
  system: string;
  tools: PythonToolSchema[];
  messages: PythonMessage[];
  dynamicContext: string;
}

interface PythonRequestPart {
  id: string;
  kind: "system" | "tools" | "message" | "dynamic";
  stability: "stable" | "append-only" | "step-variable";
  label: string;
  value: unknown;
  approximateTokens: number;
}

interface PythonRequestEvidence {
  step: number;
  stepId?: string;
  request: PythonRequest;
  parts: PythonRequestPart[];
  totalApproximateTokens: number;
  prefix: {
    sharedParts: number;
    sharedApproximateTokens: number;
    previousParts: number;
    currentParts: number;
    firstInvalidation: string | null;
    note: string;
  };
}

interface PythonEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}

interface PythonTraceItem {
  eventId: number;
  type: string;
  title: string;
  detail: string;
}

interface PythonGraph {
  stepId: string;
  eventId: number;
  plugins: string[];
  tools: Array<{ name: string; owner: string }>;
  prompts: Array<{ id?: string; text: string; owner: string }>;
  services: Array<{ name: string; provider: string }>;
  relations: Array<{ consumer: string; service: string; provider: string }>;
  nodes: Array<{ id: string; label: string; kind: string }>;
  edges: Array<{ from: string; to: string; label: string }>;
}

interface PythonTeachingEvidence {
  requests: PythonRequestEvidence[];
  events: PythonEvent[];
  trace: PythonTraceItem[];
  graphs: PythonGraph[];
}

const root = resolve(import.meta.dirname, "..");
const generated = resolve(root, "website/public/generated");
const tutorialLocale = process.env.TUTORIAL_LOCALE === "en" ? "en" : "zh";
const english = tutorialLocale === "en";
const base = JSON.parse(await readFile(resolve(generated, english ? "tutorial.en.json" : "tutorial.json"), "utf8"));
const primer = await readFile(resolve(root, english ? "docs/python-primer.en.md" : "docs/python-primer.md"), "utf8");

const configs: PythonChapterConfig[] = [
  {
    sourcePath: "python_harness/agent.py",
    lessonPath: "docs/lessons-python/m01.md",
    range: [27, 79],
    observations: [
      { title: "参数检查和构造器固定执行边界", text: "validate_arguments 只覆盖教程使用的 JSON Schema 子集。构造器保存模型、工具表和步数上限，循环不必在每次请求中重新寻找这些依赖。", lines: [27, 45] },
      { title: "一次 Step 固定请求并判断是否停止", text: "run 先写入用户目标，再将系统规则、工具 Schema、当前历史与步骤编号组成请求。模型没有 tool_calls 时，当前 Turn 结束。", lines: [47, 65] },
      { title: "工具执行和失败都回到消息历史", text: "未知工具、参数错误和执行异常都会转成工具结果并写回 messages；达到 max_steps 时由 Harness 明确报错。", lines: [67, 79] },
    ],
    fills: [
      { label: "模型协议、工具结构与 Agent 轮廓", kind: "skeleton", ranges: [[1,26]] },
      { label: "参数检查与 Agent 的固定依赖", kind: "body", ranges: [[27,45]] },
      { label: "run：构造请求、接收回复并判断停止", kind: "body", ranges: [[47,66]] },
      { label: "工具执行：校验、异常与反馈", kind: "body", ranges: [[67,79]] }
    ],
    changeStory: {
      title: "先建立可验证的 Python 执行基线",
      summary: "Python Nano DSH 用 Agent.run() 在一个 Turn 中推进多个 Step：模型返回工具调用，运行时按简化的 Schema 检查参数并执行工具，再把结果写回下一次请求。它保留了工具、历史和记录仍在内存中的限制，供后续章节处理。",
      harnessRole: "执行基线：将模型动作转成经过校验的工具结果",
      connection: "第一章先让模型、工具和反馈闭环。第二章控制请求视图，第三章管理可安装能力，第四章把运行事实写入共同记录。",
      outcomes: [
        "能沿 Agent.run() 说明请求、工具调用、工具结果和下一步的顺序",
        "能解释模型提出动作后，运行时为何还要承担工具查找、参数检查和异常包装",
        "能区分 Step、Turn 与 max_steps，并指出这条基线尚未解决的运行时问题"
      ]
    },
  },
  {
    sourcePath: "python_harness/context.py",
    lessonPath: "docs/lessons-python/m02.md",
    range: [9, 51],
    observations: [
      { title: "投影保留原始消息", text: "短结果原样返回；长结果保留头尾并写明省略量。这个函数生成模型视图，同时保留 Session 中的原始内容。", lines: [9, 18] },
      { title: "变化更慢的部分排在前面", text: "build_request 先放系统规则和工具，再放投影后的历史，最后放每步变化的 dynamicContext。", lines: [21, 38] },
      { title: "前缀比较提供教学估算", text: "字符数用于近似 token 数量；shared_prefix 按固定顺序从开头比较到首个差异，不查询 Provider 的真实缓存。", lines: [41, 51] },
    ],
    fills: [
      { label: "投影与请求比较的函数轮廓", kind: "skeleton", ranges: [[1,9]] },
      { label: "project_tool_result：在模型视图中裁剪长结果", kind: "body", ranges: [[10,20]] },
      { label: "build_request：将稳定内容、历史和本步说明排序", kind: "body", ranges: [[21,40]] },
      { label: "估算文本量并定位首个变化", kind: "body", ranges: [[41,51]] }
    ],
    changeStory: {
      title: "完整事实和当前请求分别承担不同职责",
      summary: "Python Nano DSH 在构建请求时复制消息，并只裁剪工具结果的模型视图。系统规则与工具在前，历史按顺序追加，本步说明最后加入；shared_prefix 提供四个顶层部件的确定性教学比较。",
      harnessRole: "输入投影层：决定当前 Step 发给模型的内容",
      connection: "第一章需要一份请求，本章定义请求如何由完整历史生成。第三章变更可用工具，第四章会为完整事实提供更完整的记录结构。",
      outcomes: [
        "能区分原始消息与发送给模型的投影消息",
        "能解释 project_tool_result() 为什么只改变当前请求视图",
        "能从 system、tools、messages、dynamicContext 的顺序判断首个变化位置"
      ]
    },
  },
  {
    sourcePath: "python_harness/runtime.py",
    lessonPath: "docs/lessons-python/m03.md",
    range: [25, 89],
    observations: [
      { title: "Context 保存 owner 与 effect", text: "运行时 Registry（注册表）保存 Contribution（能力贡献），安装中的插件名决定 owner，每个插件都有独立的清理函数列表。", lines: [25, 38] },
      { title: "挂载成功后生效，失败后回滚", text: "setup 抛错时逆序撤销已登记内容；成功后返回幂等的 unmount，主动卸载使用同一组清理函数。", lines: [39, 65] },
      { title: "注册内容同时登记清理函数", text: "Tool 与 Prompt 只能在安装期间进入 Registry，并立刻绑定删除该 owner 贡献的 cleanup；inspect 再生成当前运行时视图。", lines: [67, 89] },
    ],
    fills: [
      { label: "插件协议、贡献记录与 Context 轮廓", kind: "skeleton", ranges: [[1,25]] },
      { label: "安装状态、effect 栈与可逆挂载", kind: "body", ranges: [[26,66]] },
      { label: "登记工具和提示词，同时绑定清理动作", kind: "body", ranges: [[67,78]] },
      { label: "检查当前能力并守住安装期边界", kind: "body", ranges: [[79,89]] }
    ],
    changeStory: {
      title: "Python 版保留能力来源和可逆生命周期",
      summary: "完整 DSH 用 Cordis 插件树组织模型、工具、会话和 Agent Loop。Python 教学版把这一点缩为 owner 和 effect：它具体登记 Tool 与 Prompt 贡献，并在安装失败或主动卸载时逆序清理。services 与 listeners 容器为扩展预留，当前示例没有实现 Service 注入和依赖图。",
      harnessRole: "运行时组装层：维护当前可用工具和提示词的来源与生命周期",
      connection: "第一章消费工具表，第二章把工具放进请求，本章说明能力怎样进入和离开 Context。第四章会从消息和事件的角度保存运行事实。",
      outcomes: [
        "能区分 Tool 这个模型动作与 Plugin 这个能力安装单元",
        "能沿 Context.mount()、effect() 和返回的 unmount 说明安装、失败回滚和卸载",
        "能用 inspect() 的 owner 记录解释当前工具和提示词的来源"
      ]
    },
  },
  {
    sourcePath: "python_harness/session.py",
    lessonPath: "docs/lessons-python/m04.md",
    range: [16, 68],
    observations: [
      { title: "Event 以递增编号追加", text: "append 使用当前长度产生稳定 ID（标识符）；request_step_ids 从 header 事件读取能够重建的模型步骤。", lines: [16, 26] },
      { title: "请求头确定重建范围", text: "step_id 先定位目标 header；该事件之前的内容属于本步历史，最近的 checkpoint 决定从哪里继续。", lines: [28, 54] },
      { title: "Request 与 Trace 使用同一份日志", text: "消息投影读取可识别事件，trace 格式化全部 Event。两种视图均从 Session Log 生成。", lines: [56, 68] },
    ],
    fills: [
      { label: "事件结构与 SessionLog 的基本轮廓", kind: "skeleton", ranges: [[1,16]] },
      { label: "追加事实并建立可重建 Step 的索引", kind: "body", ranges: [[17,27]] },
      { label: "按请求头和检查点重建当前请求", kind: "body", ranges: [[28,55]] },
      { label: "从事件恢复消息", kind: "body", ranges: [[56,66]] },
      { label: "从同一份事件流生成 Trace", kind: "body", ranges: [[67,68]] }
    ],
    changeStory: {
      title: "Python 版从一条日志派生请求和时间线",
      summary: "Python Nano DSH 将 Event 追加到 SessionLog，并用 request/header、检查点和此前事件重建模型消息。trace() 从同一序列生成展示用时间线。这个最小版本由调用方显式追加事件，没有将日志自动接入插件运行时或持久化。",
      harnessRole: "记录层：为请求重建与执行查看提供共同输入",
      connection: "第一章产生模型和工具往返，第二章说明请求视图，第三章管理能力生命周期。本章为可记录的事实建立简单的事件序列；后两章可在完整 DSH 中继续扩展它。",
      outcomes: [
        "能说明递增事件编号怎样保留发生顺序",
        "能解释 request/header 和 context/checkpoint 怎样确定重建范围",
        "能区分 SessionLog、build_request() 的请求和 trace() 的时间线"
      ]
    },
  },
  {
    sourcePath: "python_harness/runtime_tools.py",
    lessonPath: "docs/lessons-python/m05.md",
    range: [25, 140],
    observations: [
      { title: "定义表保存代码和运行状态", text: "setup 建立定义表和自增编号，注册卸载时统一清理的 effect；cordis_inspect 返回当前运行时视图。", lines: [29, 40] },
      { title: "定义和运行是两个动作", text: "cordis_define 编译校验并保存 Agent 提交的 Python 插件代码。cordis_run 根据 plugin_id 取回代码，执行得到 Plugin，再通过 context.mount() 挂载。", lines: [42, 71] },
      { title: "停止与删除复用卸载函数", text: "cordis_stop 执行卸载函数但保留定义，cordis_undefine 停止插件并删除定义；插件贡献随 Context 生命周期一起撤销。", lines: [73, 94] },
    ],
    fills: [
      { label: "工具包装与 Runtime Tools 插件轮廓", kind: "skeleton", ranges: [[1,28],[118,120]] },
      { label: "定义表、清理动作与检查接口", kind: "body", ranges: [[29,41]] },
      { label: "定义并挂载动态 Python 插件", kind: "body", ranges: [[42,72]] },
      { label: "停止、删除、注册工具并加载插件代码", kind: "body", ranges: [[73,140]] }
    ],
    changeStory: {
      title: "面对能力缺口，先检查、挂载、验证、释放",
      summary: "Python Nano DSH 将 cordis_inspect、cordis_define、cordis_run、cordis_stop 和 cordis_undefine 暴露为普通工具。调用方先确认缺口，登记并挂载一个 Python 插件，从 Context 取出新工具验证结果，再停止或删除定义。动态代码通过内置 compile() 和 exec() 加载，仅用于可信教学样本。",
      harnessRole: "能力演化层：在任务中补齐并释放当前运行时能力",
      connection: "这条路径使用前几章的基础：Runtime Tools 提供能力变更接口，Context 管理挂载和卸载。调用方需要把 context.tools 回填进 Agent，后续请求才会看到新工具；Python 最小实现也不会自动将定义和挂载写入 SessionLog。",
      outcomes: [
        "能按检查、定义、挂载、验证、释放说明一次能力变更",
        "能说明代码已定义、插件已运行和新工具已验证之间的差别",
        "能指出动态代码执行需要可信来源与明确安全边界"
      ]
    },
  },
  {
    sourcePath: "python_harness/scenario.py",
    lessonPath: "docs/lessons-python/m06.md",
    range: [13, 41],
    observations: [
      { title: "Goal 集中保存跨轮状态", text: "目标、状态、已启动轮数和轮数上限保存在同一对象中；Round 的阶段说明由外部预先定义。", lines: [13, 26] },
      { title: "每轮都重申目标与当前阶段", text: "run_long_task 只在 Goal 为 active 且未达上限时继续；每次调用 run_round 都携带同一个 objective 与当前阶段说明。", lines: [29, 33] },
      { title: "状态决定是否续行", text: "accepted 和 blocked 会结束 Goal；状态仍为 active 的 Goal 在轮数边界标记为 limit_reached。", lines: [34, 41] },
    ],
    fills: [
      { label: "Goal 数据、回调类型与运行器轮廓", kind: "skeleton", ranges: [[1,21],[29,29]] },
      { label: "预先定义每轮任务说明", kind: "body", ranges: [[22,28]] },
      { label: "推进轮次并调用 run_round", kind: "body", ranges: [[30,33]] },
      { label: "根据结果文本结束或继续 Goal", kind: "body", ranges: [[34,41]] }
    ],
    changeStory: {
      title: "Python 版用 Goal 跨过普通 Turn",
      summary: "Python Nano DSH 的 Goal 保存目标、状态和轮数。run_long_task() 每轮把目标和阶段说明交给外部 run_round，并根据返回文本中的 accepted 或 blocked 更新状态；仍为 active 的 Goal 在上限处成为 limit_reached。",
      harnessRole: "长程协调层：让有限轮次共同推进一个目标",
      connection: "每个 run_round 可以继续调用第一章的 Agent，并复用外层保留的状态。与 TypeScript 版相比，这个教学版本没有结构化 RoundResult、进展检查或自动 SessionLog 事件。",
      outcomes: [
        "能区分 Goal、Round、Turn 和 Step 四个控制层",
        "能说明 run_long_task() 如何按照状态和轮数启动下一轮",
        "能指出 accepted、blocked 和 limit_reached 三种退出路径，以及文本匹配的教学局限"
      ]
    },
  },
];

const englishOverlays = english
  ? JSON.parse(await readFile(resolve(root, "docs/python-chapters.en.json"), "utf8")) as PythonEnglishOverlay[]
  : [];

if (english) {
  if (englishOverlays.length !== configs.length) {
    throw new Error(`Expected ${configs.length} Python English overlays, received ${englishOverlays.length}`);
  }
  configs.forEach((config, chapterIndex) => {
    const overlay = englishOverlays[chapterIndex]!;
    if (overlay.observations.length !== config.observations.length) {
      throw new Error(`Python chapter ${chapterIndex + 1}: observation translation count does not match`);
    }
    if (overlay.fills.length !== config.fills.length) {
      throw new Error(`Python chapter ${chapterIndex + 1}: fill translation count does not match`);
    }
    overlay.observations.forEach((observation, observationIndex) => {
      const sourceLines = config.observations[observationIndex]!.lines;
      if (observation.lines[0] !== sourceLines[0] || observation.lines[1] !== sourceLines[1]) {
        throw new Error(`Python chapter ${chapterIndex + 1}: observation ${observationIndex + 1} line range changed`);
      }
    });
  });
}

const PYTHON_MAIN_FILES = [
  "python_harness/agent.py",
  "python_harness/context.py",
  "python_harness/runtime.py",
  "python_harness/session.py",
  "python_harness/runtime_tools.py",
  "python_harness/scenario.py",
];

const chapters = await Promise.all(base.chapters.map(async (chapter: any, index: number) => {
  const config = configs[index]!;
  const overlay = englishOverlays[index];
  const evidence = pythonTeachingEvidence(index + 1);
  const source = await readFile(resolve(root, config.sourcePath), "utf8");
  const lessonPath = english
    ? config.lessonPath.replace("docs/lessons-python/", "docs/lessons-python-en/")
    : config.lessonPath;
  const lesson = await readFile(resolve(root, lessonPath), "utf8");
  const lines = source.trimEnd().split(/\r?\n/u);
  verifyCodeGuideCoverage(config, lines.length);
  verifyFills(config, lines);
  verifyLessonFillAnchors(config, lesson);
  const diff = additionDiff(config.sourcePath, lines);
  // 文件 tab：主文件 + 该章为止已出现的其余主文件（与 TS 版同一规则）
  const mainIndex = PYTHON_MAIN_FILES.indexOf(config.sourcePath);
  const extraFiles = (mainIndex > 0 ? PYTHON_MAIN_FILES.slice(0, mainIndex) : [])
    .map((path) => ({ path, content: "" }));
  for (const file of extraFiles) {
    file.content = await readFile(resolve(root, file.path), "utf8");
  }
  return {
    ...chapter,
    lesson,
    requests: evidence.requests,
    events: evidence.events,
    trace: evidence.trace,
    graphs: evidence.graphs,
    ...(config.changeStory || overlay?.changeStory
      ? { changeStory: overlay?.changeStory ?? config.changeStory }
      : {}),
    codeGuide: {
      ...chapter.codeGuide,
      observations: overlay?.observations ?? config.observations,
      folds: [],
      fills: overlay
        ? config.fills.map((fill, fillIndex) => ({ ...fill, label: overlay.fills[fillIndex]?.label ?? fill.label }))
        : config.fills,
    },
    extraFiles,
    source: {
      path: config.sourcePath,
      content: source,
      excerpt: lines.slice(config.range[0] - 1, config.range[1]).join("\n"),
      startLine: config.range[0],
      endLine: config.range[1],
    },
    diff,
    diffStats: {
      filesChanged: 1,
      additions: lines.length,
      deletions: 0,
      files: [{ path: config.sourcePath, additions: lines.length, deletions: 0 }],
    },
    ...(chapter.ptc ? { ptc: { ...chapter.ptc, language: "typescript" } } : {}),
  };
}));

const output = {
  ...base,
  project: {
    ...base.project,
    language: "python",
    languageLabel: "Python",
    primer,
    dataPolicy: english
      ? "The Python source runs independently and is verified by standard-library tests. Requests, events, and capability graphs are deterministic teaching samples aligned with their Python modules; the page displays Python's dynamic_context as dynamicContext for a uniform request view. Chapter 5's call sequence is constructed by the tutorial and does not claim that SessionLog automatically records plugin lifecycle changes. The static replay at the top remains the complete TypeScript coding task. Text size and shared-prefix figures are teaching estimates."
      : "Python 源码可独立运行，并由标准库测试验证。请求、事件与能力图均使用与各 Python 模块一致的确定性教学样本；页面将 Python 的 dynamic_context 统一显示为 dynamicContext，便于与请求卡对照。第五章的调用序列由教程构造，不代表 SessionLog 已自动记录插件生命周期。顶部静态回放仍保留 TypeScript 的完整编码任务。文本量与相同前缀均为教学估算。",
  },
  chapters,
};

const outputName = english ? "tutorial-python.en.json" : "tutorial-python.json";
await writeFile(resolve(generated, outputName), `${JSON.stringify(output, null, 2)}\n`);
console.log(`generated ${outputName} · ${chapters.length} chapters`);

/** Python chapters are independent mechanism samples. Keep their visible evidence
 * tied to what the corresponding Python module can actually create or inspect. */
function pythonTeachingEvidence(chapterNumber: number): PythonTeachingEvidence {
  switch (chapterNumber) {
    case 1: {
      const time = pythonTool(
        "get_time",
        "查询指定城市的固定时间。",
        "Return a fixed time for the requested city.",
        {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
          additionalProperties: false,
        },
      );
      const city = localized("北京", "Beijing");
      const first: PythonRequest = {
        system: agentSystemPrompt(),
        tools: [time],
        messages: [{ role: "user", content: localized("北京现在几点？", "What time is it in Beijing?") }],
        dynamicContext: "step=1",
      };
      const second: PythonRequest = {
        system: first.system,
        tools: [time],
        messages: [
          ...first.messages,
          { role: "assistant", content: localized("我先查询时间。", "I will check the time first.") },
          { role: "tool", name: "get_time", content: JSON.stringify({ city, time: "14:30" }) },
        ],
        dynamicContext: "step=2",
      };
      return pythonRequestEvidence([first, second]);
    }
    case 2: {
      const readNote = pythonTool(
        "read_note",
        "读取一条命名备忘录。",
        "Read a note by name.",
        {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        },
      );
      const longResult = [
        localized("备忘录 today · 会议准备记录\n", "Note today · meeting preparation\n"),
        localized("背景材料：", "Background: "),
        localized("项目状态、待确认问题与讨论过程。", "Project status, open questions, and discussion notes. ").repeat(36),
        localized("\n最终结论：下午三点开会。", "\nConclusion: the meeting starts at 3:00 p.m."),
      ].join("");
      const first: PythonRequest = {
        system: localized("先读取事实，再给出简短回答。", "Read the facts first, then answer briefly."),
        tools: [readNote],
        messages: [{ role: "user", content: localized("备忘录里写了什么？", "What does the note say?") }],
        dynamicContext: "step=1",
      };
      const second: PythonRequest = {
        system: first.system,
        tools: [readNote],
        messages: [
          ...first.messages,
          { role: "assistant", content: localized("我先读取备忘录。", "I will read the note first.") },
          { role: "tool", name: "read_note", content: projectPythonToolResult(longResult) },
        ],
        dynamicContext: "step=2",
      };
      return pythonRequestEvidence([first, second]);
    }
    case 3:
      // The Python Context currently has no Service dependency API. Do not carry
      // over TypeScript's service graph into this smaller ownership example.
      return emptyPythonEvidence();
    case 4:
      return pythonSessionEvidence();
    case 5:
      return pythonRuntimeToolsEvidence();
    case 6:
      // scenario.py only coordinates a Goal and an external callback. It neither
      // builds model requests nor writes Goal events into SessionLog.
      return emptyPythonEvidence();
    default:
      throw new Error(`Unknown Python tutorial chapter: ${chapterNumber}`);
  }
}

function localized(chinese: string, englishText: string): string {
  return english ? englishText : chinese;
}

function agentSystemPrompt(): string {
  // Keep the literal used in python_harness/agent.py so the card remains a
  // projection of the real request shape rather than a translated substitute.
  return "Use the provided tools to complete the goal. Continue from each tool result and stop calling tools when the work is complete.";
}

function pythonTool(
  name: string,
  chineseDescription: string,
  englishDescription: string,
  inputSchema: Record<string, unknown>,
): PythonToolSchema {
  return { name, description: localized(chineseDescription, englishDescription), inputSchema };
}

function projectPythonToolResult(value: string, limit = 520): string {
  if (value.length <= limit) return value;
  const omitted = value.length - limit;
  const marker = `\n… omitted ${omitted} characters …\n`;
  const headSize = Math.floor(limit / 2);
  const tailSize = limit - headSize;
  return value.slice(0, headSize) + marker + value.slice(-tailSize);
}

function pythonRequestEvidence(
  requests: PythonRequest[],
  stepIds: string[] = [],
): PythonTeachingEvidence {
  return {
    requests: requests.map((request, index) => {
      const parts = describePythonRequest(request);
      const previous = index === 0 ? undefined : requests[index - 1];
      return {
        step: index + 1,
        ...(stepIds[index] ? { stepId: stepIds[index] } : {}),
        request,
        parts,
        totalApproximateTokens: parts.reduce((total, part) => total + part.approximateTokens, 0),
        prefix: comparePythonRequestPrefix(previous, request),
      };
    }),
    events: [],
    trace: [],
    graphs: [],
  };
}

function describePythonRequest(request: PythonRequest): PythonRequestPart[] {
  const parts: PythonRequestPart[] = [
    pythonRequestPart("system", "system", "stable", "System prompt", request.system),
    pythonRequestPart("tools", "tools", "stable", "Tool schemas", request.tools),
  ];
  request.messages.forEach((message, index) => {
    const suffix = message.role === "tool" && message.name ? ` · ${message.name}` : "";
    parts.push(pythonRequestPart(
      `message-${index}`,
      "message",
      "append-only",
      `${message.role}${suffix}`,
      message,
    ));
  });
  if (request.dynamicContext) {
    parts.push(pythonRequestPart("dynamic", "dynamic", "step-variable", "Step context", request.dynamicContext));
  }
  return parts;
}

function pythonRequestPart(
  id: string,
  kind: PythonRequestPart["kind"],
  stability: PythonRequestPart["stability"],
  label: string,
  value: unknown,
): PythonRequestPart {
  return { id, kind, stability, label, value, approximateTokens: approximatePythonTokens(value) };
}

function approximatePythonTokens(value: unknown): number {
  const text = typeof value === "string" ? value : canonicalPythonValue(value);
  return Math.max(1, Math.ceil(Array.from(text).length / 4));
}

function comparePythonRequestPrefix(
  previous: PythonRequest | undefined,
  current: PythonRequest,
): PythonRequestEvidence["prefix"] {
  const currentParts = describePythonRequest(current);
  if (!previous) {
    return {
      sharedParts: 0,
      sharedApproximateTokens: 0,
      previousParts: 0,
      currentParts: currentParts.length,
      firstInvalidation: "First request has no predecessor.",
      note: "Teaching estimate only; no provider cache was queried.",
    };
  }
  const previousParts = describePythonRequest(previous);
  let sharedParts = 0;
  while (
    sharedParts < previousParts.length
    && sharedParts < currentParts.length
    && canonicalPythonValue(previousParts[sharedParts]!.value) === canonicalPythonValue(currentParts[sharedParts]!.value)
  ) {
    sharedParts += 1;
  }
  return {
    sharedParts,
    sharedApproximateTokens: currentParts
      .slice(0, sharedParts)
      .reduce((total, part) => total + part.approximateTokens, 0),
    previousParts: previousParts.length,
    currentParts: currentParts.length,
    firstInvalidation: sharedParts === Math.min(previousParts.length, currentParts.length)
      ? null
      : currentParts[sharedParts]?.label ?? "Request end",
    note: "Longest identical canonical prefix; approximate tokens, not provider cache usage.",
  };
}

function canonicalPythonValue(value: unknown): string {
  return JSON.stringify(sortPythonValue(value)) ?? "null";
}

function sortPythonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortPythonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortPythonValue(item)]),
    );
  }
  return value;
}

function pythonSessionEvidence(): PythonTeachingEvidence {
  const time = pythonTool(
    "get_time",
    "查询指定城市的固定时间。",
    "Return a fixed time for the requested city.",
    {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    },
  );
  const system = localized("需要事实时使用工具。", "Use a tool when the answer requires external facts.");
  const events: PythonEvent[] = [
    {
      id: 1,
      type: "user/message",
      data: { content: localized("北京现在几点？", "What time is it in Beijing?") },
    },
    {
      id: 2,
      type: "request/header",
      data: { step_id: "step-1", system, tools: [time], dynamic_context: "step=1" },
    },
    {
      id: 3,
      type: "assistant/message",
      data: { content: localized("我先查询时间。", "I will check the time first.") },
    },
    {
      id: 4,
      type: "tool/result",
      data: { name: "get_time", content: JSON.stringify({ time: "14:30" }) },
    },
    {
      id: 5,
      type: "context/checkpoint",
      data: {
        summary: localized("已取得北京时间：14:30。", "The Beijing time has been retrieved: 14:30."),
      },
    },
    {
      id: 6,
      type: "request/header",
      data: { step_id: "step-2", system, tools: [time], dynamic_context: "step=2" },
    },
  ];
  const headers = events.filter((event) => event.type === "request/header");
  const requests = headers.map((header) => pythonSessionRequest(events, requiredString(header.data, "step_id")));
  const evidence = pythonRequestEvidence(requests, headers.map((header) => requiredString(header.data, "step_id")));
  return { ...evidence, events, trace: pythonTrace(events) };
}

function pythonSessionRequest(events: PythonEvent[], stepId: string): PythonRequest {
  const headerIndex = events.findIndex(
    (event) => event.type === "request/header" && event.data.step_id === stepId,
  );
  if (headerIndex === -1) throw new Error(`Missing Python request header: ${stepId}`);
  const header = events[headerIndex]!;
  const headerData = header.data;
  let history = events.slice(0, headerIndex);
  let checkpointIndex = -1;
  history.forEach((event, index) => {
    if (event.type === "context/checkpoint") checkpointIndex = index;
  });
  const messages: PythonMessage[] = [];
  if (checkpointIndex >= 0) {
    const checkpoint = history[checkpointIndex]!;
    messages.push({ role: "system", content: requiredString(checkpoint.data, "summary") });
    history = history.slice(checkpointIndex + 1);
  }
  for (const event of history) {
    const message = pythonMessageFromEvent(event);
    if (message) messages.push(message);
  }
  const tools = headerData.tools;
  if (!Array.isArray(tools)) throw new Error(`Python request header ${stepId} needs a tools array`);
  return {
    system: requiredString(headerData, "system"),
    tools: tools as PythonToolSchema[],
    messages,
    dynamicContext: requiredString(headerData, "dynamic_context"),
  };
}

function pythonMessageFromEvent(event: PythonEvent): PythonMessage | undefined {
  const role = ({
    "user/message": "user",
    "assistant/message": "assistant",
    "tool/result": "tool",
  } as Record<string, string>)[event.type];
  if (!role) return undefined;
  const message: PythonMessage = { role, content: eventContent(event.data.content) };
  if (role === "tool") message.name = requiredString(event.data, "name");
  return message;
}

function eventContent(value: unknown): string {
  return typeof value === "string" ? value : canonicalPythonValue(value);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string") throw new Error(`Expected ${key} to be a string in Python teaching evidence`);
  return item;
}

function pythonTrace(events: PythonEvent[]): PythonTraceItem[] {
  return events.map((event) => {
    const { data } = event;
    switch (event.type) {
      case "request/header": {
        const tools = Array.isArray(data.tools) ? data.tools : [];
        return {
          eventId: event.id,
          type: event.type,
          title: `${requiredString(data, "step_id")} → local/python-harness`,
          detail: `${tools.length} tools · dynamic=${requiredString(data, "dynamic_context")}`,
        };
      }
      case "tool/call":
        return {
          eventId: event.id,
          type: event.type,
          title: `call ${requiredString(data, "name")}`,
          detail: canonicalPythonValue(data.arguments ?? {}),
        };
      case "tool/result":
        return {
          eventId: event.id,
          type: event.type,
          title: `result ${requiredString(data, "name")}`,
          detail: eventContent(data.content),
        };
      case "user/message":
      case "assistant/message":
        return { eventId: event.id, type: event.type, title: event.type, detail: eventContent(data.content) };
      case "context/checkpoint":
        return { eventId: event.id, type: event.type, title: event.type, detail: requiredString(data, "summary") };
      default:
        return { eventId: event.id, type: event.type, title: event.type, detail: "" };
    }
  });
}

function pythonRuntimeToolsEvidence(): PythonTeachingEvidence {
  const runtimeTools = pythonRuntimeTools();
  const wordCount = pythonTool(
    "word_count",
    "统计一段文本中以空白分隔的单词数。",
    "Count whitespace-separated words in a string.",
    {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  );
  const prompt = "Inspect the current Context, define a small Cordis Plugin when the task needs a new capability, run it, use its tools, then stop or undefine it after the experiment.";
  const baseTools = runtimeTools.map((tool) => ({ name: tool.name, owner: "runtime-tools" }));
  const basePrompts = [{ text: prompt, owner: "runtime-tools" }];
  const before = pythonGraphSnapshot({
    stepId: "before-install",
    eventId: 2,
    plugins: ["runtime-tools"],
    tools: baseTools,
    prompts: basePrompts,
  });
  const installed = pythonGraphSnapshot({
    stepId: "after-install",
    eventId: 6,
    plugins: ["runtime-tools", "word-count"],
    tools: [...baseTools, { name: wordCount.name, owner: "word-count" }],
    prompts: basePrompts,
  });
  const removed = pythonGraphSnapshot({
    stepId: "after-remove",
    eventId: 12,
    plugins: ["runtime-tools"],
    tools: baseTools,
    prompts: basePrompts,
  });
  const inspectSnapshot = {
    plugins: ["runtime-tools"],
    tools: runtimeTools.map((tool) => ({ name: tool.name, plugin: "runtime-tools" })),
    prompts: [{ text: prompt, plugin: "runtime-tools" }],
  };
  const code = pythonWordCountPluginCode();
  const events: PythonEvent[] = [
    { id: 1, type: "tool/call", data: { name: "cordis_inspect", arguments: {} } },
    { id: 2, type: "tool/result", data: { name: "cordis_inspect", content: JSON.stringify(inspectSnapshot) } },
    {
      id: 3,
      type: "tool/call",
      data: {
        name: "cordis_define",
        arguments: {
          name: "word-count",
          purpose: localized("统计单词", "count words"),
          code,
        },
      },
    },
    {
      id: 4,
      type: "tool/result",
      data: {
        name: "cordis_define",
        content: JSON.stringify({ ok: true, pluginId: "dyn-1", name: "word-count", status: "defined" }),
      },
    },
    { id: 5, type: "tool/call", data: { name: "cordis_run", arguments: { pluginId: "dyn-1" } } },
    {
      id: 6,
      type: "tool/result",
      data: {
        name: "cordis_run",
        content: JSON.stringify({
          ok: true,
          pluginId: "dyn-1",
          status: "running",
          tools: [...runtimeTools.map((tool) => tool.name), wordCount.name],
        }),
      },
    },
    {
      id: 7,
      type: "tool/call",
      data: { name: "word_count", arguments: { text: "one two three" } },
    },
    {
      id: 8,
      type: "tool/result",
      data: { name: "word_count", content: JSON.stringify({ words: 3 }) },
    },
    { id: 9, type: "tool/call", data: { name: "cordis_stop", arguments: { pluginId: "dyn-1" } } },
    {
      id: 10,
      type: "tool/result",
      data: { name: "cordis_stop", content: JSON.stringify({ ok: true, pluginId: "dyn-1", status: "stopped" }) },
    },
    { id: 11, type: "tool/call", data: { name: "cordis_undefine", arguments: { pluginId: "dyn-1" } } },
    {
      id: 12,
      type: "tool/result",
      data: { name: "cordis_undefine", content: JSON.stringify({ ok: true, pluginId: "dyn-1", status: "undefined" }) },
    },
  ];
  return { requests: [], events, trace: pythonTrace(events), graphs: [before, installed, removed] };
}

function pythonRuntimeTools(): PythonToolSchema[] {
  const pluginIdSchema = {
    type: "object",
    properties: { pluginId: { type: "string", pattern: "^dyn-[1-9][0-9]*$" } },
    required: ["pluginId"],
    additionalProperties: false,
  };
  return [
    pythonTool(
      "cordis_inspect",
      "查看当前 Context 中已挂载的插件、工具和提示词。",
      "Inspect the plugins, tools, and prompts currently held by Context.",
      { type: "object", properties: {}, additionalProperties: false },
    ),
    pythonTool(
      "cordis_define",
      "登记 Agent 提交的 Python 插件代码。",
      "Register Python plugin code supplied for a dynamic capability.",
      {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          purpose: { type: "string", minLength: 1 },
          code: { type: "string", minLength: 1 },
        },
        required: ["name", "purpose", "code"],
        additionalProperties: false,
      },
    ),
    pythonTool("cordis_run", "运行已经定义的插件。", "Run a defined plugin.", pluginIdSchema),
    pythonTool("cordis_stop", "停止插件并保留定义。", "Stop a plugin and retain its definition.", pluginIdSchema),
    pythonTool("cordis_undefine", "停止插件并删除定义。", "Stop a plugin and delete its definition.", pluginIdSchema),
  ];
}

function pythonWordCountPluginCode(): string {
  return [
    "def plugin_factory():",
    "    from types import SimpleNamespace",
    "    async def execute(arguments):",
    "        return {'words': len(arguments['text'].split())}",
    "    def setup(ctx):",
    "        ctx.register_tool('word_count', SimpleNamespace(",
    "            parameters={'type': 'object', 'properties': {'text': {'type': 'string'}}, 'required': ['text']},",
    "            execute=execute,",
    "        ))",
    "    return SimpleNamespace(name='word-count', setup=setup)",
  ].join("\n");
}

function pythonGraphSnapshot(options: {
  stepId: string;
  eventId: number;
  plugins: string[];
  tools: Array<{ name: string; owner: string }>;
  prompts?: Array<{ id?: string; text: string; owner: string }>;
  services?: Array<{ name: string; provider: string }>;
  relations?: Array<{ consumer: string; service: string; provider: string }>;
}): PythonGraph {
  const prompts = options.prompts ?? [];
  const services = options.services ?? [];
  const relations = options.relations ?? [];
  const promptNodes = prompts.map((prompt, index) => ({
    prompt,
    id: prompt.id ?? `prompt:${index}`,
  }));
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
      ...promptNodes.map(({ id }) => ({ id, label: "Prompt", kind: "prompt" })),
    ],
    edges: [
      ...options.tools.map((tool) => ({ from: tool.owner, to: `tool:${tool.name}`, label: "contributes" })),
      ...promptNodes.map(({ prompt, id }) => ({ from: prompt.owner, to: id, label: "contributes" })),
      ...relations.map((relation) => ({ from: relation.provider, to: relation.consumer, label: relation.service })),
    ],
  };
}

function emptyPythonEvidence(): PythonTeachingEvidence {
  return { requests: [], events: [], trace: [], graphs: [] };
}

function additionDiff(path: string, lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function verifyCodeGuideCoverage(config: PythonChapterConfig, sourceLineCount: number): void {
  const [start, end] = config.range;
  assert(start >= 1 && start <= end, `${config.sourcePath}: invalid source range ${start}-${end}`);
  assert(end <= sourceLineCount, `${config.sourcePath}: source range ends after line ${sourceLineCount}`);
  assert(config.observations.length > 0, `${config.sourcePath}: code guide needs observations`);
  for (const observation of config.observations) {
    const [observationStart, observationEnd] = observation.lines;
    assert(
      observationStart >= start && observationStart <= observationEnd && observationEnd <= end,
      `${config.sourcePath}: observation range ${observationStart}-${observationEnd} falls outside ${start}-${end}`,
    );
  }
}

function verifyFills(config: PythonChapterConfig, sourceLines: string[]): void {
  assert(config.fills.length > 0, `${config.sourcePath}: code guide needs fills`);
  assert(config.fills[0]?.kind === "skeleton", `${config.sourcePath}: the first fill must be a skeleton`);

  let previousBodyEnd = 0;
  for (const fill of config.fills) {
    assert(fill.label.trim().length > 0, `${config.sourcePath}: fill needs a label`);
    assert(fill.ranges.length > 0, `${config.sourcePath}: fill ${fill.label} needs ranges`);
    for (const [fillStart, fillEnd] of fill.ranges) {
      assert(
        fillStart >= 1 && fillStart <= fillEnd && fillEnd <= sourceLines.length,
        `${config.sourcePath}: fill ${fill.label} range ${fillStart}-${fillEnd} falls outside 1-${sourceLines.length}`,
      );
      if (fill.kind === "body") {
        assert(
          fillStart > previousBodyEnd,
          `${config.sourcePath}: body fill ${fill.label} overlaps or is out of order after ${previousBodyEnd}`,
        );
        previousBodyEnd = fillEnd;
      }
    }
  }

  const covered = new Set<number>();
  for (const fill of config.fills) {
    for (const [fillStart, fillEnd] of fill.ranges) {
      for (let line = fillStart; line <= fillEnd; line += 1) covered.add(line);
    }
  }
  for (const observation of config.observations) {
    const [start, end] = observation.lines;
    for (let line = start; line <= end; line += 1) {
      assert(
        covered.has(line) || sourceLines[line - 1]?.trim() === "",
        `${config.sourcePath}: observation ${observation.title} line ${line} is not covered by a fill`,
      );
    }
  }
}

/** Every language version now places each source reveal where its prose introduces it. */
function verifyLessonFillAnchors(config: PythonChapterConfig, lesson: string): void {
  const matches = [...lesson.matchAll(/<!--\s*fill\s+([\s\S]+?)\s*-->/gu)];
  assert(matches.length > 0, `${config.sourcePath}: lesson needs explicit fill anchors`);
  const indexes = matches.map((match) => {
    try {
      const directive = JSON.parse(match[1] ?? "") as { index?: unknown };
      assert(
        Number.isInteger(directive.index) && (directive.index as number) >= 0,
        `${config.sourcePath}: lesson fill anchor needs a non-negative integer index`,
      );
      return directive.index as number;
    } catch (error) {
      throw new Error(
        `${config.sourcePath}: invalid lesson fill anchor (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  });
  assert.deepEqual(
    indexes,
    config.fills.map((_, index) => index),
    `${config.sourcePath}: lesson fill anchors must name every fill exactly once, in reveal order`,
  );
}
