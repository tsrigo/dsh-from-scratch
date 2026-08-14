import { BUGGY_RETURN, FIXED_RETURN, SOURCE_PATH } from "./checkout-workspace.js";
import { TYPESCRIPT_ANALYSIS_PLUGIN_CODE } from "./catalog/typescript-analysis.js";
import type { Llm, LlmResponse, LlmStreamEvent, UnifiedRequest } from "./protocol.js";

export type ScriptedReply =
  | LlmResponse
  | ((request: UnifiedRequest, requestIndex: number) => LlmResponse);

export class ScriptedLlm implements Llm {
  readonly provider = "fake";
  readonly model = "scripted-checkout-bug-v1";
  readonly requests: UnifiedRequest[] = [];
  #nextReply = 0;

  constructor(private readonly replies: ScriptedReply[]) {}

  async *stream(request: UnifiedRequest): AsyncIterable<LlmStreamEvent> {
    this.requests.push(structuredClone(request));
    const reply = this.replies[this.#nextReply];
    if (!reply) throw new Error(`Fake LLM has no reply for request ${this.#nextReply + 1}.`);
    const index = this.#nextReply++;
    yield {
      type: "response",
      response: structuredClone(typeof reply === "function" ? reply(request, index) : reply),
    };
  }
}

export function createBugFixReplies(): ScriptedReply[] {
  return [
    readWorkspaceReply("m01"),
    patchReply("m01"),
    {
      message: {
        role: "assistant",
        content: "The minimal source change is applied. I will run the regression suite.",
        toolCalls: [{ id: "m01-test", name: "run_tests", arguments: {} }],
      },
    },
    {
      message: {
        role: "assistant",
        content: "All 43 tests pass, so I will submit the tested patch.",
        toolCalls: [{
          id: "m01-submit",
          name: "submit_patch",
          arguments: { summary: "Apply orderDiscount exactly once in calculateTotal." },
        }],
      },
    },
    {
      message: {
        role: "assistant",
        content: "CHECKOUT-417 is fixed: the duplicate order discount was removed and all regressions pass.",
        toolCalls: [],
      },
    },
  ];
}

export function createCapabilityExperimentReplies(): ScriptedReply[] {
  return [
    readWorkspaceReply("capability", true),
    patchReply("capability"),
    {
      message: {
        role: "assistant",
        content: "The regression suite should verify behavior; I will define a TypeScript analysis Plugin for caller checks.",
        toolCalls: [
          { id: "capability-test", name: "run_tests", arguments: {} },
          {
            id: "capability-define",
            name: "cordis_define",
            arguments: {
              name: "typescript_analysis",
              purpose: "Inspect calculateTotal references and check the current TypeScript fix.",
              code: TYPESCRIPT_ANALYSIS_PLUGIN_CODE,
            },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "The Plugin is defined. I will run it in the current Context.",
        toolCalls: [
          { id: "capability-run", name: "cordis_run", arguments: { pluginId: "dyn-1" } },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "The new TypeScript tools are now visible. I will inspect callers and diagnostics.",
        toolCalls: [
          {
            id: "capability-references",
            name: "find_references",
            arguments: { symbol: "calculateTotal" },
          },
          { id: "capability-types", name: "check_types", arguments: {} },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "All callers use independent discounts and type checks pass. I will undefine the Plugin and submit.",
        toolCalls: [
          {
            id: "capability-undefine",
            name: "cordis_undefine",
            arguments: { pluginId: "dyn-1" },
          },
          {
            id: "capability-submit",
            name: "submit_patch",
            arguments: { summary: "Remove the duplicate orderDiscount subtraction in calculateTotal." },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "Patch accepted. The dynamic TypeScript analysis Plugin has been removed.",
        toolCalls: [],
      },
    },
  ];
}

export function createLongTaskBugFixReplies(): ScriptedReply[] {
  return [
    readWorkspaceReply("r1", true),
    {
      message: {
        role: "assistant",
        content: "Diagnosis complete: calculateTotal subtracts orderDiscount once in merchandise and again in the return expression.",
        toolCalls: [],
      },
    },
    patchReply("r2"),
    {
      message: {
        role: "assistant",
        content: "The smallest patch is applied. I will run the full regression suite.",
        toolCalls: [{ id: "r2-test", name: "run_tests", arguments: {} }],
      },
    },
    {
      message: {
        role: "assistant",
        content: "Repair complete: all 43 tests pass. Final semantic verification remains for the next round.",
        toolCalls: [],
      },
    },
    {
      message: {
        role: "assistant",
        content: "I will define a TypeScript analysis Plugin for final caller verification.",
        toolCalls: [{
          id: "r3-define",
          name: "cordis_define",
          arguments: {
            name: "typescript_analysis",
            purpose: "Inspect calculateTotal references and check the current TypeScript fix.",
            code: TYPESCRIPT_ANALYSIS_PLUGIN_CODE,
          },
        }],
      },
    },
    {
      message: {
        role: "assistant",
        content: "The Plugin is defined. I will run it in the current Context.",
        toolCalls: [{ id: "r3-run", name: "cordis_run", arguments: { pluginId: "dyn-1" } }],
      },
    },
    {
      message: {
        role: "assistant",
        content: "The analysis tools are visible. I will verify references and diagnostics.",
        toolCalls: [
          {
            id: "r3-references",
            name: "find_references",
            arguments: { symbol: "calculateTotal" },
          },
          { id: "r3-types", name: "check_types", arguments: {} },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "Verification passed. I will undefine the dynamic Plugin and submit the patch.",
        toolCalls: [
          {
            id: "r3-undefine",
            name: "cordis_undefine",
            arguments: { pluginId: "dyn-1" },
          },
          {
            id: "r3-submit",
            name: "submit_patch",
            arguments: { summary: "Fix CHECKOUT-417 by applying each discount once." },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "Goal complete: CHECKOUT-417 was accepted and the dynamic analysis Plugin is gone.",
        toolCalls: [],
      },
    },
  ];
}

function readWorkspaceReply(prefix: string, inspect = false): ScriptedReply {
  return {
    message: {
      role: "assistant",
      content: "I will inspect the issue, implementation, regression test, and failing CI evidence before editing.",
      toolCalls: [
        ...(inspect ? [{ id: `${prefix}-inspect`, name: "cordis_inspect", arguments: {} }] : []),
        ...(["issue.md", SOURCE_PATH, "tests/checkout.test.ts", "ci.log"] as const).map((path, index) => ({
          id: `${prefix}-read-${index + 1}`,
          name: "read_workspace_file",
          arguments: { path },
        })),
      ],
    },
  };
}

function patchReply(prefix: string): ScriptedReply {
  return {
    message: {
      role: "assistant",
      content: "The order discount is already included in merchandise, so the return expression subtracts it a second time.",
      toolCalls: [{
        id: `${prefix}-patch`,
        name: "apply_patch",
        arguments: {
          path: SOURCE_PATH,
          oldText: BUGGY_RETURN,
          newText: FIXED_RETURN,
        },
      }],
    },
  };
}
