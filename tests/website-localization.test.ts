import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TutorialData } from "../website/src/types.js";

function readTutorial(name: string): TutorialData {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../website/public/generated/${name}`), "utf8"),
  ) as TutorialData;
}

describe("Python English tutorial", () => {
  const typescript = readTutorial("tutorial.en.json");
  const python = readTutorial("tutorial-python.en.json");

  it("contains no Chinese text in visible tutorial data", () => {
    const { liveReplay: _recordedReplay, ...visibleData } = python;
    expect(JSON.stringify(visibleData)).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("keeps shared questions while using Python-specific teaching evidence", () => {
    for (let index = 0; index < typescript.chapters.length; index += 1) {
      const shared = typescript.chapters[index]!;
      const localized = python.chapters[index]!;
      expect(localized.question).toBe(shared.question);
      expect(Array.isArray(localized.requests)).toBe(true);
      expect(Array.isArray(localized.events)).toBe(true);
      expect(Array.isArray(localized.trace)).toBe(true);
      expect(Array.isArray(localized.graphs)).toBe(true);
      expect(localized.changeStory.title).toMatch(/[A-Za-z]/u);
      expect(localized.changeStory.summary).toMatch(/[A-Za-z]/u);
      expect(localized.changeStory.outcomes.length).toBeGreaterThan(0);
    }
  });

  it("does not invent TypeScript-only Python runtime evidence", () => {
    const plugins = python.chapters[2]!;
    const session = python.chapters[3]!;
    const runtimeTools = python.chapters[4]!;
    const longTask = python.chapters[5]!;

    expect(plugins.graphs).toEqual([]);
    expect(session.events.every((event) => "data" in event)).toBe(true);
    expect(session.events.map((event) => event.type)).not.toContain("tool/call");

    const baseline = runtimeTools.graphs[0]!;
    const mounted = runtimeTools.graphs[1]!;
    const removed = runtimeTools.graphs[2]!;
    expect(baseline.plugins).toEqual(["runtime-tools"]);
    expect(baseline.services).toEqual([]);
    expect(mounted.plugins).toContain("word-count");
    expect(mounted.tools).toContainEqual({ name: "word_count", owner: "word-count" });
    expect(removed.tools.map((tool) => tool.name)).not.toContain("word_count");
    expect(runtimeTools.events.map((event) => event.type)).not.toContain("runtime/plugin-mounted");
    expect(runtimeTools.events.map((event) => event.type)).not.toContain("runtime/plugin-unmounted");

    expect(longTask.requests).toEqual([]);
    expect(longTask.events).toEqual([]);
    expect(longTask.trace).toEqual([]);
  });
});
