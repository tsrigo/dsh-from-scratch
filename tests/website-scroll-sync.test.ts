import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chapterFills,
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
            chapter.source.content.trimEnd().split("\n").length,
          );
        }
      }
    }
  });

  it("Python chapters fall back to an empty fill sequence", () => {
    for (const chapter of pythonTutorial.chapters) {
      expect(chapterFills(chapter)).toEqual([]);
    }
  });
});

describe("snapshotForCheckpoint", () => {
  it("starts with only the skeleton: declarations plus closing brace", () => {
    const m01 = tutorial.chapters[0]!;
    const skeleton = snapshotForCheckpoint(m01, 0);
    const numbers = skeleton.map((line) => line.number);
    // 骨架 = 接口声明 11-30 + class 声明 32 + 收尾大括号 115
    expect(numbers[0]).toBe(11);
    expect(numbers).toContain(32);
    expect(numbers[numbers.length - 1]).toBe(115);
    expect(skeleton.at(-1)!.text).toBe("}");
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

  it("without fills the whole source is shown at once", () => {
    const m01 = pythonTutorial.chapters[0]!;
    const snapshot = snapshotForCheckpoint(m01, 0);
    expect(snapshot.length).toBe(m01.source.content.trimEnd().split(/\r?\n/u).length);
    expect(isFinalCheckpoint(m01, 0)).toBe(true);
  });

  it("keeps every displayed line mapped to its source line", () => {
    for (const chapter of [...tutorial.chapters, ...pythonTutorial.chapters]) {
      const sourceLines = chapter.source.content.trimEnd().split(/\r?\n/u);
      const snapshot = snapshotForCheckpoint(chapter, chapterFills(chapter).length - 1);
      for (const line of snapshot) {
        expect(line.text).toBe(sourceLines[line.number - 1]);
      }
    }
  });
});

describe("newLineNumbers", () => {
  it("reports exactly the rows added by the next checkpoint", () => {
    const m01 = tutorial.chapters[0]!;
    const skeleton = snapshotForCheckpoint(m01, 0);
    const next = snapshotForCheckpoint(m01, 1);
    const added = newLineNumbers(skeleton, next);
    expect(added.size).toBe(next.length - skeleton.length);
    for (const number of added) {
      expect(skeleton.some((line) => line.number === number)).toBe(false);
    }
  });

  it("returns an empty set for identical snapshots", () => {
    const m01 = tutorial.chapters[0]!;
    const snapshot = snapshotForCheckpoint(m01, 1);
    expect(newLineNumbers(snapshot, snapshot).size).toBe(0);
  });
});
