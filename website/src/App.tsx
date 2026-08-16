import {
  type CSSProperties,
  type RefObject,
  Fragment,
  memo,
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
import {
  chapterFills,
  globalCodeLineProgress,
  graphSnapshotForEvidenceStep,
  newLineNumbers,
  snapshotForCheckpoint,
  snapshotForFill,
  type CodeLineProgress,
} from "./scroll-sync.js";

const PANEL_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "source", label: "源码细读" },
  { id: "diff", label: "总结" },
  { id: "request", label: "请求" },
  { id: "events", label: "事件" },
  { id: "graph", label: "能力关系" },
];

const SHOW_LIVE_REPLAY = false;

type TutorialLanguage = "typescript" | "python";
type UiLocale = "zh" | "en";

function initialLanguage(): TutorialLanguage {
  const query = new URLSearchParams(window.location.search).get("lang");
  if (query === "python") return "python";
  return window.localStorage.getItem("tutorial-language") === "python" ? "python" : "typescript";
}

function initialLocale(): UiLocale {
  const query = new URLSearchParams(window.location.search).get("locale");
  if (query === "en" || query === "zh") return query;
  const stored = window.localStorage.getItem("tutorial-locale");
  if (stored === "en" || stored === "zh") return stored;
  return "zh";
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

interface LessonFillBlock {
  /** 正文作者指定的源码出现位置。index 对应 codeGuide.fills 的下标。 */
  kind: "fill";
  fillIndex: number;
}

interface LockedCodeView {
  chapterId: string;
  checkpoint: number | null;
}

type LessonTextBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | LessonEvidenceBlock;

type LessonBlock = LessonTextBlock | LessonFillBlock;

/** 返回文档顺序中最后一个越过观察线的元素，只需读取 O(log n) 个矩形。 */
function lastElementAbove(elements: HTMLElement[], line: number): HTMLElement | null {
  let low = 0;
  let high = elements.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (elements[middle]!.getBoundingClientRect().top <= line) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match >= 0 ? elements[match]! : null;
}

export function App() {
  const [language, setLanguage] = useState<TutorialLanguage>(initialLanguage);
  const [locale, setLocale] = useState<UiLocale>(initialLocale);
  const compactLayout = useCompactLayout();
  usePreventCompactZoom(compactLayout);
  const [data, setData] = useState<TutorialData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState("chapter-1");
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const [lockedCodeView, setLockedCodeView] = useState<LockedCodeView | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const activeChapterIdRef = useRef(activeChapterId);
  const pendingChapterNavigationRef = useRef<string | null>(null);
  const navigationReleaseTimerRef = useRef<number | null>(null);
  const appliedInitialHashRef = useRef(false);
  const restoreScrollRef = useRef<number | null>(null);
  useEffect(() => { activeChapterIdRef.current = activeChapterId; }, [activeChapterId]);
  useEffect(() => () => {
    if (navigationReleaseTimerRef.current !== null) {
      window.clearTimeout(navigationReleaseTimerRef.current);
    }
  }, []);

  const lockChapterNavigation = (chapterId: string) => {
    pendingChapterNavigationRef.current = chapterId;
    if (navigationReleaseTimerRef.current !== null) {
      window.clearTimeout(navigationReleaseTimerRef.current);
    }
    // scrollend 并非所有浏览器均可靠提供；超时仅作为目标元素意外不可达时的兜底。
    navigationReleaseTimerRef.current = window.setTimeout(() => {
      pendingChapterNavigationRef.current = null;
      navigationReleaseTimerRef.current = null;
    }, 2_000);
  };

  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    const source = language === "python"
      ? locale === "en"
        ? "/generated/tutorial-python.en.json"
        : "/generated/tutorial-python.json"
      : locale === "en"
        ? "/generated/tutorial.en.json"
        : "/generated/tutorial.json";
    // 开发模式下每次重新生成教程数据都可能改变 JSON 内容，
    // 追加时间戳参数避免浏览器命中旧的 HTTP 缓存。
    const cacheBust = import.meta.env.DEV ? `?v=${Date.now()}` : "";
    fetch(`${source}${cacheBust}`)
      .then((response) => {
        if (!response.ok) throw new Error(`tutorial data: ${response.status}`);
        return response.json() as Promise<TutorialData>;
      })
      .then((nextData) => {
        if (!current) return;
        setData(nextData);
        setCheckpoint(null);
        // 语言/文本切换会经历 data → null → data 的重载，页面高度塌缩后
        // 浏览器会把滚动位置压到顶部；在这里恢复到切换前的位置。
        if (restoreScrollRef.current !== null) {
          const target = restoreScrollRef.current;
          restoreScrollRef.current = null;
          requestAnimationFrame(() => {
            window.scrollTo({ top: target, behavior: "instant" });
          });
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { current = false; };
  }, [language, locale]);

  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute(
      "content",
      locale === "en"
        ? "Six runnable chapters explain tool calls, context, session logs, runtime evolution, and long-running tasks in an Agent harness."
        : "用六个可运行章节，从零理解智能体运行框架的工具调用、上下文、过程日志与分轮任务。",
    );
  }, [locale]);

  useEffect(() => {
    if (!data || lockedCodeView) return;
    // 全局滚动联动（nano-dsh Reader 同款）：遍历所有填充锚点，激活
    // 「最后一个顶部越过视口 25% 线」的锚点；向上滚动时锚点回退，
    // 编辑器随之回退（代码段逐段消失）；滚回页面顶部时清空编辑器。
    // 用 scroll 监听而不是 IntersectionObserver：IO 在快速滚动/拖滚动条
    // 时会跳过中间帧，锚点从未进入观察带就不会触发回调，编辑器会卡住。
    const anchors = [...document.querySelectorAll<HTMLElement>("[data-fill-cp]")];
    const sections = data.chapters
      .map((chapter) => sectionRefs.current.get(chapter.id))
      .filter((section): section is HTMLElement => section !== undefined);
    let scrollFrame: number | null = null;
    const updateFromScroll = () => {
      scrollFrame = null;
      const line = window.innerHeight * 0.25;
      const pendingChapter = pendingChapterNavigationRef.current;
      if (pendingChapter) {
        const target = sectionRefs.current.get(pendingChapter);
        // 平滑滚动途经上一章的锚点时，不能让它覆盖用户刚点击的章节。
        // 目标章首进入观察线后，才交还给普通滚动联动。
        if (!target || target.getBoundingClientRect().top > line) return;
        pendingChapterNavigationRef.current = null;
        if (navigationReleaseTimerRef.current !== null) {
          window.clearTimeout(navigationReleaseTimerRef.current);
          navigationReleaseTimerRef.current = null;
        }
      }
      if (anchors.length === 0) return;
      const currentSection = lastElementAbove(sections, line);
      const currentChapterId = currentSection?.dataset.chapter ?? null;
      let currentAnchor = lastElementAbove(anchors, line);
      // 末尾兜底：最后一个锚点后面没有足够内容把它顶过 25% 线，
      // 用户一旦滚到底部（读完了），就激活它。
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
      if (atBottom) {
        const last = anchors[anchors.length - 1];
        if (last) currentAnchor = last;
      }
      // 章节由章首决定。滚回页面顶部（无章节）时清空编辑器；
      // 进入新章节时也先保持为空，等待正文中的第一个源码锚点。
      // 这样代码不会抢在问题、约束和设计理由之前出现。
      if (!currentChapterId) {
        setCheckpoint(null);
        return;
      }
      if (currentChapterId !== activeChapterIdRef.current) {
        activeChapterIdRef.current = currentChapterId;
        setActiveChapterId(currentChapterId);
        setCheckpoint(null);
        return;
      }
      if (!currentAnchor || currentAnchor.dataset.chapter !== currentChapterId) {
        return;
      }
      const currentCheckpoint = Number(currentAnchor.dataset.fillCp);
      setCheckpoint((previous) => previous === currentCheckpoint ? previous : currentCheckpoint);
    };
    const onScroll = () => {
      if (scrollFrame === null) scrollFrame = requestAnimationFrame(updateFromScroll);
    };
    updateFromScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    };
  }, [data, lockedCodeView]);

  // URL hash 章节导航：刷新/前进后退保持章节位置；切换章节 = 换文件 + 滚到章首。
  // hash 只在首次数据加载和真实的 hashchange 时生效。语言/文本切换会重新加载数据，
  // 此时沿用当前章节；URL 里的旧 hash 是上次点击导航留下的，回跳它会打断阅读位置。
  useEffect(() => {
    if (!data) return;
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      const chapter = data.chapters.find((candidate) => candidate.id === hash);
      if (!chapter) return;
      lockChapterNavigation(chapter.id);
      setActiveChapterId(chapter.id);
      setCheckpoint(null);
      requestAnimationFrame(() => {
        sectionRefs.current.get(chapter.id)?.scrollIntoView({ behavior: "instant", block: "start" });
      });
    };
    if (!appliedInitialHashRef.current) {
      appliedInitialHashRef.current = true;
      fromHash();
    }
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [data]);

  const activeChapter = useMemo(
    () => data?.chapters.find((chapter) => chapter.id === activeChapterId) ?? data?.chapters[0],
    [activeChapterId, data],
  );

  if (error) return <LoadFailure message={error} locale={locale} />;
  if (!data || !activeChapter) return <Loading locale={locale} />;

  const locked = lockedCodeView !== null;
  const lockedChapter = lockedCodeView
    ? data.chapters.find((chapter) => chapter.id === lockedCodeView.chapterId) ?? activeChapter
    : activeChapter;
  const codeChapter = locked ? lockedChapter : activeChapter;
  const codeCheckpoint = locked ? lockedCodeView!.checkpoint : checkpoint;
  const codeProgress = globalCodeLineProgress(data.chapters, codeChapter, codeCheckpoint);

  const navigateTo = (chapter: Chapter) => {
    lockChapterNavigation(chapter.id);
    setActiveChapterId(chapter.id);
    setCheckpoint(null);
    window.history.pushState(null, "", `#${chapter.id}`);
    const scroll = () => sectionRefs.current.get(chapter.id)?.scrollIntoView({
      // 跨章平滑滚动会连续布局、绘制途经的整章内容；软件合成环境下
      // 会形成数秒长任务。章节导航应直接到达，章内手动滚动仍保持联动。
      behavior: "instant",
      block: "start",
    });
    requestAnimationFrame(scroll);
  };

  const switchLanguage = (nextLanguage: TutorialLanguage) => {
    if (nextLanguage === language) return;
    const url = new URL(window.location.href);
    if (nextLanguage === "python") url.searchParams.set("lang", "python");
    else url.searchParams.delete("lang");
    window.history.replaceState(null, "", url);
    window.localStorage.setItem("tutorial-language", nextLanguage);
    restoreScrollRef.current = window.scrollY;
    setLanguage(nextLanguage);
  };

  const switchLocale = (nextLocale: UiLocale) => {
    if (nextLocale === locale) return;
    const url = new URL(window.location.href);
    if (nextLocale === "en") url.searchParams.set("locale", "en");
    else url.searchParams.delete("locale");
    window.history.replaceState(null, "", url);
    window.localStorage.setItem("tutorial-locale", nextLocale);
    restoreScrollRef.current = window.scrollY;
    setLocale(nextLocale);
  };

  const navigateToQuestions = () => {
    document.getElementById("six-questions")?.scrollIntoView({
      behavior: window.matchMedia("(max-width: 960px)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <div className="app-shell">
      <Header
        data={data}
        activeId={activeChapter.id}
        language={language}
        locale={locale}
        onLanguage={switchLanguage}
        onLocale={switchLocale}
        onNavigate={navigateTo}
        locked={locked}
        onToggleLock={() => {
          setLockedCodeView((current) => current
            ? null
            : { chapterId: activeChapter.id, checkpoint });
        }}
        codeProgress={codeProgress}
      />
      <main>
        <Hero data={data} locale={locale} onStart={navigateToQuestions} />
        <BuildPrelude chapters={data.chapters} locale={locale} onStart={() => navigateTo(data.chapters[0]!)} />
        <LanguagePrimer markdown={data.project.primer ?? ""} language={language} locale={locale} />
        {SHOW_LIVE_REPLAY && <LiveReplaySection replay={data.liveReplay} />}
        <div className="learning-layout">
          <article className="chapters" aria-label={locale === "en" ? "Step-by-step tutorial" : "渐进教程"}>
            {data.chapters.map((chapter) => (
              <ChapterArticle
                key={chapter.id}
                chapter={chapter}
                active={activeChapter.id === chapter.id}
                sectionRefs={sectionRefs}
                checkpoint={activeChapter.id === chapter.id ? checkpoint : null}
                mobileStaticCode={compactLayout}
                locale={locale}
              />
            ))}
          </article>
          <aside className="code-dock" aria-label={locale === "en" ? "Source code revealed as you read" : "根据阅读位置逐段显示的源码"}>
            <CodeDock chapter={codeChapter} checkpoint={codeCheckpoint} locale={locale} />
          </aside>
        </div>
      </main>
      <footer>
        <p className="site-footer-disclaimer">
          {locale === "en" ? <>
            Disclaimer: This independent educational implementation is not affiliated with, authorized by, or developed in partnership with DeepSeek or its affiliates.<br />
            Related names are used only for technical study and reference.
          </> : <>
            免责声明：本项目为独立的教学实现，与 DeepSeek 及其关联方不存在隶属、授权或合作关系；<br />
            相关名称仅用于技术学习与参考说明。
          </>}
        </p>
      </footer>
    </div>
  );
}

/** 窄屏将每个 fill 的源码片段直接挂在讲解卡片后，并在章末显示完整源码。 */
function useCompactLayout(): boolean {
  const query = "(max-width: 960px)";
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

/** 部分移动端浏览器会忽略 viewport 的缩放限制。
 * 窄屏下拦截多指缩放和触控板缩放，单指横向滚动代码不受影响。 */
function usePreventCompactZoom(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const nonPassive: AddEventListenerOptions = { passive: false };
    const preventMultiTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    const preventGesture = (event: Event) => event.preventDefault();
    const preventTrackpadZoom = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };

    document.addEventListener("touchstart", preventMultiTouch, nonPassive);
    document.addEventListener("touchmove", preventMultiTouch, nonPassive);
    document.addEventListener("gesturestart", preventGesture, nonPassive);
    document.addEventListener("gesturechange", preventGesture, nonPassive);
    document.addEventListener("gestureend", preventGesture, nonPassive);
    window.addEventListener("wheel", preventTrackpadZoom, nonPassive);

    return () => {
      document.removeEventListener("touchstart", preventMultiTouch);
      document.removeEventListener("touchmove", preventMultiTouch);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      window.removeEventListener("wheel", preventTrackpadZoom);
    };
  }, [enabled]);
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
  if (name === "inspect_runtime" || name === "cordis_inspect") {
    return "当前插件、服务、工具和依赖关系已返回。";
  }
  if (name === "apply_patch") return "最小补丁已应用：返回值不再重复扣除订单优惠。";
  if (name === "run_tests") return "回归测试完成：43 项全部通过。";
  if (name === "install_capability") return "typescript_analysis 插件及其工具已经加入当前 Context。";
  if (name === "cordis_define") return "新的 Cordis 插件代码已经登记。";
  if (name === "cordis_run") return "动态插件及其工具已经进入当前 Context。";
  if (name === "find_references") return "calculateTotal 的调用方已列出，折扣参数彼此独立。";
  if (name === "check_types") return "TypeScript 类型检查通过，没有诊断。";
  if (name === "remove_capability") return "typescript_analysis 插件及其工具已经从当前 Context 移除。";
  if (name === "cordis_stop") return "动态插件已经停止，它提供的工具已被移除。";
  if (name === "cordis_undefine") return "动态插件已经停止并删除定义。";
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

function LanguagePrimer({ markdown, language, locale }: { markdown: string; language: TutorialLanguage; locale: UiLocale }) {
  const sections = parsePrimer(markdown, language);
  const label = language === "python" ? "Python" : "TypeScript";
  return (
    <section className="typescript-primer" aria-labelledby="language-primer-title">
      <div className="primer-summary">
        <div>
          <p className="eyebrow">{locale === "en" ? "READING GUIDE · ABOUT 3 MINUTES" : "阅读补充 · 约 3 分钟"}</p>
          <h2 id="language-primer-title">{locale === "en" ? `Four ${label} basics for reading the code` : `${label} 的四个阅读基础`}</h2>
        </div>
      </div>
      <div className="primer-body">
        <p className="primer-intro">{sections.intro}</p>
        <div className="primer-cards">
          {sections.cards.map((card, index) => (
            <article key={card.title}>
              <span>{locale === "en" ? `BASIC ${index + 1}` : `基础 ${index + 1}`}</span>
              <h3>{card.title}</h3>
              <pre><SyntaxCode code={card.code} language={language} /></pre>
              <p>{renderInlineCode(card.body)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function BuildPrelude({ chapters, locale, onStart }: { chapters: Chapter[]; locale: UiLocale; onStart: () => void }) {
  return (
    <section id="six-questions" className="build-prelude scaffolded" aria-labelledby="build-prelude-title">
      <div className="build-prelude-copy">
        <p className="eyebrow">{locale === "en" ? "TUTORIAL STRUCTURE" : "教程结构"}</p>
        <h2 id="build-prelude-title">{locale === "en" ? "Six questions for understanding DeepSeek Harness" : "六个问题，理解 DeepSeek Harness"}</h2>
        <p>{locale === "en"
          ? "The Agent Loop repeats steps in response to feedback, while context projection controls each model input. Plugins manage runtime capabilities, and the Session Log preserves the execution history. After each Round, the Goal state determines whether the task continues."
          : "教程先建立一次工具循环，再依次处理历史增长、固定能力、过程记录、能力缺口和长程续行。DSH 的关键在于：运行时由插件树组装，模型历史由会话事件派生，Goal 在每轮结束后决定任务是否继续。"}</p>
        <div className="prelude-actions">
          <button onClick={onStart}>{locale === "en" ? "Start with the six questions" : "从六个问题开始"}</button>
          <span>{locale === "en" ? "Each chapter explains one mechanism alongside its main source file" : "每章先说明前一版遗留的问题，再解释设计和对应实现"}</span>
        </div>
      </div>
      <div className="scaffold-tree">
        <b>{chapters[0]?.source.path.startsWith("python_harness/") ? "python_harness/" : "src/"}</b>
        {chapters.map((chapter, index) => (
          <div key={chapter.id} style={{ "--file-index": index } as CSSProperties}>
            <i>{String(index + 1).padStart(2, "0")}</i>
            <code>{sourceFileLabel(chapter.source.path)}</code>
            <span className="scaffold-chapter">
              <strong>{fixedChapterTitle(chapter, locale)}</strong>
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
  locale,
  onLanguage,
  onLocale,
  onNavigate,
  locked,
  onToggleLock,
  codeProgress,
}: {
  data: TutorialData;
  activeId: string;
  language: TutorialLanguage;
  locale: UiLocale;
  onLanguage: (language: TutorialLanguage) => void;
  onLocale: (locale: UiLocale) => void;
  onNavigate: (chapter: Chapter) => void;
  locked: boolean;
  onToggleLock: () => void;
  codeProgress: CodeLineProgress;
}) {
  const chapterNavRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = chapterNavRef.current;
    if (!nav || !window.matchMedia("(max-width: 960px)").matches) return;
    const active = nav.querySelector<HTMLElement>("[aria-current='step']");
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const left = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
      nav.scrollTo({
        left: Math.max(0, left),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId]);

  return (
    <header className="site-header">
      <button
        className="wordmark"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label={locale === "en" ? "Back to the DeepSeek Harness home page" : "回到 DeepSeek Harness 首页"}
      >
        <img className="wordmark-logo" src="/deepseek-harness-logo.png" alt="" />
        <span className="wordmark-copy">DeepSeek Harness from Scratch</span>
      </button>
      <nav ref={chapterNavRef} className="chapter-nav" aria-label={locale === "en" ? "Chapter navigation" : "章节导航"}>
        {data.chapters.map((chapter) => {
          const core = isCoreChapter(chapter);
          const title = fixedChapterTitle(chapter, locale);
          return (
            <button
              key={chapter.id}
              className={[activeId === chapter.id && "active", core && "core"].filter(Boolean).join(" ")}
              onClick={() => onNavigate(chapter)}
              aria-label={core ? `${title}，${locale === "en" ? "core mechanism" : "核心机制"}` : title}
              aria-current={activeId === chapter.id ? "step" : undefined}
              title={core ? locale === "en" ? "Core mechanism" : "核心机制" : title}
            >
              <span className="chapter-number">
                {chapterName(chapter.number, locale)}
                {core && <span className="chapter-core-mark">{locale === "en" ? "CORE" : "核心"}</span>}
              </span>
              <strong>{chapterNavTitle(chapter, locale)}</strong>
            </button>
          );
        })}
      </nav>
      <div className="header-actions">
        <div className="progress-help">
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={codeProgress.revealedLines}
            aria-valuemin={0}
            aria-valuemax={codeProgress.totalLines}
            aria-valuetext={locale === "en"
              ? `${codeProgress.revealedLines} of ${codeProgress.totalLines} source lines revealed`
              : `已展示 ${codeProgress.revealedLines} / ${codeProgress.totalLines} 行源码`}
            aria-describedby="code-progress-help"
          >
            <div className="progress-bar" style={{ width: `${codeProgress.percent}%` }} />
          </div>
          <span id="code-progress-help" className="header-tooltip" role="tooltip">
            <b>{locale === "en" ? "All tutorial source" : "全书源码进度"}</b>
            <span>{locale === "en"
              ? `${codeProgress.revealedLines} of ${codeProgress.totalLines} source lines are visible. The value advances when the next code block appears.`
              : `已展示 ${codeProgress.revealedLines} / ${codeProgress.totalLines} 行源码；下一段代码出现时会同步更新。`}</span>
          </span>
        </div>
        <button
          type="button"
          className={`lock-button ${locked ? "active" : ""}`}
          onClick={onToggleLock}
          aria-pressed={locked}
          aria-label={locale === "en"
            ? locked ? "Unlock the code view and resume scroll-based updates" : "Lock the current code file and reveal stage"
            : locked ? "解除代码视图锁定，使内容继续根据阅读位置更新" : "锁定当前代码视图，保留当前文件和进度"}
          aria-describedby="code-lock-help"
        >
          {locked ? <LockIcon locked /> : <LockIcon />}
          <span id="code-lock-help" className="lock-tooltip" role="tooltip">
            <b>{locale === "en" ? locked ? "Code view locked" : "Lock code view" : locked ? "代码视图已锁定" : "锁定代码视图"}</b>
            <span>{locale === "en" ? locked ? "Click to resume scroll-based updates" : "Click to keep the current file and stage" : locked ? "点击后根据阅读位置继续更新" : "点击后保留当前文件和进度"}</span>
          </span>
        </button>
        <div className="language-control">
          <div className="language-switch" role="group" aria-label={locale === "en" ? "Tutorial implementation language" : "教程实现语言"} aria-describedby="language-switch-help">
            <button className={language === "typescript" ? "active" : ""} onClick={() => onLanguage("typescript")} aria-pressed={language === "typescript"}>TS</button>
            <button className={language === "python" ? "active" : ""} onClick={() => onLanguage("python")} aria-pressed={language === "python"}>Python</button>
          </div>
          <span id="language-switch-help" className="header-tooltip" role="tooltip">
            <b>{locale === "en" ? "Implementation language" : "选择实现语言"}</b>
          <span>{locale === "en" ? "Switch between TypeScript and Python. Both versions explain the same mechanisms." : "切换 TypeScript 或 Python；两版讲解相同机制。"}</span>
          </span>
        </div>
        <div className="locale-control">
          <div className="locale-switch" role="group" aria-label={locale === "en" ? "Page language" : "网页语言"}>
            <button className={locale === "en" ? "active" : ""} onClick={() => onLocale("en")} aria-pressed={locale === "en"}>EN</button>
            <button className={locale === "zh" ? "active" : ""} onClick={() => onLocale("zh")} aria-pressed={locale === "zh"}>中文</button>
          </div>
        </div>
        <div className="github-links">
          <a
            className="github-link"
            href="https://github.com/tsrigo/dsh-from-scratch"
            target="_blank"
            rel="noreferrer"
            aria-label={locale === "en" ? "View dsh-from-scratch on GitHub" : "在 GitHub 查看 dsh-from-scratch"}
            title="tsrigo/dsh-from-scratch"
          >
            <GitHubIcon />
          </a>
        </div>
      </div>
    </header>
  );
}

function LockIcon({ locked = false }: { locked?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      {locked ? <path d="M8 10V7a4 4 0 0 1 8 0v3" /> : <path d="M8 10V7a4 4 0 0 1 7.3-2.2" />}
      <path d="M12 14v2" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.01-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.67 1.25 3.32.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.77.11 3.06.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.35.78 1.04.78 2.1 0 1.52-.01 2.75-.01 3.12 0 .3.21.67.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function Hero({ data, locale, onStart }: { data: TutorialData; locale: UiLocale; onStart: () => void }) {
  const language = data.project.languageLabel ?? "TypeScript";
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">{locale === "en" ? `${language} FROM SCRATCH · RUNNABLE TUTORIAL` : `${language} 从零实现 · 可运行教程`}</p>
        <h1>
          <span className="hero-line">{locale === "en" ? "Understand how" : "理解 DeepSeek Harness"}</span>
          <span className="hero-line">{locale === "en" ? "DeepSeek Harness handles" : "如何逐步处理"}</span>
          <span className="hero-line hero-line-accent">{locale === "en" ? "complex tasks" : "复杂任务"}</span>
        </h1>
          <p className="hero-intro">
            {locale === "en" ? "DeepSeek Harness (DSH) provides the runtime in which a model completes tasks. It organizes model input, executes tools, and preserves the execution history." : "DeepSeek Harness（DSH）为模型执行任务提供运行环境，负责组织模型输入、执行工具并保存执行过程。"}
            <br />
            {locale === "en" ? "Each of the six chapters uses a minimal runnable example to explain one foundational mechanism." : "六章分别使用一个可运行的最小样本，说明六项基础机制。"}
          </p>
        <div className="hero-actions">
          <button className="primary-action" onClick={onStart}>{locale === "en" ? "Start with the six questions" : "从六个问题开始"} <span>↓</span></button>
          <span className="offline-badge"><i /> {locale === "en" ? "Tutorial data is included for offline reading" : "教程数据随网页提供，可离线查看"}</span>
        </div>
      </div>
      <div
        className="hero-art"
        role="img"
        aria-label={locale === "en" ? "Blue watercolor illustration of a tutor holding a pointer and a book" : "手持教鞭与书本的蓝色水彩学院导师"}
      >
        <div className="hero-art-fill" aria-hidden="true" />
        <div className="hero-art-image" aria-hidden="true" />
      </div>
    </section>
  );
}

type LessonFlowItem = LessonBlock;

/** 没有源码锚点的外部旧正文仍保留均匀穿插作为兼容回退。
 * 本教程四个语言版本均通过 <!-- fill {"index": n} --> 把源码放在论述真正需要它的位置。 */
function interleaveFillCards(blocks: LessonTextBlock[], chapter: Chapter): LessonFlowItem[] {
  const fills = chapterFills(chapter);
  const bodyCount = Math.max(fills.length - 1, 0);
  const result: LessonFlowItem[] = [{ kind: "fill", fillIndex: 0 }];
  const firstHeading = blocks.findIndex((block) => block.kind === "heading");
  const leadCount = firstHeading > 0 ? firstHeading : 0;
  result.push(...blocks.slice(0, leadCount));
  let placed = 0;
  if (leadCount > 0 && bodyCount > 0) {
    result.push({ kind: "fill", fillIndex: 1 });
    placed = 1;
  }
  const remainingBlocks = blocks.slice(leadCount);
  const initiallyPlaced = placed;
  const remainingBodyCount = bodyCount - initiallyPlaced;
  const denominator = remainingBlocks.length || 1;
  remainingBlocks.forEach((block, index) => {
    result.push(block);
    const target = initiallyPlaced
      + Math.round(((index + 1) * remainingBodyCount) / denominator);
    while (placed < target && placed < bodyCount) {
      result.push({ kind: "fill", fillIndex: placed + 1 });
      placed += 1;
    }
  });
  return result;
}

function buildLessonFlow(blocks: LessonBlock[], chapter: Chapter): LessonFlowItem[] {
  // 只要正文显式安排过源码位置，就完全服从正文顺序。这样每个 checkpoint
  // 都紧跟解释它为何出现的段落，而不再由段落数量决定。
  if (blocks.some((block) => block.kind === "fill")) return blocks;
  return interleaveFillCards(
    blocks.filter((block): block is LessonTextBlock => block.kind !== "fill"),
    chapter,
  );
}

const ChapterArticle = memo(function ChapterArticle({
  chapter,
  active,
  sectionRefs,
  checkpoint,
  mobileStaticCode,
  locale,
}: {
  chapter: Chapter;
  active: boolean;
  sectionRefs: RefObject<Map<string, HTMLElement>>;
  checkpoint: number | null;
  mobileStaticCode: boolean;
  locale: UiLocale;
}) {
  return (
    <section
      ref={(node) => {
        if (node) sectionRefs.current.set(chapter.id, node);
        else sectionRefs.current.delete(chapter.id);
      }}
      data-chapter={chapter.id}
      id={chapter.id}
      className={`chapter ${active ? "active" : ""}`}
    >
      <ChapterContent
        chapter={chapter}
        checkpoint={checkpoint}
        mobileStaticCode={mobileStaticCode}
        locale={locale}
      />
    </section>
  );
});

/** active 只改变外层章节标记；正文保持 memo，避免切换标签时重新执行
 * 两整章的 Markdown 渲染及折叠证据区语法高亮。 */
const ChapterContent = memo(function ChapterContent({
  chapter,
  checkpoint,
  mobileStaticCode,
  locale,
}: {
  chapter: Chapter;
  checkpoint: number | null;
  mobileStaticCode: boolean;
  locale: UiLocale;
}) {
  const lesson = useMemo(() => parseLesson(chapter.lesson), [chapter.lesson]);
  const flow = useMemo(() => buildLessonFlow(lesson, chapter), [lesson, chapter]);
  const fills = chapterFills(chapter);
  return (
    <div className="chapter-content">
        <div className="chapter-kicker">
          <span>{fixedChapterTitle(chapter, locale)}</span>
        </div>
        <div className="chapter-heading">
          <div className="chapter-file">
            <span>{locale === "en" ? "CURRENT FILE" : "当前正在写入"}</span>
            <code>{chapter.source.path}</code>
          </div>
          <h2>{chapter.title}</h2>
          <p className="chapter-question">{chapter.question}</p>
          <div className="reading-order" aria-label={locale === "en" ? "How the article controls the code view" : "正文与代码的联动顺序"}>
            <span><b>→</b>{locale === "en" ? "Scroll through the article to reveal the structure, then each implementation section" : "先阅读问题和设计，再滚动正文查看每段实现"}</span>
          </div>
        </div>
        <CodeGuideCard chapter={chapter} locale={locale} />
        <div className="lesson-copy">
          {flow.map((item, index) => {
            if (item.kind === "heading") return <h3 key={`heading-${index}`}>{item.text}</h3>;
            if (item.kind === "paragraph") return <p key={`paragraph-${index}`}>{renderInlineCode(item.text)}</p>;
            if (item.kind === "fill") {
              const fill = fills[item.fillIndex];
              if (!fill) return null;
              return (
                <FillCard
                  key={`fill-${item.fillIndex}`}
                  chapter={chapter}
                  fillIndex={item.fillIndex}
                  fill={fill}
                  active={!mobileStaticCode && checkpoint !== null && checkpoint >= item.fillIndex}
                  showSource={mobileStaticCode}
                  locale={locale}
                />
              );
            }
            return <EvidenceContentCard key={`evidence-${item.id}`} chapter={chapter} block={item} locale={locale} />;
          })}
        </div>
        <ChapterSummaryCard chapter={chapter} locale={locale} />
        {mobileStaticCode && <MobileFullSource chapter={chapter} locale={locale} />}
    </div>
  );
});

function CodeGuideCard({ chapter, locale }: { chapter: Chapter; locale: UiLocale }) {
  return (
    <section className="code-guide-card" aria-label={locale === "en" ? "Source guide for this chapter" : "本章源码导览"}>
      <div className="card-heading">
        <span>{locale === "en" ? "SOURCE GUIDE" : "本章源码导览"}</span>
        <h3>{chapter.codeGuide.title}</h3>
      </div>
      <p>{chapter.codeGuide.description}</p>
    </section>
  );
}

/** 正文中的源码锚点：放在课文指定的位置，并驱动右侧的渐进源码视图。
 * fillIndex 0 是结构卡；其余卡片对应一个能独立说明的实现单元。 */
function FillCard({
  chapter,
  fillIndex,
  fill,
  active,
  showSource,
  locale,
}: {
  chapter: Chapter;
  fillIndex: number;
  fill: NonNullable<Chapter["codeGuide"]["fills"]>[number];
  active: boolean;
  showSource: boolean;
  locale: UiLocale;
}) {
  const observation = fillIndex > 0
    ? chapter.codeGuide.observations.find(
        (item) =>
          fill.ranges.some(
            ([start, end]) => item.lines[0] <= end && item.lines[1] >= start,
          ),
      )
    : undefined;
  const card = (
    <div
      className={`fill-card ${fill.kind === "skeleton" ? "skeleton" : ""} ${active ? "done" : ""}`}
      data-chapter={chapter.id}
      data-fill-cp={fillIndex}
    >
      <div className="fill-card-heading">
        <span className="fill-card-index">{fill.kind === "skeleton" ? locale === "en" ? "SOURCE SHAPE" : "源码结构" : locale === "en" ? "IN THE SOURCE" : "对应源码"}</span>
        <h4>{fill.label}</h4>
      </div>
      {observation && <p>{observation.text}</p>}
    </div>
  );
  if (!showSource) return card;
  return (
    <div className="fill-step">
      {card}
      <MobileFillSource chapter={chapter} fillIndex={fillIndex} locale={locale} />
    </div>
  );
}

function MobileFillSource({
  chapter,
  fillIndex,
  locale,
}: {
  chapter: Chapter;
  fillIndex: number;
  locale: UiLocale;
}) {
  const lines = useMemo(() => snapshotForFill(chapter, fillIndex), [chapter, fillIndex]);
  const fill = chapterFills(chapter)[fillIndex];
  if (!fill || lines.length === 0) return null;
  const ranges = fill.ranges
    .map(([start, end]) => start === end ? `L${start}` : `L${start}–${end}`)
    .join(", ");
  return (
    <section
      className="mobile-fill-source"
      aria-label={locale === "en" ? `Source excerpt for ${fill.label}` : `${fill.label} 对应的源码片段`}
    >
      <header className="mobile-static-code-header">
        <span>{locale === "en" ? "SOURCE EXCERPT" : "对应源码"}</span>
        <code title={chapter.source.path}>{sourceFileLabel(chapter.source.path)} · {ranges}</code>
      </header>
      <CodeBlock
        code={lines.map((line) => line.text).join("\n")}
        sourceLineNumbers={lines.map((line) => line.number)}
        language={languageForPath(chapter.source.path)}
      />
    </section>
  );
}

function MobileFullSource({ chapter, locale }: { chapter: Chapter; locale: UiLocale }) {
  const lineCount = chapter.source.content.trimEnd().split(/\r?\n/u).length;
  return (
    <section
      className="mobile-full-source"
      aria-label={locale === "en" ? "Complete static source code" : "完整静态源码"}
    >
      <header className="mobile-static-code-header">
        <div>
          <span>{locale === "en" ? "COMPLETE STATIC SOURCE" : "完整静态源码"}</span>
          <strong>{locale === "en" ? "Complete chapter implementation" : "本章完整实现"}</strong>
        </div>
        <code title={chapter.source.path}>{sourceFileLabel(chapter.source.path)} · {lineCount} {locale === "en" ? "lines" : "行"}</code>
      </header>
      <CodeBlock
        code={chapter.source.content}
        startLine={1}
        language={languageForPath(chapter.source.path)}
      />
    </section>
  );
}

/** 证据块：编号子标题由课文的 ## 标题承担（如「1.1 循环：请求、执行、再请求」），
 * 这里只渲染小标签、说明与数据卡片。source 卡没有独立内容（引导读者看右侧源码）。 */
function EvidenceContentCard({ chapter, block, locale }: { chapter: Chapter; block: LessonEvidenceBlock; locale: UiLocale }) {
  const target = block.target;
  return (
    <div className="evidence-block" data-evidence-cue={block.id}>
      <p className="evidence-caption">{block.label}</p>
      <p className="evidence-description">{block.description}</p>
      {target.tab !== "source" && (
        <section className={`evidence-content-card evidence-${target.tab}`}>
          {target.tab === "request" && <RequestCard chapter={chapter} target={target} locale={locale} />}
          {target.tab === "events" && <TraceCard chapter={chapter} target={target} locale={locale} />}
          {target.tab === "graph" && <GraphCard chapter={chapter} target={target} locale={locale} />}
        </section>
      )}
    </div>
  );
}

function ChapterSummaryCard({ chapter, locale }: { chapter: Chapter; locale: UiLocale }) {
  const { changeStory } = chapter;
  return (
    <section className="chapter-summary-card" aria-label={locale === "en" ? "Chapter summary" : "本章总结"}>
      <div className="card-heading">
        <span>{locale === "en" ? "CHAPTER SUMMARY" : "本章总结"}</span>
        <h3>{changeStory.title}</h3>
      </div>
      <p>{changeStory.summary}</p>
      <dl>
        <div><dt>{locale === "en" ? "Harness role" : "Harness 的角色"}</dt><dd>{changeStory.harnessRole}</dd></div>
        <div><dt>{locale === "en" ? "Connection to the tutorial" : "与全书的连接"}</dt><dd>{changeStory.connection}</dd></div>
      </dl>
      <ul>
        {changeStory.outcomes.map((outcome) => <li key={outcome}><i>✓</i><span>{outcome}</span></li>)}
      </ul>
      <small>{locale === "en"
        ? `Chapter code changes: ${chapter.diffStats.filesChanged} file${chapter.diffStats.filesChanged === 1 ? "" : "s"} · +${chapter.diffStats.additions} / −${chapter.diffStats.deletions} lines`
        : `本章代码改动 ${chapter.diffStats.filesChanged} 个文件 · +${chapter.diffStats.additions} / −${chapter.diffStats.deletions} 行`}</small>
    </section>
  );
}

/** 手动平滑滚动：rAF 驱动 easeOutCubic，时长随距离 180-420ms。
 * 通过 frameRef 可取消上一段动画（连续 checkpoint 变化时避免排队）。 */
function smoothScrollTo(
  scroller: HTMLElement,
  targetTop: number,
  frameRef: { current: number | null },
): void {
  if (frameRef.current !== null) {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
  const start = scroller.scrollTop;
  const delta = targetTop - start;
  if (Math.abs(delta) < 1) return;
  const duration = Math.min(1000, Math.max(450, Math.abs(delta) * 1.3));
  const begin = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - begin) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    scroller.scrollTop = start + delta * eased;
    frameRef.current = progress < 1 ? requestAnimationFrame(step) : null;
  };
  frameRef.current = requestAnimationFrame(step);
}

/** 代码区：随正文 checkpoint 渐进补全（nano-dsh CodePanel 同款）。
 * 文件 tab 由章节决定（该章为止已出现的六个主文件，进入章节即全部显示）；
 * 内容由 checkpoint 驱动：null 时等待正文引入源码，
 * 骨架为类/函数抽象，随后实现段逐段补入；checkpoint 变化时 tab 重置回主文件。 */
function CodeDock({
  chapter,
  checkpoint,
  locale,
}: {
  chapter: Chapter;
  checkpoint: number | null;
  locale: UiLocale;
}) {
  const fills = chapterFills(chapter);
  const extraFiles = chapter.extraFiles ?? [];
  const mainPath = chapter.source.path;
  // tab 只依赖章节：主文件 + 该章为止已出现的其余主文件
  const tabs = [mainPath, ...extraFiles.map((file) => file.path)];
  const safeCheckpoint = checkpoint === null
    ? null
    : Math.min(checkpoint, Math.max(fills.length - 1, 0));
  const [selected, setSelected] = useState(mainPath);
  // nano-dsh：checkpoint 变化时重置到该 checkpoint 的默认文件（主文件）
  useEffect(() => {
    setSelected(mainPath);
  }, [safeCheckpoint, chapter.id]);
  const file = tabs.includes(selected) ? selected : mainPath;
  const extra = extraFiles.find((candidate) => candidate.path === file);
  const snapshot = useMemo(
    () => safeCheckpoint === null
      ? []
      : snapshotForCheckpoint(chapter, safeCheckpoint),
    [chapter, safeCheckpoint],
  );
  const previous = useMemo(
    () => safeCheckpoint === null || safeCheckpoint === 0
      ? []
      : snapshotForCheckpoint(chapter, safeCheckpoint - 1),
    [chapter, safeCheckpoint],
  );
  const added = useMemo(
    () => newLineNumbers(previous, snapshot),
    [previous, snapshot],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  // 补全定位（pi-from-scratch 时序 + 平滑滚动）：checkpoint 推进后，
  // 先平滑滚动到新增代码首行（视口 28% 处），随后打字动画逐行写入。
  // 平滑滚动用 rAF 手动驱动（easeOutCubic），连续 checkpoint 变化时
  // 取消上一段动画，避免排队跳变。
  useEffect(() => {
    if (safeCheckpoint === null) return;
    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current;
      if (!body) return;
      const scroller = body.querySelector<HTMLElement>(".code-lines");
      if (!scroller) return;
      const firstNew = body.querySelector<HTMLElement>(".code-line.is-new");
      if (!firstNew) {
        smoothScrollTo(scroller, 0, scrollFrameRef);
        return;
      }
      const bodyRect = scroller.getBoundingClientRect();
      const newRect = firstNew.getBoundingClientRect();
      const targetTop = scroller.scrollTop
        + newRect.top - bodyRect.top - scroller.clientHeight * 0.28;
      smoothScrollTo(scroller, Math.max(0, targetTop), scrollFrameRef);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [safeCheckpoint, chapter.id]);

  const code = snapshot.map((line) => line.text).join("\n");
  const lineNumbers = snapshot.map((line) => line.number);
  const language = languageForPath(file);
  // 写入动画作用于主文件的所有新增内容：进入章节时的骨架（cp0）与
  // 逐段补入的代码同样有「长出 + 打字」动画；extra 文件为完整查看，不动画。
  const enteringLines = !extra && safeCheckpoint !== null
    ? added
    : null;
  return (
    <div className="code-dock-shell">
      {tabs.length > 0 && (
        <div className="code-tabs" role="tablist" aria-label={locale === "en" ? "Open files" : "已打开的文件"}>
          {tabs.map((path) => (
            <button
              key={path}
              role="tab"
              aria-selected={file === path}
              className={file === path ? "code-tab is-active" : "code-tab"}
              onClick={() => setSelected(path)}
              aria-label={path}
              title={path}
            >
              {sourceFileLabel(path)}
            </button>
          ))}
        </div>
      )}
      <div className="file-label">
        <div className="file-meta">
          <span className="file-name" title={file}>{sourceFileLabel(file)}{extra ? locale === "en" ? " · FULL FILE" : " · 完整文件" : ""}</span>
          <span className="file-stage">
            {!extra && fills.length > 0
              ? safeCheckpoint === null
                ? locale === "en" ? "NOT STARTED" : "尚未开始"
                : safeCheckpoint === 0
                  ? locale === "en" ? "STRUCTURE" : "结构"
                  : locale === "en" ? `CODE ${safeCheckpoint}/${fills.length - 1}` : `代码 ${safeCheckpoint}/${fills.length - 1}`
              : ""}
          </span>
        </div>
        {!extra && fills.length > 0 && (
          <CodeOutline fills={fills} checkpoint={safeCheckpoint} language={language} locale={locale} />
        )}
        <button onClick={() => navigator.clipboard?.writeText(extra ? extra.content : code)}>{locale === "en" ? "Copy" : "复制"}</button>
      </div>
      <div ref={bodyRef} className="code-dock-body">
        {extra ? (
          <CodeBlock
            code={extra.content}
            startLine={1}
            language={language}
          />
        ) : safeCheckpoint === null || fills.length === 0 ? (
          fills.length === 0 ? (
            <CodeBlock
              code={code}
              sourceLineNumbers={lineNumbers}
              language={language}
            />
          ) : (
            <div className="editor-empty">{locale === "en" ? "(The article will introduce this source when it becomes relevant.)" : "（正文将在需要它时引入这段源码。）"}</div>
          )
        ) : (
          <CodeBlock
            code={code}
            sourceLineNumbers={lineNumbers}
            language={language}
            newLines={added}
            enteringLines={enteringLines}
          />
        )}
        {!extra && fills.length > 0 && safeCheckpoint !== null && safeCheckpoint < fills.length - 1 && (
          <p className="code-dock-hint">{locale === "en" ? "Continue reading to reveal the next section of code" : "继续向下阅读，右侧将显示下一段代码"}</p>
        )}
      </div>
    </div>
  );
}

/** 补全顺序目录（三行专注模式）：只显示上一段、当前段、下一段。
 * 中间一行代表现在，随 checkpoint 推进滚动；首尾边界自动收窄为两行。 */
function CodeOutline({ fills, checkpoint, language, locale }: {
  fills: ReturnType<typeof chapterFills>;
  checkpoint: number | null;
  language: string;
  locale: UiLocale;
}) {
  const comment = language === "python" ? "#" : "//";
  const current = Math.min(Math.max(checkpoint ?? 0, 0), fills.length - 1);
  const indexes = [];
  if (current - 1 >= 0) indexes.push(current - 1);
  indexes.push(current);
  if (current + 1 < fills.length) indexes.push(current + 1);
  return (
    <div className="code-outline" role="list" aria-label={locale === "en" ? "Code reveal order for this chapter" : "本章补全顺序"}>
      {indexes.map((index) => {
        const fill = fills[index]!;
        const reached = checkpoint !== null && index < checkpoint;
        const isCurrent = index === current;
        return (
          <div key={fill.label} className={`code-outline-line ${isCurrent ? "current" : reached ? "reached" : ""}`}>
            <span className="line-no" aria-hidden="true">···</span>
            <code>
              {comment} {fillStageLabel(index, locale)}: {fill.label}
              {isCurrent ? locale === "en" ? " ← NOW" : " ← 现在" : reached ? " ✓" : ""}
            </code>
          </div>
        );
      })}
    </div>
  );
}

function fillStageLabel(index: number, locale: UiLocale): string {
  return index === 0
    ? locale === "en" ? "SOURCE SHAPE" : "源码结构"
    : locale === "en" ? "IMPLEMENTATION" : "实现";
}

/** 请求对比卡（压缩版）：相邻请求的 token 估算与首次失效位置 */
function RequestCard({ chapter, target, locale }: { chapter: Chapter; target: EvidenceTarget; locale: UiLocale }) {
  const step = target.step ?? Math.min(chapter.requests.length - 1, 1);
  const evidence = chapter.requests[step] ?? chapter.requests[0]!;
  const previous = chapter.requests[Math.max(0, step - 1)] ?? evidence;
  const sharedParts = evidence.prefix.sharedParts;
  const previousTail = previous.parts.slice(sharedParts);
  const currentTail = evidence.parts.slice(sharedParts);
  return (
    <div className="evidence-card-body request-card">
      <div className="request-compare-heading">
        <b>{locale === "en" ? "Two consecutive model requests" : "相邻两次模型请求"}</b>
        <span>{locale === "en" ? `Shared prefix: about ${evidence.prefix.sharedApproximateTokens} tokens` : `相同开头约 ${evidence.prefix.sharedApproximateTokens} token`}</span>
      </div>
      <div className="request-comparison" aria-label={locale === "en" ? `Comparison of model requests ${previous.step} and ${evidence.step}` : `第 ${previous.step} 次和第 ${evidence.step} 次模型请求对比`}>
        <RequestComparisonRow
          chapter={chapter}
          evidence={previous}
          sharedParts={sharedParts}
          tail={previousTail}
          locale={locale}
        />
        <div className="request-rebuild-arrow"><i>↓</i><span>{locale === "en" ? "Rebuild after appending new events" : "追加新记录后重新构建"}</span></div>
        <RequestComparisonRow
          chapter={chapter}
          evidence={evidence}
          sharedParts={sharedParts}
          tail={currentTail}
          current
          locale={locale}
        />
      </div>
      <div className="request-compare-conclusion">
        <b>{locale === "en" ? "First change" : "首次变化"}</b>
        <span>{invalidationLabel(evidence.prefix.firstInvalidation, locale)}{locale === "en" ? "; all earlier content and ordering remain unchanged" : "；此前内容和顺序保持相同"}</span>
      </div>
      <details className="technical-details" open>
        <summary><span>{locale === "en" ? "Inspect request" : "查看请求组成"}</span><b>{locale === "en" ? "Contents and estimates by section" : "各部分内容与估算"}</b></summary>
        <p className="details-note">{locale === "en" ? "Select a section to inspect its content and estimate." : "点击每个部分，可展开查看具体内容与估算。"}</p>
        <div className="request-parts">
          {evidence.parts.map((part) => (
            <details key={part.id} className={part.stability}>
              <summary>
                <span className="request-part-label">{requestPartLabel(part, locale)}</span>
                <small>{stabilityLabel(part.stability, locale)} · {locale === "en" ? `about ${part.approximateTokens} tokens` : `约 ${part.approximateTokens} token`}</small>
                <span className="request-part-toggle">{locale === "en" ? "Expand ▸" : "展开 ▸"}</span>
              </summary>
              <pre><SyntaxCode code={formatJson(part.value)} language="json" /></pre>
            </details>
          ))}
        </div>
      </details>
    </div>
  );
}

function RequestComparisonRow({
  chapter,
  evidence,
  sharedParts,
  tail,
  current = false,
  locale,
}: {
  chapter: Chapter;
  evidence: RequestEvidence;
  sharedParts: number;
  tail: RequestPart[];
  current?: boolean;
  locale: UiLocale;
}) {
  return (
    <div className={`request-compare-row ${current ? "current" : "previous"}`}>
      <div className="request-row-label">
        <small>{locale === "en" ? `REQUEST ${evidence.step}` : `请求 ${evidence.step}`}</small>
        <b>{locale === "en" ? `about ${evidence.totalApproximateTokens} tokens` : `约 ${evidence.totalApproximateTokens} token`}</b>
      </div>
      <div className="request-segments">
        {sharedParts > 0 && (
          <span className="shared">
            <b>{locale === "en" ? "Shared prefix" : "相同开头"}</b>
            <small>{locale === "en" ? "Rules, tools, and existing history" : "规则、工具与已有历史"}</small>
          </span>
        )}
        {tail.map((part, index) => (
          <span className={part.stability === "step-variable" ? "variable" : "added"} key={part.id}>
            <b>{requestComparisonPartLabel(chapter, part, locale)}</b>
            <small>{locale === "en" ? `about ${part.approximateTokens} tokens` : `约 ${part.approximateTokens} token`}</small>
            {current && part.stability !== "step-variable" && <i>{locale === "en" ? "NEW" : "新增"}</i>}
          </span>
        ))}
      </div>
    </div>
  );
}

function requestComparisonPartLabel(chapter: Chapter, part: RequestPart, locale: UiLocale): string {
  if (part.stability === "step-variable") return locale === "en" ? "Step context" : "本步说明";
  if (part.label.startsWith("assistant")) {
    return locale === "en"
      ? chapter.number === "06" ? "Previous Round progress" : "Model Tool Call"
      : chapter.number === "06" ? "上一轮进展" : "模型发起工具调用";
  }
  if (part.label.startsWith("tool")) return requestPartLabel(part, locale);
  if (part.label.startsWith("user") && chapter.number === "06") return locale === "en" ? "Next Round task" : "下一轮任务";
  return requestPartLabel(part, locale);
}

/** 时间线卡（压缩版）：关键事件摘要 */
function TraceCard({ chapter, target, locale }: { chapter: Chapter; target: EvidenceTarget; locale: UiLocale }) {
  const focusIndex = traceFocusIndex(chapter.trace, target);
  const start = chapter.trace.length > 8 ? Math.max(0, focusIndex - 3) : 0;
  const window = chapter.trace.length > 8
    ? chapter.trace.slice(start, focusIndex + 1)
    : chapter.trace;
  const focus = chapter.trace[focusIndex];
  const items = focus?.type === "tool/result" && focus.title.endsWith("word_count")
    ? window.filter((item) => item.type === "runtime/plugin-mounted" || item.title.endsWith("word_count"))
    : window;
  return (
    <div className="evidence-card-body trace-card">
      {chapter.events.length === 0 ? (
        <p className="evidence-card-empty">{locale === "en" ? "This chapter keeps execution records locally. Chapter 4 stores the complete process in one append-only log." : "这一章先保存本地执行记录；第四章把全部过程写入同一条只追加日志。"}</p>
      ) : (
        <>
          <div className="trace-focus-summary">
            <span>{locale === "en" ? "EVIDENCE WINDOW" : "证据窗口"}</span>
            <b>{locale === "en" ? "EVENT" : "事件"} {focus ? String(focus.eventId).padStart(2, "0") : "—"} · {focus ? traceLabel(focus.type, locale) : locale === "en" ? "No target" : "无目标"}</b>
            <small>{locale === "en" ? `${items.length} directly related events shown; ${chapter.events.length} in this chapter` : `显示 ${items.length} 条直接相关事件；全章共 ${chapter.events.length} 条`}</small>
          </div>
          <ol>
            {items.map((item) => (
              <li key={`${item.eventId}-${item.type}`} className={`${traceClass(item.type)} ${item.eventId === focus?.eventId ? "focus" : ""}`}>
                <span>{String(item.eventId).padStart(2, "0")}</span>
                <i />
                <div>
                  <small>{traceLabel(item.type, locale)}</small>
                  <b>{humanTraceTitle(item, locale)}</b>
                  {item.detail && <span className="trace-detail">{item.detail}</span>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function traceFocusIndex(trace: Chapter["trace"], target: EvidenceTarget): number {
  if (!target.event || trace.length === 0) return Math.max(0, trace.length - 1);
  const matches = trace
    .map((item, index) => item.type === target.event?.type ? index : -1)
    .filter((index) => index >= 0);
  if (matches.length === 0) return trace.length - 1;
  if (target.event.occurrence === "last") return matches.at(-1)!;
  const occurrence = typeof target.event.occurrence === "number" ? target.event.occurrence : 1;
  return matches[Math.max(0, occurrence - 1)] ?? matches.at(-1)!;
}

/** 能力图卡（压缩版）：插件归属快照 */
function GraphCard({ chapter, target, locale }: { chapter: Chapter; target: EvidenceTarget; locale: UiLocale }) {
  const graph = graphSnapshotForEvidenceStep(chapter, target.step);
  if (!graph) {
    return (
      <div className="evidence-card-body graph-card">
        <p className="evidence-card-empty">{locale === "en" ? "Chapter 3 adds capability ownership. The first two chapters assemble tools directly without recording their source." : "能力归属会在第三章加入：前两章直接组装工具，不记录来源。"}</p>
      </div>
    );
  }
  if (chapter.number === "05") {
    return <EvolutionGraphCard chapter={chapter} graph={graph} locale={locale} />;
  }
  if (chapter.number === "03") {
    return <DependencyGraphCard graph={graph} locale={locale} />;
  }
  return (
    <div className="evidence-card-body graph-card">
      <div className="graph-ledger">
        <section><small>{locale === "en" ? "PLUGINS" : "插件"} · {graph.plugins.length}</small>{graph.plugins.map((plugin) => <span key={plugin}>{prettyPlugin(plugin, locale)}</span>)}</section>
        <section><small>{locale === "en" ? "TOOLS" : "工具"} · {graph.tools.length}</small>{graph.tools.map((tool) => <span key={tool.name}>{tool.name}</span>)}</section>
        <section><small>{locale === "en" ? "PROMPTS" : "提示词"} · {graph.prompts.length}</small>{graph.prompts.map((prompt) => <span key={prompt.id ?? prompt.text} title={prompt.text}>{prettyPrompt(prompt.id, locale)}</span>)}</section>
        <section><small>{locale === "en" ? "SERVICES" : "服务"} · {graph.services.length}</small>{graph.services.map((service) => <span key={service.name}>{service.name}</span>)}</section>
      </div>
      {graph.relations.length > 0 && (
        <p className="graph-relations">
          <b>{locale === "en" ? "DEPENDENCIES" : "依赖"}</b>
          {graph.relations.map((relation) => (
            <span key={`${relation.consumer}-${relation.service}-${relation.provider}`}>
              {prettyPlugin(relation.consumer, locale)} → {prettyPlugin(relation.provider, locale)} ({relation.service})
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function DependencyGraphCard({ graph, locale }: { graph: GraphSnapshot; locale: UiLocale }) {
  const relation = graph.relations[0];
  if (!relation) {
    return <div className="evidence-card-body graph-card"><p className="evidence-card-empty">{locale === "en" ? "This snapshot has no plugin dependencies." : "当前快照没有插件依赖。"}</p></div>;
  }
  const contributions = [
    ...graph.tools
      .filter((tool) => (tool.owner ?? tool.plugin) === relation.consumer)
      .map((tool) => ({ kind: "TOOL", name: tool.name })),
    ...graph.prompts
      .filter((prompt) => (prompt.owner ?? prompt.plugin) === relation.consumer)
      .map((prompt) => ({ kind: "PROMPT", name: prettyPrompt(prompt.id, locale) })),
  ];
  return (
    <div className="evidence-card-body dependency-snapshot">
      <div className="dependency-flow" aria-label={locale === "en" ? `${relation.consumer} depends on the ${relation.service} service from ${relation.provider}` : `${relation.consumer} 依赖 ${relation.provider} 提供的 ${relation.service} 服务`}>
        <div className="dependency-node consumer">
          <small>{locale === "en" ? "CONSUMER PLUGIN" : "使用方插件"}</small>
          <code>{relation.consumer}</code>
        </div>
        <div className="dependency-link" aria-hidden="true">
          <span>{locale === "en" ? `uses ${relation.service}` : `使用 ${relation.service} 服务`}</span>
          <b>→</b>
        </div>
        <div className="dependency-node provider">
          <small>{locale === "en" ? "PROVIDER PLUGIN" : "提供方插件"}</small>
          <code>{relation.provider}</code>
        </div>
      </div>
      <div className="dependency-contributions">
        <span className="dependency-branch" aria-hidden="true">↓</span>
        <b>{locale === "en" ? `${relation.consumer} also contributes to Context` : `${relation.consumer} 同时向 Context 贡献`}</b>
        <div>
          {contributions.map((item) => (
            <span key={`${item.kind}-${item.name}`}><small>{item.kind}</small><code>{item.name}</code></span>
          ))}
        </div>
      </div>
      <div className="dependency-conclusion">
        <b>{locale === "en" ? "HOW TO READ THIS" : "读图结论"}</b>
        <span>{locale === "en" ? "Context records each contribution's source in owner and links service consumers to providers through dependency records." : "Context 用 owner 记录贡献来源，用依赖关系连接服务的使用方和提供方。"}</span>
      </div>
    </div>
  );
}

type EvolutionPhase = "baseline" | "mounted" | "restored";

/** 第五章的能力快照只讲一次变化，不让读者从完整清单里自行找差异。 */
function EvolutionGraphCard({ chapter, graph, locale }: { chapter: Chapter; graph: GraphSnapshot; locale: UiLocale }) {
  const baseline = chapter.graphs.find((snapshot) => snapshot.stepId === "before-install")
    ?? chapter.graphs[0]
    ?? graph;
  const mounted = chapter.graphs.find((snapshot) =>
    snapshot.tools.some((tool) => tool.name === "word_count")) ?? graph;
  const capabilityName = mounted.plugins.find((plugin) => !baseline.plugins.includes(plugin))
    ?? "dynamic:word_count";
  const phase: EvolutionPhase = graph.stepId === "after-remove"
    ? "restored"
    : graph.tools.some((tool) => tool.name === "word_count")
      ? "mounted"
      : "baseline";
  const phaseIndex = ({ baseline: 0, mounted: 1, restored: 2 } as const)[phase];
  const comparison = phase === "mounted" ? baseline : phase === "restored" ? mounted : null;
  const pluginDelta = comparison ? graph.plugins.length - comparison.plugins.length : 0;
  const toolDelta = comparison ? graph.tools.length - comparison.tools.length : 0;
  const phaseCopyZh = ({
    baseline: {
      pluginStatus: "尚未加入",
      toolStatus: "不可调用",
      relation: "能力缺口",
      timingLabel: "下一步",
      timing: "定义并运行插件，再观察这两个位置是否发生变化。",
    },
    mounted: {
      pluginStatus: "新增插件",
      toolStatus: "新增工具",
      relation: "向 Context 注册",
      timingLabel: "生效时点",
      timing: "下一次模型请求会读取更新后的工具列表。",
    },
    restored: {
      pluginStatus: "已移除",
      toolStatus: "已移除",
      relation: "贡献已撤销",
      timingLabel: "验证结果",
      timing: "插件和工具数量都回到实验开始前的基线。",
    },
  } as const)[phase];
  const phaseCopyEn = ({
    baseline: {
      pluginStatus: "Not installed",
      toolStatus: "Unavailable",
      relation: "Capability gap",
      timingLabel: "NEXT STEP",
      timing: "Define and run the plugin, then check whether these two positions change.",
    },
    mounted: {
      pluginStatus: "Plugin added",
      toolStatus: "Tool added",
      relation: "Registers with Context",
      timingLabel: "WHEN IT TAKES EFFECT",
      timing: "The next model request reads the updated tool list.",
    },
    restored: {
      pluginStatus: "Removed",
      toolStatus: "Removed",
      relation: "Contributions withdrawn",
      timingLabel: "VERIFICATION",
      timing: "Plugin and tool counts have returned to their pre-experiment baseline.",
    },
  } as const)[phase];
  const phaseCopy = locale === "en" ? phaseCopyEn : phaseCopyZh;

  return (
    <div className={`evidence-card-body evolution-snapshot ${phase}`}>
      <ol className="evolution-steps" aria-label={locale === "en" ? "Runtime capability stages" : "运行时能力变化阶段"}>
        {(locale === "en" ? ["Before", "Mounted", "Removed"] : ["运行前", "已挂载", "已移除"]).map((label, index) => (
          <li className={index === phaseIndex ? "current" : index < phaseIndex ? "done" : ""} key={label}>
            <i>{index < phaseIndex ? "✓" : index + 1}</i>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <div className="evolution-flow" aria-label={locale === "en" ? `${capabilityName} provides the word_count tool` : `${capabilityName} 提供 word_count 工具`}>
        <div className="evolution-node plugin">
          <small>PLUGIN</small>
          <code>{capabilityName}</code>
          <span>{phaseCopy.pluginStatus}</span>
        </div>
        <div className="evolution-link" aria-hidden="true">
          <span>{phaseCopy.relation}</span>
          <b>→</b>
        </div>
        <div className="evolution-node tool">
          <small>TOOL</small>
          <code>word_count</code>
          <span>{phaseCopy.toolStatus}</span>
        </div>
      </div>

      <div className="evolution-metrics" aria-label={locale === "en" ? "Capability count changes" : "能力数量变化"}>
        <EvolutionMetric label={locale === "en" ? "Plugins" : "插件"} before={comparison?.plugins.length} after={graph.plugins.length} delta={pluginDelta} />
        <EvolutionMetric label={locale === "en" ? "Tools" : "工具"} before={comparison?.tools.length} after={graph.tools.length} delta={toolDelta} />
      </div>

      <div className="evolution-note">
        <span>{locale === "en" ? "UNCHANGED" : "未变化"}</span>
        <b>{locale === "en" ? "Prompts" : "提示词"} {graph.prompts.length}</b>
        <b>{locale === "en" ? "Services" : "服务"} {graph.services.length}</b>
      </div>
      <div className="evolution-timing">
        <b>{phaseCopy.timingLabel}</b>
        <span>{phaseCopy.timing}</span>
      </div>
    </div>
  );
}

function EvolutionMetric({
  label,
  before,
  after,
  delta,
}: {
  label: string;
  before: number | undefined;
  after: number;
  delta: number;
}) {
  return (
    <div>
      <small>{label}</small>
      <strong>{before === undefined ? after : <>{before}<i>→</i>{after}</>}</strong>
      {before !== undefined && <span>{delta > 0 ? `+${delta}` : delta}</span>}
    </div>
  );
}

function CodeBlock({
  code,
  startLine = 1,
  diff = false,
  language = "typescript",
  highlightedRange = null,
  newLines = null,
  enteringLines = null,
  sourceLineNumbers = null,
  annotations = [],
}: {
  code: string;
  startLine?: number;
  diff?: boolean;
  language?: string;
  highlightedRange?: [number, number] | null;
  newLines?: Set<number> | null;
  /** 需要打字机写入动画的新增行（相对该行号排序确定交错延迟） */
  enteringLines?: Set<number> | null;
  /** 快照渲染时逐行指定源文件真实行号（与 code 的行一一对应） */
  sourceLineNumbers?: number[] | null;
  /** 在指定源文件行之前插入的教学注释，不占用真实行号。 */
  annotations?: Array<{ beforeLine: number; text: string }>;
}) {
  const english = document.documentElement.lang === "en";
  const lines = code.trimEnd().split(/\r?\n/u);
  const languages = diffLanguages(lines, language);
  const enteringOrder = useMemo(() => {
    if (!enteringLines || enteringLines.size === 0) return new Map<number, number>();
    return new Map(
      [...enteringLines].sort((a, b) => a - b).map((line, index) => [line, index]),
    );
  }, [enteringLines]);
  return (
    <div className={`code-lines ${highlightedRange ? "has-line-focus" : ""}`} role="region" aria-label={english ? diff ? "Line-by-line code diff" : "Source code" : diff ? "逐行代码差异" : "源代码"}>
      {lines.map((line, index) => {
        const lineNumber = sourceLineNumbers?.[index] ?? startLine + index;
        const comments = annotations.filter((item) => item.beforeLine === lineNumber);
        const highlighted = highlightedRange !== null
          && lineNumber >= highlightedRange[0]
          && lineNumber <= highlightedRange[1];
        const enteringIndex = enteringOrder.get(lineNumber);
        const isEntering = enteringIndex !== undefined;
        return (
          <Fragment key={index}>
            {comments.map((comment) => (
              <div key={comment.text} className="code-segment-comment">
                <span className="line-no" aria-hidden="true">···</span>
                <SyntaxCode code={comment.text} language={language} />
              </div>
            ))}
            <div
              data-line={lineNumber}
              className={`${diff ? diffClass(line) : "code-line"} ${highlighted ? "highlighted" : ""} ${newLines?.has(lineNumber) ? "is-new" : ""} ${isEntering ? "is-entering" : ""}`.trim()}
              style={isEntering ? ({
                "--write-delay": `${120 + enteringIndex! * 28}ms`,
                "--write-duration": `${Math.max(260, line.length * 10)}ms`,
              } as CSSProperties) : undefined}
            >
              <span className="line-no">{String(lineNumber).padStart(3, "0")}</span>
              {diff
                ? <DiffCodeLine line={line} language={languages[index] ?? language} />
                : <SyntaxCode code={line || " "} language={language} />}
            </div>
          </Fragment>
        );
      })}
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

function LoadFailure({ message, locale }: { message: string; locale: UiLocale }) {
  return <div className="load-state"><b>{locale === "en" ? "Could not load tutorial data" : "教程数据加载失败"}</b><span>{message}</span><p>{locale === "en" ? "Run pnpm tutorial:generate first." : "请先运行 pnpm tutorial:generate。"}</p></div>;
}

function Loading({ locale }: { locale: UiLocale }) {
  return <div className="load-state"><b>{locale === "en" ? "Loading tutorial…" : "正在加载教程…"}</b><span>{locale === "en" ? "Reading source and execution records for all six chapters" : "正在读取六章源码与执行记录"}</span></div>;
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
      const fill = /^<!--\s*fill\s+([\s\S]+?)\s*-->$/u.exec(block)?.[1];
      if (fill) {
        try {
          const directive = JSON.parse(fill) as { index?: unknown };
          if (!Number.isInteger(directive.index) || (directive.index as number) < 0) {
            throw new Error("missing non-negative fill index");
          }
          return [{ kind: "fill", fillIndex: directive.index as number }];
        } catch (error) {
          console.warn("Ignored invalid lesson fill directive", error);
          return [];
        }
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

function scrollEvidenceIntoView(element: HTMLElement): void {
  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  const container = element.closest<HTMLElement>(".code-lines");
  if (!container) return;
  const elementBox = element.getBoundingClientRect();
  const containerBox = container.getBoundingClientRect();
  const centeredTop = container.scrollTop
    + elementBox.top
    - containerBox.top
    - (container.clientHeight - elementBox.height) / 2;
  container.scrollTo({ top: Math.max(0, centeredTop), behavior });
}

function parsePrimer(markdown: string, language: TutorialLanguage): {
  intro: string;
  cards: Array<{ title: string; code: string; body: string }>;
} {
  if (!markdown) return { intro: `${language === "python" ? "Python" : "TypeScript"} 阅读补充暂时不可用。`, cards: [] };
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
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/gu).map((part, index) => {
    if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong className="inline-emphasis" key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function formatLineRange(range: [number, number]): string {
  return range[0] === range[1] ? `第 ${range[0]} 行` : `第 ${range[0]}–${range[1]} 行`;
}


function toolNameLabel(name: string, locale: UiLocale = "zh"): string {
  if (locale === "en") {
    return ({
      read_workspace_file: "Read workspace file",
      apply_patch: "Apply exact patch",
      run_tests: "Run regression tests",
      submit_patch: "Submit patch",
      inspect_runtime: "Inspect runtime",
      cordis_inspect: "List Cordis plugins and capabilities",
      install_capability: "Install temporary capability",
      remove_capability: "Remove temporary capability",
      cordis_define: "Define Cordis plugin",
      cordis_run: "Run Cordis plugin",
      cordis_stop: "Stop Cordis plugin",
      cordis_undefine: "Remove Cordis plugin",
      get_time: "Get city time",
      read_note: "Read note",
      word_count: "Count words",
      find_references: "Find references",
      check_types: "Check TypeScript types",
    } as Record<string, string>)[name] ?? name;
  }
  return ({
    read_workspace_file: "读取工作区文件",
    apply_patch: "应用精确补丁",
    run_tests: "运行回归测试",
    submit_patch: "提交补丁",
    inspect_runtime: "检查运行环境",
    cordis_inspect: "列出 Cordis 插件与能力",
    install_capability: "安装临时能力",
    remove_capability: "移除临时能力",
    cordis_define: "定义 Cordis 插件",
    cordis_run: "运行 Cordis 插件",
    cordis_stop: "停止 Cordis 插件",
    cordis_undefine: "移除 Cordis 插件",
    get_time: "查询城市时间",
    read_note: "读取备忘录",
    word_count: "统计单词数",
    find_references: "查找调用方",
    check_types: "检查 TypeScript 类型",
  } as Record<string, string>)[name] ?? name;
}

function chapterName(number: string, locale: UiLocale): string {
  return locale === "en" ? `Chapter ${Number(number)}` : `第${chapterNumeral(number)}章`;
}

function chapterNavTitle(chapter: Chapter, locale: UiLocale): string {
  if (locale === "zh") return chapter.shortTitle;
  return ({
    "01": "Agent Loop",
    "02": "Context & Cache",
    "03": "Plugins",
    "04": "Traceable Runs",
    "05": "Runtime Evolution",
    "06": "Long Tasks",
  } as Record<string, string>)[chapter.number] ?? chapter.shortTitle;
}

function fixedChapterTitle(chapter: Chapter, locale: UiLocale): string {
  return locale === "en"
    ? `${chapterName(chapter.number, locale)} · ${chapter.shortTitle}`
    : `${chapterName(chapter.number, locale)}·${chapter.shortTitle}`;
}

/** 插件运行时与会话事件是 DSH 的两条结构主线：前者决定能力怎样组成，
 * 后者让请求、回放和恢复共享同一份事实。 */
function isCoreChapter(chapter: Pick<Chapter, "number">): boolean {
  return chapter.number === "03" || chapter.number === "04";
}

function chapterNumeral(number: string): string {
  return ({ "01": "一", "02": "二", "03": "三", "04": "四", "05": "五", "06": "六" } as Record<string, string>)[number] ?? number;
}

function requestPartLabel(part: RequestPart, locale: UiLocale): string {
  if (part.kind === "system") return locale === "en" ? "System rules" : "系统规则";
  if (part.kind === "tools") return locale === "en" ? "Available actions and parameter schemas" : "可用动作与参数规则";
  if (part.kind === "dynamic") return locale === "en" ? "Step context" : "本步说明";
  if (part.label.startsWith("user")) return locale === "en" ? "User message" : "用户消息";
  if (part.label.startsWith("assistant")) return locale === "en" ? "Model response" : "模型回复";
  if (part.label.startsWith("system")) return locale === "en" ? "History summary" : "历史摘要";
  if (part.label.startsWith("tool")) {
    const name = part.label.split(" · ")[1];
    return name ? locale === "en" ? `Tool Result · ${name}` : `工具结果 · ${name}` : locale === "en" ? "Tool Result" : "工具结果";
  }
  return part.label;
}

function stabilityLabel(stability: RequestPart["stability"], locale: UiLocale): string {
  return (locale === "en" ? {
    stable: "Stable",
    "append-only": "Append-only",
    "step-variable": "Step-specific",
  } : {
    stable: "固定区",
    "append-only": "累积区",
    "step-variable": "本步区",
  })[stability];
}

function invalidationLabel(value: string | null, locale: UiLocale): string {
  if (locale === "en") {
    if (value === null) return "The previous request is fully preserved as the prefix";
    if (value.startsWith("First request")) return "Baseline request for this chapter; prefix comparison begins with the next Step";
    return value;
  }
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

function sourceFileLabel(path: string): string {
  return path.replace(/^(?:src|python_harness)\//u, "");
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

function traceLabel(type: string, locale: UiLocale): string {
  const labels = locale === "en" ? {
    "turn/start": "Turn started",
    "turn/end": "Turn ended",
    "user/message": "User input",
    "step/start": "Model Step started",
    "step/end": "Model Step ended",
    "request/header": "Model request",
    "assistant/message": "Model response",
    "tool/call": "Tool Call",
    "tool/result": "Tool Result",
    "context/checkpoint": "Context checkpoint",
    "runtime/plugin-mounted": "Capability installed",
    "runtime/plugin-unmounted": "Capability removed",
    "goal/created": "Goal created",
    "goal/round-started": "Round started",
    "goal/status-changed": "Goal status changed",
  } : {
    "turn/start": "一轮开始",
    "turn/end": "一轮结束",
    "user/message": "用户输入",
    "step/start": "模型步骤开始",
    "step/end": "模型步骤结束",
    "request/header": "模型请求",
    "assistant/message": "模型回复",
    "tool/call": "工具调用",
    "tool/result": "工具结果",
    "context/checkpoint": "上下文摘要点",
    "runtime/plugin-mounted": "能力已安装",
    "runtime/plugin-unmounted": "能力已移除",
    "goal/created": "任务已创建",
    "goal/round-started": "新一轮开始",
    "goal/status-changed": "任务状态变化",
  };
  return (labels as Record<string, string>)[type] ?? (locale === "en" ? "Execution event" : "过程事件");
}

function humanTraceTitle(item: Chapter["trace"][number], locale: UiLocale): string {
  if (item.type === "tool/call") return item.title.replace(/^call\s+/u, locale === "en" ? "Use " : "请求使用 ");
  if (item.type === "tool/result") return item.title.replace(/^result\s+/u, locale === "en" ? "Received · " : "收到结果 · ");
  if (item.type === "goal/round-started") return item.title.replace(/^round\s+(\d+)\s*·/u, locale === "en" ? "Round $1 ·" : "第 $1 轮 ·");
  if (item.type === "goal/status-changed" && item.detail.startsWith("completed")) return locale === "en" ? "Goal completed" : "Goal 已完成";
  if (item.title === item.type) {
    const earlyStep = /^step\/(\d+)\/start$/u.exec(item.type);
    if (earlyStep) return locale === "en" ? `Model Step ${earlyStep[1]} started` : `第 ${earlyStep[1]} 个模型步骤开始`;
    if (item.type === "llm/request") return locale === "en" ? "Build model request" : "生成模型请求";
    const tools = ({
      read_workspace_file: "读取工作区文件",
      apply_patch: "应用精确补丁",
      run_tests: "运行回归测试",
      submit_patch: "提交补丁",
      inspect_runtime: "检查运行环境",
      cordis_inspect: "列出 Cordis 插件与能力",
      install_capability: "安装临时能力",
      remove_capability: "移除临时能力",
      cordis_define: "定义 Cordis 插件",
      cordis_run: "运行 Cordis 插件",
      cordis_stop: "停止 Cordis 插件",
      cordis_undefine: "移除 Cordis 插件",
      find_references: "查找调用方",
      check_types: "检查 TypeScript 类型",
    } as Record<string, string>)[item.type];
    if (locale === "en") return toolNameLabel(item.type, locale) ?? traceLabel(item.type, locale);
    return tools ?? traceLabel(item.type, locale);
  }
  return item.title;
}

function prettyPlugin(plugin: string, locale: UiLocale): string {
  const known = (locale === "en" ? {
    "session-log": "Session Log",
    "runtime-tools": "Capability management tools",
    "trusted-capability-catalog": "Trusted capability catalog",
    "capability:word_count": "Temporary · word count",
    "dynamic:word_count": "Dynamic · word count",
    "dynamic:typescript_analysis": "Dynamic · TypeScript analysis",
    "checkout-workspace-state": "Checkout workspace state",
    "checkout-workspace": "File and patch tools",
    "checkout-tests": "Test and submission tools",
  } : {
    "session-log": "过程日志",
    "runtime-tools": "能力管理工具",
    "trusted-capability-catalog": "受信任能力目录",
    "capability:word_count": "临时 · 分词统计",
    "dynamic:word_count": "动态 · 分词统计",
    "dynamic:typescript_analysis": "动态 · TypeScript 分析",
    "checkout-workspace-state": "结账工作区状态",
    "checkout-workspace": "文件与补丁工具",
    "checkout-tests": "测试与提交工具",
  } as Record<string, string>)[plugin];
  if (known) return known;
  return plugin
    .replace(/^provider:/u, locale === "en" ? "Model · " : "模型 · ")
    .replace(/^capability:/u, locale === "en" ? "Temporary · " : "临时 · ")
    .replaceAll("-", " ");
}

function prettyPrompt(id: string | undefined, locale: UiLocale): string {
  if (id === "runtime-experiment-boundary") return locale === "en" ? "Runtime experiment boundary" : "运行时实验边界";
  if (id === "clock-rule") return locale === "en" ? "Time-tool call rule" : "时间工具调用规则";
  return id ?? "Prompt";
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
