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

  it("reuses the shared English teaching evidence", () => {
    for (let index = 0; index < typescript.chapters.length; index += 1) {
      const shared = typescript.chapters[index]!;
      const localized = python.chapters[index]!;
      expect(localized.question).toBe(shared.question);
      expect(localized.changeStory).toEqual(shared.changeStory);
      expect(localized.requests).toEqual(shared.requests);
      expect(localized.events).toEqual(shared.events);
      expect(localized.graphs).toEqual(shared.graphs);
    }
  });
});
