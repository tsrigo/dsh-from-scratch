import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Chapter,
  GraphSnapshot,
  PanelTab,
  RequestEvidence,
  TutorialData,
} from "./types.js";

const PANEL_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "source", label: "源码" },
  { id: "diff", label: "Diff" },
  { id: "request", label: "请求" },
  { id: "events", label: "事件 / Trace" },
  { id: "graph", label: "插件图" },
];

type MobileTab = "article" | PanelTab;

const MOBILE_TABS: Array<{ id: MobileTab; label: string }> = [
  { id: "article", label: "正文" },
  { id: "source", label: "源码" },
  { id: "diff", label: "Diff" },
  { id: "request", label: "请求" },
  { id: "events", label: "Trace" },
  { id: "graph", label: "插件图" },
];

export function App() {
  const [data, setData] = useState<TutorialData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState("m01");
  const [tab, setTab] = useState<PanelTab>("source");
  const [mobileTab, setMobileTab] = useState<MobileTab>("article");
  const [step, setStep] = useState(0);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    fetch("/generated/tutorial.json")
      .then((response) => {
        if (!response.ok) throw new Error(`tutorial data: ${response.status}`);
        return response.json() as Promise<TutorialData>;
      })
      .then(setData)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

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
            if (current !== id) setMobileTab("article");
            return id;
          });
          setStep(0);
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

  const navigateTo = (chapter: Chapter) => {
    sectionRefs.current.get(chapter.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveChapterId(chapter.id);
    setMobileTab("article");
  };

  return (
    <div className="app-shell">
      <Header data={data} activeId={activeChapter.id} onNavigate={navigateTo} />
      <main>
        <Hero data={data} onStart={() => navigateTo(data.chapters[0]!)} />
        <div className="learning-layout">
          <article className="chapters" aria-label="渐进教程">
            {data.chapters.map((chapter, index) => (
              <ChapterArticle
                key={chapter.id}
                chapter={chapter}
                {...(data.chapters[index - 1] ? { previous: data.chapters[index - 1] } : {})}
                active={activeChapter.id === chapter.id}
                mobileTab={activeChapter.id === chapter.id ? mobileTab : "article"}
                sectionRef={(node) => {
                  if (node) sectionRefs.current.set(chapter.id, node);
                }}
                onOpenPanel={(nextTab) => {
                  setActiveChapterId(chapter.id);
                  setTab(nextTab);
                  setMobileTab(nextTab);
                }}
                onMobileTab={(nextTab) => {
                  setActiveChapterId(chapter.id);
                  setMobileTab(nextTab);
                  if (nextTab !== "article") setTab(nextTab);
                }}
                step={step}
                onStep={setStep}
              />
            ))}
          </article>
          <aside className="evidence-dock" aria-label="同步证据面板">
            <EvidencePanel
              chapter={activeChapter}
              tab={tab}
              step={step}
              onTab={setTab}
              onStep={setStep}
            />
          </aside>
        </div>
      </main>
      <footer>
        <span>dsh / from scratch</span>
        <span>确定性 fake LLM · 静态证据 · 原创实现</span>
      </footer>
    </div>
  );
}

function Header({
  data,
  activeId,
  onNavigate,
}: {
  data: TutorialData;
  activeId: string;
  onNavigate: (chapter: Chapter) => void;
}) {
  return (
    <header className="site-header">
      <button className="wordmark" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <span className="wordmark-dot" />
        <span>dsh</span>
        <span className="wordmark-muted">/ from scratch</span>
      </button>
      <nav className="checkpoint-nav" aria-label="Checkpoint 导航">
        {data.chapters.map((chapter) => (
          <button
            key={chapter.id}
            className={activeId === chapter.id ? "active" : ""}
            onClick={() => onNavigate(chapter)}
            aria-current={activeId === chapter.id ? "step" : undefined}
          >
            <span>{chapter.number}</span>
            {chapter.shortTitle}
          </button>
        ))}
      </nav>
      <a className="repo-link" href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">
        上游参考 ↗
      </a>
    </header>
  );
}

function Hero({ data, onStart }: { data: TutorialData; onStart: () => void }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">NANO HARNESS · FIELD NOTES 001</p>
        <h1>
          把一次模型调用，
          <br />
          变成<span>可拆、可看、可回放</span>的 Harness。
        </h1>
        <p className="hero-intro">
          不会 Cordis 也没关系。我们围绕一宗离线可验证的火星中继站事故，
          从普通工具调用出发，六次只加入眼前真正缺少的机制。
        </p>
        <div className="hero-actions">
          <button className="primary-action" onClick={onStart}>开始调查 <span>↓</span></button>
          <span className="offline-badge"><i /> 无 API key 可运行</span>
        </div>
        <div className="hero-facts">
          <div><b>06</b><span>教学 checkpoints</span></div>
          <div><b>01</b><span>贯穿任务</span></div>
          <div><b>00</b><span>隐藏模型调用</span></div>
        </div>
      </div>
      <OrbitalIllustration />
      <p className="hero-caption">
        {data.project.scenario} · 所有请求、Trace 与图谱均由对应 checkpoint 的真实代码生成
      </p>
    </section>
  );
}

function OrbitalIllustration() {
  return (
    <div className="orbit-art" aria-label="中继站恢复路线示意图">
      <div className="orbit-grid" />
      <svg viewBox="0 0 600 540" role="img" aria-hidden="true">
        <defs>
          <filter id="glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <linearGradient id="path" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ebff64" /><stop offset="1" stopColor="#69d8c5" /></linearGradient>
        </defs>
        <circle cx="300" cy="282" r="176" className="orbit-line orbit-a" />
        <circle cx="300" cy="282" r="112" className="orbit-line orbit-b" />
        <path d="M77 414 C175 366 184 211 297 180 C393 153 421 249 525 93" className="signal-path" />
        <path d="M83 170 C185 235 213 329 316 366 C411 399 462 355 548 440" className="failed-path" />
        <circle cx="83" cy="414" r="9" className="node node-green" />
        <circle cx="297" cy="180" r="12" className="node node-green" />
        <circle cx="525" cy="93" r="15" className="node node-green" filter="url(#glow)" />
        <circle cx="83" cy="170" r="8" className="node node-muted" />
        <circle cx="316" cy="366" r="15" className="node node-failed" />
        <circle cx="548" cy="440" r="8" className="node node-muted" />
        <g transform="translate(316 366)"><path d="M-10 -10 L10 10 M10 -10 L-10 10" className="failure-x" /></g>
        <g className="satellite" transform="translate(265 250)">
          <rect x="-27" y="-19" width="54" height="38" rx="7" />
          <path d="M-28 -13 L-68 -30 L-68 30 L-28 13 M28 -13 L68 -30 L68 30 L28 13" />
          <circle cx="0" cy="0" r="9" />
          <path d="M0 -22 L0 -45 M-10 -45 L10 -45" />
        </g>
      </svg>
      <div className="art-label label-a"><b>ASTER</b><span>eligible route</span></div>
      <div className="art-label label-b"><b>RELAY-7</b><span>thermal drift</span></div>
      <div className="telemetry-strip"><span>T+35</span><i /><i /><i className="hot" /><i className="hot" /><b>79°C</b></div>
    </div>
  );
}

function ChapterArticle({
  chapter,
  previous,
  active,
  mobileTab,
  sectionRef,
  onOpenPanel,
  onMobileTab,
  step,
  onStep,
}: {
  chapter: Chapter;
  previous?: Chapter;
  active: boolean;
  mobileTab: MobileTab;
  sectionRef: (node: HTMLElement | null) => void;
  onOpenPanel: (tab: PanelTab) => void;
  onMobileTab: (tab: MobileTab) => void;
  step: number;
  onStep: (step: number) => void;
}) {
  const lesson = parseLesson(chapter.lesson);
  return (
    <section
      ref={sectionRef}
      data-chapter={chapter.id}
      id={chapter.id}
      className={`chapter ${active ? "active" : ""}`}
    >
      <div className="chapter-rail">
        <span>{chapter.number}</span><i />
      </div>
      <div className="chapter-content">
        <div className="chapter-kicker">
          <span>CHECKPOINT {chapter.number}</span>
          <span>{chapter.commit.slice(0, 7)} · {chapter.tag}</span>
        </div>
        <div className="mobile-switcher" role="tablist" aria-label="移动端章节视图">
          {MOBILE_TABS.map((item) => (
            <button
              key={item.id}
              className={mobileTab === item.id ? "active" : ""}
              onClick={() => onMobileTab(item.id)}
              aria-selected={mobileTab === item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className={`chapter-body ${mobileTab === "article" ? "mobile-active" : ""}`}>
          <h2>{chapter.title}</h2>
          <p className="chapter-question">{chapter.question}</p>
          {previous && (
            <div className="pressure-note">
              <span>前一步留下的问题</span>
              {pressureText(chapter.id)}
            </div>
          )}
          <div className="lesson-copy">
            {lesson.map((block, index) =>
              block.kind === "heading" ? (
                <h3 key={index}>{block.text}</h3>
              ) : (
                <p key={index}>{renderInlineCode(block.text)}</p>
              ),
            )}
          </div>
          {chapter.id === "m01" && chapter.ptc && <ModeContrast chapter={chapter} />}
          {chapter.id === "m02" && <ContextCutaway request={chapter.requests[1] ?? chapter.requests[0]!} />}
          {chapter.id === "m03" && <PresetAssembly />}
          {chapter.id === "m05" && <ExperimentSequence />}
          {chapter.id === "m06" && <RoundSequence />}
          <div className="chapter-verdict">
            <span className="verdict-mark">✓</span>
            <div><small>FAKE SCENARIO VERDICT</small><strong>{chapter.verdict}</strong></div>
            <button onClick={() => onOpenPanel(chapter.events.length ? "events" : "request")}>查看证据 →</button>
          </div>
        </div>
        <div className={`mobile-panel ${mobileTab !== "article" ? "mobile-active" : ""}`}>
          {mobileTab !== "article" && (
            <EvidencePanel
              chapter={chapter}
              tab={mobileTab}
              step={step}
              onTab={onOpenPanel}
              onStep={onStep}
              compact
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ModeContrast({ chapter }: { chapter: Chapter }) {
  return (
    <div className="mode-contrast">
      <div><span>标准模式 · Nano 实现</span><b>schema → call → result</b><p>{chapter.ptc?.comparison.standard}</p></div>
      <div className="mode-arrow">same tools<br />different surface →</div>
      <div><span>PTC · 静态对照</span><b>Code Mode SDK</b><p>{chapter.ptc?.comparison.ptc}</p></div>
      <p className="boundary-note">{chapter.ptc?.comparison.nanoBoundary}</p>
      <pre className="ptc-program"><code>{chapter.ptc?.program}</code></pre>
    </div>
  );
}

function ContextCutaway({ request }: { request: RequestEvidence }) {
  return (
    <div className="context-cutaway">
      <p><span /> stable prefix <i /> append-only <b /> step-variable</p>
      <div className="request-bar">
        {request.parts.map((part) => (
          <span key={part.id} className={part.stability} style={{ flexGrow: part.approximateTokens }} title={`${part.label}: ≈${part.approximateTokens} tokens`} />
        ))}
      </div>
      <small>≈ {request.totalApproximateTokens} tokens · 教学估算，不是 provider usage</small>
    </div>
  );
}

function PresetAssembly() {
  return (
    <div className="preset-grid">
      <div><b>标准</b><span>完整编码能力组装</span></div>
      <div><b>PTC</b><span>同等能力，Code Mode 呈现</span></div>
      <div><b>极简</b><span>主动删减后的极小组装</span></div>
      <div><b>创造</b><span>标准 + 检查 + 实验 + 指导</span></div>
    </div>
  );
}

function ExperimentSequence() {
  return (
    <div className="sequence-strip">
      <span>inspect</span><i>→</i><span>install</span><i>→</i><strong>score_routes</strong><i>→</i><span>remove</span><i>→</i><span>submit</span>
    </div>
  );
}

function RoundSequence() {
  return (
    <div className="round-strip">
      <div><b>01</b><span>survey</span></div><i />
      <div><b>02</b><span>score</span></div><i />
      <div><b>03</b><span>submit</span></div>
      <strong>completed</strong>
    </div>
  );
}

function EvidencePanel({
  chapter,
  tab,
  step,
  onTab,
  onStep,
  compact = false,
}: {
  chapter: Chapter;
  tab: PanelTab;
  step: number;
  onTab: (tab: PanelTab) => void;
  onStep: (step: number) => void;
  compact?: boolean;
}) {
  const maxSteps = Math.max(chapter.requests.length, chapter.graphs.length, 1);
  const safeStep = Math.min(step, maxSteps - 1);
  return (
    <div className={`panel-shell ${compact ? "compact" : ""}`}>
      <div className="panel-topline">
        <div><i /> LIVE FROM <b>{chapter.tag}</b></div>
        <span>{chapter.commit.slice(0, 7)}</span>
      </div>
      <div className="panel-tabs" role="tablist">
        {PANEL_TABS.map((item) => {
          const unavailable = (item.id === "events" && chapter.events.length === 0) || (item.id === "graph" && chapter.graphs.length === 0);
          return (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => onTab(item.id)}
              aria-selected={tab === item.id}
              title={unavailable ? "这个 checkpoint 尚未引入该机制" : undefined}
            >
              {item.label}{unavailable ? " ·" : ""}
            </button>
          );
        })}
      </div>
      {(tab === "request" || tab === "graph") && maxSteps > 1 && (
        <div className="step-picker">
          <span>STEP</span>
          {Array.from({ length: maxSteps }, (_, index) => (
            <button key={index} className={safeStep === index ? "active" : ""} onClick={() => onStep(index)}>{index + 1}</button>
          ))}
        </div>
      )}
      <div className="panel-content">
        {tab === "source" && <CodeView code={chapter.source.content} label={chapter.source.path} />}
        {tab === "diff" && <CodeView code={chapter.diff} label={`${chapter.previousTag} → ${chapter.tag}`} diff />}
        {tab === "request" && <RequestView evidence={chapter.requests[safeStep] ?? chapter.requests[0]!} />}
        {tab === "events" && <TraceView chapter={chapter} />}
        {tab === "graph" && <GraphView {...(chapter.graphs[safeStep] ? { graph: chapter.graphs[safeStep] } : {})} chapter={chapter} />}
      </div>
    </div>
  );
}

function CodeView({ code, label, diff = false }: { code: string; label: string; diff?: boolean }) {
  const lines = code.split("\n");
  return (
    <div className="code-view">
      <div className="file-label"><span>{label}</span><button onClick={() => navigator.clipboard?.writeText(code)}>复制</button></div>
      <pre>{lines.map((line, index) => (
        <div key={index} className={diff ? diffClass(line) : ""}><span className="line-no">{String(index + 1).padStart(3, "0")}</span><code>{line || " "}</code></div>
      ))}</pre>
    </div>
  );
}

function RequestView({ evidence }: { evidence: RequestEvidence }) {
  return (
    <div className="request-view">
      <div className="request-metrics">
        <div><small>TOTAL · ESTIMATE</small><b>≈ {evidence.totalApproximateTokens}</b><span>tokens</span></div>
        <div><small>SHARED PREFIX</small><b>≈ {evidence.prefix.sharedApproximateTokens}</b><span>tokens</span></div>
      </div>
      <p className="estimate-warning">估算值 · 最长规范化相同前缀 · 未查询 provider cache</p>
      <div className="request-parts">
        {evidence.parts.map((part) => (
          <details key={part.id} open={part.kind !== "message" || evidence.step < 3} className={part.stability}>
            <summary><span>{part.label}</span><small>{part.stability} · ≈{part.approximateTokens}</small></summary>
            <pre>{formatJson(part.value)}</pre>
          </details>
        ))}
      </div>
      <div className="invalidation">
        first change <b>{evidence.prefix.firstInvalidation ?? "append-only boundary"}</b>
      </div>
    </div>
  );
}

function TraceView({ chapter }: { chapter: Chapter }) {
  if (chapter.events.length === 0) {
    return <EmptyMechanism number={chapter.id === "m03" ? "04" : "04"} title="Session Events 尚未出现" text="这个 checkpoint 仍使用当时的本地 Trace。M04 会把只追加 Session Log 变成唯一历史来源。" fallback={chapter.trace} />;
  }
  return (
    <div className="trace-view">
      <div className="trace-summary"><b>{chapter.events.length}</b> immutable events <span>→</span> <b>{chapter.requests.length}</b> rebuilt requests</div>
      <ol>
        {chapter.trace.map((item) => (
          <li key={`${item.eventId}-${item.type}`} className={traceClass(item.type)}>
            <span>{String(item.eventId).padStart(2, "0")}</span>
            <i />
            <div>
              <small>{item.type}</small><b>{item.title}</b>
              {item.detail && (
                item.detail.length > 150 ? (
                  <details className="trace-payload">
                    <summary>{truncate(item.detail, 150)}</summary>
                    <pre>{item.detail}</pre>
                  </details>
                ) : <p>{item.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function GraphView({ graph, chapter }: { graph?: GraphSnapshot; chapter: Chapter }) {
  if (!graph) {
    return <EmptyMechanism number="03" title="插件图尚未出现" text="M01–M02 仍是直接装配。M03 才让服务、工具、Prompt 与 listener 拥有统一生命周期。" />;
  }
  const capability = graph.plugins.find((plugin) => plugin.startsWith("capability:"));
  return (
    <div className="graph-view">
      <div className="graph-stage">
        <div className="graph-core">Context<span>{chapter.id.toUpperCase()}</span></div>
        {graph.plugins.map((plugin, index) => (
          <div key={plugin} className={`graph-node plugin ${plugin.startsWith("capability:") ? "capability" : ""}`} style={{ "--i": index } as React.CSSProperties}>
            <i />{prettyPlugin(plugin)}
          </div>
        ))}
      </div>
      <div className="graph-ledger">
        <section><small>TOOLS · {graph.tools.length}</small>{graph.tools.map((tool) => <span key={tool.name}>{tool.name}</span>)}</section>
        <section><small>SERVICES · {graph.services.length}</small>{graph.services.map((service) => <span key={service.name}>{service.name}</span>)}</section>
        <section><small>PROMPT CONTRIBUTIONS · {graph.prompts.length}</small>{graph.prompts.map((prompt, index) => <span key={prompt.id ?? index}>{truncate(prompt.text, 48)}</span>)}</section>
      </div>
      {chapter.id === "m05" && (
        <p className={`capability-state ${capability ? "mounted" : "removed"}`}>
          <i /> route_scoring {capability ? "mounted — next request includes score_routes" : "not mounted"}
        </p>
      )}
    </div>
  );
}

function EmptyMechanism({
  number,
  title,
  text,
  fallback,
}: {
  number: string;
  title: string;
  text: string;
  fallback?: Chapter["trace"];
}) {
  return (
    <div className="empty-mechanism">
      <span>COMING IN M{number}</span><h3>{title}</h3><p>{text}</p>
      {fallback && <div className="early-trace">{fallback.slice(0, 7).map((item) => <small key={item.eventId}>{item.title}</small>)}</div>}
    </div>
  );
}

function LoadFailure({ message }: { message: string }) {
  return <div className="load-state"><b>数据没有装载</b><span>{message}</span><p>先运行 pnpm tutorial:generate。</p></div>;
}

function Loading() {
  return <div className="load-state"><b>正在装载 checkpoint 证据…</b><span>no model call is made</span></div>;
}

function parseLesson(markdown: string): Array<{ kind: "heading" | "paragraph"; text: string }> {
  return markdown
    .split(/\n\s*\n/u)
    .slice(1)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({
      kind: block.startsWith("## ") ? "heading" : "paragraph",
      text: block.replace(/^##\s+/u, "").replace(/\n/gu, " "),
    }));
}

function renderInlineCode(text: string) {
  return text.split(/(`[^`]+`)/gu).map((part, index) =>
    part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part,
  );
}

function pressureText(id: string): string {
  return {
    m02: "遥测结果被整段带进每个后续请求，稳定与变化的输入混在一起。",
    m03: "工具数组能工作，却不知道谁注册了它，也无法保证卸载和失败回滚。",
    m04: "Agent 内部还藏着 messages 数组，请求和 Trace 没有共同的权威来源。",
    m05: "固定组装无法在运行时验证评分能力，又不能开放任意代码加载。",
    m06: "一次 turn 难以表达调查、评分、提交的跨阶段进度与停止原因。",
  }[id] ?? "";
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

function traceClass(type: string): string {
  if (type.startsWith("tool/")) return "tool";
  if (type.startsWith("runtime/")) return "runtime";
  if (type.startsWith("goal/")) return "goal";
  if (type === "request/header") return "request";
  return "";
}

function prettyPlugin(plugin: string): string {
  return plugin.replace(/^provider:/u, "provider · ").replace(/^capability:/u, "+ ").replaceAll("-", " ");
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
