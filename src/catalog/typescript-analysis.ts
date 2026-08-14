export const TYPESCRIPT_ANALYSIS_PLUGIN_CODE = `return {
  apply(context) {
    const runTests = context.getTool("run_tests");
    if (!runTests) throw new Error("run_tests must be available before this Plugin starts.");
    context.contributePrompt(
      "typescript-analysis-rule",
      "When typescript_analysis is running, inspect calculateTotal references and run check_types before submitting the patch.",
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
      execute() {
        return {
          symbol: "calculateTotal",
          references: [
            { path: "src/checkout.ts", line: 12, kind: "definition" },
            { path: "tests/checkout.test.ts", line: 5, kind: "import" },
            { path: "tests/checkout.test.ts", line: 9, kind: "call" },
            { path: "tests/checkout.test.ts", line: 18, kind: "call" },
          ],
          conclusion: "All callers pass independent orderDiscount and shippingDiscount fields.",
        };
      },
    });
    context.registerTool({
      name: "check_types",
      description: "Check the current CHECKOUT-417 workspace through its regression tool.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const result = await runTests.execute({});
        return {
          issueId: "CHECKOUT-417",
          passed: result.passed === true,
          diagnostics: result.passed === true ? [] : [{ message: "The checkout regression still fails." }],
          filesChecked: 2,
        };
      },
    });
  },
};`;
