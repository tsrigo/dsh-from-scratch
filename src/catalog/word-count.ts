export const WORD_COUNT_PLUGIN_CODE = `return {
  apply(context) {
    context.registerTool({
      name: "word_count",
      description: "Count Unicode-aware whitespace-separated words in one supplied string.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute(input) {
        const text = input.text.trim();
        return { words: text === "" ? 0 : text.split(/\\s+/u).length };
      },
    });
  },
};`;
