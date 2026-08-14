# 网站重构设计：左文右码 + 骨架渐进填充

> 状态：设计稿（未实现）· 分支建议：`feat/site-reader`
> 依据：用户三点要求；(1) 左文右码、严格遵循 nano-dsh 滚动刷新逻辑；
> (2) 原右侧面板内容全部迁入左侧正文；(3) 每章代码按子区域渐进填充：先骨架后实现。

## 1. 目标布局（nano-dsh 严格版）

```
site-header（章节导航 · hash · 补全进度 · 锁定 · TS/Python 切换 · 上游链接）
learning-layout（两列 grid，参考 nano-dsh .main）
├─ article.chapters（左侧正文，唯一内容流）
│   ├─ 章首：kicker / 标题 / 问题 /「本章源码导览」卡（codeGuide.title+description）
│   ├─ 正文段落（lesson markdown）
│   ├─ 填充卡片（fills 锚点：每个实现段的解释，含行区间徽章）
│   ├─ 证据卡（evidence 内嵌内容：请求对比 / 时间线 / 能力图 / 总结，见 §4）
│   └─ 图示（ContextCutaway、PresetAssembly、RoundSequence 等原样保留在正文流）
└─ aside.code-dock（右侧，sticky，只放代码）
    ├─ 文件标签 + 当前段计数
    └─ 源码（渐进填充：骨架 → 实现段；is-new 紫色高亮；行号真实）
```

- 右侧代码区**不再有** panel-intro 观察点列表、tab 系统、步骤选择器——全部迁入正文。
- 滚动联动严格移植 nano-dsh `Reader.tsx`：scroll 监听（非 IO）+ 25% 视口线 + 末尾兜底 +
  锁定暂停 + `#chapter-N` hash + 补全进度条 + LCS 新增行判定（`scroll-sync.ts` 原样复用）。

## 2. 数据模型：fills（骨架 + 填充段）

### 2.1 checkpoints.json 每章新增字段

```jsonc
"fills": [
  { "label": "声明 Agent 骨架", "kind": "skeleton", "ranges": [[52, 52], [173, 173]] },
  { "label": "私有字段与构造器", "kind": "body",     "ranges": [[53, 75]] },
  // …按教学顺序，最多 7 段
]
```

- `kind: "skeleton"` 只含声明（类/接口/函数名 + 大括号 + 类型签名），**无实现体**；
  首次出现整段呈现，**不做 is-new 高亮**（nano-dsh ch1 文件级出现同款）。
- `kind: "body"` 为实现段；出现时相对上一快照做 LCS 高亮。
- `ranges` 支持多区间（骨架需要"声明行 + 收尾大括号"两处）。
- 片段按序**严格累积**（快照 = fills[0..i] 的 ranges 行按序拼接），不得改写旧行。

### 2.2 生成器扩展

`scripts/generate-tutorial-data.ts`：从 `config.fills` 校验（区间单调不重叠、在文件行数内、
骨架在 sourceRange 前）并写入 `chapter.fills`。Python 版若无标注则缺省 `fills: []`，
前端退化为"整段显示"（现状行为）。

### 2.3 m01 完整样例（src/agent.ts，173 行）

| # | kind | ranges | label | 对应观察点 |
|---|---|---|---|---|
| 1 | skeleton | [52,52] [173,173] | 声明 Agent 骨架 | — |
| 2 | body | [53,75] | 私有字段与构造器 | obs1 [53,76] |
| 3 | body | [77,97] | Step 循环与请求组装 | obs2 [73,95] 的后半 |
| 4 | body | [98,113] | 流式等待模型回复 | obs3 [98,113] |
| 5 | body | [114,132] | 无工具调用即结束 Turn | — |
| 6 | body | [134,149] | 逐个执行工具并写回结果 | — |
| 7 | body | [151,172] | 工具执行：校验与运行 | — |

其余五章实现时按同法划分（骨架 = 章主文件的类/函数声明；实现段 = 观察点区间 +
源文件真实边界）。m06 的观察点区间 [33,60] [62,82] [83,114] 直接切段。

## 3. 滚动联动与渐进填充（移植自 nano-dsh）

- **锚点 = 填充卡片**：每章正文段落流按比例交错插入 `fills[1..]` 卡片（骨架由章首自动激活），
  卡片带 `data-fill-cp`、label、行区间徽章、观察点解释文本（`observations[i].text`）。
- **滚动监听**：`[data-fill-cp]` 中最后一个 top ≤ 25% 视口线的卡片 → checkpoint；
  末尾兜底；`locked` 时暂停。复用旧版已验证的 App 内实现，改锚点选择器即可。
- **快照渲染**：`snapshotForCheckpoint(chapter, i)` = 拼接 fills[0..i] 的 ranges；
  `addedLines(prev, cur)` LCS 判定 is-new；代码区滚动定位到首个 is-new 行（-24px 留白）。
- **hash / 锁 / 进度**：`#chapter-N`（与 `?lang=python` 兼容，hash 与 search 独立）；
  顶栏 🔒 锁定；进度 = 当前章 checkpoint 数/总 fill 数。

## 4. 内容迁移清单（原右侧 → 左侧正文）

| 原面板内容 | 迁入正文的形式 |
|---|---|
| source 观察点列表 + codeGuide 导览 | 章首「源码导览」卡 + 填充卡片（label + text + 行区间） |
| request（模型输入） | evidence 卡内嵌「请求对比」：相邻两次请求的 messages 增量 + token 估算（复用 `ContextCutaway` 风格，固定展示第 1→2 次） |
| events（时间线） | evidence 卡内嵌「时间线」：事件摘要列表（`TraceView` 压缩版，取 5-8 条关键事件） |
| diff / 总结 | 章末「本章总结」卡：changeStory + outcomes + diff 统计（`m0X-summary` evidence 块原位渲染） |
| graph（能力关系） | evidence 卡内嵌「能力图」：插件/工具归属快照（`GraphView` 压缩版） |
| 运行叙事/练习（ChapterRun 等） | 保留在正文（原位置），不再驱动右侧面板，改为高亮右侧对应行区间 |

- `LessonNarrative` 的 cue 滚动联动**移除**（它驱动的是面板）；evidence 块降级为纯内容卡。
- 观察点 hover/pin 联动**保留**：正文填充卡片 hover → 右侧代码区高亮对应行并滚动定位
  （跨列联动，旧版已验证；移动端点击切换）。

## 5. 组件改造清单（App.tsx，2325 行 → 预计 ~1500 行）

| 组件 | 处置 |
|---|---|
| `App()` | 状态收敛：`language / activeChapterId / checkpoint / locked / progress`；删除 tab/step/evidenceSync/followingNarrative；hash 初始化 + scroll 监听 + 数据加载保留 |
| `Header` | 加 🔒 + 进度条；保留章节导航 / 语言切换 / repo |
| `Hero / BuildPrelude / LanguagePrimer / LiveReplaySection` | 原样保留 |
| `ChapterArticle` | 布局改单列正文；删除 mobile-switcher 双栏逻辑（移动端 = 正文在上、代码在下滚动） |
| `LessonNarrative` | 删除 cue 联动；段落流交错插入填充卡片 + 证据卡 |
| `SourceView` | 重命名为代码区：快照渲染 + is-new + 真实行号；删除观察点列表与复制按钮保留 |
| `CodeBlock` | 加 `newLines` prop（旧版实现复用）；逐行直接渲染，不再隐藏代码 |
| `EvidencePanel / MoreEvidence / step picker / RequestView / TraceView / GraphView / DiffView` | 改为正文内嵌压缩版证据卡组件（`EvidenceCard`） |
| `scroll-sync.ts` | 从旧分支内容恢复（buildCheckpoints 改为 fills 版：`snapshotForCheckpoint` / `addedLines` / `checkpointForRange`） |

## 6. 样式（styles.css，2695 行）

- 删除 panel-shell/tabs/step-picker/evidence-dock 相关；新增 `.code-dock`（右侧 sticky 列）、
  `.fill-card`（正文填充卡片，复用 `.observation-card` 视觉）、`.evidence-card`、
  `.code-line.is-new`（紫色）、`.source-placeholder`、`.progress-track`、`.lock-button`。
- 移动端（≤960px）：单列——正文在上，代码区随滚动联动仍生效（代码区 sticky 于底部？否，
  简化为正文内滚动位置驱动，代码区在页面下方，到达章节时骨架已补入）。

## 7. 验证方案

1. `pnpm typecheck` + `pnpm test`（新增 scroll-sync fills 单测：骨架多区间、LCS、累积单调）。
2. `pnpm tutorial:generate` 可复现（含 fills 校验断言）。
3. headless CDP 巡检：逐章滚动 → 右侧行数单调递增、骨架先行（首帧只有骨架行）、is-new
   高亮、hash 恢复、锁定冻结、TS/Python 双数据源、移动端视口冒烟、六章零异常。

## 8. 实施步骤（分支 feat/site-reader，从 origin/main 切出）

1. `feat(data): add fill slices to checkpoints and generator` —— checkpoints.json 六章 fills
   标注 + 生成器校验/输出 + tutorial.json 重新生成 + scroll-sync.ts 恢复与单测。
2. `feat(site): two-column reader with progressive code fill` —— 布局重写 + 滚动联动 +
   填充卡片 + is-new 渲染。
3. `feat(site): move evidence into the article flow` —— 证据卡内嵌 + 总结卡 + 请求/时间线/能力图压缩版。
4. `feat(site): hash, lock, progress, mobile` —— 顶栏控件与移动端。
5. `docs: record reader redesign` —— 本设计归档。

## 9. 风险

- fills 内容划分是教学核心，六章划分需逐章核对源码行号（以重新生成的 tutorial.json 为准）。
- 移除面板 tab 后，请求/事件/图的交互深度下降（步骤选择器丢失）——以固定对比形式补偿。
- Python 版暂不加 fills（无标注），前端兼容空 fills。
