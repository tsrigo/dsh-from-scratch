import type { Llm, LlmResponse, LlmStreamEvent } from "./protocol.js";

/**
 * Offline replay for the bounded Python hello-world demo.
 * It replays model decisions without reproducing stream timing.
 */
export class PythonHelloReplayLlm implements Llm {
  readonly provider = "replay";
  readonly model = "python-hello-replay-v1";
  #nextReply = 0;

  async *stream(_request: Parameters<Llm["stream"]>[0]): AsyncIterable<LlmStreamEvent> {
    const response = PYTHON_HELLO_REPLIES[this.#nextReply++];
    if (!response) throw new Error("Python hello replay has no response for this request.");
    yield { type: "response", response: structuredClone(response) };
  }
}

const PYTHON_HELLO_REPLIES: LlmResponse[] = [
  {
    message: {
      role: "assistant",
      content: "I will create the requested minimal Python program.",
      toolCalls: [
        {
          id: "replay-write-hello",
          name: "write_python_file",
          arguments: { path: "hello.py", content: 'print("Hello, world!")' },
        },
      ],
    },
  },
  {
    message: {
      role: "assistant",
      content: "The file is written. I will run the provided verifier.",
      toolCalls: [{ id: "replay-run-hello", name: "run_python_hello", arguments: {} }],
    },
  },
  {
    message: {
      role: "assistant",
      content: "The verifier passed.",
      toolCalls: [],
    },
  },
];
