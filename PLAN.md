# deepseek-harness-from-scratch 实施计划

## 1. 项目定位

在本文件所在目录实现一个名为 `dsh-from-scratch` 的 TypeScript 教学项目。它不是 DeepSeek Harness 的兼容实现，而是保留最能体现 DSH 思想的部分：

> Agent 的模型、工具、上下文、会话和运行循环都是可安装、可观察、可卸载的插件；因此 Agent 甚至可以检查并改变自己的能力。

同目录的 `deepseek-harness/` 是只读上游参考，固定在 commit `47f943859bef60e4160492346772ded9b24f765a`，不得修改。新项目文件直接创建在本文件所在目录。

目标读者会基础 TypeScript，但没有接触过 Cordis 或 Agent Harness。教程应像一次从零搭建：遇到一个问题，加入一块机制，立即运行并观察结果；不要写成 DSH 功能百科。

M01–M05 是首版入门主线，经过第 2.4 节的贯穿任务筛选后，M06 也已进入首版。筛选过程与原始候选保存在 [Nano DSH 内容候选](nano-dsh-curriculum/NANO-DSH-CANDIDATES.md)。

## 2. 内容筛选与范围决策

### 2.1 贯穿任务

M01–M05 使用同一个任务展示机制逐步加入后的差异。任务已经按下列条件完成筛选，具体选择与每章增量见第 2.4 节：

1. 结果可观察、可自动验证，fake LLM 可以无网络稳定复现。
2. 每章都能展示前一步的具体不足，以及新机制带来的请求、Trace、插件或会话变化。
3. 同一任务可以由真实 DeepSeek 通过同一 Agent Loop 完成，不需要为 fake provider 编写专用执行路径。
4. 某章删除后若任务仍能以相同方式完成，就重新判断该章应保留、后移还是只作旁注。
5. 不为保留全部候选而把无关能力硬拼进任务。

`word_count` 只保留为验证动态安装、使用和卸载的最小机制示例，不预先占据贯穿任务的位置。

### 2.2 与 DSH 网页端 preset 的对应

DSH 网页端的“模式”是四套 Agent preset，即四种插件组装，不是 Agent Loop 的四种运行状态。它们为 Nano 的问题主线提供产品层参照，但不直接成为 Nano 的章节或可选模式：

| 网页端 preset | 产品定义 | Nano 教学对应 |
|---|---|---|
| 标准模式 | 功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。 | M01 以标准模式使用的普通工具调用作为 Agent Loop 基线；Nano 只实现贯穿任务需要的工具，不复刻完整能力目录。 |
| PTC 模式 | 具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。 | M01 对照普通工具调用与 PTC 的工具呈现方式；Nano 只解释差异，不实现 Code Runtime。 |
| 极简模式 | 仅提供持久 bash 与 `str_replace_editor` 的双工具编码 Agent。 | 它说明 preset 可以通过删减插件得到极小组装；Nano 沿用“只保留教学所需能力”的原则，但不照搬这两个工具。 |
| 创造模式 | 用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。 | M03 解释 preset 为什么能由插件组成；M05 实现运行时检查与临时插件实验，并说明生产版 DSH 如何把结果写成自定义 preset。Nano 不实现完整 preset 创作流程。 |

这组对应只统一产品术语，不扩大 Nano 的实现范围。尤其不能把 PTC 模式说成新增能力，也不能把创造模式概括为不受约束地修改任意运行时代码。只是我们可以在一些关键时刻，提到 xxx 就是创造模式的最重要的能力。另外，我估计用户不太了解四种模式的区别，所以在教学中可以用它们来说明不同插件组装的产品结果。特别的，PTC 这个概念也可以简单介绍一下。

### 2.3 编码前的决策清单

- [x] 选定贯穿 M01–M05 的任务，并写出每章可观察的增量。
- [x] 决定 M04 是否加入简单 JSONL 落盘与关闭后恢复；内存日志、请求重建和回放始终必做。
- [x] 根据贯穿任务决定 M06 是否进入首版；默认后移。
- [x] 决定是否保留“上下文溢出后压缩并恢复”的一次受控重试；普通固定重试不进入教程。

### 2.4 已冻结的首版范围（2026-08-14）

贯穿任务确定为 **“火星中继站恢复审计”**：离线工作区内有一份固定的中继站事故包，包含故障链路、三条候选路由、遥测噪声和提交约束。Agent 要找出故障、比较候选路由，临时安装受信任的 `route_scoring` 能力完成可复核评分，卸载实验能力，并提交唯一正确、可由程序验收的恢复方案。任务不开放任意文件读取或 Shell；所有输入都由受限的事故包工具提供。

选择它的原因是同一结果可以由 fake LLM 和真实 DeepSeek 通过完全相同的 Harness 得到，并且每章都会留下不同且可观察的证据：

| 章节 | 前一步的具体不足 | 本章可观察的增量 |
|---|---|---|
| M01 | 只有问题，没有可执行闭环。 | 普通工具调用依次读取事故包并提交方案；Trace 明确显示一个 turn 内的多个 step。相同操作另以静态 PTC TypeScript 组合示意展示，但不执行代码。 |
| M02 | 完整遥测结果被重复送回模型，请求迅速膨胀。 | 后续请求只投影遥测头尾与省略标记；网站显示分段 token 估算、稳定前缀和首次失效位置。 |
| M03 | 工具、Prompt 与事件监听器仍是直接装配，无法可靠替换。 | 事故工具成为插件贡献；安装／卸载测试证明服务、工具、Prompt 和 listener 一同出现、回滚和消失。 |
| M04 | 过程只能依赖运行中的隐藏历史，无法证明请求和 Trace 的来源一致。 | 只追加 Session Log 成为唯一历史；摘要检查点覆盖早期投影但保留原始遥测事件，并可逐 step 深度相等地重建请求。 |
| M05 | 固定组装不能在运行时验证一个新评分策略。 | Agent 先检查运行时，再从受信任目录安装 `route_scoring`、调用它、通过同一 disposer 卸载；相邻请求的 tool schemas、Prompt 和插件图随日志变化。`word_count` 另作最小机制验收。 |
| M06 | 一次 turn 不适合清楚表达“调查—评分—提交”的长程进度和停止原因。 | 同一恢复审计跨三个 Round 推进并完成；另外用确定性测试覆盖 blocked 与轮次上限停止。 |

首版范围决定如下：

- **保留 M06。** 用户明确要求实现，并且该任务可自然拆成调查、评分和提交三轮；M06 不引入 Todo、Schedule、后台 Job、Subagent 或 Workflow。
- **不加入 JSONL。** 教学验收需要的是事件作为唯一历史、请求重建与 Trace 回放；进程重启并不是这项离线事故审计的必要环节。仓库中不得留下 JSONL writer、配置或占位入口。
- **不加入上下文溢出恢复重试。** 固定事故包通过确定性裁剪和摘要检查点即可控制上下文，没有需要重试的失败路径；普通重试同样不实现。
- `word_count` 只用于独立的插件生命周期小场景；贯穿任务的动态能力是 `route_scoring`。
- 网站提交 M01–M06 六个 checkpoint 的真实源码、diff 和同一事故场景生成数据；估算 token 与可复用前缀始终明确标为教学估算。

以下范围已经确定：

- PTC 模式及其 Code Mode SDK 只作工具呈现方式的对照，不实现 Code Runtime。
- Nano 只估算可复用请求前缀，不调用或模拟模型提供方的 Prompt Cache。
- 安全、权限、审批和沙箱不进入教程；首版不提供通用 shell、任意路径写入或相应权限开关。
- Schedule、后台 Job、Subagent、Workflow 和运行期间的新消息处理不进入入门主线。

## 3. 章节主线

### M01 从 Agent Loop 到 Harness

**核心问题：Agent Loop 已经能工作，为什么还需要 DSH？**

从最小的“调用模型—执行工具—继续调用”循环开始，落地回答“在 DSH 中，模型是怎么执行工具的”：

- 每次模型请求包含 system prompt、当前历史、tool schemas 和本 step 使用的动态上下文。
- 一个 turn 表示一次用户任务；一个 step 表示一次模型请求及其工具结果。
- 模型生成工具名和参数；Harness 校验并执行，再把工具结果交还模型。
- 工具调用会产生下一 step；没有新的工具调用时 turn 才结束。
- Provider 只把统一请求映射为具体模型 API，不拥有 Agent Loop。
- DSH 网页端的标准模式把工具逐个呈现给模型；PTC 模式保留标准模式的全部能力，但改由 Code Mode SDK 呈现，让模型用一个 TypeScript 程序组合多步操作。
- Nano 实现标准模式所使用的普通工具调用路径；PTC 只作对照，不实现 `run_code` 或 Code Runtime。

本章先让任务跑通，再指出实际 Harness 还要解决上下文压力、能力替换、过程记录和运行时扩展。

### M02 上下文组织与 Prompt Cache

**核心问题：DSH 如何组织模型上下文，并尽量提高 Prompt Cache 命中率？**

本章区分“模型会看到什么”和“这些输入怎样按稳定性组织”：

- 稳定的 system prompt 与 tool schemas 形成可复用请求前缀。
- 新的对话、工具调用和工具结果尽量追加在已有前缀之后。
- step 特有的动态上下文放在可变部分，并在网站中明确其失效位置。
- 巨大工具结果在后续请求中只投影必要片段，并带明确的省略说明。
- 压力仍然过高时，摘要检查点替换较早的模型历史。
- 插件、工具目录或摘要检查点变化会从相应位置开始缩短可复用前缀。

网站展示各请求部分的近似 token 数、与上一次请求相同的最长前缀，以及裁剪或压缩前后的差异。Nano 不宣称提供方实际命中了缓存。

M02 先用当时的内存历史解释请求组织和工具结果裁剪；摘要检查点在 M04 引入 Session Log 后完成，原始执行记录不被摘要替换。

### M03 插件内核

**核心问题：“一切皆插件”如何实现，为什么能力能够安装、替换和卸载？**

实现 Nano 后续内容依赖的最小 `Context`。插件通过同一套生命周期注册服务、工具、Prompt 贡献和事件监听器；每次注册都返回撤销方法，卸载插件时贡献一起消失。

Tool 是模型能够调用的动作，Plugin 是向运行时贡献 Tool 或其他能力的安装单元。M01–M02 的直接装配在本章改为插件装配，并用相同任务证明行为不变、运行时关系变得可检查和可卸载。

第 2.2 节的四种网页端模式展示了这种组装关系：标准模式选择完整编码能力，PTC 模式在其上更换工具呈现方式，极简模式把组装缩减为两个工具，创造模式再加入运行时检查、插件实验和 preset 创作指导。

Nano 把 Preset 作为插件组装的产品层例子，不实现 preset 发现、加载或创作。Skill、完整依赖拓扑和 Cordis 的其他机制也不属于必要前置。

### M04 会话日志

**核心问题：DSH 怎样记录 Agent 执行过程，并据此重建请求和回放？**

用只追加的 Session Log 记录用户消息、模型回答、工具调用、工具结果、turn／step 边界、插件变化，以及重建请求所需的输入快照。下一次模型请求和教学网站 Trace 都从同一份日志推导，不维护另一份隐藏消息历史。

M02 的工具结果裁剪只改变日志到模型历史的投影；摘要检查点覆盖较早事件的模型投影，但原始事件继续保留。首版必须实现内存记录、指定 step 的请求重建和 Trace 回放。JSONL 只在第 2.3 节明确选中后加入；SQLite、迁移和完整 fork 机制不进入 Nano。

### M05 从插件内核到创造模式

**核心问题：DSH 怎样检查自己的插件组装、试装能力，并帮助用户创建新的 Agent preset？**

DSH 网页端的创造模式具备标准模式的全部能力，并增加运行时检查、插件实验和 preset 创作指导；其产品目标是创建自定义 Agent preset。运行时检查和临时挂载是验证组装的手段，不等同于允许 Agent 不受约束地改写运行时代码。

Nano 只实现其中最能解释插件内核的部分：把运行时检查和受信任插件目录暴露成常驻工具。Agent 通过 M03 的普通安装路径临时加入一项能力，下一次请求出现该工具；完成实验后再通过同一个 disposer 卸载，后续请求中的工具目录随之变化。

Session Log 记录插件挂载和卸载，网站同步展示工具列表、Prompt 贡献和插件图的变化。`word_count` 用于机制级验收；本章最后说明生产版 DSH 如何把验证后的组装写成自定义 preset，但 Nano 不实现 preset 文件创作、发现或加载。贯穿任务若不自然需要插件实验，就重新评估 M05 的位置而不是扭曲任务。

### M06 长程任务（已选择）

**核心问题：DSH 怎样让 Agent 持续完成长程任务？**

贯穿任务已经证明需要多轮续行，因此实现最小长程机制：保存当前目标、状态和已开始的 Round 数；每轮结束后判断是否继续；完成、阻塞或达到轮次上限时停止。fake 场景确定性展示多个 Round 推进同一目标。

Todo 只可作为进度展示，不扩展为独立系统。Schedule、后台 Job、Subagent 和 Workflow 只作延伸链接，不实现。

标准模式虽然已经包含目标、子代理和工作流，但产品能力目录本身不是 Nano 收录它们的理由；M06 仍只由贯穿任务是否需要跨 Round 续行决定。

主线逻辑是：**先看标准模式采用的普通 Agent Loop → 对照 PTC 的工具呈现方式 → 组织模型上下文 → 解释不同 preset 如何由插件组装 → 用日志重建全部经历 → 通过运行时检查与插件实验理解创造模式 → 让同一审计跨 Round 续行**。

## 4. 演示设计

### 4.1 无网络主线

```sh
pnpm install
pnpm demo
```

`pnpm demo` 使用 scripted fake LLM 完成选定的贯穿任务。任务确定后，脚本、教程和网站共用同一场景定义，不在各章手写不同结果。

最终场景至少证明：

1. M01 的 turn／step 和普通工具往返能完成任务，并能准确说明 PTC 模式只改变工具呈现与组合方式。
2. M02 能指出请求中的稳定前缀、追加部分、近似 token 数和被裁剪的工具结果。
3. M03 中服务、工具、Prompt 贡献和监听器都属于插件生命周期，卸载后不残留。
4. M04 能从 Session Log 重建任一模型请求，且结果与实际发送内容一致。
5. M05 的运行时检查、临时插件安装和卸载改变下一次请求的 tool schemas，并由同一日志和 Trace 呈现；教程明确区分这项插件实验与完整的 preset 创作。
6. 若某项增量无法自然出现在同一任务中，先回到第 2 节调整范围。

`word_count` 另有一个小型确定性场景，专门证明“安装前不可见—安装后调用—卸载后消失”，但它不替代贯穿任务。

### 4.2 真实 DeepSeek

真实 DeepSeek 使用同一套 Agent Loop、上下文投影、插件和 Session Log：

```sh
export DEEPSEEK_API_KEY=...
export DEEPSEEK_MODEL=...
pnpm dev -- --provider deepseek --workspace ./demo-workspace
```

`DEEPSEEK_BASE_URL` 可选，默认 `https://api.deepseek.com`。首版使用非流式 Chat Completions，并关闭 thinking mode；streaming 不是教程主线。没有 API key 时，所有离线教学、测试和网站生成仍可运行。

## 5. 最小实现

### 5.1 协议与 Agent Loop

- 厂商无关的 `Llm.complete(request)` 接口，以及统一的消息、工具调用和工具结果类型。
- scripted fake provider 和真实 DeepSeek provider；两者只负责请求与响应映射。
- 由贯穿任务决定的最小工具集，不预设通用 `write_file` 或 `run_command`。
- Ajv 校验模型生成的工具参数；未知工具、参数错误和执行失败都转成 tool result 交还模型。
- Agent Loop 串行执行 tool calls，并用可配置 `maxSteps` 防止单个 turn 无限循环。
- 同一场景记录每个 step 实际发送的统一请求，供 M02 和 M04 使用。

### 5.2 上下文投影

实现一个确定性的请求装配过程，并把逻辑请求拆成网站可展示的有序部分：

- system prompt 和 tool schemas 优先保持稳定；Provider 可以把它们映射到 API 的不同字段。
- 历史消息、工具调用和工具结果按发生顺序追加。
- step 特有的动态上下文明确标记为可变部分。
- 工具结果裁剪策略可配置，投影保留必要片段和省略说明，Session Log 保留原始结果。
- M04 加入的摘要检查点记录覆盖的事件范围和摘要文本；请求只使用最新适用检查点及之后的事件。
- fake 场景使用确定性的摘要，不把通用摘要质量作为 Nano 的实现目标。
- token 数只作明确标注的近似估算；可复用前缀由相邻统一请求的规范化部分比较得出。

Nano 不调用缓存 API，也不把估算值冒充 provider usage。

### 5.3 插件运行时

实现 `ServiceToken<T>`、`Plugin` 和 `Context`：

- `provide/use`：插件提供和获取服务；重复或缺失服务立即报错。
- `effect`：记录清理函数；卸载和安装失败回滚时按相反顺序执行，且只执行一次。
- `registerTool`：注册模型工具并返回 disposer。
- `contributePrompt`：按稳定顺序贡献 system prompt 片段并返回 disposer。
- `on/emit`：注册和派发 Session 与运行时事件，监听器随插件卸载。
- `mount`：安装插件并返回幂等 disposer。
- `inspect`：返回当前插件、服务、工具、Prompt 贡献及提供／消费关系。

Service、Tool、Prompt 贡献和 listener 的注册都必须属于当前插件的 effect，不能在卸载或安装失败后残留。首版不为没有主线用途的 Cordis 机制预留抽象。

### 5.4 Session Log

最终实现只保存事件，不另存 `messages`。最小事件集合为：

```text
turn/start              user/message
step/start              request/header
assistant/message       tool/call
tool/result             context/checkpoint
runtime/plugin-mounted  runtime/plugin-unmounted
step/end                turn/end
```

`request/header` 保存 provider、model、当时编译出的 system prompt、tool schemas、动态上下文和投影设置，不复制消息历史。`context/checkpoint` 保存摘要文本及其覆盖的事件范围。

`buildRequest(events, stepId)` 使用目标 step 的 header、此前消息和工具事件，以及最新适用的摘要检查点重建统一请求。真正发送给 LLM 的请求必须与重建结果深度相等；测试覆盖工具结果裁剪、插件变化和摘要检查点前后的请求。

内存日志和基于事件的 Trace 回放属于首版。若选择 JSONL，文件只追加事件，重启后读取同一格式继续投影；不增加 SQLite、schema migration 或 fork。

### 5.5 运行时检查与插件实验

提供三个常驻工具：

- `inspect_runtime`：查看已安装插件、服务、工具、Prompt 贡献和关系。
- `install_capability`：按名字安装受信任目录中的插件。
- `remove_capability`：卸载此前动态安装的插件。

受信任目录至少包含一个 `word_count` 机制示例，并在贯穿任务选定后加入该任务真正需要的动态能力。动态插件必须通过普通 `ctx.mount()` 安装并通过同一个 disposer 卸载，不为演示增加特殊注册路径。

安装与卸载事件进入 Session Log；下一个 `request/header` 捕获变化后的 Prompt 和 tool schemas，因此重建请求与网站视图使用同一来源。

这组工具只实现创造模式中的运行时检查与插件实验，不生成或加载 DSH preset。教程用最终运行时状态解释自定义 preset 应固定哪些插件选择，生产版创作流程只作对照。

### 5.6 长程任务（首版已选择）

- 保存目标、`active/completed/blocked` 状态、已开始的 Round 数和轮次上限。
- 一轮结束后根据状态和实际进展决定继续或停止；达到上限必须显式结束。
- 用 Session Events 记录目标与 Round 变化，使 Trace 可以回放。
- scripted fake 场景稳定跨多个 Round 完成同一目标。
- 不实现完整 Goal 服务、后台调度或分布式工作流。

实现止于本节列出的最小协调器，不创建 Todo、Schedule、后台 Job、Subagent 或 Workflow 的占位服务、配置或网站面板。

## 6. 建议目录

```text
PLAN.md
README.md
package.json
tsconfig.json
dsh-from-scratch-curriculum/
  dsh-from-scratch-CANDIDATES.md
src/
  runtime.ts
  protocol.ts
  context.ts
  session.ts
  tools.ts
  llm-fake.ts
  llm-deepseek.ts
  agent.ts
  runtime-tools.ts
  catalog/word-count.ts
  compose.ts
  cli.ts
  long-task.ts              # 仅在选择 M06 时
tests/
demo-workspace/
docs/
  lessons/m01.md ... m05.md
  lessons/m06.md            # 仅在选择 M06 时
  checkpoints.json
scripts/generate-tutorial-data.ts
website/
  public/generated/
```

使用 Node.js 22+、pnpm、ESM、TypeScript `strict`、Vitest、Ajv、Vite 和 React。实现保持足够小，让读者能沿章节阅读完整主线；规模目标不能成为省略校验、回滚、错误结果或重建一致性的理由。

## 7. 实施顺序

### 0. 冻结首版范围

完成第 2.3 节的决策清单。把选定任务、每章增量、JSONL 决定、M06 决定和明确排除项写回本计划，再开始教学 checkpoint。

### A. M01：可运行 Agent

实现统一协议、scripted fake provider、最小工具集、turn／step Agent Loop 和 CLI。普通工具调用作为标准模式的机制基线，教程用同一组多步操作静态对照 PTC 模式的 Code Mode SDK 呈现；Nano 不执行该 TypeScript 程序。用 mock-fetch 覆盖 DeepSeek 请求映射；真实 API 测试在没有 key 时自跳过。

### B. M02：上下文组织

实现请求分段、近似 token 估算、相邻请求前缀比较和工具结果裁剪。生成网站所需的请求数据；只定义摘要检查点需要解决的问题，不在隐藏消息数组上完成摘要机制。

### C. M03：插件内核

把 M01–M02 的直接装配改为 `Context` 插件：服务、工具、Prompt 贡献和监听器都用 effect 管理。用标准、PTC、极简和创造模式说明 preset 如何选择或增加插件，但不实现 preset loader。测试安装、失败回滚、逆序清理、检查和卸载，不改变贯穿任务结果。

### D. M04：会话日志

用 Session Events 替换 `Message[]`，实现 `request/header`、`context/checkpoint`、`buildRequest()` 和 Trace 回放。断言最终实现没有第二份消息历史；若已选择 JSONL，在本阶段加入落盘恢复。

### E. M05：运行时检查与插件实验

实现运行时工具、受信任插件目录和动态能力，完成贯穿任务中的自然插件实验，并用 `word_count` 场景补足机制级边界。验证安装前、安装后和卸载后的 Prompt 与 tool schemas 变化；用结果解释创造模式怎样把经过验证的插件组装写成自定义 preset，但不实现该创作流程。

### F. 筛选后的条件内容

M06 已由范围清单选择，独立形成 `tutorial-m06` checkpoint。上下文溢出恢复未选择，仓库中不保留半成品。

### G. 教程与网站

每完成 M01–M06 的代码、测试和确定性场景，就编写对应章节并建立 `tutorial-m01` 至 `tutorial-m06` tag。每章包含：本章问题、前一步的具体不足、新增或修改的代码、运行结果、请求或 Trace 的变化，以及生产版 DSH 额外处理的内容。

最后接通生成脚本和网站，确保所有源码、diff、请求、Session Events 与插件图来自 checkpoint 和真实 fake 场景。

## 8. 交互式教学网站

网站采用“一边阅读，一边看到代码和运行过程变化”的体验，并使用原创信息结构和视觉设计：

- 首页展示 M01–M06 的递进关系。
- 阅读位置驱动源码面板，显示本节新增或修改的真实代码。
- M01 展示模型请求、普通工具调用和 turn／step Trace，并用同一组操作对照标准模式与 PTC 模式的工具呈现方式。
- M02 展示请求分段、近似 token 数、相同前缀和裁剪／压缩差异。
- M03 展示当前插件、服务、工具、Prompt 贡献及卸载变化，并用四种网页端 preset 说明不同插件组装的产品结果。
- M04 展示 Session Events、摘要检查点、重建请求和回放位置。
- M05 同步展示运行时检查与临时插件安装／卸载时的工具列表和插件图，并把该实验与创造模式的 preset 创作目标区分开。
- M06 展示 Goal 状态和 Round 续行。
- 移动端把正文、代码、请求、Trace 和插件图切换为 tabs。

`docs/checkpoints.json` 记录章节、tag、场景和生成入口。`pnpm tutorial:generate` 从这些 checkpoint 与确定性 fake 场景生成源码、diff、插件图、统一请求和 Session Events，写入并提交到 `website/public/generated/`；网站不手抄源码，也不请求真实模型。

普通 `pnpm site:build` 只读取生成结果，不依赖 Git 历史。缓存前缀与 token 数属于教学估算，界面必须明确标注，不能展示为 provider 返回的真实命中数据。

## 9. 明确不做

- 完整 Cordis 兼容、完整依赖拓扑、profile／bundle／patch loader
- Skill registry、完整 Preset 发现／加载／创作、Agent Scope、完整 Goal、LSP、ACP
- PTC 模式依赖的完整 Code Runtime、`run_code` 和任意模型生成代码执行
- 模型提供方 Prompt Cache 控制或真实命中模拟
- 通用 shell、任意路径写入、权限、审批和生产 sandbox
- SQLite、迁移、完整 resume／fork；JSONL 仅在明确选中时实现
- streaming、并行工具和普通固定重试
- Schedule、后台 Job、Subagent、Workflow 和运行期间的新消息处理
- 上下文溢出恢复的半成品或占位抽象；M06 之外的完整 Goal 能力

这些内容可在相关章节用短链接指出其在生产版 DSH 中的位置，但不进入未选中的实现范围。

## 10. 原创性

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 是行为与架构参考；不得把上游源码删减、改名后放入本项目。
- [`pi-from-scratch`](https://github.com/SaladDay/pi-from-scratch) 只提供“渐进实现、文章与源码同步、静态 Trace”三项教学灵感；不得复制其源码、注释、文章、章节组织、组件、CSS、页面布局或 Trace 数据。
- [Pi Agent 源码精读笔记](https://dg-ai-notes.pages.dev/) 只作为曾讨论过的课程示例，不采用其覆盖式章节结构。
- README 公开致谢并说明本项目为独立实现。若改编任何具体片段，必须记录来源、许可证和修改；否则不得提交。
- 发布前检查代码与文字相似度，并人工审阅所有长匹配。

## 11. 完成标准

基线命令：

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm demo
pnpm tutorial:generate
pnpm site:build
```

基线同时满足：

- 贯穿任务及每章增量已写入本计划，fake 演示无网络可重复运行。
- 真实 DeepSeek 使用同一 Agent Loop、上下文投影、插件和 Session Log。
- 网站展示与实际统一请求一致的请求部分、近似 token 数、可复用前缀和裁剪结果。
- 最终模型上下文只从 Session Log、投影设置和摘要检查点重建；原始执行事件完整保留。
- 动态安装和卸载通过普通插件生命周期改变下一次请求的 Prompt 或 tool schemas。
- 网站完整同步所有已选章节、真实源码和同一条 Trace，并明确标注估算数据。
- 未选内容没有占位实现、隐藏分支或完成标准。

条件验收：

- 若选择 JSONL，重启后从落盘事件重建同一请求和 Trace。
- 若选择上下文溢出恢复，只在压缩后且任务已有实际进展时重试，并有确定性失败场景。
- 若选择 M06，fake 场景覆盖跨 Round 进展，以及 completed、blocked 和轮次上限三种停止条件。
