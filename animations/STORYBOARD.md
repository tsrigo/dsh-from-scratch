# DSH 核心概念动画规格

这组六段动画直接回答教程的六个章节问题。每段遵循同一条教学结构：提出问题、展示一个不充分的直觉、让真实数据结构或控制流发生变换、用源码行为和测试不变量收束答案。

动画不是源码的装饰性复述。每一个进入画面的对象都必须承担论证任务；无法改变读者理解的元素不进入镜头。

## 统一视觉语言

- 深蓝黑背景代表尚未被解释的运行空间。
- 青色代表当前控制流或模型可见内容。
- 绿色代表已经由执行证据确认的事实。
- 黄色代表边界、选择或暂时状态。
- 红色代表失败分支、非法状态或被拒绝的假设。
- 灰色代表仍被保存、但当前投影不需要读取的事实。
- 主动作始终只有一个；次要对象在关键变换时降低亮度。
- 每段结尾保留一个能够脱离动画单独阅读的“答案式”。

---

## 01 · DSH 的 Agent Loop 是什么样的？

### 直接答案

DSH 的 Agent Loop 是一个有步骤上限的 Turn 循环。每个 Step 都从当前 Context 与 Session Log 重建一份统一模型请求；模型只负责返回文字和结构化工具调用，Harness 负责校验、执行并记录结果。没有工具调用时 Turn 完成，超过 `maxSteps` 时强制停止。

### 要纠正的直觉

“Agent 就是模型自己反复思考并直接操作环境。”

模型既不拥有循环，也不直接执行工具。循环、权限、执行、记录和停止条件都在 Harness 中。

### 视觉推导

1. 一个 Turn 展开成若干空 Step，右上角出现 `maxSteps` 刹车。
2. 当前 Step 放大：`system + tools + messages + dynamicContext` 合成为 `UnifiedRequest`。
3. 请求进入 LLM；回复分裂为 `content` 与 `toolCalls[]`。
4. `toolCalls.length === 0` 的分支直接进入 `completed`。
5. 非空调用依次经过“查找工具 → JSON Schema 校验 → execute → 捕获错误”，无论成功或失败都形成结构化 `tool/result`。
6. 这些事件进入 Session Log；下一个 Step 再次调用 `buildRequest()`。
7. 镜头拉远，Provider 被放在循环外侧，只承担统一请求与供应商协议之间的翻译。

### 结尾答案式

`Agent Loop = buildRequest → LLM → validate/execute → append events → stop or next Step`

### 源码与测试证据

- `src/agent.ts`：`Agent.runTurn()` 的有界 `for` 循环、无工具调用完成分支、工具执行和 `maxSteps` 终止。
- `src/agent.ts`：未知工具、参数错误和执行异常都被转换成工具结果。
- `src/protocol.ts`：`UnifiedRequest` 与 `Llm` 的供应商无关接口。
- `tests/m01-agent.test.ts`：完整修复经历 5 个 Step；非法调用在下一份模型输入中可见；流式增量不污染规范 Session Log。

### 动作原则

Staging、Pose to Pose、Timing。请求合成、分支判断和执行结果落账是三个关键姿势；其余动效只服务于控制权的转移。

---

## 02 · 上下文是怎样组织的，为缓存复用做了什么优化？

### 直接答案

DSH 将完整执行历史与本次模型可见上下文分开：长工具结果在投影中保留头尾并标明省略量，必要时用 checkpoint 摘要接替较早历史。最终请求按变化频率排列为稳定的系统提示词、稳定的工具定义、只追加消息、当前 Step 的动态上下文，从而尽可能延长相邻请求完全相同的开头。

### 要纠正的直觉

“上下文就是把所有历史原样塞给模型；缓存会自动识别哪些内容重要。”

完整保存不等于每次完整发送；缓存比较的是相同前缀，不理解语义重要性。

### 视觉推导

1. 一条 1200 字符的 CI 结果进入 Session Log，保持完整。
2. 它的模型投影被压缩成“头部 + 明确省略标记 + 尾部”，原始收据仍留在后方。
3. 较早消息被 checkpoint 覆盖时，只改变未来请求的投影，不删除旧事件。
4. 四类请求部件散落出现；按变化频率重新排序为 `system → tools → messages → dynamic`。
5. Request A 与 Request B 上下对齐；扫描线从左向右寻找最长规范化相同前缀。
6. 新消息只在尾部追加时，共享前缀延长；插件安装改变工具定义时，首次差异提前，复用机会变短。
7. 明确标注：页面计算的是“复用机会估计”，不是供应商缓存命中率。

### 结尾答案式

`模型上下文 = project(完整历史)`

`缓存机会 = longest identical canonical prefix(request[n-1], request[n])`

### 源码与测试证据

- `src/context.ts`：`clipToolResult()`、`projectMessages()`、`describeRequest()` 与 `compareRequestPrefix()`。
- `src/session.ts`：checkpoint 只影响 `buildRequest()` 的投影范围。
- `tests/m02-context.test.ts`：长结果保留头尾和省略标记；请求顺序为 stable、append-only、step-variable；首次差异定位到 assistant。
- `tests/m04-session.test.ts`：原始 CI 日志完整保留，重建请求只包含裁剪投影。

### 动作原则

Staging、Exaggeration、Slow In/Slow Out。扫描线和首次失效点是唯一主动作；被裁剪但仍保存的原文以低亮度留场，防止读者误认为数据被删除。

---

## 03 · 如何实现“一切皆插件”？

### 直接答案

DSH 把运行时能力统一纳入 `Context.mount(plugin)` 生命周期。Plugin 在 `setup()` 期间可以提供 Service、注册 Tool、贡献 Prompt、监听事件；Context 为每项贡献记录 owner，并把对应逆操作压入同一个 effect 栈。安装成功返回幂等卸载函数，安装失败或主动卸载都按逆序执行同一批清理动作。

### 要纠正的直觉

“一切皆插件”只是把工具对象放进一个插件数组。

真正的难点不是添加，而是让异构贡献拥有统一归属，并保证部分安装失败后不留残骸。

### 视觉推导

1. Service、Tool、Prompt、Listener 分别落入四个注册表，看似需要四套卸载逻辑。
2. Plugin 进入 `setup()` 事务区；每次登记都盖上相同 owner，并在右侧压入一张逆操作卡片。
3. 正常完成时，effect 栈被封装成一次性的 disposer。
4. 主动卸载：栈顶开始逆序弹出，四个注册表和依赖关系同时恢复。
5. 反例重演：第三项登记后 setup 抛错；完全相同的 rollback 路径立即回放。
6. 最后区分三层：Preset 选择 Plugin，Plugin 贡献运行时能力，Tool 只是模型可调用能力之一。

### 结尾答案式

`mount = setup + owner ledger + inverse-effect stack`

`失败回滚 ≡ 主动卸载`（使用同一条逆序清理路径）

### 源码与测试证据

- `src/runtime.ts`：`Context.mount()`、`effect()`、各类 register/provide/contribute/on 方法、`#rollback()` 与 `once()`。
- `src/plugins.ts`：工作区状态、工作区工具、测试工具和 Provider 都通过 Plugin 组合。
- `tests/m03-runtime.test.ts`：异构贡献可检查；一个 disposer 完整且幂等卸载；失败 setup 按 `second → first` 逆序回滚；重复 Service 安装后不留状态。

### 动作原则

Anticipation、Follow Through、Staging。effect 栈先于卸载建立，让读者提前看见“为什么之后能撤回”；逆序弹出是主动作，注册表变化略微滞后以强化因果。

---

## 04 · DSH 怎么记录和保存 Agent 执行过程？

### 直接答案

DSH 使用内存中的只追加 Session Log 记录带递增编号的类型化事件，包括 Turn/Step 边界、请求头、模型消息、工具调用与完整结果、插件变化和 Goal 状态。历史模型请求不是另存副本，而是从目标 `request/header` 之前的事件切片重建；人类 Trace 也只是同一事件流的另一种投影。

### 要纠正的直觉

“给模型维护 messages 数组，再额外写一份调试日志就够了。”

两份可变历史会漂移，无法证明回放页面与模型当时真正看到的内容一致。

### 视觉推导

1. 事件按编号逐张落入一条不可回写的账本。
2. 查询 `turn-1-step-3` 时，在对应 `request/header` 处竖起时间切面；未来事件全部排除。
3. 在切面左侧寻找最近 checkpoint；它只替换模型投影中的旧消息，旧事件仍在账本中。
4. 同 Step 的 assistant 与 tool calls 被重新配对，工具结果再经过当时 header 保存的 projection 设置。
5. 重建结果与真正发送给 ScriptedLlm 的请求重合，显示相等符号。
6. 同一批事件向另一侧投影为人类可读 Trace；没有第二份故事数据。
7. 边界说明：当前 Session Log 在内存中，教程未声称实现跨进程持久化。

### 结尾答案式

`Session Log = append-only facts`

`historical request = buildRequest(events before its header)`

`Trace = replayTrace(the same events)`

### 源码与测试证据

- `src/session.ts`：`SessionEvent` 联合类型、递增编号、不可变订阅副本、`buildRequest()` 与 `replayTrace()`。
- `tests/m04-session.test.ts`：每份真实请求都可仅由事件重建；checkpoint 不删除旧事件；Trace 类型顺序与事件完全一致；观察者不能篡改已存事实。

### 动作原则

Staging、Pose to Pose、Secondary Action。时间切面是唯一主动作；请求与 Trace 两个投影先后出现，避免同时竞争注意力。

---

## 05 · DSH 是如何持续自进化的？

### 直接答案

DSH 把自进化实现为可重复的受信任能力实验：Agent 先检查当前 Context，只能从进程内可信目录选择能力，再通过普通插件生命周期临时安装。新 Tool 与 Prompt 从下一个 Step 重建请求时开始可见；Agent 使用真实结果验证能力，最后调用保存的 disposer 完整移除。安装、使用和卸载全部进入 Session Log。

### 要纠正的直觉

“自进化意味着 Agent 任意下载代码、永久改写自己，或在当前模型回复中凭空获得新工具。”

Nano DSH 不加载任意远程代码，也不生成和持久化 Preset；它实现的是有目录边界、下一请求生效、可审计可回滚的运行时实验。

### 视觉推导

1. `inspect_runtime` 展开当前插件、工具和 Prompt 表。
2. `remote_package` 冲向安装入口，被 JSON Schema 中的 enum 边界拒绝；`typescript_analysis` 获准通过。
3. 当前请求已经冻结，安装动作只改变 Context；镜头跨过 Step 边界后，下一份请求才新增 `find_references`、`check_types` 和分析规则。
4. 两个新工具返回调用方与类型检查证据，能力从“候选”变成“被验证的临时选择”。
5. `remove_capability` 取出安装时保存的 disposer；下一个请求恢复原工具集和 Prompt。
6. Session Log 上形成 `mounted → used → unmounted` 的闭环；循环可在未来遇到新缺口时再次执行。

### 结尾答案式

`inspect → trusted install → next-request exposure → evidence → remove/keep`

### 源码与测试证据

- `src/runtime-tools.ts`：可信目录、由目录生成的参数 enum、installed disposer Map、检查/安装/移除工具。
- `src/catalog/typescript-analysis.ts`：临时 Prompt、`find_references` 与 `check_types`。
- `tests/m05-runtime-tools.test.ts`：安装前不可见、下一请求可见、移除后的后续请求再次不可见；不受信名称在参数校验阶段被拒绝；安装与卸载事件成对出现。

### 动作原则

Anticipation、Staging、Timing。可信目录是安装前的明确门槛；Step 边界使用可感知停顿，强调能力不会追溯性进入已经构建的请求。

---

## 06 · DSH 是如何持续完成长程任务的？

### 直接答案

DSH 在有界 Agent Turn 外再套一层有界 Round 循环。Goal 保存目标和状态，多个 Round 复用同一个 Agent、Context 与 Session Log。每轮结束后，协调器根据工具结果和工作区状态判断是否完成、是否取得可观察进展；只有存在具体进展才继续，必要时最多追加一次针对缺失证据的补充 Turn，同时受 `maxRounds` 约束。

### 要纠正的直觉

“让模型一直运行，或让它自己说‘还需要继续’，就能完成长程任务。”

模型叙述不是续行依据；没有可观察进展必须停止，轮数上限也是独立终止条件。

### 视觉推导

1. 镜头从 Step 拉远到 Turn、Round、Goal 四层嵌套结构；Agent Loop 位于最内层。
2. Goal 的同一条 Session Log 穿过三轮：diagnose、repair、verify-submit。
3. 第一轮收集 `inspect + 4 reads`；第二轮需要 `patch + testsPassed`；第三轮需要引用分析、类型检查、已接受提交和能力无残留。
4. 每轮的模型结论被放在一边，只有事件与工作区状态进入 evidence gate。
5. 决策树依次检查 completed、blockedReason、progressed、maxRounds；满足进展且未终止才回到下一轮。
6. 展示部分进展分支：缺一项证据时允许一次更具体的补充 Turn；补充后仍无进展则 blocked。
7. 三个终态并列：completed、blocked、max-rounds，说明“持续”并不等于无限。

### 结尾答案式

`Long task = persistent Goal + shared history + evidence-gated bounded Rounds`

### 源码与测试证据

- `src/long-task.ts`：Goal 状态机、Round 外循环与 completed/blocked/max-rounds 终止分支。
- `src/scenario.ts`：每轮的具体证据谓词、部分进展判断和一次性补充指令。
- `tests/m06-long-task.test.ts`：三轮完成；安装后部分进展触发一个补充 Turn；错误提交可纠正；无进展 blocked；达到上限 max-rounds。

### 动作原则

Timing、Staging、Secondary Action。四层时钟使用不同节奏；证据门是主动作，内层 Step 只作为缩略的次要动作，防止层级关系退化成普通流程图。

