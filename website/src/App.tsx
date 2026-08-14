import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-yaml.js";
import type {
  Chapter,
  GraphSnapshot,
  LiveReplay,
  LiveReplayEvent,
  PanelTab,
  RequestEvidence,
  RequestPart,
  TutorialData,
} from "./types.js";
import {
  nextReplayFrame,
  replayDelay,
  replayEventGroup,
  replayStageHold,
} from "./replay-timing.js";

const PANEL_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "source", label: "源码细读" },
  { id: "diff", label: "总结" },
  { id: "request", label: "请求" },
  { id: "events", label: "事件" },
  { id: "graph", label: "能力关系" },
];

const SHOW_LIVE_REPLAY = false;

type TutorialLanguage = "typescript" | "python";

function initialLanguage(): TutorialLanguage {
  const query = new URLSearchParams(window.location.search).get("lang");
  if (query === "python") return "python";
  return window.localStorage.getItem("tutorial-language") === "python" ? "python" : "typescript";
}

type MobileTab = "article" | PanelTab | "more";

interface EvidenceTarget {
  tab: PanelTab;
  step?: number;
  lines?: [number, number];
  event?: {
    type: string;
    occurrence?: number | "last";
  };
  cueId?: string;
  note: string;
}

interface EvidenceSync extends EvidenceTarget {
  chapterId: string;
  version: number;
  origin: "default" | "scroll" | "hover" | "click";
}

interface LessonEvidenceBlock {
  kind: "evidence";
  id: string;
  ordinal: number;
  label: string;
  description: string;
  target: EvidenceTarget;
}

type LessonBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | LessonEvidenceBlock;

const MOBILE_TABS: Array<{ id: MobileTab; label: string }> = [
  { id: "article", label: "正文" },
  { id: "more", label: "证据" },
];

export function App() {
  const [language, setLanguage] = useState<TutorialLanguage>(initialLanguage);
  const [data, setData] = useState<TutorialData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState("chapter-1");
  const [tab, setTab] = useState<PanelTab>("source");
  const [mobileTabs, setMobileTabs] = useState<Record<string, MobileTab>>({});
  const [step, setStep] = useState(0);
  const [evidenceSync, setEvidenceSync] = useState<EvidenceSync | null>(null);
  const [followingNarrative, setFollowingNarrative] = useState(true);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const latestNarrativeTargets = useRef(new Map<string, EvidenceTarget>());

  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    const source = language === "python" ? "/generated/tutorial-python.json" : "/generated/tutorial.json";
    fetch(source)
      .then((response) => {
        if (!response.ok) throw new Error(`tutorial data: ${response.status}`);
        return response.json() as Promise<TutorialData>;
      })
      .then((nextData) => {
        if (!current) return;
        const firstChapter = nextData.chapters[0];
        const initialEvidence = chapterDefaultEvidence(firstChapter);
        setData(nextData);
        setActiveChapterId(firstChapter?.id ?? "chapter-1");
        setTab(initialEvidence.tab);
        setStep(initialEvidence.step ?? 0);
        setEvidenceSync(firstChapter ? {
          ...initialEvidence,
          chapterId: firstChapter.id,
          version: 1,
          origin: "default",
        } : null);
        setFollowingNarrative(true);
        latestNarrativeTargets.current.clear();
        setMobileTabs({});
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { current = false; };
  }, [language]);

  useEffect(() => {
    if (!data) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const id = visible?.target.getAttribute("data-chapter");
        if (id) {
          setActiveChapterId((current) => {
            if (current !== id) {
              const chapter = data.chapters.find((item) => item.id === id);
              const target = chapterDefaultEvidence(chapter);
              setTab(target.tab);
              setStep(target.step ?? 0);
              setEvidenceSync((sync) => ({
                ...target,
                chapterId: id,
                version: (sync?.version ?? 0) + 1,
                origin: "default",
              }));
              setFollowingNarrative(true);
            }
            return id;
          });
        }
      },
      { rootMargin: "-22% 0px -54% 0px", threshold: [0.05, 0.3, 0.65] },
    );
    for (const section of sectionRefs.current.values()) observer.observe(section);
    return () => observer.disconnect();
  }, [data]);

  const activeChapter = useMemo(
    () => data?.chapters.find((chapter) => chapter.id === activeChapterId) ?? data?.chapters[0],
    [activeChapterId, data],
  );

  if (error) return <LoadFailure message={error} />;
  if (!data || !activeChapter) return <Loading />;

  const showEvidence = (
    chapter: Chapter,
    target: EvidenceTarget,
    origin: EvidenceSync["origin"],
    openOnCompact = false,
  ) => {
    setActiveChapterId(chapter.id);
    setTab(target.tab);
    setStep(target.step ?? 0);
    setEvidenceSync((current) => ({
      ...target,
      chapterId: chapter.id,
      version: (current?.version ?? 0) + 1,
      origin,
    }));

    if (openOnCompact && window.matchMedia("(max-width: 960px)").matches) {
      setMobileTabs((current) => ({ ...current, [chapter.id]: target.tab }));
      requestAnimationFrame(() => {
        sectionRefs.current
          .get(chapter.id)
          ?.querySelector<HTMLElement>(".mobile-switcher")
          ?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    }
  };

  const navigateTo = (chapter: Chapter) => {
    const target = chapterDefaultEvidence(chapter);
    showEvidence(chapter, target, "default");
    setFollowingNarrative(true);
    setMobileTabs({});
    const compact = window.matchMedia("(max-width: 960px)").matches;
    const scroll = () => sectionRefs.current.get(chapter.id)?.scrollIntoView({
      behavior: compact ? "auto" : "smooth",
      block: "start",
    });
    if (compact) requestAnimationFrame(scroll);
    else scroll();
  };

  const switchLanguage = (nextLanguage: TutorialLanguage) => {
    if (nextLanguage === language) return;
    const url = new URL(window.location.href);
    if (nextLanguage === "python") url.searchParams.set("lang", "python");
    else url.searchParams.delete("lang");
    window.history.replaceState(null, "", url);
    window.localStorage.setItem("tutorial-language", nextLanguage);
    setLanguage(nextLanguage);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const navigateToQuestions = () => {
    document.getElementById("six-questions")?.scrollIntoView({
      behavior: window.matchMedia("(max-width: 960px)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <div className="app-shell">
      <Header data={data} activeId={activeChapter.id} language={language} onLanguage={switchLanguage} onNavigate={navigateTo} />
      <main>
        <Hero data={data} onStart={navigateToQuestions} />
        <BuildPrelude chapters={data.chapters} onStart={() => navigateTo(data.chapters[0]!)} />
        <LanguagePrimer markdown={data.project.primer ?? ""} language={language} />
        {SHOW_LIVE_REPLAY && <LiveReplaySection replay={data.liveReplay} />}
        <div className="learning-layout">
          <article className="chapters" aria-label="渐进教程">
            {data.chapters.map((chapter) => (
              <ChapterArticle
                key={chapter.id}
                chapter={chapter}
                chapters={data.chapters}
                active={activeChapter.id === chapter.id}
                mobileTab={mobileTabs[chapter.id] ?? "article"}
                sectionRef={(node) => {
                  if (node) sectionRefs.current.set(chapter.id, node);
                }}
                onMobileTab={(nextTab) => {
                  setActiveChapterId(chapter.id);
                  setFollowingNarrative(false);
                  setEvidenceSync(null);
                  setMobileTabs((current) => ({ ...current, [chapter.id]: nextTab }));
                  if (nextTab !== "article" && nextTab !== "more") setTab(nextTab);
                }}
                onNarrativeFocus={(target) => {
                  latestNarrativeTargets.current.set(chapter.id, target);
                  if (followingNarrative) showEvidence(chapter, target, "scroll");
                }}
                onNarrativePreview={(target) => {
                  latestNarrativeTargets.current.set(chapter.id, target);
                  showEvidence(chapter, target, "hover");
                }}
                onNarrativeClick={(target) => {
                  latestNarrativeTargets.current.set(chapter.id, target);
                  setFollowingNarrative(true);
                  showEvidence(chapter, target, "click", true);
                }}
                evidenceSync={evidenceSync?.chapterId === chapter.id ? evidenceSync : null}
                step={step}
              />
            ))}
          </article>
          <aside className="evidence-dock" aria-label="随章节更新的学习面板">
            <EvidencePanel
              chapter={activeChapter}
              chapters={data.chapters}
              tab={tab}
              step={step}
              following={followingNarrative}
              onFollowingChange={(nextFollowing) => {
                setFollowingNarrative(nextFollowing);
                if (nextFollowing) {
                  const target = latestNarrativeTargets.current.get(activeChapter.id)
                    ?? chapterDefaultEvidence(activeChapter);
                  showEvidence(activeChapter, target, "scroll");
                }
              }}
              onSelect={(target) => {
                setFollowingNarrative(false);
                latestNarrativeTargets.current.set(activeChapter.id, target);
                showEvidence(activeChapter, target, "click");
              }}
              sync={evidenceSync?.chapterId === activeChapter.id ? evidenceSync : null}
            />
          </aside>
        </div>
      </main>
      <footer>
        <p className="site-footer-disclaimer">
          免责声明：本项目为独立的教学实现，与 DeepSeek 及其关联方不存在隶属、授权或合作关系；<br />
          相关名称仅用于技术学习与参考说明。
        </p>
      </footer>
    </div>
  );
}

interface ReplayToolState {
  index: number;
  id: string;
  name: string;
  arguments: string;
  result?: {
    name: string;
    summary: string;
  };
}

interface ReplayGenerationState {
  stepId: string;
  ordinal: number;
  content: string;
  tools: ReplayToolState[];
  done: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
}

interface ReplayReceiptState {
  sequence: number;
  type: string;
  label: string;
  title: string;
  detail: string;
}

interface ReplayInstructionSet {
  systems: Array<{ stepId: string; content: string }>;
  users: Array<{ turnId: string; content: string }>;
  dynamicContexts: string[];
}

type ReplaySignalNodeId = "context" | "model" | "tool" | "session";
type ReplaySignalEdge = "context-model" | "model-tool" | "tool-session" | "session-context" | null;
type ReplaySignalPhase = "setup" | "prepare" | "generate" | "commit" | "feedback" | "settle";

interface ReplaySignalState {
  phase: ReplaySignalPhase;
  activeNode: ReplaySignalNodeId | null;
  activeEdge: ReplaySignalEdge;
  title: string;
  detail: string;
}

const REPLAY_SIGNAL_NODES: Array<{
  id: ReplaySignalNodeId;
  code: string;
  label: string;
  detail: string;
}> = [
  { id: "context", code: "01 · CONTEXT", label: "整理请求", detail: "系统 · 工具 · 历史" },
  { id: "model", code: "02 · MODEL", label: "生成下一步", detail: "文字或工具参数" },
  { id: "tool", code: "03 · TOOL", label: "执行动作", detail: "校验 · 运行 · 返回" },
  { id: "session", code: "04 · SESSION", label: "写入事件", detail: "只追加并反馈" },
];

const REPLAY_SIGNAL_PHASES: Record<ReplaySignalPhase, { code: string; label: string }> = {
  setup: { code: "SETUP", label: "建立舞台" },
  prepare: { code: "PREPARE", label: "准备输入" },
  generate: { code: "GENERATE", label: "流式生成" },
  commit: { code: "COMMIT", label: "提交动作" },
  feedback: { code: "FEEDBACK", label: "接收反馈" },
  settle: { code: "SETTLE", label: "记录收束" },
};

function LiveReplaySection({ replay }: { replay: LiveReplay }) {
  const [cursor, setCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const receiptsRef = useRef<HTMLDivElement>(null);
  const events = replay.events;
  const complete = cursor >= events.length - 1;
  const instructions = useMemo(() => extractReplayInstructions(events), [events]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const firstDeltaSequences = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<number>();
    for (const item of events) {
      if (
        item.source === "model" &&
        item.stepId &&
        (item.event.type === "content-delta" || item.event.type === "tool-call-delta") &&
        !seen.has(item.stepId)
      ) {
        seen.add(item.stepId);
        first.add(item.sequence);
      }
    }
    return first;
  }, [events]);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= events.length - 1) {
      setPlaying(false);
      return;
    }
    const frame = nextReplayFrame(events, cursor);
    if (!frame) {
      setPlaying(false);
      return;
    }
    const next = events[frame.start];
    if (!next) return;
    const previousAt = cursor >= 0 ? events[cursor]?.atMs ?? 0 : 0;
    const rawGap = Math.max(0, next.atMs - previousAt);
    const modelDelta = next.source === "model" &&
      (next.event.type === "content-delta" || next.event.type === "tool-call-delta");
    const transition = next.event.type === "response" ||
      next.event.type === "goal/round-started" ||
      next.event.type === "goal/status-changed";
    const delayKind = firstDeltaSequences.has(next.sequence) || rawGap > 600
      ? "idle"
      : modelDelta
        ? "stream"
        : transition
          ? "transition"
          : "receipt";
    const current = cursor >= 0 ? events[cursor] : undefined;
    const leavingSemanticPose = current && replayEventGroup(current) !== replayEventGroup(next);
    const currentSignal = leavingSemanticPose ? replaySignalState(current) : null;
    const semanticHold = currentSignal
      ? replayStageHold(currentSignal.activeNode, currentSignal.phase)
      : 0;
    const delay = Math.max(replayDelay(rawGap, speed, delayKind), semanticHold);
    const timer = window.setTimeout(() => setCursor(frame.end), delay);
    return () => window.clearTimeout(timer);
  }, [cursor, events, firstDeltaSequences, playing, speed]);

  const visibleEvents = useMemo(() => events.slice(0, cursor + 1), [cursor, events]);
  const generations = useMemo(() => buildReplayGenerations(visibleEvents), [visibleEvents]);
  const receipts = useMemo(() => buildReplayReceipts(visibleEvents), [visibleEvents]);
  const roundStarts = useMemo(
    () => events
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.source === "session" && item.event.type === "goal/round-started"),
    [events],
  );
  const visibleRoundCount = visibleEvents.filter(
    (item) => item.source === "session" && item.event.type === "goal/round-started",
  ).length;
  const goalCompleted = visibleEvents.some(
    (item) => item.source === "session" && item.event.type === "goal/status-changed" && item.event.status === "completed",
  );

  useEffect(() => {
    if (!playing) return;
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    receiptsRef.current?.scrollTo({ top: receiptsRef.current.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }, [cursor, playing, reducedMotion]);

  const togglePlayback = () => {
    if (complete) setCursor(-1);
    setPlaying((current) => !current || complete);
  };
  const restart = () => {
    setCursor(-1);
    setPlaying(true);
  };
  const jumpToRound = (index: number) => {
    const target = roundStarts[index];
    if (!target) return;
    setPlaying(false);
    setCursor(target.index);
  };
  const progress = events.length === 0 ? 0 : Math.max(0, (cursor + 1) / events.length * 100);
  const status = complete ? "任务完成" : playing ? "正在流式回放" : cursor < 0 ? "等待播放" : "已暂停";
  const currentEvent = cursor >= 0 ? events[cursor] : undefined;

  return (
    <section className="live-replay" id="live-replay" aria-labelledby="live-replay-title">
      <header className="replay-heading">
        <div>
          <h2 id="live-replay-title">先看模型怎样把任务做完。</h2>
          <p>这不是预先写好的打字动画。下面保存了一次真实 DeepSeek 流式调用：模型读取缺陷与代码证据、应用最小补丁、运行回归测试，再临时安装 TypeScript 分析能力完成语义核验。</p>
        </div>
        <dl className="replay-provenance">
          <div><dt>来源</dt><dd><i /> 真实 API 录制</dd></div>
          <div><dt>模型</dt><dd>{replay.provenance.model}</dd></div>
          <div><dt>原始时长</dt><dd>{formatReplayDuration(replay.provenance.durationMs)}</dd></div>
          <div><dt>录制时间</dt><dd>{formatReplayDate(replay.provenance.recordedAt)}</dd></div>
        </dl>
      </header>

      <section className="replay-mission" aria-labelledby="replay-mission-title">
        <div className="mission-command">
          <span>GOAL BRIEF · 交给模型的任务</span>
          <h3 id="replay-mission-title">修复购物车重复优惠 Bug · CHECKOUT-417</h3>
          <p>订单优惠已经分摊进商品小计，结账函数却又扣了一次。模型要定位重复扣减、应用唯一最小补丁并跑完回归测试；最终核验时还要临时安装 TypeScript 分析工具，并在提交前完整移除。</p>
        </div>
        <ol className="mission-rounds">
          <li><i>1</i><div><b>先诊断</b><span>检查运行环境，读取 issue、源码、测试与 CI 日志。</span></div></li>
          <li><i>2</i><div><b>再修复</b><span>精确替换重复扣减表达式，运行 43 项回归测试。</span></div></li>
          <li><i>3</i><div><b>验证提交</b><span>用 <code>typescript_analysis</code> 核验调用方与类型，清理后提交。</span></div></li>
        </ol>
        <div className="mission-contract">
          <span><small>补丁约束</small>只修改 src/checkout.ts 的目标表达式</span>
          <span><small>执行边界</small>只能读固定路径 · 只能使用 Harness 受限工具</span>
          <span><small>完成条件</small>43/43 测试通过 · 补丁被接受 · 临时能力无残留</span>
        </div>
        <p className="mission-explainer"><b>怎么看这段回放：</b>模型只负责生成文字或工具调用；Harness 校验并执行工具，再把结果写入会话，成为下一模型步骤的输入。</p>
        <div className="mission-prompt">
          <span>ACTUAL USER INSTRUCTION · 实际发送的首轮指令</span>
          <code>{instructions.users[0]?.content ?? "录制中没有找到 user/message。"}</code>
          <details>
            <summary>查看完整 SYSTEM、全部 USER 指令与动态上下文</summary>
            <div className="mission-prompt-details">
              {instructions.systems.map((instruction, index) => (
                <section key={`${instruction.stepId}-${index}`}>
                  <small>SYSTEM {index + 1} · 从 {instruction.stepId} 起生效</small>
                  <pre>{instruction.content}</pre>
                </section>
              ))}
              <section>
                <small>USER · 每个 turn 的实际任务</small>
                <ol>{instructions.users.map((instruction, index) => (
                  <li key={`${instruction.turnId}-${index}`}><b>{instruction.turnId}</b><code>{instruction.content}</code></li>
                ))}</ol>
              </section>
              <section>
                <small>DYNAMIC CONTEXT · 每步追加</small>
                {instructions.dynamicContexts.map((context) => <code key={context}>{context}</code>)}
              </section>
            </div>
          </details>
        </div>
      </section>

      <div className="replay-console">
        <div className="replay-controls">
          <button className="replay-play" onClick={togglePlayback}>
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
            {complete ? "重新播放" : playing ? "暂停" : cursor < 0 ? "播放真实回放" : "继续"}
          </button>
          <button className="replay-restart" onClick={restart} disabled={cursor < 0}>从头播放</button>
          <div className="replay-speed" aria-label="回放速度">
            {[0.25, 0.5, 1, 2].map((value) => (
              <button key={value} className={speed === value ? "active" : ""} onClick={() => setSpeed(value)}>{value}×</button>
            ))}
          </div>
          <span className={`replay-status ${playing ? "active" : ""}`} aria-live="polite"><i />{status}</span>
        </div>
        <div className="replay-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>

        <ReplaySignalMap currentEvent={currentEvent} playing={playing} />

        <div className="replay-rounds" aria-label="三轮任务进度">
          {["诊断", "修复", "验证提交"].map((label, index) => {
            const active = visibleRoundCount === index + 1 && !goalCompleted;
            const done = visibleRoundCount > index + 1 || goalCompleted;
            return (
              <button key={label} className={`${active ? "active" : ""} ${done ? "done" : ""}`} onClick={() => jumpToRound(index)}>
                <i>{done ? "✓" : index + 1}</i><span><small>第 {index + 1} 轮</small>{label}</span>
              </button>
            );
          })}
          <div className={goalCompleted ? "done" : ""}><i>{goalCompleted ? "✓" : "·"}</i><span><small>最终状态</small>{goalCompleted ? "CHECKOUT-417 已接受" : "等待完成"}</span></div>
        </div>

        <div className="replay-stage">
          <section className="model-stream-panel">
            <header><span><i /> MODEL STREAM</span><small>模型文字与工具参数按真实 chunk 顺序出现</small></header>
            <div className="model-stream-feed" ref={terminalRef} aria-live={playing ? "off" : "polite"}>
              {generations.length === 0 ? (
                <div className="replay-empty"><b>准备回放真实生成过程</b><span>点击播放后，这里会先出现请求，再逐段收到模型输出。</span></div>
              ) : generations.map((generation, index) => {
                const current = index === generations.length - 1 && !generation.done;
                return (
                  <article key={generation.stepId} className={`generation-block ${current ? "current" : ""}`}>
                    <div className="generation-meta">
                      <span>模型步骤 {generation.ordinal}</span><code>{generation.stepId}</code>
                      {generation.done && (
                        <small>
                          {generation.tools.length > 0 ? `生成 ${generation.tools.length} 个工具调用` : "文字回复完成"}
                          {generation.completionTokens === null ? "" : ` · ${generation.completionTokens} token`}
                        </small>
                      )}
                    </div>
                    {generation.content && <pre>{generation.content}{current && playing && <i className="stream-cursor" />}</pre>}
                    {generation.tools.map((tool) => (
                      <div className="stream-tool" key={tool.index}>
                        <span>TOOL CALL</span>
                        <b>模型请求 · {tool.name || "正在接收工具名…"}</b>
                        <code>{tool.arguments || "…"}{current && playing && <i className="stream-cursor" />}</code>
                        {tool.result ? (
                          <div className="stream-tool-result">
                            <span>HARNESS RESULT</span>
                            <b>{toolNameLabel(tool.result.name)} 已执行</b>
                            <p>{tool.result.summary}</p>
                          </div>
                        ) : generation.done ? (
                          <div className="stream-tool-pending"><i /> 调用已经生成，等待 Harness 校验并执行…</div>
                        ) : null}
                      </div>
                    ))}
                    {generation.tools.some((tool) => tool.result) && (
                      <p className="stream-feedback-note">↳ 工具结果已写入 Session，下一模型步骤会从这些事实继续。</p>
                    )}
                    {!generation.content && generation.tools.length === 0 && !generation.done && (
                      <p className="waiting-token"><i /> 请求已发送，等待首个增量…</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="harness-receipts">
            <header><span>HARNESS RECEIPTS</span><small>同一次运行中的动作收据</small></header>
            <div ref={receiptsRef}>
              {receipts.length === 0 ? <p>尚未产生运行事件。</p> : receipts.map((receipt, index) => (
                <article key={receipt.sequence} className={`${receipt.type} ${index === receipts.length - 1 ? "latest" : ""}`}>
                  <i /><div><small>#{String(receipt.sequence).padStart(3, "0")} · {receipt.label}</small><b>{receipt.title}</b>{receipt.detail && <p>{receipt.detail}</p>}</div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      </div>
      <footer className="replay-note">
        <span><i /> 阅读者无需 API</span>
        <p>浏览器只读取已提交的录制样本。生成内容保留真实 chunk 顺序；没有可见内容的网络等待统一缩成短停顿。六章的可重复教学证据仍由确定性模型模拟器生成。</p>
      </footer>
    </section>
  );
}

function ReplaySignalMap({
  currentEvent,
  playing,
}: {
  currentEvent: LiveReplayEvent | undefined;
  playing: boolean;
}) {
  const signal = replaySignalState(currentEvent);
  const phase = REPLAY_SIGNAL_PHASES[signal.phase];

  return (
    <section
      className={`replay-signal-map phase-${signal.phase} ${playing ? "playing" : ""}`}
      aria-label="当前运行事件在智能体循环中的位置"
    >
      <div className="signal-readout" aria-live={playing ? "off" : "polite"}>
        <span className="signal-kicker"><i /> 运行信号台</span>
        <div>
          <small>{phase.code} · {phase.label}</small>
          <b>{signal.title}</b>
          <p>{signal.detail}</p>
        </div>
      </div>

      <div className="signal-route" role="group" aria-label="请求、模型、工具与会话记录的反馈回路">
        <ol className="signal-track">
          {REPLAY_SIGNAL_NODES.map((node, index) => {
            const nextNode = REPLAY_SIGNAL_NODES[index + 1];
            const edge = nextNode ? `${node.id}-${nextNode.id}` as ReplaySignalEdge : null;
            const active = signal.activeNode === node.id;
            return (
              <li key={node.id} className={`signal-step ${active ? "active" : ""}`} aria-current={active ? "step" : undefined}>
                <div className="signal-node">
                  <i aria-hidden="true">{index + 1}</i>
                  <span>{node.code}</span>
                  <b>{node.label}</b>
                  <small>{node.detail}</small>
                </div>
                {edge && <span className={`signal-bridge ${signal.activeEdge === edge ? "active" : ""}`} aria-hidden="true"><i /></span>}
              </li>
            );
          })}
        </ol>
        <div className={`signal-feedback ${signal.activeEdge === "session-context" ? "active" : ""}`}>
          <i aria-hidden="true">↺</i>
          <span>反馈回路</span>
          <b>工具结果与运行变化，会成为下一份模型请求的一部分</b>
        </div>
      </div>
    </section>
  );
}

function replaySignalState(item: LiveReplayEvent | undefined): ReplaySignalState {
  if (!item) {
    return {
      phase: "setup",
      activeNode: null,
      activeEdge: null,
      title: "等待第一条真实事件",
      detail: "播放后，这里会标出每个动作由谁接手、又把结果交给谁。",
    };
  }

  const event = item.event;
  if (item.source === "model") {
    if (event.type === "tool-call-delta") {
      return {
        phase: "commit",
        activeNode: "model",
        activeEdge: "model-tool",
        title: "模型正在组装工具调用",
        detail: "工具名与参数按增量到达；完整后才会交给 Harness 校验执行。",
      };
    }
    if (event.type === "response") {
      return {
        phase: "settle",
        activeNode: "model",
        activeEdge: null,
        title: "本次模型生成已经结束",
        detail: "Harness 接收完整回复，并把文字或工具请求写进会话事件。",
      };
    }
    return {
      phase: "generate",
      activeNode: "model",
      activeEdge: "context-model",
      title: "模型正在流式生成",
      detail: "左侧按真实 chunk 追加内容；当前阶段不会直接执行任何工具。",
    };
  }

  if (event.type === "goal/created") {
    return {
      phase: "setup",
      activeNode: "session",
      activeEdge: "session-context",
      title: "跨轮任务已经建立",
      detail: "目标、轮次上限与完成条件先写入会话，成为后续运行的边界。",
    };
  }
  if (event.type === "goal/round-started") {
    const round = replayNumber(event.round) ?? 1;
    return {
      phase: "prepare",
      activeNode: "context",
      activeEdge: "session-context",
      title: `第 ${round} 轮从已有记录继续`,
      detail: "上一轮的工具反馈不会丢失；它会和本轮目标一起重建模型输入。",
    };
  }
  if (event.type === "turn/start" || event.type === "user/message" || event.type === "step/start") {
    return {
      phase: "prepare",
      activeNode: "context",
      activeEdge: "session-context",
      title: event.type === "step/start" ? "从事件历史重建本步输入" : "把本轮任务加入上下文",
      detail: "稳定系统说明、可用工具、历史消息与动态上下文正在按固定顺序组合。",
    };
  }
  if (event.type === "request/header") {
    return {
      phase: "commit",
      activeNode: "context",
      activeEdge: "context-model",
      title: "模型工作包已经发出",
      detail: `${replayString(event.stepId) || "当前步骤"} 的请求边界已记录，现在由模型接手。`,
    };
  }
  if (event.type === "tool/call") {
    const call = replayRecord(event.call);
    const name = replayString(call?.name);
    return {
      phase: "commit",
      activeNode: "tool",
      activeEdge: "model-tool",
      title: `正在执行 ${toolNameLabel(name)}`,
      detail: "参数先经过结构校验，再调用对应实现；模型不能绕过这层执行边界。",
    };
  }
  if (event.type === "tool/result") {
    const name = replayString(event.name);
    return {
      phase: "feedback",
      activeNode: "session",
      activeEdge: "tool-session",
      title: `${toolNameLabel(name)} 已经返回`,
      detail: "结果先写入只追加会话，下一模型步骤再从同一份事实继续推理。",
    };
  }
  if (event.type === "runtime/plugin-mounted" || event.type === "runtime/plugin-unmounted") {
    const mounted = event.type === "runtime/plugin-mounted";
    return {
      phase: "feedback",
      activeNode: "session",
      activeEdge: "session-context",
      title: `运行能力已${mounted ? "挂载" : "移除"}`,
      detail: "能力图发生变化；下一份请求会据此重新列出可见工具与提示词。",
    };
  }
  if (event.type === "goal/status-changed") {
    return {
      phase: "settle",
      activeNode: "session",
      activeEdge: null,
      title: replayString(event.status) === "completed" ? "任务完成，循环停止" : "任务状态已经更新",
      detail: "完成条件已经核验，最终状态与原因被保存在同一条事件时间线上。",
    };
  }
  if (event.type === "assistant/message" || event.type === "step/end" || event.type === "turn/end") {
    return {
      phase: "settle",
      activeNode: "session",
      activeEdge: null,
      title: event.type === "turn/end" ? "本轮运行已经收束" : "本步输出写入会话",
      detail: "记录保持只追加：既能复盘，也能在下一步重建出模型真正看到的输入。",
    };
  }

  return {
    phase: "settle",
    activeNode: "session",
    activeEdge: null,
    title: "运行事件已经落盘",
    detail: "Harness 用同一份事件历史连接模型输入、工具执行与任务状态。",
  };
}

export function buildReplayGenerations(events: LiveReplayEvent[]): ReplayGenerationState[] {
  const order: string[] = [];
  const states = new Map<string, ReplayGenerationState & { toolMap: Map<number, ReplayToolState> }>();
  const ensure = (stepId: string) => {
    let state = states.get(stepId);
    if (!state) {
      order.push(stepId);
      state = {
        stepId,
        ordinal: order.length,
        content: "",
        tools: [],
        toolMap: new Map(),
        done: false,
        promptTokens: null,
        completionTokens: null,
      };
      states.set(stepId, state);
    }
    return state;
  };
  for (const item of events) {
    if (item.source === "session") {
      const stepId = replayString(item.event.stepId);
      if (item.event.type === "request/header" && stepId) ensure(stepId);
      if (item.event.type === "tool/result" && stepId) {
        const state = ensure(stepId);
        const toolCallId = replayString(item.event.toolCallId);
        const name = replayString(item.event.name);
        let tool = [...state.toolMap.values()].find((candidate) => candidate.id === toolCallId);
        if (!tool) {
          const index = state.toolMap.size;
          tool = { index, id: toolCallId, name, arguments: "" };
          state.toolMap.set(index, tool);
        }
        tool.result = {
          name,
          summary: replayToolResult(name, replayString(item.event.content)),
        };
      }
      continue;
    }
    if (item.source !== "model" || !item.stepId) continue;
    const state = ensure(item.stepId);
    if (item.event.type === "content-delta") {
      state.content += replayString(item.event.content);
    } else if (item.event.type === "tool-call-delta") {
      const index = replayNumber(item.event.index) ?? 0;
      const tool = state.toolMap.get(index) ?? { index, id: "", name: "", arguments: "" };
      tool.id += replayString(item.event.id);
      tool.name += replayString(item.event.name);
      tool.arguments += replayString(item.event.arguments);
      state.toolMap.set(index, tool);
    } else if (item.event.type === "response") {
      state.done = true;
      const response = replayRecord(item.event.response);
      const metadata = replayRecord(response?.providerMetadata);
      state.promptTokens = replayNumber(metadata?.promptTokens);
      state.completionTokens = replayNumber(metadata?.completionTokens);
    }
  }
  return order.map((stepId) => {
    const state = states.get(stepId)!;
    const { toolMap, ...generation } = state;
    return { ...generation, tools: [...toolMap.values()].sort((left, right) => left.index - right.index) };
  });
}

function buildReplayReceipts(events: LiveReplayEvent[]): ReplayReceiptState[] {
  return events.flatMap((item): ReplayReceiptState[] => {
    if (item.source !== "session") return [];
    const event = item.event;
    if (event.type === "goal/created") {
      return [{ sequence: item.sequence, type: "goal", label: "目标", title: "三轮代码修复任务已创建", detail: "诊断重复优惠、应用并测试最小补丁，最后验证提交。" }];
    }
    if (event.type === "goal/round-started") {
      const round = replayNumber(event.round) ?? 0;
      return [{ sequence: item.sequence, type: "round", label: `第 ${round} 轮`, title: replayRoundTitle(replayString(event.label)), detail: "同一个 goal 继续向前推进。" }];
    }
    if (event.type === "request/header") {
      return [{ sequence: item.sequence, type: "request", label: "模型请求", title: replayString(event.stepId), detail: `${replayString(event.provider)}/${replayString(event.model)}` }];
    }
    if (event.type === "tool/call") {
      const call = replayRecord(event.call);
      const name = replayString(call?.name);
      return [{ sequence: item.sequence, type: "tool", label: "工具调用", title: toolNameLabel(name), detail: truncate(JSON.stringify(call?.arguments ?? {}), 92) }];
    }
    if (event.type === "tool/result") {
      const name = replayString(event.name);
      return [{ sequence: item.sequence, type: "result", label: "工具结果", title: `${toolNameLabel(name)} 已返回`, detail: replayToolResult(name, replayString(event.content)) }];
    }
    if ((event.type === "runtime/plugin-mounted" || event.type === "runtime/plugin-unmounted") && replayString(event.plugin).startsWith("capability:")) {
      const mounted = event.type === "runtime/plugin-mounted";
      return [{ sequence: item.sequence, type: "runtime", label: "能力变化", title: `TypeScript 分析能力已${mounted ? "安装" : "移除"}`, detail: mounted ? "下一次模型请求会看到 find_references 与 check_types。" : "工具目录已经恢复。" }];
    }
    if (event.type === "goal/status-changed") {
      return [{ sequence: item.sequence, type: "complete", label: "目标状态", title: "任务完成", detail: "CHECKOUT-417 已接受，临时分析能力已移除。" }];
    }
    return [];
  });
}

export function extractReplayInstructions(events: LiveReplayEvent[]): ReplayInstructionSet {
  const systems: ReplayInstructionSet["systems"] = [];
  const users: ReplayInstructionSet["users"] = [];
  const dynamicContexts = new Set<string>();
  const seenSystems = new Set<string>();
  for (const item of events) {
    if (item.source !== "session") continue;
    if (item.event.type === "request/header") {
      const system = replayString(item.event.system);
      const stepId = replayString(item.event.stepId);
      if (system && !seenSystems.has(system)) {
        systems.push({ stepId, content: system });
        seenSystems.add(system);
      }
      const dynamicContext = replayString(item.event.dynamicContext);
      if (dynamicContext) dynamicContexts.add(dynamicContext);
    }
    if (item.event.type === "user/message") {
      users.push({
        turnId: replayString(item.event.turnId),
        content: replayString(item.event.content),
      });
    }
  }
  return { systems, users, dynamicContexts: [...dynamicContexts] };
}

function replayToolResult(name: string, content: string): string {
  if (name === "read_workspace_file") return "工作区证据已读取：issue、源码、测试或 CI 日志进入会话。";
  if (name === "inspect_runtime") return "当前插件、服务和受信任能力目录已返回。";
  if (name === "apply_patch") return "最小补丁已应用：返回值不再重复扣除订单优惠。";
  if (name === "run_tests") return "回归测试完成：43 项全部通过。";
  if (name === "install_capability") return "typescript_analysis 已进入运行时。";
  if (name === "find_references") return "calculateTotal 的调用方已列出，折扣参数彼此独立。";
  if (name === "check_types") return "TypeScript 类型检查通过，没有诊断。";
  if (name === "remove_capability") return "typescript_analysis 已从运行时撤下。";
  if (name === "submit_patch") {
    return content.includes('"accepted":true')
      ? "补丁通过：CHECKOUT-417 已被验收器接受。"
      : "补丁被拒绝；错误结果将回到下一次模型请求。";
  }
  return truncate(content, 92);
}

function replayRoundTitle(label: string): string {
  return ({ diagnose: "诊断重复优惠", repair: "应用补丁并运行测试", "verify-submit": "验证调用方并提交补丁" } as Record<string, string>)[label] ?? label;
}

function replayRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function replayString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function replayNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatReplayDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} 秒`;
}

function formatReplayDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function LanguagePrimer({ markdown, language }: { markdown: string; language: TutorialLanguage }) {
  const sections = parsePrimer(markdown, language);
  const label = language === "python" ? "Python" : "TypeScript";
  return (
    <details className="typescript-primer">
      <summary className="primer-summary">
        <div>
          <p className="eyebrow">阅读补充 · 约 3 分钟</p>
          <h2 id="language-primer-title">{label} 不熟？先认四个路标。</h2>
        </div>
        <span aria-hidden="true" />
      </summary>
      <div className="primer-body" aria-labelledby="language-primer-title">
        <p className="primer-intro">{sections.intro}</p>
        <div className="primer-cards">
          {sections.cards.map((card, index) => (
            <article key={card.title}>
              <span>路标 {index + 1}</span>
              <h3>{card.title}</h3>
              <pre><SyntaxCode code={card.code} language={language} /></pre>
              <p>{renderInlineCode(card.body)}</p>
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}

function BuildPrelude({ chapters, onStart }: { chapters: Chapter[]; onStart: () => void }) {
  return (
    <section id="six-questions" className="build-prelude scaffolded" aria-labelledby="build-prelude-title">
      <div className="build-prelude-copy">
        <p className="eyebrow">阅读地图</p>
        <h2 id="build-prelude-title">六个问题，理解 DeepSeek Harness。</h2>
        <p>Loop 让历史增长，上下文投影控制输入；插件管理变化，会话日志保存过程；运行时能力可以受控调整，Goal 再把工作带到下一轮。</p>
        <div className="prelude-actions">
          <button onClick={onStart}>从六个问题开始</button>
          <span>每章先讲整体机制，右侧再细读一个主文件</span>
        </div>
      </div>
      <div className="scaffold-tree">
        <b>{chapters[0]?.source.path.startsWith("python_harness/") ? "python_harness/" : "src/"}</b>
        {chapters.map((chapter, index) => (
          <div key={chapter.id} style={{ "--file-index": index } as CSSProperties}>
            <i>{String(index + 1).padStart(2, "0")}</i>
            <code>{chapter.source.path.replace(/^(?:src|python_harness)\//u, "")}</code>
            <span className="scaffold-chapter">
              <strong>第{chapterNumeral(chapter.number)}章 · {chapter.shortTitle}</strong>
              <small>{chapter.question}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Header({
  data,
  activeId,
  language,
  onLanguage,
  onNavigate,
}: {
  data: TutorialData;
  activeId: string;
  language: TutorialLanguage;
  onLanguage: (language: TutorialLanguage) => void;
  onNavigate: (chapter: Chapter) => void;
}) {
  return (
    <header className="site-header">
      <button className="wordmark" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <span className="wordmark-dot" />
        <span>DeepSeek Harness</span>
        <span className="wordmark-muted">/ from scratch</span>
      </button>
      <nav className="chapter-nav" aria-label="章节导航">
        {data.chapters.map((chapter) => (
          <button
            key={chapter.id}
            className={activeId === chapter.id ? "active" : ""}
            onClick={() => onNavigate(chapter)}
            aria-current={activeId === chapter.id ? "step" : undefined}
          >
            <span>{chapterName(chapter.number)}</span>
            {chapter.shortTitle}
          </button>
        ))}
      </nav>
      <div className="header-actions">
        <div className="language-switch" role="group" aria-label="教程实现语言">
          <button className={language === "typescript" ? "active" : ""} onClick={() => onLanguage("typescript")} aria-pressed={language === "typescript"}>TS</button>
          <button className={language === "python" ? "active" : ""} onClick={() => onLanguage("python")} aria-pressed={language === "python"}>Python</button>
        </div>
        <a className="repo-link" href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">deepseek-harness ↗</a>
      </div>
    </header>
  );
}

function Hero({ data, onStart }: { data: TutorialData; onStart: () => void }) {
  const language = data.project.languageLabel ?? "TypeScript";
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">{language} 从零搭建 · 可运行教程</p>
        <h1>
          <span className="hero-line">看懂 DeepSeek Harness，</span>
          <span className="hero-line">如何一步步</span>
          <span className="hero-line hero-line-accent">完成复杂任务。</span>
        </h1>
          <p className="hero-intro">
            Agent Harness 负责整理模型输入、执行工具、保存过程。
            <br />
            六章各用一个最小样本，只回答一个机制问题。
          </p>
        <div className="hero-actions">
          <button className="primary-action" onClick={onStart}>从六个问题开始 <span>↓</span></button>
          <span className="offline-badge"><i /> 离线学习样本可直接查看</span>
        </div>
      </div>
      <div
        className="hero-art"
        role="img"
        aria-label="手持教鞭与书本的蓝色水彩学院导师"
      >
        <div className="hero-art-fill" aria-hidden="true" />
        <div className="hero-art-image" aria-hidden="true" />
      </div>
    </section>
  );
}

function ChapterArticle({
  chapter,
  chapters,
  active,
  mobileTab,
  sectionRef,
  onMobileTab,
  onNarrativeFocus,
  onNarrativePreview,
  onNarrativeClick,
  evidenceSync,
  step,
}: {
  chapter: Chapter;
  chapters: Chapter[];
  active: boolean;
  mobileTab: MobileTab;
  sectionRef: (node: HTMLElement | null) => void;
  onMobileTab: (tab: MobileTab) => void;
  onNarrativeFocus: (target: EvidenceTarget) => void;
  onNarrativePreview: (target: EvidenceTarget) => void;
  onNarrativeClick: (target: EvidenceTarget) => void;
  evidenceSync: EvidenceSync | null;
  step: number;
}) {
  const lesson = useMemo(() => parseLesson(chapter.lesson), [chapter.lesson]);
  const evidenceCount = lesson.filter((block) => block.kind === "evidence").length;
  return (
    <section
      ref={sectionRef}
      data-chapter={chapter.id}
      id={chapter.id}
      className={`chapter ${active ? "active" : ""}`}
    >
      <div className="chapter-rail">
        <span>{chapterNumeral(chapter.number)}</span><i />
      </div>
      <div className={`chapter-content ${mobileTab === "article" ? "" : "showing-panel"}`}>
        <div className="chapter-kicker">
          <span>{chapterName(chapter.number)}</span>
          <span>本章主题 · {chapter.shortTitle}</span>
        </div>
        <div className="chapter-heading">
          <div className="chapter-file">
            <span>第 {Number(chapter.number)} / 6 次写入</span>
            <code>{chapter.source.path}</code>
          </div>
          <h2>{chapter.title}</h2>
          <p className="chapter-question">{chapter.question}</p>
          <div className="reading-order" aria-label="正文与右栏的联动顺序">
            <span><b>→</b>右栏按 {Number(chapter.number)}.1 至 {Number(chapter.number)}.{evidenceCount} 跟随正文</span>
          </div>
        </div>
        <div className="mobile-switcher" role="tablist" aria-label="移动端章节视图">
          {MOBILE_TABS.map((item) => (
            <button
              key={item.id}
              className={isMobileTabActive(mobileTab, item.id) ? "active" : ""}
              onClick={() => onMobileTab(item.id)}
              aria-selected={isMobileTabActive(mobileTab, item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className={`chapter-body ${mobileTab === "article" ? "mobile-active" : ""}`}>
          <LessonNarrative
            blocks={lesson}
            chapterNumber={chapter.number}
            active={active}
            activeCueId={evidenceSync?.cueId ?? null}
            onCueFocus={onNarrativeFocus}
            onCuePreview={onNarrativePreview}
            onCueClick={onNarrativeClick}
          />
        </div>
        <div className={`mobile-panel ${mobileTab !== "article" ? "mobile-active" : ""}`}>
          {mobileTab === "more" && <MoreEvidence chapter={chapter} onSelect={onNarrativeClick} />}
          {mobileTab !== "article" && mobileTab !== "more" && (
            <EvidencePanel
              chapter={chapter}
              chapters={chapters}
              tab={mobileTab}
              step={step}
              onSelect={onNarrativeClick}
              sync={evidenceSync}
              compact
            />
          )}
        </div>
      </div>
    </section>
  );
}

function LessonNarrative({
  blocks,
  chapterNumber,
  active,
  activeCueId,
  onCueFocus,
  onCuePreview,
  onCueClick,
}: {
  blocks: LessonBlock[];
  chapterNumber: string;
  active: boolean;
  activeCueId: string | null;
  onCueFocus: (target: EvidenceTarget) => void;
  onCuePreview: (target: EvidenceTarget) => void;
  onCueClick: (target: EvidenceTarget) => void;
}) {
  const cueRefs = useRef(new Map<string, HTMLElement>());
  const focusCallback = useRef(onCueFocus);
  const lastFocusedCue = useRef<string | null>(null);

  useEffect(() => { focusCallback.current = onCueFocus; }, [onCueFocus]);

  useEffect(() => {
    if (!active || window.matchMedia("(max-width: 960px)").matches) {
      lastFocusedCue.current = null;
      return;
    }

    const elements = [...cueRefs.current.values()];
    if (elements.length === 0) return;

    let frame = 0;
    const evaluate = () => {
      frame = 0;
      const focusY = window.innerHeight * 0.4;
      const positions = elements
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      const atPageEnd = window.scrollY + window.innerHeight
        >= document.documentElement.scrollHeight - 4;
      const candidate = atPageEnd
        ? positions.at(-1)
        : positions
        .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight)
        .sort(
          (left, right) =>
            Math.abs(left.rect.top - focusY) - Math.abs(right.rect.top - focusY),
        )[0];
      const cueId = candidate?.element.getAttribute("data-evidence-cue");
      if (!cueId || cueId === lastFocusedCue.current) return;
      const block = blocks.find(
        (item): item is LessonEvidenceBlock => item.kind === "evidence" && item.id === cueId,
      );
      if (!block) return;
      lastFocusedCue.current = cueId;
      focusCallback.current(block.target);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(evaluate);
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, blocks]);

  return (
    <div className="lesson-copy">
      {blocks.map((block, index) => {
        if (block.kind === "heading") return <h3 key={index}>{block.text}</h3>;
        if (block.kind === "paragraph") return <p key={index}>{renderInlineCode(block.text)}</p>;
        const selected = block.id === activeCueId;
        return (
          <aside
            key={block.id}
            ref={(node) => {
              if (node) cueRefs.current.set(block.id, node);
              else cueRefs.current.delete(block.id);
            }}
            data-evidence-cue={block.id}
            className={`evidence-cue ${selected ? "active" : ""}`}
          >
            <button
              type="button"
              aria-pressed={selected}
              onMouseEnter={() => onCuePreview(block.target)}
              onFocus={() => onCuePreview(block.target)}
              onClick={() => onCueClick(block.target)}
            >
              <span className="evidence-cue-index">{Number(chapterNumber)}.{block.ordinal}</span>
              <strong>{block.label}</strong>
              <span className="evidence-cue-description">{block.description}</span>
            </button>
          </aside>
        );
      })}
    </div>
  );
}

function MoreEvidence({ chapter, onSelect }: { chapter: Chapter; onSelect: (target: EvidenceTarget) => void }) {
  const sections = lessonEvidenceBlocks(chapter.lesson);
  return (
    <section className="mobile-more">
      <span>本章顺序</span>
      <h3>从 {Number(chapter.number)}.1 读到总结</h3>
      <p>每一项只回答正文旁边的一个问题。</p>
      <div>
        {sections.map((section) => (
          <button key={section.id} onClick={() => onSelect(section.target)}>
            <b>{Number(chapter.number)}.{section.ordinal} · {section.label}</b>
            <span>{section.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function EvidencePanel({
  chapter,
  chapters,
  tab,
  step,
  onSelect,
  following = true,
  onFollowingChange,
  sync = null,
  compact = false,
}: {
  chapter: Chapter;
  chapters: Chapter[];
  tab: PanelTab;
  step: number;
  onSelect: (target: EvidenceTarget) => void;
  following?: boolean;
  onFollowingChange?: (following: boolean) => void;
  sync?: EvidenceSync | null;
  compact?: boolean;
}) {
  const sections = lessonEvidenceBlocks(chapter.lesson);
  const availableSteps = tab === "graph" ? chapter.graphs.length : chapter.requests.length;
  const safeStep = Math.min(step, Math.max(availableSteps - 1, 0));
  const activeSectionId = sync?.cueId
    ?? sections.find((section) => sameEvidenceLocation(section.target, { tab, step: safeStep }))?.id;
  return (
    <div className={`panel-shell ${compact ? "compact" : ""}`}>
      <div className="panel-topline">
        <div><i /> 本章路径</div>
        {onFollowingChange ? (
          <button
            type="button"
            className={`narrative-follow ${following ? "active" : "paused"}`}
            aria-pressed={following}
            onClick={() => onFollowingChange(!following)}
          >
            <span />{following ? "跟随正文" : "继续跟随正文"}
          </button>
        ) : <span>{chapterName(chapter.number)}</span>}
      </div>
      <div className="panel-tabs chapter-evidence-tabs" role="tablist">
        {sections.map((section) => (
            <button
              key={section.id}
              className={activeSectionId === section.id ? "active" : ""}
              onClick={() => onSelect(section.target)}
              aria-selected={activeSectionId === section.id}
            >
              <small>{Number(chapter.number)}.{section.ordinal}</small>
              <span>{section.label}</span>
            </button>
        ))}
      </div>
      <div
        key={`${chapter.id}-${activeSectionId ?? tab}-${safeStep}`}
        className={`panel-content panel-content-enter ${tab === "source" ? "source-panel-content" : ""}`}
      >
        {tab === "source" && <SourceView chapter={chapter} externalRange={sync?.lines ?? null} />}
        {tab === "diff" && <DiffView chapter={chapter} chapters={chapters} onSelect={onSelect} />}
        {tab === "request" && <RequestView chapter={chapter} evidence={chapter.requests[safeStep] ?? chapter.requests[0]!} />}
        {tab === "events" && <TraceView chapter={chapter} focus={sync?.event} />}
        {tab === "graph" && <GraphView {...(chapter.graphs[safeStep] ? { graph: chapter.graphs[safeStep] } : {})} chapter={chapter} />}
      </div>
    </div>
  );
}

function SourceView({
  chapter,
  externalRange = null,
}: {
  chapter: Chapter;
  externalRange?: [number, number] | null;
}) {
  const lineCount = chapter.source.content.trimEnd().split("\n").length;
  const [hoveredObservation, setHoveredObservation] = useState<number | null>(null);
  const [pinnedObservation, setPinnedObservation] = useState<number | null>(null);
  const focusCodeRef = useRef<HTMLDivElement>(null);
  const externalObservation = externalRange === null
    ? -1
    : chapter.codeGuide.observations.findIndex(
        (observation) => observation.lines[0] === externalRange[0]
          && observation.lines[1] === externalRange[1],
      );
  const activeObservation = hoveredObservation
    ?? pinnedObservation
    ?? (externalObservation >= 0 ? externalObservation : null);
  const activeRange = hoveredObservation !== null || pinnedObservation !== null
    ? chapter.codeGuide.observations[activeObservation ?? -1]?.lines ?? null
    : externalRange;
  const suppressFullExcerptFocus = hoveredObservation === null
    && pinnedObservation === null
    && externalRange !== null
    && externalRange[0] <= chapter.source.startLine
    && externalRange[1] >= chapter.source.endLine;
  const displayedRange = suppressFullExcerptFocus ? null : activeRange;
  const focusLine = displayedRange === null
    ? null
    : Math.floor((displayedRange[0] + displayedRange[1]) / 2);
  useEffect(() => {
    if (focusLine === null) return;
    const frame = requestAnimationFrame(() => {
      const highlighted = [
        ...(focusCodeRef.current?.querySelectorAll<HTMLElement>(".code-line.highlighted") ?? []),
      ];
      const target = highlighted[Math.floor(highlighted.length / 2)]
        ?? focusCodeRef.current?.querySelector<HTMLElement>(`[data-line="${focusLine}"]`);
      if (target) scrollEvidenceIntoView(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusLine]);
  return (
    <div className="source-view">
      <section className="panel-intro">
        <span>源码细读</span>
        <h3>{chapter.codeGuide.title}</h3>
        <p>{chapter.codeGuide.description}</p>
        <small className="hover-hint">悬停即定位并高亮；点按可固定。代码独立滚动，省略行可展开。</small>
        <ol>
          {chapter.codeGuide.observations.map((observation, index) => (
            <li key={observation.text} className={activeObservation === index ? "active" : ""}>
              <button
                type="button"
                aria-pressed={pinnedObservation === index}
                onMouseEnter={() => setHoveredObservation(index)}
                onMouseLeave={() => setHoveredObservation(null)}
                onFocus={() => setHoveredObservation(index)}
                onBlur={() => setHoveredObservation(null)}
                onClick={() => setPinnedObservation((current) => current === index ? null : index)}
              >
                <span className="source-guide-copy">
                  <b>{observation.title}</b>
                  <span>{observation.text}</span>
                </span>
                <small>{formatLineRange(observation.lines)}</small>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <div ref={focusCodeRef} className="focus-code">
        <div className="file-label">
          <span>
            {chapter.source.path} · 第 {chapter.source.startLine}–{chapter.source.endLine} 行
            {chapter.codeGuide.folds?.length ? ` · 折叠 ${chapter.codeGuide.folds.length} 处实现细节` : ""}
          </span>
          <button onClick={() => navigator.clipboard?.writeText(chapter.source.excerpt)}>复制片段</button>
        </div>
        <CodeBlock
          code={chapter.source.excerpt}
          startLine={chapter.source.startLine}
          language={languageForPath(chapter.source.path)}
          highlightedRange={displayedRange}
          folds={chapter.codeGuide.folds ?? []}
        />
      </div>
      <details className="technical-details full-source">
        <summary><span>完整源文件</span><b>{lineCount} 行 · 按需展开</b></summary>
        <div className="details-body">
          <div className="file-label">
            <span>{chapter.source.path}</span>
            <button onClick={() => navigator.clipboard?.writeText(chapter.source.content)}>复制全文</button>
          </div>
          <CodeBlock code={chapter.source.content} language={languageForPath(chapter.source.path)} />
        </div>
      </details>
    </div>
  );
}

function DiffView({
  chapter,
  chapters,
  onSelect,
}: {
  chapter: Chapter;
  chapters: Chapter[];
  onSelect: (target: EvidenceTarget) => void;
}) {
  const { changeStory } = chapter;
  const activeIndex = chapters.findIndex((item) => item.id === chapter.id);
  return (
    <div className="diff-view">
      <section className="panel-intro change-intro">
        <span>第 {Number(chapter.number)} 问 · 本章答案</span>
        <p className="summary-question">{chapter.question}</p>
        <h3>{changeStory.title}</h3>
        <p>{changeStory.summary}</p>
      </section>

      <section className="summary-section code-callbacks">
        <header>
          <span>回看代码</span>
          <h4>答案落在这三个控制点</h4>
          <p>{chapter.codeGuide.description}</p>
        </header>
        <ol>
          {chapter.codeGuide.observations.map((observation, index) => (
            <li key={`${observation.title}-${observation.lines.join("-")}`}>
              <button
                type="button"
                onClick={() => onSelect({
                  tab: "source",
                  lines: observation.lines,
                  note: observation.title,
                })}
              >
                <small>{String(index + 1).padStart(2, "0")} · {chapter.source.path}:{observation.lines[0]}–{observation.lines[1]}</small>
                <b>{observation.title}</b>
                <span>{observation.text}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="summary-section harness-summary">
        <header>
          <span>放回 DeepSeek Harness</span>
          <h4>{changeStory.harnessRole}</h4>
          <p>{changeStory.connection}</p>
        </header>
        <ol className="six-question-map" aria-label="理解 DeepSeek Harness 的六个问题">
          {chapters.map((item, index) => (
            <li
              key={item.id}
              className={index === activeIndex ? "current" : index < activeIndex ? "answered" : "upcoming"}
            >
              <small>{String(index + 1).padStart(2, "0")}</small>
              <div><b>{item.shortTitle}</b><span>{item.question}</span></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="summary-section summary-checklist">
        <header><span>带走这三句</span><h4>读完本章，你应该能自己解释</h4></header>
        <ul className="outcome-list">
          {changeStory.outcomes.map((outcome) => <li key={outcome}><i>✓</i><span>{outcome}</span></li>)}
        </ul>
      </section>
    </div>
  );
}

function CodeBlock({
  code,
  startLine = 1,
  diff = false,
  language = "typescript",
  highlightedRange = null,
  folds = [],
}: {
  code: string;
  startLine?: number;
  diff?: boolean;
  language?: string;
  highlightedRange?: [number, number] | null;
  folds?: Array<{ lines: [number, number]; label: string }>;
}) {
  const lines = code.trimEnd().split("\n");
  const languages = diffLanguages(lines, language);
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(() => new Set());
  const foldAtLine = new Map(
    folds.map((fold) => [fold.lines[0], fold] as const),
  );
  const rows: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const lineNumber = startLine + index;
    const fold = foldAtLine.get(lineNumber);
    const foldKey = fold ? `${fold.lines[0]}-${fold.lines[1]}` : "";
    if (fold && !expandedFolds.has(foldKey)) {
      const highlighted = highlightedRange !== null
        && fold.lines[0] <= highlightedRange[1]
        && fold.lines[1] >= highlightedRange[0];
      rows.push(
        <div key={`fold-${foldKey}`} className={`code-fold ${highlighted ? "highlighted" : ""}`.trim()}>
          <span className="line-no">⋯</span>
          <button
            type="button"
            onClick={() => setExpandedFolds((current) => new Set(current).add(foldKey))}
          >
            展开第 {fold.lines[0]}–{fold.lines[1]} 行 · {fold.label}
          </button>
        </div>,
      );
      index += fold.lines[1] - fold.lines[0] + 1;
      continue;
    }
    const line = lines[index] ?? "";
    const highlighted = highlightedRange !== null
      && lineNumber >= highlightedRange[0]
      && lineNumber <= highlightedRange[1];
    rows.push(
      <div
        key={index}
        data-line={lineNumber}
        className={`${diff ? diffClass(line) : "code-line"} ${highlighted ? "highlighted" : ""}`.trim()}
      >
        <span className="line-no">{String(lineNumber).padStart(3, "0")}</span>
        {diff
          ? <DiffCodeLine line={line} language={languages[index] ?? language} />
          : <SyntaxCode code={line || " "} language={language} />}
      </div>,
    );
    index += 1;
  }
  return (
    <div className={`code-lines ${highlightedRange ? "has-line-focus" : ""}`} role="region" aria-label={diff ? "逐行代码差异" : "源代码"}>
      {rows}
    </div>
  );
}

function SyntaxCode({ code, language }: { code: string; language: string }) {
  const grammar = Prism.languages[language] ?? Prism.languages.plain;
  const html = grammar ? Prism.highlight(code, grammar, language) : escapeHtml(code);
  return <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function DiffCodeLine({ line, language }: { line: string; language: string }) {
  if (/^(?:diff --git|index |--- |\+\+\+ |@@)/u.test(line)) {
    return <code className="diff-meta">{line || " "}</code>;
  }
  const marker = /^[+\- ]/u.test(line) ? line[0] : "";
  const content = marker ? line.slice(1) : line;
  return (
    <code className={`diff-code language-${language}`}>
      {marker && <span className="diff-marker">{marker}</span>}
      <span dangerouslySetInnerHTML={{ __html: highlightCode(content || " ", language) }} />
    </code>
  );
}

function RequestView({ chapter, evidence }: { chapter: Chapter; evidence: RequestEvidence }) {
  const guide = requestViewGuide(chapter.number);
  const showAnatomy = chapter.number === "01" || chapter.number === "02";
  return (
    <div className="request-view">
      <section className="panel-intro concept-intro">
        <span>{guide.eyebrow}</span>
        <h3>{guide.title}</h3>
        <p>{guide.description}</p>
      </section>
      {showAnatomy && (
        <div className="request-anatomy">
          <div className="stable"><b>固定区</b><span>系统规则、工具说明</span></div>
          <div className="append-only"><b>累积区</b><span>用户、模型与工具记录</span></div>
          <div className="step-variable"><b>本步区</b><span>只服务于当前步骤的说明</span></div>
        </div>
      )}
      <p className="request-step-title">第 {evidence.step} 次模型请求</p>
      <div className="request-metrics">
        <div><small>整份工作包</small><b>约 {evidence.totalApproximateTokens}</b><span>token</span></div>
        <div><small>与上次相同的开头</small><b>约 {evidence.prefix.sharedApproximateTokens}</b><span>token</span></div>
      </div>
      {chapter.number === "02" && <p className="estimate-warning">Token 是模型处理文本时使用的计量单位。这里按字符估算，便于比较大小；相同开头只表示提示词缓存（Prompt Cache）具备复用机会。</p>}
      <div className="request-parts">
        {evidence.parts.map((part) => (
          <details key={part.id} className={part.stability}>
            <summary>
              <span>{requestPartLabel(part)}</span>
              <small>{stabilityLabel(part.stability)} · 约 {part.approximateTokens} token</small>
            </summary>
            <pre><SyntaxCode code={formatJson(part.value)} language="json" /></pre>
          </details>
        ))}
      </div>
      <div className="invalidation">
        <span>相同开头从这里发生变化</span>
        <b>{invalidationLabel(evidence.prefix.firstInvalidation)}</b>
      </div>
    </div>
  );
}

function TraceView({
  chapter,
  focus,
}: {
  chapter: Chapter;
  focus?: EvidenceTarget["event"];
}) {
  const guide = traceViewGuide(chapter.number);
  const focusedEvent = (() => {
    if (!focus) return undefined;
    const matches = chapter.trace.filter((item) => item.type === focus.type);
    if (focus.occurrence === "last") return matches.at(-1);
    return matches[Math.max(0, (focus.occurrence ?? 1) - 1)];
  })();
  const focusedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!focusedEvent) return;
    const frame = requestAnimationFrame(() => {
      if (focusedRef.current) scrollEvidenceIntoView(focusedRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedEvent?.eventId]);

  return (
    <div className="trace-view">
      <section className="panel-intro concept-intro">
        <span>{guide.eyebrow}</span>
        <h3>{guide.title}</h3>
        <p>{guide.description}</p>
      </section>
      {chapter.events.length === 0 ? (
        <EmptyMechanism
          title="可重建的会话事件会在后续章节加入"
          text="这一章先保存本地执行轨迹。第四章会让用户消息、模型请求、工具结果和能力变化进入同一条只追加日志。"
          fallback={chapter.trace}
        />
      ) : (
        <>
          <div className="trace-summary"><b>{chapter.events.length}</b> 条关键事件，按发生顺序只追加</div>
          <ol>
            {chapter.trace.map((item) => {
              const selected = item.eventId === focusedEvent?.eventId;
              return (
              <li
                key={`${item.eventId}-${item.type}`}
                ref={selected ? focusedRef : undefined}
                className={`${traceClass(item.type)} ${selected ? "focused" : ""}`.trim()}
              >
                <span>{String(item.eventId).padStart(2, "0")}</span>
                <i />
                <div>
                  <small>{traceLabel(item.type)} <code>{item.type}</code></small>
                  <b>{humanTraceTitle(item)}</b>
                  {item.detail && (
                    item.detail.length > 120 ? (
                      <details className="trace-payload">
                        <summary>{truncate(item.detail, 120)}</summary>
                        <pre>{item.detail}</pre>
                      </details>
                    ) : <p>{item.detail}</p>
                  )}
                </div>
              </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

function GraphView({ graph, chapter }: { graph?: GraphSnapshot; chapter: Chapter }) {
  if (!graph) {
    return (
      <div className="graph-view">
        <section className="panel-intro concept-intro">
          <span>能力图读什么</span>
          <h3>它会回答“谁提供了这项能力”</h3>
          <p>插件可以贡献工具、服务和提示词。能力图把这些归属与依赖放在一张快照中。</p>
        </section>
        <EmptyMechanism title="能力归属会在第三章加入" text="前两章直接组装工具。第三章开始记录每项工具、服务和提示词来自哪个插件。" />
      </div>
    );
  }
  const capability = graph.plugins.find((plugin) => plugin.startsWith("capability:"));
  const guide = graphViewGuide(chapter.number, Boolean(capability));
  return (
    <div className="graph-view">
      <section className="panel-intro graph-intro">
        <span>{guide.eyebrow}</span>
        <h3>{guide.title}</h3>
        <p>{guide.description}</p>
      </section>
      <div className="graph-stage">
        <div className="graph-core">运行环境<span>本章快照</span></div>
        {graph.plugins.map((plugin, index) => {
          const angle = (index / graph.plugins.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <div
              key={plugin}
              className={`graph-node plugin ${plugin.startsWith("capability:") ? "capability" : ""}`}
              style={{
                left: `${50 + Math.cos(angle) * 36}%`,
                top: `${50 + Math.sin(angle) * 34}%`,
              }}
            >
              <i />{prettyPlugin(plugin)}
            </div>
          );
        })}
      </div>
      <div className="graph-ledger">
        <section><small>工具 · {graph.tools.length}</small>{graph.tools.map((tool) => <span key={tool.name}>{tool.name}</span>)}</section>
        <section><small>服务 · {graph.services.length}</small>{graph.services.map((service) => <span key={service.name}>{service.name}</span>)}</section>
        <section><small>提示词片段 · {graph.prompts.length}</small>{graph.prompts.map((prompt, index) => <span key={prompt.id ?? index}>{truncate(prompt.text, 48)}</span>)}</section>
      </div>
      {chapter.number === "05" && (
        <p className={`capability-state ${capability ? "mounted" : "removed"}`}>
          <i /> 临时分词统计能力{capability ? "已安装；当前工具目录已经出现 word_count" : "未安装；工具目录处于基线状态"}
        </p>
      )}
    </div>
  );
}

function EmptyMechanism({
  title,
  text,
  fallback,
}: {
  title: string;
  text: string;
  fallback?: Chapter["trace"];
}) {
  return (
    <div className="empty-mechanism">
      <span>后续章节加入</span><h3>{title}</h3><p>{text}</p>
      {fallback && <div className="early-trace">{fallback.slice(0, 7).map((item) => <small key={item.eventId}>{humanTraceTitle(item)}</small>)}</div>}
    </div>
  );
}

function LoadFailure({ message }: { message: string }) {
  return <div className="load-state"><b>学习数据没有装载</b><span>{message}</span><p>请先运行 pnpm tutorial:generate。</p></div>;
}

function Loading() {
  return <div className="load-state"><b>正在展开教程…</b><span>六章源码与运行轨迹即将就绪</span></div>;
}

function parseLesson(markdown: string): LessonBlock[] {
  let evidenceOrdinal = 0;
  return markdown
    .split(/\n\s*\n/u)
    .slice(1)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block): LessonBlock[] => {
      if (block.startsWith("## ")) {
        return [{ kind: "heading", text: block.replace(/^##\s+/u, "").replace(/\n/gu, " ") }];
      }
      const evidence = /^<!--\s*evidence\s+([\s\S]+?)\s*-->$/u.exec(block)?.[1];
      if (!evidence) return [{ kind: "paragraph", text: block.replace(/\n/gu, " ") }];
      try {
        const directive = JSON.parse(evidence) as {
          id?: unknown;
          tab?: unknown;
          requestStep?: unknown;
          lines?: unknown;
          eventType?: unknown;
          eventOccurrence?: unknown;
          label?: unknown;
          description?: unknown;
        };
        if (
          typeof directive.id !== "string"
          || !PANEL_TABS.some((item) => item.id === directive.tab)
          || typeof directive.label !== "string"
          || typeof directive.description !== "string"
        ) {
          throw new Error("missing id, tab, label, or description");
        }
        const target: EvidenceTarget = {
          tab: directive.tab as PanelTab,
          note: directive.description,
          cueId: directive.id,
        };
        if (typeof directive.requestStep === "number") {
          target.step = Math.max(0, Math.floor(directive.requestStep) - 1);
        }
        if (
          Array.isArray(directive.lines)
          && directive.lines.length === 2
          && directive.lines.every((line) => typeof line === "number")
        ) {
          target.lines = [directive.lines[0] as number, directive.lines[1] as number];
        }
        if (typeof directive.eventType === "string") {
          target.event = {
            type: directive.eventType,
            ...(directive.eventOccurrence === "last" || typeof directive.eventOccurrence === "number"
              ? { occurrence: directive.eventOccurrence as number | "last" }
              : {}),
          };
        }
        return [{
          kind: "evidence",
          id: directive.id,
          ordinal: evidenceOrdinal += 1,
          label: directive.label,
          description: directive.description,
          target,
        }];
      } catch (error) {
        console.warn("Ignored invalid lesson evidence directive", error);
        return [];
      }
    });
}

function lessonEvidenceBlocks(markdown: string): LessonEvidenceBlock[] {
  return parseLesson(markdown).filter(
    (block): block is LessonEvidenceBlock => block.kind === "evidence",
  );
}

function chapterDefaultEvidence(chapter: Chapter | undefined): EvidenceTarget {
  const firstSection = chapter ? lessonEvidenceBlocks(chapter.lesson)[0] : undefined;
  if (firstSection) {
    const { lines: _defaultLines, ...target } = firstSection.target;
    return target;
  }
  return chapter ? {
    tab: "source",
    note: "从本章主文件开始",
  } : { tab: "source", note: "从本章主文件开始" };
}

function sameEvidenceLocation(
  target: EvidenceTarget,
  location: { tab: PanelTab; step?: number },
): boolean {
  return target.tab === location.tab && (target.step ?? 0) === (location.step ?? 0);
}

function scrollEvidenceIntoView(element: HTMLElement): void {
  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  const shell = element.closest<HTMLElement>(".panel-shell");
  if (shell?.classList.contains("compact")) {
    element.scrollIntoView({ behavior, block: "center" });
    return;
  }

  const container = element.closest<HTMLElement>(".code-lines")
    ?? element.closest<HTMLElement>(".panel-content");
  if (!container) return;
  const elementBox = element.getBoundingClientRect();
  const containerBox = container.getBoundingClientRect();
  const centeredTop = container.scrollTop
    + elementBox.top
    - containerBox.top
    - (container.clientHeight - elementBox.height) / 2;
  container.scrollTo({ top: Math.max(0, centeredTop), behavior });
}

function requestViewGuide(number: string): { eyebrow: string; title: string; description: string } {
  return ({
    "01": {
      eyebrow: "Agent Loop · 反馈闭环",
      title: "工具反馈构成下一步的新增上下文",
      description: "展开累积区，可以看到上一 Step 的模型回复和工具结果。正是这两条记录，让模型能从真实反馈继续。",
    },
    "02": {
      eyebrow: "上下文与缓存 · 比较相邻请求",
      title: "缓存机会位于稳定前缀",
      description: "先看相同前缀有多长，再看第一次变化落在哪个区域。变化越靠后，可复用的内容通常越多。",
    },
    "03": {
      eyebrow: "插件组装 · 编译模型输入",
      title: "当前 Context 决定模型能看到什么",
      description: "工具与 Prompt 都来自已挂载插件。插件组装不变，请求头就保持稳定；组装改变，下一次请求也会跟着改变。",
    },
    "04": {
      eyebrow: "Session Log · 请求重建",
      title: "这份请求不是另存的副本",
      description: "系统从目标 request/header 之前的事件重新拼出消息，再应用当时的投影设置。请求视图与 Trace 共用一份历史。",
    },
    "05": {
      eyebrow: "运行时实验 · 能力变化",
      title: "插件从下一次请求开始生效",
      description: "比较安装前后或卸载前后的步骤。工具目录与系统 Prompt 的变化，会准确落在紧随其后的模型请求中。",
    },
    "06": {
      eyebrow: "长程续行 · 跨 Round 请求",
      title: "新的 Turn 仍然带着旧进展",
      description: "Round 会开始新的 Turn，但不会清空 Session。展开累积区，可以看到前一阶段留下的消息和工具结果。",
    },
  } as Record<string, { eyebrow: string; title: string; description: string }>)[number] ?? {
    eyebrow: "模型请求",
    title: "一次请求，就是交给模型的一份工作包",
    description: "它把规则、可用动作、已有记录和本步说明装在一起。",
  };
}

function traceViewGuide(number: string): { eyebrow: string; title: string; description: string } {
  return ({
    "04": {
      eyebrow: "Session Log · 同一份记录",
      title: "Event 是原始记录，Trace 是可读投影",
      description: "这里没有第二份手写时间线。每一项都来自只追加事件；请求重建也从同一组事件开始。",
    },
    "05": {
      eyebrow: "运行时实验 · 变化有记录",
      title: "安装和卸载不是看不见的状态跳跃",
      description: "沿时间线查看插件挂载、工具使用和插件撤回。能力在何时出现、何时消失，都有对应事件。",
    },
    "06": {
      eyebrow: "长程任务 · Goal 时间线",
      title: "每一次继续和停止都有原因",
      description: "Goal 创建、Round 开始、Agent Turn 和最终状态都在同一条时间线上。这里能看见外层协调器怎样推进任务。",
    },
  } as Record<string, { eyebrow: string; title: string; description: string }>)[number] ?? {
    eyebrow: "事件与轨迹",
    title: "Event 保存原始记录，Trace 提供阅读视图",
    description: "会话日志按时间收集运行事件，Trace 再把同一份记录翻成便于阅读的时间线。",
  };
}

function graphViewGuide(number: string, capabilityMounted: boolean): { eyebrow: string; title: string; description: string } {
  if (number === "05") {
    return capabilityMounted ? {
      eyebrow: "运行时实验 · 已挂载",
      title: "新能力已经进入当前 Context",
      description: "能力插件、它贡献的工具和 Prompt 同时出现。下一次模型请求会从这张新的能力快照编译。",
    } : {
      eyebrow: "运行时实验 · 基线或已卸载",
      title: "临时能力不在当前 Context 中",
      description: "能力插件与它的贡献一起消失。对照安装时的快照，可以检查卸载是否留下残余。",
    };
  }
  return {
    eyebrow: "插件内核 · 当前能力快照",
    title: "每项运行时能力都有明确归属",
    description: "圆心代表运行时 Context，外圈是已安装插件；下方清单把工具、服务和 Prompt 归到各自来源。",
  };
}

function parsePrimer(markdown: string, language: TutorialLanguage): {
  intro: string;
  cards: Array<{ title: string; code: string; body: string }>;
} {
  if (!markdown) return { intro: `${language === "python" ? "Python" : "TypeScript"} 阅读预检正在更新。`, cards: [] };
  const intro = markdown.split(/\n\s*\n/u)[1]?.trim() ?? "";
  const cards = [...markdown.matchAll(
    /##\s+([^\n]+)\n\s*```(?:ts|python)\n([\s\S]*?)```\n\s*([^\n][\s\S]*?)(?=\n##\s+|$)/gu,
  )].map((match) => ({
    title: match[1]?.trim() ?? "",
    code: match[2]?.trim() ?? "",
    body: match[3]?.trim().replace(/\n/gu, " ") ?? "",
  }));
  return { intro, cards };
}

function renderInlineCode(text: string) {
  return text.split(/(`[^`]+`)/gu).map((part, index) =>
    part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part,
  );
}

function isMobileTabActive(current: MobileTab, item: MobileTab): boolean {
  if (item === "more") return current !== "article";
  return current === item;
}

function formatLineRange(range: [number, number]): string {
  return range[0] === range[1] ? `第 ${range[0]} 行` : `第 ${range[0]}–${range[1]} 行`;
}


function toolNameLabel(name: string): string {
  return ({
    read_workspace_file: "读取工作区文件",
    apply_patch: "应用精确补丁",
    run_tests: "运行回归测试",
    submit_patch: "提交补丁",
    inspect_runtime: "检查运行环境",
    install_capability: "安装临时能力",
    remove_capability: "移除临时能力",
    get_time: "查询城市时间",
    read_note: "读取备忘录",
    word_count: "统计单词数",
    find_references: "查找调用方",
    check_types: "检查 TypeScript 类型",
  } as Record<string, string>)[name] ?? name;
}

function chapterName(number: string): string {
  return `第${chapterNumeral(number)}章`;
}

function chapterNumeral(number: string): string {
  return ({ "01": "一", "02": "二", "03": "三", "04": "四", "05": "五", "06": "六" } as Record<string, string>)[number] ?? number;
}

function requestPartLabel(part: RequestPart): string {
  if (part.kind === "system") return "系统规则";
  if (part.kind === "tools") return "可用动作与参数规则";
  if (part.kind === "dynamic") return "本步说明";
  if (part.label.startsWith("user")) return "用户消息";
  if (part.label.startsWith("assistant")) return "模型回复";
  if (part.label.startsWith("system")) return "历史摘要";
  if (part.label.startsWith("tool")) {
    const name = part.label.split(" · ")[1];
    return name ? `工具结果 · ${name}` : "工具结果";
  }
  return part.label;
}

function stabilityLabel(stability: RequestPart["stability"]): string {
  return {
    stable: "固定区",
    "append-only": "累积区",
    "step-variable": "本步区",
  }[stability];
}

function invalidationLabel(value: string | null): string {
  if (value === null) return "上一份请求完整保留在开头";
  if (value.startsWith("First request")) return "本章基线请求；从下一步开始比较前缀";
  return ({
    "System prompt": "系统规则",
    "Tool schemas": "可用动作与参数规则",
    "Step context": "本步说明",
    "Request end": "请求末尾",
  } as Record<string, string>)[value] ?? value
    .replace(/^user/u, "用户消息")
    .replace(/^assistant/u, "模型回复")
    .replace(/^tool/u, "工具结果");
}

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function diffClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  if (line.startsWith("@@")) return "hunk";
  return "";
}

function highlightCode(code: string, language: string): string {
  const grammar = Prism.languages[language] ?? Prism.languages.plain;
  return grammar ? Prism.highlight(code, grammar, language) : escapeHtml(code);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "markup",
    sh: "bash",
    bash: "bash",
    yaml: "yaml",
    yml: "yaml",
    py: "python",
  } as Record<string, string>)[extension ?? ""] ?? "typescript";
}

function diffLanguages(lines: string[], fallback: string): string[] {
  let current = fallback;
  return lines.map((line) => {
    const file = /^\+\+\+ b\/(.+)$/u.exec(line)?.[1];
    if (file) current = languageForPath(file);
    return current;
  });
}

function traceClass(type: string): string {
  if (type.startsWith("tool/")) return "tool";
  if (type.startsWith("runtime/")) return "runtime";
  if (type.startsWith("goal/")) return "goal";
  if (type === "request/header") return "request";
  return "";
}

function traceLabel(type: string): string {
  return ({
    "turn/start": "一轮开始",
    "turn/end": "一轮结束",
    "user/message": "用户输入",
    "step/start": "模型步骤开始",
    "step/end": "模型步骤结束",
    "request/header": "模型工作包",
    "assistant/message": "模型回复",
    "tool/call": "工具调用",
    "tool/result": "工具结果",
    "context/checkpoint": "上下文摘要点",
    "runtime/plugin-mounted": "能力已安装",
    "runtime/plugin-unmounted": "能力已移除",
    "goal/created": "任务已创建",
    "goal/round-started": "新一轮开始",
    "goal/status-changed": "任务状态变化",
  } as Record<string, string>)[type] ?? "过程事件";
}

function humanTraceTitle(item: Chapter["trace"][number]): string {
  if (item.type === "tool/call") return item.title.replace(/^call\s+/u, "请求使用 ");
  if (item.type === "tool/result") return item.title.replace(/^result\s+/u, "收到结果 · ");
  if (item.type === "goal/round-started") return item.title.replace(/^round\s+(\d+)\s*·/u, "第 $1 轮 ·");
  if (item.title === item.type) {
    const earlyStep = /^step\/(\d+)\/start$/u.exec(item.type);
    if (earlyStep) return `第 ${earlyStep[1]} 个模型步骤开始`;
    if (item.type === "llm/request") return "整理模型工作包";
    const tools = ({
      read_workspace_file: "读取工作区文件",
      apply_patch: "应用精确补丁",
      run_tests: "运行回归测试",
      submit_patch: "提交补丁",
      inspect_runtime: "检查运行环境",
      install_capability: "安装临时能力",
      remove_capability: "移除临时能力",
      find_references: "查找调用方",
      check_types: "检查 TypeScript 类型",
    } as Record<string, string>)[item.type];
    return tools ?? traceLabel(item.type);
  }
  return item.title;
}

function prettyPlugin(plugin: string): string {
  const known = ({
    "session-log": "过程日志",
    "runtime-tools": "实验工具",
    "trusted-capability-catalog": "受信任能力目录",
    "capability:word_count": "临时 · 分词统计",
    "checkout-workspace-state": "结账工作区状态",
    "checkout-workspace": "文件与补丁工具",
    "checkout-tests": "测试与提交工具",
  } as Record<string, string>)[plugin];
  if (known) return known;
  return plugin
    .replace(/^provider:/u, "模型 · ")
    .replace(/^capability:/u, "临时 · ")
    .replaceAll("-", " ");
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
