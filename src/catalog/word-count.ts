import type { JsonValue } from "../protocol.js";
import type { Plugin } from "../runtime.js";

export function wordCountPlugin(): Plugin {
  return {
    name: "capability:word_count",
    setup(context) {
      context.registerTool({
        name: "word_count",
        description: "Count Unicode-aware whitespace-separated words in one supplied string.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        execute: (input) => {
          const text = (input as { text: string }).text.trim();
          return {
            words: text === "" ? 0 : text.split(/\s+/u).length,
          } as JsonValue;
        },
      });
    },
  };
}
