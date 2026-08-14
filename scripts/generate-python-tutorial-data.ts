import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface PythonChapterConfig {
  sourcePath: string;
  lessonPath: string;
  range: [number, number];
  observations: Array<{ title: string; text: string; lines: [number, number] }>;
  fills: Array<{ label: string; kind: "skeleton" | "body"; ranges: Array<[number, number]> }>;
}

const root = resolve(import.meta.dirname, "..");
const generated = resolve(root, "website/public/generated");
const base = JSON.parse(await readFile(resolve(generated, "tutorial.json"), "utf8"));
const primer = await readFile(resolve(root, "docs/python-primer.md"), "utf8");

const configs: PythonChapterConfig[] = [
  {
    sourcePath: "python_harness/agent.py",
    lessonPath: "docs/lessons-python/m01.md",
    range: [47, 79],
    observations: [
      { title: "请求包含构建时的当前状态", text: "用户目标先进入 messages；每个 Step 再把固定规则、工具 Schema、全部历史与本步编号组成一次模型请求。", lines: [47, 60] },
      { title: "工具调用决定是否继续", text: "模型回复先进入历史。没有 tool_calls 时结束；存在调用时进入执行阶段，并在结果写回后继续下一个 Step。", lines: [61, 66] },
      { title: "失败也会写入反馈", text: "未知工具、参数错误和执行异常都会转换为结果并写入 messages；达到 max_steps 时由 Harness 明确报错。", lines: [67, 79] },
    ],
    fills: [
      { label: "类型声明与 Agent 骨架", kind: "skeleton", ranges: [[1,26],[41,41],[79,80]] },
      { label: "validate_arguments：参数校验", kind: "body", ranges: [[27,40]] },
      { label: "构造器：注入 LLM 与工具", kind: "body", ranges: [[42,46]] },
      { label: "run：组装请求并调用模型", kind: "body", ranges: [[47,60]] },
      { label: "停止条件：无调用即返回", kind: "body", ranges: [[61,66]] },
      { label: "工具执行与错误反馈", kind: "body", ranges: [[67,79]] }
    ],
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
      { label: "四个函数签名", kind: "skeleton", ranges: [[1,9],[21,21],[41,41],[46,46]] },
      { label: "project_tool_result：裁剪长结果", kind: "body", ranges: [[10,20]] },
      { label: "build_request：稳定前缀排序", kind: "body", ranges: [[22,40]] },
      { label: "approximate_tokens：字符估算", kind: "body", ranges: [[42,45]] },
      { label: "shared_prefix：首个差异定位", kind: "body", ranges: [[47,52]] }
    ],
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
      { label: "类型声明与 Context 骨架", kind: "skeleton", ranges: [[1,25],[89,90]] },
      { label: "构造器：Registry 状态", kind: "body", ranges: [[26,33]] },
      { label: "effect：登记清理函数", kind: "body", ranges: [[34,38]] },
      { label: "mount：安装、回滚与卸载", kind: "body", ranges: [[39,62]] },
      { label: "_rollback：逆序撤销", kind: "body", ranges: [[63,66]] },
      { label: "工具与提示词注册", kind: "body", ranges: [[67,78]] },
      { label: "inspect 与 owner 守卫", kind: "body", ranges: [[79,89]] }
    ],
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
      { label: "事件类型与 SessionLog 骨架", kind: "skeleton", ranges: [[1,16],[68,69]] },
      { label: "append：递增编号写入", kind: "body", ranges: [[17,24]] },
      { label: "request_step_ids：重建索引", kind: "body", ranges: [[25,27]] },
      { label: "build_request：定位头部与摘要", kind: "body", ranges: [[28,55]] },
      { label: "_message_from：事件转消息", kind: "body", ranges: [[56,66]] },
      { label: "trace：同一份日志的时间线", kind: "body", ranges: [[67,68]] }
    ],
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
      { label: "工具包装与 runtime_tools_plugin 骨架", kind: "skeleton", ranges: [[1,28],[118,120]] },
      { label: "定义表、清理与检查工具", kind: "body", ranges: [[29,41]] },
      { label: "登记插件代码", kind: "body", ranges: [[42,56]] },
      { label: "运行动态插件", kind: "body", ranges: [[57,72]] },
      { label: "停止与删除插件", kind: "body", ranges: [[73,95]] },
      { label: "注册五个 cordis 工具", kind: "body", ranges: [[96,117]] },
      { label: "编译、实例化与参数读取", kind: "body", ranges: [[121,141]] }
    ],
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
      { label: "类型声明与 run_long_task 骨架", kind: "skeleton", ranges: [[1,21],[29,29],[41,42]] },
      { label: "轮次说明常量", kind: "body", ranges: [[22,28]] },
      { label: "循环：推进与调用 run_round", kind: "body", ranges: [[30,33]] },
      { label: "状态落定：完成、受阻、上限", kind: "body", ranges: [[34,41]] }
    ],
  },
];

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
  const source = await readFile(resolve(root, config.sourcePath), "utf8");
  const lesson = await readFile(resolve(root, config.lessonPath), "utf8");
  const lines = source.trimEnd().split(/\r?\n/u);
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
    codeGuide: { ...chapter.codeGuide, observations: config.observations, folds: [], fills: config.fills },
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
    dataPolicy: "Python 源码可独立运行并由标准库测试验证；请求、事件与能力图使用与 TypeScript 版相同的最小确定性样本。顶部静态回放仍保留完整编码任务。文本量与相同前缀均为教学估算。",
  },
  chapters,
};

await writeFile(resolve(generated, "tutorial-python.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`generated Python tutorial · ${chapters.length} chapters`);

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
