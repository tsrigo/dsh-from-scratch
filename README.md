# dsh-from-scratch

一个原创、可离线运行的 TypeScript 教学 Harness 与交互式网站。我们用同一宗“火星中继站恢复审计”，从普通 tool calling 开始，逐步加入上下文投影、插件生命周期、只追加 Session Log、受信任能力实验和跨 Round 续行。

不要求读者预先了解 TypeScript、Cordis 或 Agent Harness。网站在 M01 前用四张预检卡解释本教程会反复出现的类型标注、`interface`、`async/await` 和事件联合；每章再先暴露上一步的具体不足，加入一块机制，并同步展示当时的真实源码、Git diff、模型请求、Trace、Session Events 和插件图。

## 离线运行

```sh
corepack enable
pnpm install
pnpm demo
pnpm test
pnpm typecheck
pnpm build
pnpm tutorial:generate
pnpm site:build
```

`pnpm demo` 使用确定性 fake LLM，在三个 Round 内完成调查、临时安装并使用 `route_scoring`、卸载实验能力和提交 ASTER 恢复方案。它不读取 API key，也不访问网络。

本地浏览教学网站：

```sh
pnpm tutorial:generate
pnpm site:dev
```

网站只读取 [`website/public/generated/tutorial.json`](website/public/generated/tutorial.json)。生成器会在隔离临时目录中运行 `tutorial-m01` 至 `tutorial-m06` 每个 Git tag 的真实代码，验证 M04 之后的每个实际请求都能从 Session Events 重建，再从对应 tag 提取文章、源码和 diff。网站本身从不调用模型。

## 六个 checkpoint

| 章节 | 新增机制 | 现场证据 |
|---|---|---|
| M01 | 普通工具调用 Agent Loop | turn／step、Ajv 参数校验、标准模式与 PTC 静态对照 |
| M02 | 上下文投影 | 遥测裁剪、稳定前缀、近似 token 与首次失效位置 |
| M03 | 最小插件内核 | service、tool、Prompt、listener 的归属、回滚与卸载 |
| M04 | 只追加 Session Log | 摘要检查点、任意 step 请求重建与 Trace 回放 |
| M05 | 受信任插件实验 | `inspect → install → score → remove` 后 tool schema 与 Prompt 的变化 |
| M06 | 有界长程续行 | survey／score／submit 三轮与 completed、blocked、max-rounds 停止条件 |

token 和可复用前缀始终标为教学估算；项目不会调用、控制或模拟模型提供方的 Prompt Cache。

## 真实 DeepSeek

真实 DeepSeek 与 fake provider 复用同一 `Agent`、Context、上下文投影和 Session Log：

```sh
DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-v4-flash \
  pnpm dev -- --provider deepseek --workspace ./demo-workspace
```

默认 base URL 是 `https://api.deepseek.com`。API key 只从环境变量读取；无 key 不影响 demo、测试、教程生成或网站。provider 只负责把统一请求映射到非流式 Chat Completions，并关闭 thinking mode。可用 `DEEPSEEK_BASE_URL` 与 `DEEPSEEK_MODEL` 覆盖默认值。

## 边界与致谢

本项目不是 DeepSeek Harness 的兼容层，也不实现 Code Runtime、preset loader、权限审批、生产沙箱、Subagent 或 Workflow。PTC 只作为工具呈现方式的静态教学对照；创造模式只实现运行时检查与受信任插件实验，不把它冒充完整 preset 创作。JSONL 和上下文溢出恢复经过任务筛选后未进入首版，仓库没有相应占位实现。

架构行为参考 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。教学闭环受到 [pi-from-scratch](https://github.com/SaladDay/pi-from-scratch) “渐进实现、文章与真实源码同步、静态 Trace”理念启发。所有源码、文案、章节组织、组件、布局和 Trace 数据均为独立创作。
