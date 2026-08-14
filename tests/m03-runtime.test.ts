import { describe, expect, it, vi } from "vitest";
import { createBugFixReplies, ScriptedLlm } from "../src/llm-fake.js";
import { composeM03Runtime } from "../src/plugins.js";
import { Context, ServiceToken } from "../src/runtime.js";

describe("M03 plugin kernel", () => {
  it("inspects owned services, tools, prompts, listeners, and service relations", async () => {
    const { context } = await composeM03Runtime(
      new ScriptedLlm(createBugFixReplies()),
    );
    const inspection = context.inspect();

    expect(inspection.plugins).toEqual([
      "session-log",
      "provider:fake",
      "checkout-workspace-state",
      "checkout-workspace",
      "checkout-tests",
    ]);
    expect(inspection.services.map((service) => service.name)).toEqual([
      "session-log",
      "llm",
      "checkout-workspace",
    ]);
    expect(inspection.tools.map((tool) => tool.name)).toEqual([
      "read_workspace_file",
      "apply_patch",
      "run_tests",
      "submit_patch",
    ]);
    expect(inspection.prompts).toHaveLength(2);
    expect(inspection.listeners).toContainEqual({
      event: "tool/executed",
      plugin: "checkout-workspace",
    });
    expect(inspection.listeners.filter((listener) => listener.plugin === "session-log")).toHaveLength(2);
    expect(inspection.listeners).toContainEqual({
      event: "runtime/plugin-unmounted",
      plugin: "session-log",
    });
    expect(inspection.relations).toContainEqual({
      consumer: "checkout-workspace",
      service: "checkout-workspace",
      provider: "checkout-workspace-state",
    });
    expect(inspection.relations).toContainEqual({
      consumer: "checkout-tests",
      service: "checkout-workspace",
      provider: "checkout-workspace-state",
    });
  });

  it("uninstalls all contributions through one idempotent disposer", async () => {
    const context = new Context();
    const token = new ServiceToken<number>("answer");
    const listener = vi.fn();
    const dispose = await context.mount({
      name: "everything",
      setup(ctx) {
        ctx.provide(token, 42);
        ctx.registerTool({
          name: "answer",
          description: "Return an answer.",
          inputSchema: { type: "object" },
          execute: () => 42,
        });
        ctx.contributePrompt("answer-rule", "Answer carefully.");
        ctx.on("tick", listener);
      },
    });

    expect(context.inspect()).toMatchObject({
      plugins: ["everything"],
      services: [{ name: "answer", provider: "everything" }],
      tools: [{ name: "answer", plugin: "everything" }],
    });
    dispose();
    dispose();
    context.emit("tick", null);
    expect(context.inspect()).toEqual({
      plugins: [],
      services: [],
      tools: [],
      prompts: [],
      listeners: [],
      relations: [],
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("rolls a failed setup back in reverse effect order", async () => {
    const context = new Context();
    const cleanup: string[] = [];
    await expect(
      context.mount({
        name: "broken",
        setup(ctx) {
          ctx.effect(() => cleanup.push("first"));
          ctx.effect(() => cleanup.push("second"));
          ctx.contributePrompt("temporary", "must disappear");
          throw new Error("setup failed");
        },
      }),
    ).rejects.toThrow("setup failed");
    expect(cleanup).toEqual(["second", "first"]);
    expect(context.inspect().plugins).toEqual([]);
    expect(context.inspect().prompts).toEqual([]);
  });

  it("rejects duplicate and missing services immediately", async () => {
    const context = new Context();
    const token = new ServiceToken<number>("single");
    expect(() => context.use(token)).toThrow("Missing service: single");
    await expect(
      context.mount({
        name: "duplicate",
        setup(ctx) {
          ctx.provide(token, 1);
          ctx.provide(token, 2);
        },
      }),
    ).rejects.toThrow("Service already provided: single");
    expect(context.inspect().services).toEqual([]);
  });
});
