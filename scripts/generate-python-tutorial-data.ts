import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface PythonChapterConfig {
  sourcePath: string;
  lessonPath: string;
  range: [number, number];
  observations: Array<{ title: string; text: string; lines: [number, number] }>;
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
      { title: "请求是当前状态的快照", text: "用户目标先进入 messages；每个 Step 再把固定规则、工具 Schema、全部历史与本步编号组装为一次模型请求。", lines: [47, 60] },
      { title: "工具调用决定是否继续", text: "模型回复先进入历史。没有 tool_calls 就结束；存在调用则转入执行阶段，并在结果写回以后继续下一圈。", lines: [61, 66] },
      { title: "失败也必须成为反馈", text: "未知工具、参数错误和执行异常都被转换为结果写入 messages；达到 max_steps 才由 Harness 明确报错。", lines: [67, 79] },
    ],
  },
  {
    sourcePath: "python_harness/context.py",
    lessonPath: "docs/lessons-python/m02.md",
    range: [9, 51],
    observations: [
      { title: "投影不改写原始消息", text: "短结果原样返回；长结果保留头尾并写明省略量。这个函数只生成模型视图，不负责修改 Session 中的来源。", lines: [9, 18] },
      { title: "变化更慢的部分排在前面", text: "build_request 先放系统规则和工具，再放投影后的历史，最后放每步变化的 dynamicContext。", lines: [21, 38] },
      { title: "前缀比较只是一种估算", text: "字符数近似 token；shared_prefix 从固定顺序的开头比较到首个差异，并不查询 Provider 的真实缓存。", lines: [41, 51] },
    ],
  },
  {
    sourcePath: "python_harness/runtime.py",
    lessonPath: "docs/lessons-python/m03.md",
    range: [25, 89],
    observations: [
      { title: "Context 保存 owner 与 effect", text: "运行时 Registry 保存 Contribution，安装中的插件名决定 owner，每个插件都有独立的清理栈。", lines: [25, 38] },
      { title: "挂载只有成功或回滚两种结果", text: "setup 抛错就逆序撤销已登记影响；成功后返回幂等的 unmount，主动卸载复用同一条路径。", lines: [39, 65] },
      { title: "注册动作同时登记清理", text: "Tool 与 Prompt 只能在安装期间进入 Registry，并立刻绑定删除本 owner 贡献的 cleanup；inspect 再投影当前快照。", lines: [67, 89] },
    ],
  },
  {
    sourcePath: "python_harness/session.py",
    lessonPath: "docs/lessons-python/m04.md",
    range: [16, 68],
    observations: [
      { title: "Event 以递增编号只追加", text: "append 用当前长度产生稳定 ID；request_step_ids 只从 header 事件读取可重建的模型步骤。", lines: [16, 26] },
      { title: "请求头固定重建边界", text: "step_id 先定位目标 header，只有它之前的事件属于本步历史；最近 checkpoint 决定从哪里接续。", lines: [28, 54] },
      { title: "Request 与 Trace 共用一份日志", text: "消息投影只读取可识别事件；trace 则直接格式化全部 Event，两种视图不维护独立历史。", lines: [56, 68] },
    ],
  },
  {
    sourcePath: "python_harness/runtime_tools.py",
    lessonPath: "docs/lessons-python/m05.md",
    range: [14, 42],
    observations: [
      { title: "基线、目录与 disposer 都有明确位置", text: "RuntimeTools 保存 Context、可信工厂目录和当前实验的卸载函数；inspect_runtime 只投影当前快照。", lines: [14, 21] },
      { title: "安装只能命中可信目录", text: "未知名称和重复安装先被拒绝；成功时仍调用普通 Context.mount，并返回新的工具目录。", lines: [23, 35] },
      { title: "移除复用原来的卸载函数", text: "remove 取出安装时保存的 disposer，执行后再次返回工具目录，供调用方检查运行时是否恢复。", lines: [37, 42] },
    ],
  },
  {
    sourcePath: "python_harness/scenario.py",
    lessonPath: "docs/lessons-python/m06.md",
    range: [13, 41],
    observations: [
      { title: "Goal 集中保存跨轮状态", text: "目标、状态、已启动轮数和上限放在同一对象中；Round 的阶段说明由外部预先定义。", lines: [13, 26] },
      { title: "每轮都重申目标与当前阶段", text: "外循环只在 active 且未达上限时运行；每次调用 run_round 都携带同一 objective 与当前阶段说明。", lines: [29, 33] },
      { title: "状态决定是否续行", text: "accepted 和 blocked 进入明确终态；仍 active 的 Goal 在轮数边界标为 limit_reached。", lines: [34, 41] },
    ],
  },
];

const chapters = await Promise.all(base.chapters.map(async (chapter: any, index: number) => {
  const config = configs[index]!;
  const source = await readFile(resolve(root, config.sourcePath), "utf8");
  const lesson = await readFile(resolve(root, config.lessonPath), "utf8");
  const lines = source.trimEnd().split(/\r?\n/u);
  const diff = additionDiff(config.sourcePath, lines);
  return {
    ...chapter,
    lesson,
    codeGuide: { ...chapter.codeGuide, observations: config.observations, folds: [], fills: [] },
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
