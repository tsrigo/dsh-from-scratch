import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chapterFills,
  chapterCodeLineCount,
  globalCodeLineProgress,
  graphSnapshotForEvidenceStep,
  isFinalCheckpoint,
  newLineNumbers,
  snapshotForCheckpoint,
  snapshotForFill,
} from "../website/src/scroll-sync.js";
import type { TutorialData } from "../website/src/types.js";

const tutorial = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../website/public/generated/tutorial.json"), "utf8"),
) as TutorialData;
const pythonTutorial = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../website/public/generated/tutorial-python.json"),
    "utf8",
  ),
) as TutorialData;

describe("chapterFills", () => {
  it("every TypeScript chapter has a skeleton-first fill sequence", () => {
    for (const chapter of tutorial.chapters) {
      const fills = chapterFills(chapter);
      expect(fills.length).toBeGreaterThanOrEqual(2);
      expect(fills[0]!.kind).toBe("skeleton");
      expect(fills.slice(1).every((fill) => fill.kind === "body")).toBe(true);
      for (const fill of fills) {
        for (const [start, end] of fill.ranges) {
          expect(start).toBeGreaterThanOrEqual(1);
          expect(end).toBeLessThanOrEqual(
            chapter.source.content.split("\n").length,
          );
        }
      }
    }
  });

  it("Python chapters also carry a skeleton-first fill sequence", () => {
    for (const chapter of pythonTutorial.chapters) {
      const fills = chapterFills(chapter);
      expect(fills.length).toBeGreaterThanOrEqual(2);
      expect(fills[0]!.kind).toBe("skeleton");
      expect(fills.slice(1).every((fill) => fill.kind === "body")).toBe(true);
      for (const fill of fills) {
        for (const [start, end] of fill.ranges) {
          expect(start).toBeGreaterThanOrEqual(1);
          expect(end).toBeLessThanOrEqual(
            chapter.source.content.split("\n").length,
          );
        }
      }
    }
  });
});

describe("globalCodeLineProgress", () => {
  it("measures the whole tutorial in source lines, not chapter checkpoints", () => {
    const first = tutorial.chapters[0]!;
    const second = tutorial.chapters[1]!;
    const last = tutorial.chapters.at(-1)!;
    const totalLines = tutorial.chapters
      .reduce((total, chapter) => total + chapterCodeLineCount(chapter), 0);

    expect(globalCodeLineProgress(tutorial.chapters, first, null)).toMatchObject({
      revealedLines: 0,
      totalLines,
      percent: 0,
    });

    let previous = 0;
    for (let checkpoint = 0; checkpoint < chapterFills(first).length; checkpoint += 1) {
      const progress = globalCodeLineProgress(tutorial.chapters, first, checkpoint);
      expect(progress.revealedLines).toBeGreaterThan(previous);
      previous = progress.revealedLines;
    }

    const nextChapter = globalCodeLineProgress(tutorial.chapters, second, null);
    expect(nextChapter.revealedLines).toBe(chapterCodeLineCount(first));

    const finalProgress = globalCodeLineProgress(
      tutorial.chapters,
      last,
      chapterFills(last).length - 1,
    );
    expect(finalProgress).toEqual({
      revealedLines: totalLines,
      totalLines,
      percent: 100,
    });
  });

  it("uses the selected implementation language's source totals", () => {
    const first = pythonTutorial.chapters[0]!;
    const second = pythonTutorial.chapters[1]!;
    const progress = globalCodeLineProgress(pythonTutorial.chapters, second, null);

    expect(progress.revealedLines).toBe(chapterCodeLineCount(first));
    expect(progress.totalLines).toBe(
      pythonTutorial.chapters.reduce((total, chapter) => total + chapterCodeLineCount(chapter), 0),
    );
  });
});

describe("graphSnapshotForEvidenceStep", () => {
  it("selects the matching chapter-five lifecycle snapshot", () => {
    const chapter = tutorial.chapters[4]!;
    expect(graphSnapshotForEvidenceStep(chapter, 0)?.stepId).toBe("before-install");
    expect(graphSnapshotForEvidenceStep(chapter, 1)?.stepId).toBe("after-install");
    expect(graphSnapshotForEvidenceStep(chapter, 2)?.stepId).toBe("after-remove");
  });

  it("keeps the baseline internally consistent", () => {
    const graph = graphSnapshotForEvidenceStep(tutorial.chapters[4]!, 0)!;
    expect(graph.plugins).toContain("runtime-tools");
    expect(graph.prompts.map((prompt) => prompt.id)).toContain("runtime-evolution-guide");
    expect(graph.tools.map((tool) => tool.name)).toContain("cordis_define");
    expect(graph.tools.map((tool) => tool.name)).not.toContain("word_count");
  });

  it("uses the Python runtime's own dynamic-plugin snapshots", () => {
    const chapter = pythonTutorial.chapters[4]!;
    const baseline = graphSnapshotForEvidenceStep(chapter, 0)!;
    const mounted = graphSnapshotForEvidenceStep(chapter, 1)!;
    const removed = graphSnapshotForEvidenceStep(chapter, 2)!;

    expect(baseline.plugins).toEqual(["runtime-tools"]);
    expect(baseline.services).toEqual([]);
    expect(mounted.plugins).toContain("word-count");
    expect(mounted.tools).toContainEqual({ name: "word_count", owner: "word-count" });
    expect(removed.tools.map((tool) => tool.name)).not.toContain("word_count");
  });
});

describe("snapshotForCheckpoint", () => {
  it("starts with only the skeleton: declarations plus closing brace", () => {
    const m01 = tutorial.chapters[0]!;
    const skeleton = snapshotForCheckpoint(m01, 0);
    const numbers = skeleton.map((line) => line.number);
    // 骨架 = imports 1-9 + 接口声明 11-30 + class 声明 32 + 字段 33-39 + 收尾大括号 115
    expect(numbers[0]).toBe(1);
    expect(numbers).toContain(32);
    expect(numbers).toContain(33);
    expect(numbers[numbers.length - 1]).toBeGreaterThanOrEqual(115);
    expect(skeleton.find((line) => line.number === 115)?.text).toBe("}");
    expect(skeleton.every((line) => line.number !== 53)).toBe(true);
  });

  it("line numbers stay sorted and snapshots grow monotonically", () => {
    for (const chapter of tutorial.chapters) {
      const fills = chapterFills(chapter);
      let previous = snapshotForCheckpoint(chapter, 0);
      for (let checkpoint = 0; checkpoint < fills.length; checkpoint += 1) {
        const snapshot = snapshotForCheckpoint(chapter, checkpoint);
        const numbers = snapshot.map((line) => line.number);
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
        expect(snapshot.length).toBeGreaterThanOrEqual(previous.length);
        previous = snapshot;
      }
      expect(isFinalCheckpoint(chapter, fills.length - 1)).toBe(true);
    }
  });

  it("Python chapters also fill progressively from the skeleton", () => {
    const m01 = pythonTutorial.chapters[0]!;
    const skeleton = snapshotForCheckpoint(m01, 0);
    const full = snapshotForCheckpoint(m01, chapterFills(m01).length - 1);
    const total = m01.source.content.split(/\r?\n/u).length;
    // 骨架 = 部分行（类型声明 + 收尾），最终快照覆盖全部已讲行
    expect(skeleton.length).toBeLessThan(full.length);
    expect(full.length).toBeLessThanOrEqual(total);
    expect(isFinalCheckpoint(m01, chapterFills(m01).length - 1)).toBe(true);
  });

  it("keeps every displayed line mapped to its source line", () => {
    for (const chapter of [...tutorial.chapters, ...pythonTutorial.chapters]) {
      const sourceLines = chapter.source.content.split(/\r?\n/u);
      const snapshot = snapshotForCheckpoint(chapter, chapterFills(chapter).length - 1);
      for (const line of snapshot) {
        expect(line.text).toBe(sourceLines[line.number - 1]);
      }
      for (let index = 1; index < snapshot.length; index += 1) {
        const previous = snapshot[index - 1]!.number;
        const current = snapshot[index]!.number;
        if (current - previous <= 1) continue;
        expect(
          sourceLines.slice(previous, current - 1).some((line) => line.trim() !== ""),
        ).toBe(true);
      }
    }
  });

  it("keeps blank source lines between displayed ranges", () => {
    const m04 = tutorial.chapters[3]!;
    const snapshot = snapshotForCheckpoint(m04, chapterFills(m04).length - 1);
    const line = snapshot.find((item) => item.number === 212);
    expect(line).toEqual({ number: 212, text: "" });
    expect(snapshot[snapshot.findIndex((item) => item.number === 211) + 1]?.number).toBe(212);
  });
});

describe("newLineNumbers", () => {
  it("reports exactly the rows added by the next checkpoint", () => {
    const m01 = tutorial.chapters[0]!;
    const skeleton = snapshotForCheckpoint(m01, 0);
    const next = snapshotForCheckpoint(m01, 1);
    const added = newLineNumbers(skeleton, next);
    const expected = next.filter(
      (line) => !skeleton.some((previous) => previous.number === line.number),
    );
    expect(added.size).toBe(expected.length);
    for (const number of added) {
      expect(skeleton.some((line) => line.number === number)).toBe(false);
    }
  });

  it("returns an empty set for identical snapshots", () => {
    const m01 = tutorial.chapters[0]!;
    const snapshot = snapshotForCheckpoint(m01, 1);
    expect(newLineNumbers(snapshot, snapshot).size).toBe(0);
  });

  it("highlights blank lines that belong to the new block, not pre-existing ones", () => {
    const m04 = tutorial.chapters[3]!;
    // 第四章最后一个语义单元从 Trace 派生函数开始；它包含多处源码空行。
    const previous = snapshotForCheckpoint(m04, 3);
    const current = snapshotForCheckpoint(m04, 4);
    const added = newLineNumbers(previous, current);
    // 195 位于两个源码块之间，在新的 checkpoint 首次出现。
    expect(current.find((line) => line.number === 195)?.text).toBe("");
    expect(added).toContain(195);
    // 新块内部的空行也随源码片段一起高亮。
    expect(added).toContain(203);
    expect(added).toContain(212);
    expect(added).toContain(230);
  });
});

describe("snapshotForFill", () => {
  it("returns only the source ranges assigned to one code card", () => {
    const chapter = tutorial.chapters[0]!;
    const fills = chapterFills(chapter);
    for (let fillIndex = 0; fillIndex < fills.length; fillIndex += 1) {
      const expected = new Set<number>();
      for (const [start, end] of fills[fillIndex]!.ranges) {
        for (let line = start; line <= end; line += 1) expected.add(line);
      }
      const snapshot = snapshotForFill(chapter, fillIndex);
      expect(snapshot.map((line) => line.number)).toEqual([...expected].sort((a, b) => a - b));
    }
  });

  it("does not include lines from an earlier checkpoint", () => {
    const chapter = tutorial.chapters[0]!;
    const skeleton = new Set(snapshotForFill(chapter, 0).map((line) => line.number));
    const codeOne = snapshotForFill(chapter, 1);
    expect(codeOne.length).toBeGreaterThan(0);
    expect(codeOne.every((line) => !skeleton.has(line.number))).toBe(true);
  });

  it("keeps every snippet line mapped to the original source", () => {
    for (const chapter of tutorial.chapters) {
      const sourceLines = chapter.source.content.split(/\r?\n/u);
      for (let index = 0; index < chapterFills(chapter).length; index += 1) {
        for (const line of snapshotForFill(chapter, index)) {
          expect(line.text).toBe(sourceLines[line.number - 1]);
        }
      }
    }
  });
});
