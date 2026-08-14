# DeepSeek Harness from Scratch

[中文](./README.zh.md) | [English](./README.md)

一个可离线运行的 TypeScript 教程，用六个逐步增加的实现解释 DeepSeek Harness 的主要运行机制。

DeepSeek Harness（DSH）为语言模型执行任务提供运行环境。它组织模型输入，向模型提供工具，执行经过校验的工具调用，保存运行过程，并在一次模型回复不足以完成任务时继续推进。这个仓库把上述机制整理成一套可以阅读、运行和测试的最小实现，同时提供一个与源码同步的交互式教学网站。

六章各自使用一个独立的确定性样本，只保留当前问题需要的输入和运行事件。章节之间逐步加入上下文投影、插件生命周期、会话日志、动态插件和长程任务续行。读者可以分别检查每项机制引起的源码、模型请求和运行状态变化。

本项目面向机制教学，代码规模和运行边界都有意保持有限。它不提供 DeepSeek Harness 的兼容接口，也不覆盖完整产品中的权限、持久化、任务调度和多 Agent 协作能力。

## 快速开始

需要 Node.js 22 或更高版本。项目使用 pnpm 11，版本已经写入 `package.json`。

```sh
git clone https://github.com/tsrigo/dsh-from-scratch.git
cd dsh-from-scratch
corepack enable
pnpm install
pnpm exec tsx scripts/generate-tutorial-data.ts
pnpm site:dev
```

## 运行真实模型 Demo

下面的命令完成一个受限的 Python 任务。Agent 需要创建 `hello.py`，调用验证器运行它，并确认输出正好是 `Hello, world!`。文件默认写入 `demo-python/hello.py`。

```sh
pnpm demo
```

设置 `DEEPSEEK_API_KEY` 后，命令调用真实的 DeepSeek 模型；没有设置时，命令离线重放仓库中保存的模型决策，不访问网络，也不模拟流式等待。可以通过环境变量指定模型和工作区：

```sh
DEEPSEEK_API_KEY=你的密钥 \
DEEPSEEK_MODEL=deepseek-chat \
pnpm demo -- --workspace ./tmp/python-hello
```

模型请求、工具调用和 Python 程序的实际输出都会进入 `SessionLog`。如果只想运行原来的离线购物车样本，可以使用 `pnpm demo:checkout`。

`scripts/generate-tutorial-data.ts` 默认生成中文版 TypeScript 数据。如需同时生成英文数据，可以另外执行：

```sh
TUTORIAL_LOCALE=en pnpm exec tsx scripts/generate-tutorial-data.ts
```

生成过程与网站浏览都不调用模型，也不需要模型服务的应用程序编程接口（Application Programming Interface，API）密钥。

## 浏览教学网站

网站包含以下内容：

- 四张 TypeScript 阅读准备卡，解释教程使用的类型标注、`interface`、`async` / `await` 和可区分联合类型。
- 六个彼此独立的最小机制样本，以及与当前段落对应的源码、逐章差异、模型请求、Session Event（会话事件）、执行过程和插件关系。
- 相邻请求的稳定前缀、首次变化位置和 token（模型处理文本的计量单位）数量估算。这些数据只用于解释请求结构，实际缓存命中与计费以模型服务返回的数据为准。

生成器读取 [`docs/checkpoints.json`](./docs/checkpoints.json) 中的章节配置，从教学 checkpoint（检查点）和当前 TypeScript 源码提取内容，并把中文版结果写入 [`website/public/generated/tutorial.json`](./website/public/generated/tutorial.json)。英文版使用 [`docs/checkpoints.en.json`](./docs/checkpoints.en.json)、[`docs/lessons-en/`](./docs/lessons-en/) 和 [`docs/typescript-primer.en.md`](./docs/typescript-primer.en.md)，输出为 [`website/public/generated/tutorial.en.json`](./website/public/generated/tutorial.en.json)。生成期间还会检查源码行号、代码讲解覆盖范围，以及可以从事件重建的模型请求是否与原请求一致。

## 六章内容

### 第一章·Agent Loop

> DSH 的 Agent Loop 是什么样的?

`Agent.runTurn()` 把一个 Turn（一次连续执行）分成多个 Step（一次模型请求及其工具执行）。每个 Step 都从当前状态构造请求。模型返回 Tool Call（工具调用）后，Harness 使用 JSON Schema 校验参数，执行工具，再把 Tool Result（工具结果）加入下一次请求。模型没有继续调用工具时结束 Turn，超过 `maxSteps` 时明确终止。

本章还对照程序化工具调用（Programmatic Tool Calling，PTC）怎样把多个动作组织成 TypeScript 程序。仓库只提供静态对照，不实现 Code Runtime（代码运行环境）。

### 第二章·上下文与缓存复用

> 上下文是怎样组织的，为缓存复用做了什么优化？

模型请求从完整记录投影得到。长工具结果只在模型视图中保留开头、结尾和省略字符数，原始结果继续保存在会话记录中。请求把稳定的系统提示词和工具定义放在前面，按顺序追加消息，把当前 Step 的动态说明放在最后，以保留较长的相同前缀。

页面比较相邻请求经过规范化后的最长相同前缀，并估算对应的 token 数量。这里没有调用或模拟模型服务的 Prompt Cache（提示词缓存）。

### 第三章·一切皆插件

> 如何实现“一切皆插件”？

`Context` 是插件统一使用的注册入口。插件可以提供 Service（运行时服务）、注册 Tool、贡献系统 Prompt（提示词），以及添加 Event Listener（事件监听器）。每项贡献都记录来源和 effect（随插件生命周期管理的操作）。插件安装失败或主动卸载时，`Context` 按相反顺序执行 effect 中登记的清理函数。

这个最小运行时保留了 Cordis 插件生命周期中与教程直接相关的部分：依赖获取、能力归属、安装回滚、幂等卸载和运行时检查。

### 第四章·让运行有迹可循

> DSH 怎么记录和保存 Agent 执行过程?

`SessionLog` 按发生顺序追加 Turn、Step、用户消息、模型回复、工具调用、工具结果、请求头、上下文检查点、插件变化和 Goal 状态。每个事件取得连续编号，已经写入的事件不会原地修改。

`buildRequest()` 从这些事件重建指定 Step 的模型输入，`replayTrace()` 从同一组事件生成执行过程。上下文检查点只替换后续模型请求看到的较早历史，原始事件仍然保留。当前最小实现把日志保存在内存中；教程生成器将它序列化为网站使用的静态 JSON 数据。

### 第五章·运行时自进化

> DSH 是如何持续自进化的?

常驻的 Runtime Tools（运行时工具）向 Agent 提供 `cordis_inspect`、`cordis_define`、`cordis_run`、`cordis_stop` 和 `cordis_undefine`。Agent 可以检查已有能力，提交一段 Cordis 插件代码，挂载插件，调用新增工具验证结果，再停止插件或删除定义。

动态插件仍然经过第三章的 `Context.mount()`，所以新增工具与 Prompt 会进入后续模型请求，卸载时也使用相同的清理路径。代码通过 Node.js 的 `node:vm` 执行环境加载；这项实现用于可信教学样本，不构成面向不可信代码的安全沙箱。

### 第六章·长程任务续行

> DSH 是如何持续完成长程任务的？

`LongTaskRunner` 在 Agent Loop 外保存 Goal（长期目标）、当前状态、已经开始的 Round（续行轮次）和轮数上限。每个 Round 启动一个普通 Agent Turn，并沿用同一个 `Context`、工作区和 `SessionLog`。单轮返回结构化的进展、完成或受阻结果，外层据此继续下一轮，或者以 `completed`、`blocked`、`max-rounds` 结束。

Goal、Round、Turn 和 Step 分别处理长期目标、跨轮续行、一次连续执行和一次模型请求。测试覆盖正常完成、没有可观察进展、显式受阻和达到轮数上限。

## 部署教学网站

```sh
pnpm exec tsx scripts/generate-tutorial-data.ts
pnpm site:build
pnpm site:dev
```

`pnpm site:build` 生成生产版本，输出目录是 `dist/`。本地查看时使用 `pnpm site:dev`，然后打开终端显示的地址。

## 实现边界

当前 TypeScript 版本有意省略以下生产能力：

- 完整 DeepSeek Harness 的插件目录、preset 加载与配置热重载。
- PTC 的 Code Runtime、通用 Shell、任意文件读写和网络工具。
- 面向不可信插件代码的权限、审批、进程隔离和安全沙箱。
- Session Log 的 JSON Lines（JSONL，每行一条 JSON 记录）或 SQLite 持久化，以及进程重启后的恢复。
- Schedule（定时任务）、后台 Job（作业）、Subagent（子 Agent）和 Workflow（工作流）。
- 模型服务端缓存命中的测量、计费模拟和通用上下文压缩策略。

这些边界让每章的代码与它回答的问题保持直接对应。需要完整产品能力时，请阅读 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

## 参考与许可

架构行为参考 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。章节的渐进实现、正文与源码同步方式参考 [pi-from-scratch](https://github.com/SaladDay/pi-from-scratch)。程序化动效的阶段划分与可复现状态方法参考 [vibe-motion/skills](https://github.com/vibe-motion/skills)。本仓库的源码、文案、章节组织、组件、布局、动效和过程数据均为独立创作。

项目使用 [MIT License](./LICENSE)。本项目为独立教学实现，与 DeepSeek 及其关联方不存在隶属、授权或合作关系。
