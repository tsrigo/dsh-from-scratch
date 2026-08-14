export const PTC_PRESENTATION_EXAMPLE = String.raw`// Static teaching contrast — Nano never executes this program.
const [issue, source, test] = await Promise.all([
  tools.read_workspace_file({ path: "issue.md" }),
  tools.read_workspace_file({ path: "src/checkout.ts" }),
  tools.read_workspace_file({ path: "tests/checkout.test.ts" })
]);
await tools.apply_patch({
  path: "src/checkout.ts",
  oldText: "  return merchandise + shipping - input.orderDiscount;",
  newText: "  return merchandise + shipping;"
});
const result = await tools.run_tests({});
if (result.passed) {
  await tools.submit_patch({ summary: "Apply orderDiscount exactly once." });
}`;

export const MODE_COMPARISON = {
  standard: "Presents each tool schema; the model returns ordinary tool calls handled by the Agent Loop.",
  ptc: "Keeps the standard preset's abilities but exposes them through the Code Mode SDK for programmatic composition.",
  nanoBoundary: "Nano implements only ordinary tool calls. The PTC program above is inert explanatory text.",
} as const;
