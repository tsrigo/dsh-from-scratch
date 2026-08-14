import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-yaml.js";
import type {
  Chapter,
  GraphSnapshot,
  PanelTab,
  RequestEvidence,
  RequestPart,
  TutorialData,
} from "./types.js";

const PANEL_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "source", label: "跟着写" },
  { id: "diff", label: "变化" },
  { id: "request", label: "请求" },
  { id: "events", label: "事件" },
  { id: "graph", label: "能力关系" },
];

type MobileTab = "article" | PanelTab | "more";

const MOBILE_TABS: Array<{ id: MobileTab; label: string }> = [
  { id: "article", label: "正文" },
  { id: "source", label: "跟着写" },
  { id: "more", label: "延伸阅读" },
];

export function App() {
  const [data, setData] = useState<TutorialData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState("chapter-1");
  const [tab, setTab] = useState<PanelTab>("source");
  const [mobileTabs, setMobileTabs] = useState<Record<string, MobileTab>>({});
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
            if (current !== id) {
              setStep(0);
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

  const navigateTo = (chapter: Chapter) => {
    setActiveChapterId(chapter.id);
    setMobileTabs({});
    setStep(0);
    const compact = window.matchMedia("(max-width: 960px)").matches;
    const scroll = () => sectionRefs.current.get(chapter.id)?.scrollIntoView({
      behavior: compact ? "auto" : "smooth",
      block: "start",
    });
    if (compact) requestAnimationFrame(scroll);
    else scroll();
  };

  return (
    <div className="app-shell">
      <Header data={data} activeId={activeChapter.id} onNavigate={navigateTo} />
      <main>
        <Hero data={data} onStart={() => navigateTo(data.chapters[0]!)} />
        <TypeScriptPrimer markdown={data.project.primer ?? ""} />
        <BuildPrelude chapters={data.chapters} onStart={() => navigateTo(data.chapters[0]!)} />
        <div className="learning-layout">
          <article className="chapters" aria-label="渐进教程">
            {data.chapters.map((chapter, index) => (
              <ChapterArticle
                key={chapter.id}
                chapter={chapter}
                hasPrevious={index > 0}
                active={activeChapter.id === chapter.id}
                mobileTab={mobileTabs[chapter.id] ?? "article"}
                sectionRef={(node) => {
                  if (node) sectionRefs.current.set(chapter.id, node);
                }}
                onOpenPanel={(nextTab) => {
                  setActiveChapterId(chapter.id);
                  setTab(nextTab);
                  setMobileTabs((current) => ({ ...current, [chapter.id]: nextTab }));
                }}
                onMobileTab={(nextTab) => {
                  setActiveChapterId(chapter.id);
                  setMobileTabs((current) => ({ ...current, [chapter.id]: nextTab }));
                  if (nextTab !== "article") setTab(nextTab);
                }}
                step={step}
                onStep={setStep}
              />
            ))}
          </article>
          <aside className="evidence-dock" aria-label="随章节更新的学习面板">
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
        <span>Harness Lab · 从零搭建</span>
        <span>确定性模型模拟器 · 静态学习样本 · 原创实现</span>
      </footer>
    </div>
  );
}

function TypeScriptPrimer({ markdown }: { markdown: string }) {
  const sections = parsePrimer(markdown);
  return (
    <section className="typescript-primer" aria-labelledby="typescript-primer-title">
      <div className="primer-heading">
        <p className="eyebrow">阅读预检 · 约 3 分钟</p>
        <h2 id="typescript-primer-title">TypeScript 不熟？先认四个路标。</h2>
        <p>{sections.intro}</p>
      </div>
      <div className="primer-cards">
        {sections.cards.map((card, index) => (
          <article key={card.title}>
            <span>路标 {index + 1}</span>
            <h3>{card.title}</h3>
            <pre><SyntaxCode code={card.code} language="typescript" /></pre>
            <p>{renderInlineCode(card.body)}</p>
          </article>
        ))}
      </div>
      <div className="primer-flow" aria-label="一次模型步骤的阅读顺序">
        <span>用户目标</span><i>→</i><span>模型请求</span><i>→</i><span>工具动作</span><i>→</i><span>过程事件</span><i>→</i><span>下一步</span>
      </div>
    </section>
  );
}

function BuildPrelude({ chapters, onStart }: { chapters: Chapter[]; onStart: () => void }) {
  const [scaffolded, setScaffolded] = useState(false);
  return (
    <section className={`build-prelude ${scaffolded ? "scaffolded" : ""}`} aria-labelledby="build-prelude-title">
      <div className="build-prelude-copy">
        <p className="eyebrow">先导 · 第 0 步</p>
        <h2 id="build-prelude-title">从六个空文件开始。</h2>
        <p>先搭出目录，暂时不塞进整套实现。后面每一章只盯住一个主文件，让这个运行框架一层一层长出来。</p>
        <div className="prelude-actions">
          {!scaffolded ? (
            <button onClick={() => setScaffolded(true)}>搭好空架子</button>
          ) : (
            <button onClick={onStart}>开始写第一个文件</button>
          )}
          <span>{scaffolded ? "六个文件已就位，先写 agent.ts" : "点击后查看本教程的搭建顺序"}</span>
        </div>
      </div>
      <div className="scaffold-tree" aria-live="polite">
        <b>src/</b>
        {chapters.map((chapter, index) => (
          <div key={chapter.id} style={{ "--file-index": index } as CSSProperties}>
            <i>{scaffolded ? "✓" : ""}</i>
            <code>{chapter.source.path.replace(/^src\//u, "")}</code>
            <span>第{chapterNumeral(chapter.number)}章 · {chapter.shortTitle}</span>
          </div>
        ))}
      </div>
    </section>
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
        <span>Harness Lab</span>
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
      <a className="repo-link" href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">
        上游项目 ↗
      </a>
    </header>
  );
}

function Hero({ data, onStart }: { data: TutorialData; onStart: () => void }) {
  const requestCount = data.chapters.reduce((sum, chapter) => sum + chapter.requests.length, 0);
  const eventCount = data.chapters.reduce((sum, chapter) => sum + chapter.events.length, 0);
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">从零搭建 · 可运行教程</p>
        <h1>
          <span className="hero-line">看懂一次模型调用，</span>
          <span className="hero-line">如何一步步</span>
          <span className="hero-line hero-line-accent">完成复杂任务。</span>
        </h1>
        <p className="hero-intro">
          Agent Harness（智能体运行框架）负责整理模型输入、执行工具、保存过程。
          这套教程用一宗火星中继站事故，分六章拆开它的工作方式。
        </p>
        <div className="hero-actions">
          <button className="primary-action" onClick={onStart}>从第一章开始 <span>↓</span></button>
          <span className="offline-badge"><i /> 离线学习样本可直接查看</span>
        </div>
        <div className="hero-facts">
          <div><b>{data.chapters.length}</b><span>渐进章节</span></div>
          <div><b>{requestCount}</b><span>模型请求样本</span></div>
          <div><b>{eventCount}</b><span>过程事件样本</span></div>
        </div>
      </div>
      <OrbitalIllustration />
      <p className="hero-caption">
        {data.project.scenario} · 每份样本都由对应章节的真实代码生成
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
          <linearGradient id="path" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7dd3fc" /><stop offset="1" stopColor="#4f8cff" /></linearGradient>
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
      <div className="art-label label-a"><b>ASTER</b><span>可用候选路线</span></div>
      <div className="art-label label-b"><b>RELAY-7</b><span>出现热漂移</span></div>
      <div className="telemetry-strip"><span>T+35</span><i /><i /><i className="hot" /><i className="hot" /><b>79°C</b></div>
    </div>
  );
}

function ChapterArticle({
  chapter,
  hasPrevious,
  active,
  mobileTab,
  sectionRef,
  onOpenPanel,
  onMobileTab,
  step,
  onStep,
}: {
  chapter: Chapter;
  hasPrevious: boolean;
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
          <div className="reading-order" aria-label="推荐阅读顺序">
            <span><b>1</b>读本章说明</span><i>→</i>
            <span><b>2</b>跟三处代码</span><i>→</i>
            <span><b>3</b>运行固定样本</span>
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
          {hasPrevious && (
            <div className="pressure-note">
              <span>上一章留下的限制</span>
              {pressureText(chapter.number)}
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
          {chapter.number === "01" && chapter.ptc && <ModeContrast program={chapter.ptc.program} />}
          {chapter.number === "02" && <ContextCutaway request={chapter.requests[1] ?? chapter.requests[0]!} />}
          {chapter.number === "03" && <PresetAssembly />}
          {chapter.number === "05" && <ExperimentSequence />}
          {chapter.number === "06" && <RoundSequence />}
          <ChapterRun chapter={chapter} onOpenPanel={onOpenPanel} />
        </div>
        <div className={`mobile-panel ${mobileTab !== "article" ? "mobile-active" : ""}`}>
          {mobileTab === "more" && <MoreEvidence chapter={chapter} onSelect={onMobileTab} />}
          {mobileTab !== "article" && mobileTab !== "more" && (
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

function ChapterRun({ chapter, onOpenPanel }: { chapter: Chapter; onOpenPanel: (tab: PanelTab) => void }) {
  const narrative = runNarrative(chapter.number);
  const [phase, setPhase] = useState(0);
  const complete = phase > narrative.steps.length;
  const activeStep = complete ? null : narrative.steps[phase - 1];
  const buttonLabel = complete
    ? "重新运行"
    : phase === 0
      ? "开始运行"
      : phase === narrative.steps.length
        ? "查看结果"
        : "下一步";
  const advance = () => setPhase((current) => current > narrative.steps.length ? 1 : current + 1);

  return (
    <section className={`chapter-run ${phase > 0 ? "started" : ""} ${complete ? "complete" : ""}`}>
      <div className="run-heading">
        <div>
          <small>动手检查</small>
          <h3>{narrative.title}</h3>
        </div>
        <span>固定样本 · 不调用模型服务</span>
      </div>
      <ol>
        {narrative.steps.map((item, index) => (
          <li
            key={item.label}
            className={complete || index < phase - 1 ? "done" : index === phase - 1 ? "current" : ""}
          >
            <i>{complete || index < phase - 1 ? "✓" : index + 1}</i>
            <span>{item.label}</span>
          </li>
        ))}
      </ol>
      <p className="run-message" aria-live="polite">
        {complete
          ? <><b>{narrative.result}</b><span>{narrative.resultDetail}</span></>
          : activeStep
            ? <><b>{activeStep.label}</b><span>{activeStep.detail}</span></>
            : <span>点击“开始运行”，按顺序查看输入、执行动作和结果。</span>}
      </p>
      <div className="run-actions">
        <button className="run-primary" onClick={advance}>{buttonLabel}</button>
        <button className="run-secondary" onClick={() => onOpenPanel(chapter.events.length ? "events" : "request")}>
          {chapter.events.length ? "打开这次运行的时间线" : "查看这次模型输入"}
        </button>
      </div>
    </section>
  );
}

function MoreEvidence({ chapter, onSelect }: { chapter: Chapter; onSelect: (tab: MobileTab) => void }) {
  const descriptions: Record<Exclude<PanelTab, "source">, string> = {
    diff: "看看这一章改了哪些文件",
    request: "拆开模型收到的工作包",
    events: "按时间回看运行过程",
    graph: "查看工具和服务来自哪里",
  };
  return (
    <section className="mobile-more">
      <span>按需打开</span>
      <h3>这些内容不影响主线阅读</h3>
      <p>先完成正文和“跟着写”。需要核对实现时，再从下面选一项。</p>
      <div>
        {PANEL_TABS.slice(1).map((item) => (
          <button key={item.id} onClick={() => onSelect(item.id)}>
            <b>{item.label}</b>
            <span>{descriptions[item.id as Exclude<PanelTab, "source">]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ModeContrast({ program }: { program: string }) {
  return (
    <section className="mode-contrast" aria-label="两种工具呈现方式">
      <div className="mode-intro">
        <span>概念补充</span>
        <p>程序化工具调用（Programmatic Tool Calling，PTC）允许模型用程序组合多个工具。Code Mode 软件开发工具包（Software Development Kit，SDK）提供程序可以调用的工具接口。</p>
      </div>
      <div><span>标准模式 · 本教程可运行</span><b>逐项选择工具</b><p>模型返回一个或多个工具调用，运行框架逐个校验和执行。</p></div>
      <div className="mode-arrow">同一组能力<br />两种交互方式</div>
      <div><span>PTC · 概念示例</span><b>用程序组合工具</b><p>模型生成 TypeScript，通过工具接口表达条件、循环和多步动作。</p></div>
      <details className="ptc-example">
        <summary>展开静态代码示例</summary>
        <pre><SyntaxCode code={program} language="typescript" /></pre>
      </details>
    </section>
  );
}

function ContextCutaway({ request }: { request: RequestEvidence }) {
  return (
    <div className="context-cutaway">
      <p><span /> 固定区 <i /> 累积区 <b /> 本步区</p>
      <div className="request-bar">
        {request.parts.map((part) => (
          <span key={part.id} className={part.stability} style={{ flexGrow: part.approximateTokens }} title={`${requestPartLabel(part)}：约 ${part.approximateTokens} token`} />
        ))}
      </div>
      <small>约 {request.totalApproximateTokens} token · 用于比较体积的教学估算</small>
    </div>
  );
}

function PresetAssembly() {
  return (
    <div className="preset-grid">
      <div><b>标准</b><span>完整编码能力组装</span></div>
      <div><b>程序化调用</b><span>同一能力目录，提供程序接口</span></div>
      <div><b>极简</b><span>主动删减后的轻量组装</span></div>
      <div><b>创造</b><span>标准组装加检查、实验与指导</span></div>
    </div>
  );
}

function ExperimentSequence() {
  return (
    <div className="sequence-strip" aria-label="临时能力实验顺序">
      <span>检查环境</span><i>→</i><span>安装评分能力</span><i>→</i><strong>执行路线评分</strong><i>→</i><span>移除能力</span><i>→</i><span>提交方案</span>
    </div>
  );
}

function RoundSequence() {
  return (
    <div className="round-strip">
      <div><b>第一轮</b><span>调查</span></div><i />
      <div><b>第二轮</b><span>评分</span></div><i />
      <div><b>第三轮</b><span>提交</span></div>
      <strong>完成</strong>
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
        <div><i /> 本章可核验样本</div>
        <span>{chapterName(chapter.number)}</span>
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
              title={unavailable ? "这项机制会在后续章节加入" : undefined}
            >
              {item.label}{unavailable ? " ·" : ""}
            </button>
          );
        })}
      </div>
      {(tab === "request" || tab === "graph") && maxSteps > 1 && (
        <div className="step-picker">
          <span>模型步骤</span>
          {Array.from({ length: maxSteps }, (_, index) => (
            <button key={index} className={safeStep === index ? "active" : ""} onClick={() => onStep(index)}>{index + 1}</button>
          ))}
        </div>
      )}
      <div className="panel-content">
        {tab === "source" && <SourceView chapter={chapter} />}
        {tab === "diff" && <DiffView chapter={chapter} />}
        {tab === "request" && <RequestView evidence={chapter.requests[safeStep] ?? chapter.requests[0]!} />}
        {tab === "events" && <TraceView chapter={chapter} />}
        {tab === "graph" && <GraphView {...(chapter.graphs[safeStep] ? { graph: chapter.graphs[safeStep] } : {})} chapter={chapter} />}
      </div>
    </div>
  );
}

function SourceView({ chapter }: { chapter: Chapter }) {
  const lineCount = chapter.source.content.trimEnd().split("\n").length;
  return (
    <div className="source-view">
      <section className="panel-intro">
        <span>先看它带来的变化</span>
        <h3>{chapter.codeGuide.title}</h3>
        <p>{chapter.codeGuide.description}</p>
        <ol>
          {chapter.codeGuide.observations.map((observation) => <li key={observation}>{observation}</li>)}
        </ol>
      </section>
      <div className="focus-code">
        <div className="file-label">
          <span>{chapter.source.path} · 第 {chapter.source.startLine}–{chapter.source.endLine} 行</span>
          <button onClick={() => navigator.clipboard?.writeText(chapter.source.excerpt)}>复制片段</button>
        </div>
        <CodeBlock code={chapter.source.excerpt} startLine={chapter.source.startLine} language={languageForPath(chapter.source.path)} />
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

function DiffView({ chapter }: { chapter: Chapter }) {
  const { diffStats, changeStory } = chapter;
  return (
    <div className="diff-view">
      <section className="panel-intro change-intro">
        <span>这一章给使用者带来什么</span>
        <h3>{changeStory.title}</h3>
        <p>{changeStory.summary}</p>
      </section>
      <div className="change-metrics" aria-label="代码改动规模">
        <div><b>{diffStats.filesChanged}</b><span>个文件有改动</span></div>
        <div><b>+{diffStats.additions}</b><span>行新增</span></div>
        <div><b>{diffStats.deletions}</b><span>行删除</span></div>
      </div>
      <ul className="outcome-list">
        {changeStory.outcomes.map((outcome) => <li key={outcome}><i>✓</i><span>{outcome}</span></li>)}
      </ul>
      <details className="technical-details diff-details">
        <summary><span>工程证据</span><b>查看文件清单与逐行代码差异（Diff）</b></summary>
        <div className="details-body">
          <div className="file-stats">
            {diffStats.files.map((file) => (
              <div key={file.path}><span>{file.path}</span><b>+{file.additions} / −{file.deletions}</b></div>
            ))}
          </div>
          <p className="details-note">逐行差异保留实现细节；内部版本名已经从公开视图中隐藏。</p>
          <div className="file-label">
            <span>本章逐行差异</span>
            <button onClick={() => navigator.clipboard?.writeText(chapter.diff)}>复制差异</button>
          </div>
          <CodeBlock code={chapter.diff} diff />
        </div>
      </details>
    </div>
  );
}

function CodeBlock({
  code,
  startLine = 1,
  diff = false,
  language = "typescript",
}: {
  code: string;
  startLine?: number;
  diff?: boolean;
  language?: string;
}) {
  const lines = code.trimEnd().split("\n");
  const languages = diffLanguages(lines, language);
  return (
    <div className="code-lines" role="region" aria-label={diff ? "逐行代码差异" : "源代码"}>
      {lines.map((line, index) => (
        <div key={index} className={diff ? diffClass(line) : ""}>
          <span className="line-no">{String(startLine + index).padStart(3, "0")}</span>
          {diff
            ? <DiffCodeLine line={line} language={languages[index] ?? language} />
            : <SyntaxCode code={line || " "} language={language} />}
        </div>
      ))}
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

function RequestView({ evidence }: { evidence: RequestEvidence }) {
  return (
    <div className="request-view">
      <section className="panel-intro concept-intro">
        <span>先认识“模型请求”</span>
        <h3>一次请求，就是交给模型的一份工作包</h3>
        <p>它把规则、可用动作、已有记录和本步说明装在一起。模型读完这份工作包后，返回文字回复或工具调用。</p>
      </section>
      <div className="request-anatomy">
        <div className="stable"><b>固定区</b><span>系统规则、工具说明</span></div>
        <div className="append-only"><b>累积区</b><span>用户、模型与工具记录</span></div>
        <div className="step-variable"><b>本步区</b><span>只服务于当前步骤的说明</span></div>
      </div>
      <p className="request-step-title">第 {evidence.step} 次模型请求</p>
      <div className="request-metrics">
        <div><small>整份工作包</small><b>约 {evidence.totalApproximateTokens}</b><span>token</span></div>
        <div><small>与上次相同的开头</small><b>约 {evidence.prefix.sharedApproximateTokens}</b><span>token</span></div>
      </div>
      <p className="estimate-warning">Token 是模型处理文本时使用的计量单位。这里按字符估算，便于比较大小；相同开头只表示提示词缓存（Prompt Cache）具备复用机会。</p>
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

function TraceView({ chapter }: { chapter: Chapter }) {
  return (
    <div className="trace-view">
      <section className="panel-intro concept-intro">
        <span>先认识“事件”和“轨迹”</span>
        <h3>事件是过程收据，轨迹是阅读时间线</h3>
        <p>会话事件（Session Event）记录一次已发生动作；会话日志（Session Log）按时间收集这些记录；执行轨迹（Trace）把同一份日志翻成便于阅读的时间线。</p>
      </section>
      {chapter.events.length === 0 ? (
        <EmptyMechanism
          title="可重建的会话事件会在后续章节加入"
          text="这一章先保存本地执行轨迹。第四章会让用户消息、模型请求、工具结果和能力变化进入同一条只追加日志。"
          fallback={chapter.trace}
        />
      ) : (
        <>
          <div className="trace-summary"><b>{chapter.events.length}</b> 条过程收据 <span>生成</span> <b>{chapter.requests.length}</b> 份可重建请求</div>
          <ol>
            {chapter.trace.map((item) => (
              <li key={`${item.eventId}-${item.type}`} className={traceClass(item.type)}>
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
            ))}
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
  return (
    <div className="graph-view">
      <section className="panel-intro graph-intro">
        <span>当前能力快照</span>
        <h3>查看工具、服务和提示词的归属</h3>
        <p>圆心代表运行环境，外圈节点代表已安装插件。下方清单列出这一步当前可用的能力。</p>
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
          <i /> 路线评分能力{capability ? "已安装；下一次请求会出现评分工具" : "已移除；工具目录已经恢复"}
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
  return <div className="load-state"><b>正在装载学习样本…</b><span>页面不会发起模型调用</span></div>;
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

function parsePrimer(markdown: string): {
  intro: string;
  cards: Array<{ title: string; code: string; body: string }>;
} {
  if (!markdown) return { intro: "TypeScript 阅读预检正在更新。", cards: [] };
  const intro = markdown.split(/\n\s*\n/u)[1]?.trim() ?? "";
  const cards = [...markdown.matchAll(
    /##\s+([^\n]+)\n\s*```ts\n([\s\S]*?)```\n\s*([^\n][\s\S]*?)(?=\n##\s+|$)/gu,
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
  if (item === "more") return current === "more" || (current !== "article" && current !== "source");
  return current === item;
}

interface RunNarrative {
  title: string;
  steps: Array<{ label: string; detail: string }>;
  result: string;
  resultDetail: string;
}

function runNarrative(number: string): RunNarrative {
  const narratives: Record<string, RunNarrative> = {
    "01": {
      title: "跑一次“读取—提交—收尾”",
      steps: [
        { label: "读取事故包", detail: "模型选择 read_incident_packet，运行框架执行这个工具。" },
        { label: "提交恢复方案", detail: "工具结果回到下一次模型输入，模型据此提交 ASTER 路线。" },
        { label: "结束本轮", detail: "模型不再调用工具，循环返回最后一条回复。" },
      ],
      result: "ASTER 路线通过校验",
      resultDetail: "这里原先显示的“3 model steps”，指上面的三次模型输入。",
    },
    "02": {
      title: "把一段长遥测送进上下文投影",
      steps: [
        { label: "保存完整结果", detail: "工具返回的遥测原文进入执行记录，供回看和核对。" },
        { label: "裁剪模型副本", detail: "发送给模型的版本只保留开头、结尾和省略说明。" },
        { label: "比较相邻输入", detail: "页面计算两次模型输入从开头起有多少内容相同。" },
      ],
      result: "模型输入缩短，完整遥测仍在记录中",
      resultDetail: "请求面板可以展开查看两种文本各自放在哪里。",
    },
    "03": {
      title: "安装一次插件，再完整卸载",
      steps: [
        { label: "建立影响清单", detail: "安装期登记插件带来的工具、服务、提示词和监听器。" },
        { label: "完成挂载", detail: "安装成功后，这些能力进入当前运行环境。" },
        { label: "反向清理", detail: "卸载函数按相反顺序撤回登记过的影响。" },
      ],
      result: "插件离场后没有残留能力",
      resultDetail: "能力关系视图可以核对挂载后的归属。",
    },
    "04": {
      title: "从事件记录还原一次模型输入",
      steps: [
        { label: "找到请求头", detail: "stepId 定位到当时的规则、工具目录与投影设置。" },
        { label: "收集此前事件", detail: "用户消息、模型回复与工具结果按发生顺序进入历史。" },
        { label: "应用摘要点", detail: "若已有摘要，就从摘要和之后的新事件继续拼装。" },
      ],
      result: "当时发送给模型的内容可以被重建",
      resultDetail: "时间线和请求视图来自同一组只追加记录。",
    },
    "05": {
      title: "临时加入路线评分能力",
      steps: [
        { label: "检查受信任目录", detail: "安装动作只接受目录中登记过的能力名称。" },
        { label: "挂载评分插件", detail: "下一次模型输入会多出 score_routes 工具与对应规则。" },
        { label: "使用后卸载", detail: "评分结束后，临时工具和规则一起移除。" },
      ],
      result: "评分能力只在实验期间出现",
      resultDetail: "切换模型步骤，可以看到工具目录随安装状态变化。",
    },
    "06": {
      title: "让同一任务走完调查、评分和提交",
      steps: [
        { label: "第一轮 · 调查", detail: "读取事故包并检查当前运行环境。" },
        { label: "第二轮 · 评分", detail: "安装临时评分能力，比较三条候选路线。" },
        { label: "第三轮 · 提交", detail: "移除临时能力，提交通过约束的 ASTER 路线。" },
      ],
      result: "任务在第三轮完成",
      resultDetail: "每轮的继续与停止原因都写入时间线。",
    },
  };
  return narratives[number] ?? narratives["01"]!;
}

function pressureText(number: string): string {
  return {
    "02": "遥测结果被整段带进每个后续请求，稳定内容与本步变化混在一起。",
    "03": "工具数组没有记录来源，也无法保证卸载和安装失败时完整清理。",
    "04": "智能体内部还保存着一份内存消息数组，请求与时间线缺少共同的数据来源。",
    "05": "固定组装无法在运行时验证临时评分能力，可安装范围也需要明确边界。",
    "06": "一次用户交互难以表达调查、评分、提交的跨阶段进度与停止原因。",
  }[number] ?? "";
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
  if (value.startsWith("First request")) return "首次请求，没有上一份样本可比较";
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
      read_incident_packet: "读取事故数据",
      submit_recovery_plan: "提交恢复方案",
      inspect_runtime: "检查运行环境",
      install_capability: "安装临时能力",
      remove_capability: "移除临时能力",
      score_routes: "执行路线评分",
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
    "incident-state": "事故状态",
    "incident-tools": "事故工具",
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
