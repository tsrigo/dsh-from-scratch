import {
  CHECKOUT_WORKSPACE,
  FIXED_RETURN,
  ISSUE_ID,
  SOURCE_PATH,
  hasExpectedFix,
} from "../checkout-workspace.js";
import type { JsonValue } from "../protocol.js";
import type { Plugin } from "../runtime.js";

export function typescriptAnalysisPlugin(): Plugin {
  return {
    name: "capability:typescript_analysis",
    setup(context) {
      const workspace = context.use(CHECKOUT_WORKSPACE);
      context.contributePrompt(
        "typescript-analysis-rule",
        "When typescript_analysis is installed, inspect calculateTotal references and run check_types before submitting the patch.",
      );
      context.registerTool({
        name: "find_references",
        description: "Find references to calculateTotal in the fixed TypeScript workspace.",
        inputSchema: {
          type: "object",
          properties: { symbol: { type: "string", enum: ["calculateTotal"] } },
          required: ["symbol"],
          additionalProperties: false,
        },
        execute: () => ({
          symbol: "calculateTotal",
          references: [
            { path: SOURCE_PATH, line: 12, kind: "definition" },
            { path: "tests/checkout.test.ts", line: 5, kind: "import" },
            { path: "tests/checkout.test.ts", line: 9, kind: "call" },
            { path: "tests/checkout.test.ts", line: 18, kind: "call" },
          ],
          conclusion: "All callers pass independent orderDiscount and shippingDiscount fields.",
        }) as unknown as JsonValue,
      });
      context.registerTool({
        name: "check_types",
        description: "Run a deterministic TypeScript semantic check for CHECKOUT-417.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => ({
          issueId: ISSUE_ID,
          passed: hasExpectedFix(workspace.files[SOURCE_PATH]),
          diagnostics: hasExpectedFix(workspace.files[SOURCE_PATH])
            ? []
            : [{ path: SOURCE_PATH, message: `Expected patched return: ${FIXED_RETURN.trim()}` }],
          filesChecked: 2,
        }) as unknown as JsonValue,
      });
    },
  };
}
