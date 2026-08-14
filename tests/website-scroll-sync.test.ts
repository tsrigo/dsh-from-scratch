import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chapterFills,
  graphSnapshotForEvidenceStep,
  isFinalCheckpoint,
  newLineNumbers,
  snapshotForCheckpoint,
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
      (line) => !skeleton.some((previous) => previous.number === line.number) && line.text.trim() !== "",
    );
    expect(added.size).toBe(expected.length);
    for (const number of added) {
      expect(skeleton.some((line) => line.number === number)).toBe(false);
      expect(next.find((line) => line.number === number)?.text.trim()).not.toBe("");
    }
  });

  it("returns an empty set for identical snapshots", () => {
    const m01 = tutorial.chapters[0]!;
    const snapshot = snapshotForCheckpoint(m01, 1);
    expect(newLineNumbers(snapshot, snapshot).size).toBe(0);
  });

  it("does not highlight the blank line between chapter four ranges", () => {
    const m04 = tutorial.chapters[3]!;
    const previous = snapshotForCheckpoint(m04, 6);
    const current = snapshotForCheckpoint(m04, 7);
    expect(current.find((line) => line.number === 212)?.text).toBe("");
    expect(newLineNumbers(previous, current)).not.toContain(212);
    expect(newLineNumbers(previous, current)).toContain(213);
  });
});
