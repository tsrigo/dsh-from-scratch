import { useEffect, useRef } from "react";

interface FilmDefinition {
  answer: string;
  evidence: string[];
  number: string;
  question: string;
  slug: string;
}

const FILMS: Record<string, FilmDefinition> = {
  "01": {
    number: "01",
    slug: "01-agent-loop",
    question: "DSH 的 Agent Loop 是什么样的？",
    answer: "一个有 maxSteps 上限的 Turn 循环：每个 Step 重建请求，模型决定调用，Harness 校验、执行、记录并决定继续或停止。",
    evidence: ["Agent.runTurn()", "UnifiedRequest", "7 项 M01 测试"],
  },
  "02": {
    number: "02",
    slug: "02-context-cache",
    question: "上下文怎样组织，又为缓存复用做了什么？",
    answer: "完整历史先投影成模型可见上下文，再按 stable → append-only → step-variable 排列，以保留相邻请求最长的规范化相同前缀。",
    evidence: ["clipToolResult()", "compareRequestPrefix()", "原始 CI 日志仍保留"],
  },
  "03": {
    number: "03",
    slug: "03-plugin-kernel",
    question: "如何实现“一切皆插件”？",
    answer: "所有运行时贡献都在 plugin.setup() 中登记 owner 与逆操作；成功返回幂等 disposer，失败和卸载共用逆序 rollback。",
    evidence: ["Context.mount()", "inverse effect stack", "失败后零残留"],
  },
  "04": {
    number: "04",
    slug: "04-session-log",
    question: "DSH 怎么记录和保存 Agent 执行过程？",
    answer: "只追加 Session Log 保存规范事实；历史请求和人类 Trace 都从同一事件流按目标时间切面重建。",
    evidence: ["typed SessionEvent", "buildRequest()", "replayTrace()"],
  },
  "05": {
    number: "05",
    slug: "05-runtime-evolution",
    question: "DSH 是如何持续自进化的？",
    answer: "反复执行受信能力实验：检查现状、目录内试装、下一请求生效、用真实结果验证，再完整移除或保留。",
    evidence: ["trusted catalog enum", "普通 mount 生命周期", "mounted → used → unmounted"],
  },
  "06": {
    number: "06",
    slug: "06-long-task",
    question: "DSH 是如何持续完成长程任务的？",
    answer: "Goal 在有界 Turn 外组织有界 Round；多个 Round 共享历史，并由实际事件与工作区状态决定完成、补充、继续或停止。",
    evidence: ["Goal ⊃ Round ⊃ Turn ⊃ Step", "evidence gate", "completed / blocked / max-rounds"],
  },
};

export function ConceptFilm({ chapterNumber }: { chapterNumber: string }) {
  const definition = FILMS[chapterNumber];
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      return;
    }
    void video.play().catch(() => {
      // Native controls remain available when autoplay is blocked.
    });
  }, [chapterNumber]);

  if (!definition) return null;

  return (
    <figure className="concept-film" aria-labelledby={`concept-film-${definition.number}`}>
      <header className="concept-film-heading">
        <div>
          <span>MANIM CE · PROGRAMMATIC EXPLAINER</span>
          <h3 id={`concept-film-${definition.number}`}>{definition.question}</h3>
          <p>从误解出发，让源码结构在画面中完成推导，再用测试不变量收束答案。</p>
        </div>
        <div className="concept-film-render-meta" aria-label="动画技术信息">
          <b>PY</b><span>16:9 · 30 FPS</span>
        </div>
      </header>

      <div className="concept-film-video-wrap">
        <video
          key={definition.slug}
          ref={videoRef}
          src={`/animations/${definition.slug}.mp4`}
          poster={`/animations/${definition.slug}.jpg`}
          controls
          muted
          playsInline
          preload="metadata"
          aria-label={`${definition.question} Manim 解释动画`}
        >
          你的浏览器不支持 HTML 视频。动画的文字答案：{definition.answer}
        </video>
      </div>

      <figcaption className="concept-film-answer">
        <span>本片答案</span>
        <strong>{definition.answer}</strong>
        <div className="concept-film-evidence" aria-label="答案对应的源码证据">
          {definition.evidence.map((item) => <i key={item}>{item}</i>)}
        </div>
      </figcaption>
    </figure>
  );
}
