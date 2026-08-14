import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUGGY_RETURN,
  FIXED_RETURN,
  SOURCE_PATH,
  WORKSPACE_PATHS,
  createCheckoutState,
  createTestTools,
  createWorkspaceTools,
  loadCheckoutWorkspace,
} from "../src/checkout-workspace.js";

describe("bounded demo workspace", () => {
  it("loads the same validated code fixture used by fake and DeepSeek providers", async () => {
    const fixture = await loadCheckoutWorkspace(resolve("demo-workspace"));
    expect(fixture.issueId).toBe("CHECKOUT-417");
    expect(fixture.files[SOURCE_PATH]).toContain(BUGGY_RETURN);
    expect(fixture.files["tests/checkout.test.ts"]).toContain("toBe(100)");
    expect(fixture.files["ci.log"]).toContain("42 passed");
  });

  it("rejects a malformed fixture before the Agent Loop starts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nano-dsh-invalid-"));
    try {
      await mkdir(join(directory, "src"), { recursive: true });
      await mkdir(join(directory, "tests"), { recursive: true });
      for (const path of WORKSPACE_PATHS) {
        const content = path === "issue.md" ? "wrong issue\n" : "wrong fixture\n";
        await writeFile(join(directory, path), content);
      }
      await expect(loadCheckoutWorkspace(directory)).rejects.toThrow(
        "fixture contract does not match CHECKOUT-417",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts only the exact tested checkout patch", async () => {
    const state = createCheckoutState();
    const workspaceTools = createWorkspaceTools(state);
    const testTools = createTestTools(state);
    const apply = workspaceTools.find((tool) => tool.name === "apply_patch");
    const runTests = testTools.find((tool) => tool.name === "run_tests");
    const submit = testTools.find((tool) => tool.name === "submit_patch");

    await apply?.execute({
      newText: FIXED_RETURN,
      path: SOURCE_PATH,
      oldText: BUGGY_RETURN,
    });
    expect(await runTests?.execute({})).toMatchObject({ passed: true });
    expect(await submit?.execute({ summary: "Apply each discount once." })).toMatchObject({
      accepted: true,
    });
    expect(state.acceptedPatch?.issueId).toBe("CHECKOUT-417");
  });
});
