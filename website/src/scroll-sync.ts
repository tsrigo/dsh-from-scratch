// website/src/scroll-sync.ts
// 骨架渐进填充的数据工具：checkpoint 快照与新增行判定。
// 机制借鉴 nano-dsh web/app/Reader.tsx 的逐段补全，独立实现。

import type { Chapter } from "./types.js";

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

/** 章节的填充序列；无 fills 标注（如 Python 版）时返回空数组。 */
export function chapterFills(chapter: Chapter): FillSlice[] {
  return chapter.codeGuide.fills ?? [];
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
  return [...wanted]
    .sort((left, right) => left - right)
    .map((number) => ({ number, text: contentLines[number - 1] ?? "" }));
}

/** 相对上一快照新增的行号集合（行号集合差；fills 区间单调，无需 LCS）。 */
export function newLineNumbers(previous: SnapshotLine[], current: SnapshotLine[]): Set<number> {
  const previousNumbers = new Set(previous.map((line) => line.number));
  return new Set(
    current.filter((line) => !previousNumbers.has(line.number)).map((line) => line.number),
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
