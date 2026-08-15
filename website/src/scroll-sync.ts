// website/src/scroll-sync.ts
// 骨架渐进填充的数据工具：checkpoint 快照与新增行判定。
// 机制借鉴 nano-dsh web/app/Reader.tsx 的逐段补全，独立实现。

import type { Chapter, GraphSnapshot } from "./types.js";

export interface FillSlice {
  label: string;
  kind: "skeleton" | "body";
  ranges: Array<[number, number]>;
}

export interface SnapshotLine {
  /** 源文件真实行号（1 起） */
  number: number;
  text: string;
}

export interface CodeLineProgress {
  /** 当前阅读位置已经展示的源码行数。 */
  revealedLines: number;
  /** 当前语言六章源码的总行数。 */
  totalLines: number;
  /** 供进度条宽度使用的百分比。 */
  percent: number;
}

/** 章节的填充序列；无 fills 标注（如 Python 版）时返回空数组。 */
export function chapterFills(chapter: Chapter): FillSlice[] {
  return chapter.codeGuide.fills ?? [];
}

/** 一章源文件的物理代码行数；结尾换行不单独计为一行。 */
export function chapterCodeLineCount(chapter: Pick<Chapter, "source">): number {
  const content = chapter.source.content.trimEnd();
  return content ? content.split(/\r?\n/u).length : 0;
}

/** 当前 checkpoint 已经出现在代码面板中的行数。
 * 最后一段出现时直接以该文件总行数封顶，确保读完整章后进度恰好到达该章的终点。 */
export function revealedCodeLineCount(chapter: Chapter, checkpoint: number | null): number {
  const fills = chapterFills(chapter);
  const total = chapterCodeLineCount(chapter);
  if (fills.length === 0) return total;
  if (checkpoint === null) return 0;
  if (checkpoint >= fills.length - 1) return total;
  return Math.min(
    total,
    snapshotForCheckpoint(chapter, checkpoint)
      .filter((line) => line.number <= total)
      .length,
  );
}

/** 顶栏使用全书源码行数：此前章节按已读完计入，当前章节只计入已揭示的代码。 */
export function globalCodeLineProgress(
  chapters: Chapter[],
  currentChapter: Pick<Chapter, "id">,
  checkpoint: number | null,
): CodeLineProgress {
  const totalLines = chapters.reduce((total, chapter) => total + chapterCodeLineCount(chapter), 0);
  const currentIndex = chapters.findIndex((chapter) => chapter.id === currentChapter.id);
  if (currentIndex === -1 || totalLines === 0) {
    return { revealedLines: 0, totalLines, percent: 0 };
  }
  const completedLines = chapters
    .slice(0, currentIndex)
    .reduce((total, chapter) => total + chapterCodeLineCount(chapter), 0);
  const revealedLines = Math.min(
    totalLines,
    completedLines + revealedCodeLineCount(chapters[currentIndex]!, checkpoint),
  );
  return {
    revealedLines,
    totalLines,
    percent: Math.round((revealedLines / totalLines) * 100),
  };
}

/** 正文证据块中的 requestStep 使用从零开始的索引；能力图必须选择同一步快照。 */
export function graphSnapshotForEvidenceStep(
  chapter: Pick<Chapter, "graphs">,
  step?: number,
): GraphSnapshot | undefined {
  if (chapter.graphs.length === 0) return undefined;
  if (step === undefined) return chapter.graphs.at(-1);
  return chapter.graphs[step] ?? chapter.graphs.at(-1);
}

/** checkpoint 快照：激活 fills[0..checkpoint] 的全部区间，按源文件行号排序拼接。
 * 骨架的收尾大括号（文件末行）会沉到快照末尾：读者先看到「名字 + 大括号」，
 * 随滚动推进，中间的实现段按行号顺序逐渐补入。 */
export function snapshotForCheckpoint(chapter: Chapter, checkpoint: number): SnapshotLine[] {
  const fills = chapterFills(chapter);
  const contentLines = chapter.source.content.trimEnd().split(/\r?\n/u);
  if (fills.length === 0) {
    return contentLines.map((text, index) => ({ number: index + 1, text }));
  }
  const wanted = new Set<number>();
  const last = Math.min(checkpoint, fills.length - 1);
  for (let index = 0; index <= last; index += 1) {
    for (const [start, end] of fills[index]!.ranges) {
      for (let line = start; line <= end; line += 1) wanted.add(line);
    }
  }
  // 保留已显示代码之间的纯空行。它们虽然不属于任何 fill，仍然是源文件的
  // 真实行；否则读者会看到例如 211 直接跳到 213 的行号断层。
  const ordered = [...wanted].sort((left, right) => left - right);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const gapIsBlank = Array.from(
      { length: current - previous - 1 },
      (_, offset) => contentLines[previous + offset]?.trim() === "",
    ).every(Boolean);
    if (!gapIsBlank) continue;
    for (let line = previous + 1; line < current; line += 1) wanted.add(line);
  }
  return [...wanted]
    .sort((left, right) => left - right)
    .map((number) => ({ number, text: contentLines[number - 1] ?? "" }));
}

/** 单个 fill 对应的源码片段。移动端将它直接放在讲解卡片下方，
 * 因此只返回当前 fill 声明的区间，不累计前面的 checkpoint。 */
export function snapshotForFill(chapter: Chapter, fillIndex: number): SnapshotLine[] {
  const fill = chapterFills(chapter)[fillIndex];
  if (!fill) return [];
  const contentLines = chapter.source.content.trimEnd().split(/\r?\n/u);
  const wanted = new Set<number>();
  for (const [start, end] of fill.ranges) {
    for (let line = start; line <= end; line += 1) wanted.add(line);
  }
  return [...wanted]
    .sort((left, right) => left - right)
    .map((number) => ({ number, text: contentLines[number - 1] ?? "" }));
}

/** 相对上一快照新增的行号集合（含空行）：新增代码块中的空行与代码行
 * 一起高亮，读者才能看到完整的新增块边界。 */
export function newLineNumbers(previous: SnapshotLine[], current: SnapshotLine[]): Set<number> {
  const previousNumbers = new Set(previous.map((line) => line.number));
  return new Set(
    current
      .filter((line) => !previousNumbers.has(line.number))
      .map((line) => line.number),
  );
}

/** 是否已到达章节最后一个 checkpoint（快照覆盖了源文件末尾）。 */
export function isFinalCheckpoint(chapter: Chapter, checkpoint: number): boolean {
  const fills = chapterFills(chapter);
  if (fills.length === 0) return true;
  const total = chapter.source.content.trimEnd().split(/\r?\n/u).length;
  const snapshot = snapshotForCheckpoint(chapter, checkpoint);
  return snapshot.length > 0 && snapshot[snapshot.length - 1]!.number >= total;
}
