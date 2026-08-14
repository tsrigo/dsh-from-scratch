# deepseek-harness-from-scratch

一个原创、可离线运行的 TypeScript / Python Agent Harness（智能体运行框架）教程与交互式网站。六章分别使用一个最小样本，讲清 Agent Loop、上下文投影、插件生命周期、只追加会话日志、受信任能力实验和跨轮续行。网站顶部可以随时切换两种实现语言；完整购物车修复仅保留为独立的静态回放。

读者无需预先了解 TypeScript、Cordis 或智能体运行框架。网站先用四张预检卡解释常见语法，再让每章同步展示正文、聚焦代码、本章变化、模型请求、过程事件和能力图。真实回放中的“运行信号台”还会把每条录制事件投影为请求、模型、工具与会话之间的责任交接。完整源码与逐行代码差异放在可展开的工程附录中。

## 离线运行

```sh
corepack enable
pnpm install
pnpm demo
pnpm test
pnpm test:python
pnpm typecheck
pnpm build
pnpm tutorial:generate
pnpm site:build
```

`pnpm demo` 使用确定性模型模拟器，在三轮内诊断重复折扣、临时安装并使用 `typescript_analysis`、卸载实验能力、修改代码、运行测试并提交补丁。命令不会读取应用程序编程接口（Application Programming Interface，API）密钥，也不会访问网络。

本地浏览教学网站：

```sh
pnpm tutorial:generate
pnpm site:dev
```

网站读取 TypeScript 的 [`website/public/generated/tutorial.json`](website/public/generated/tutorial.json) 或 Python 的 `tutorial-python.json`。生成器会在隔离临时目录中运行六份历史教学快照，校验后续章节的模型请求可以从会话事件中重建，再提取对应源码和变化数据。Python 教程源码位于 [`python_harness/`](python_harness)，只依赖标准库，并有独立测试。

正文前的主回放来自一次真实 DeepSeek 流式运行。模型增量、工具调用、工具结果和 Goal 状态已经录制为静态样本，因此浏览器端不会发起模型调用，也不需要 API 密钥。

## 六章内容

| 章节 | 加入的机制 | 页面证据 |
|---|---|---|
| 第一章 · Agent Loop | 有上限的普通工具调用循环 | 轮次／步骤、Ajv 参数校验、两种工具呈现方式 |
| 第二章 · 上下文与缓存复用 | 模型输入投影 | 长测试日志裁剪、相同前缀、文本量估算与首次变化位置 |
| 第三章 · 一切皆插件 | 带归属的插件生命周期 | 服务、工具、提示词、监听器的归属、回滚与卸载 |
| 第四章 · 让运行有迹可循 | 只追加会话日志 | 上下文摘要点、任意步骤请求重建与执行轨迹回放 |
| 第五章 · 运行时自进化 | 受信任能力目录 | 检查、试装、实际调用与移除前后的工具变化 |
| 第六章 · 长程任务续行 | 有界跨轮续行 | 诊断、修复、验证提交三轮与完成、受阻、达到上限三类停止状态 |

Token（文本计量单位）和可复用前缀始终标为教学估算。项目不会查询或模拟模型服务的提示词缓存（Prompt Cache）命中情况。

## 连接 DeepSeek

DeepSeek 与确定性模型模拟器复用同一个智能体、运行上下文、上下文投影和会话日志：

```sh
DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-v4-flash \
  pnpm dev -- --provider deepseek --workspace ./demo-workspace
```

默认服务地址为 `https://api.deepseek.com`。API 密钥只从环境变量读取；没有密钥仍可运行离线演示、测试、教程生成和网站。适配层负责把统一请求映射到流式 Chat Completions，逐段组装文字和工具参数，并关闭思考模式。`DEEPSEEK_BASE_URL` 与 `DEEPSEEK_MODEL` 可以覆盖默认值。

维护者需要更新真实回放时，显式运行：

```sh
DEEPSEEK_API_KEY=... pnpm replay:record
pnpm tutorial:generate
```

录制命令只有在三轮 Goal 完成、`CHECKOUT-417` 补丁被接受且临时 TypeScript 分析能力已经移除时才会原子更新 [`docs/replays/checkout-live.json`](docs/replays/checkout-live.json)。普通 `tutorial:generate` 只读取并校验这份已提交样本，不访问网络。

## 实现范围与致谢

项目范围聚焦教学闭环，未包含 Code Runtime、预设配置加载器、权限审批、生产沙箱、子智能体和工作流系统。程序化工具调用（Programmatic Tool Calling，PTC）作为工具呈现方式的静态对照；创造模式实现运行时检查与受信任插件实验。JSON Lines（JSONL，每行一个 JSON 对象）持久化和上下文溢出恢复也未进入当前版本。

架构行为参考 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。教学闭环受到 [pi-from-scratch](https://github.com/SaladDay/pi-from-scratch) “渐进实现、文章与真实源码同步、静态执行轨迹”理念启发；程序化动效借鉴 [vibe-motion/skills](https://github.com/vibe-motion/skills) 的语义阶段、运动层级与可复现状态方法。所有源码、文案、章节组织、组件、布局、动效和过程数据均为独立创作。
