import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { JsonValue, ToolDefinition } from "./protocol.js";
import { ServiceToken, type Context, type Plugin } from "./runtime.js";

const execFileAsync = promisify(execFile);
const HELLO_FILE = "hello.py";
const EXPECTED_OUTPUT = "Hello, world!";

export interface PythonRunResult {
  passed: boolean;
  output: string;
  error?: string;
}

export interface PythonHelloWorkspaceState {
  workspace: string;
  written: boolean;
  lastRun: PythonRunResult | null;
}

export const PYTHON_HELLO_WORKSPACE = new ServiceToken<PythonHelloWorkspaceState>(
  "python-hello-workspace",
);

/**
 * A deliberately bounded Python workspace for the agentic hello-world demo.
 * The agent can write only hello.py, and execution is allowed only after the
 * source passes the tiny hello-world contract below.
 */
export function pythonHelloWorkspacePlugin(workspace: string): Plugin {
  const root = resolve(workspace);
  return {
    name: "python-hello-workspace",
    async setup(context) {
      await mkdir(root, { recursive: true });
      const state: PythonHelloWorkspaceState = {
        workspace: root,
        written: false,
        lastRun: null,
      };
      context.provide(PYTHON_HELLO_WORKSPACE, state);
      context.contributePrompt(
        "python-hello-rules",
        "Work only on hello.py. Write a minimal Python 3 program that prints exactly Hello, world!, then call run_python_hello. Do not use imports, filesystem access, network access, or any other file.",
      );
      context.registerTool(writePythonFileTool(root, state));
      context.registerTool(runPythonHelloTool(root, state));
    },
  };
}

function writePythonFileTool(
  root: string,
  state: PythonHelloWorkspaceState,
): ToolDefinition {
  return {
    name: "write_python_file",
    description: "Write the bounded Python hello-world file. The only allowed path is hello.py.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", enum: [HELLO_FILE] },
        content: { type: "string", minLength: 1 },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    async execute(input) {
      const value = input as { path?: string; content?: string };
      if (value.path !== HELLO_FILE || typeof value.content !== "string") {
        return { ok: false, error: "Only hello.py can be written." };
      }
      await writeFile(resolve(root, HELLO_FILE), value.content, "utf8");
      state.written = true;
      state.lastRun = null;
      return { ok: true, path: HELLO_FILE, characters: value.content.length };
    },
  };
}

function runPythonHelloTool(
  root: string,
  state: PythonHelloWorkspaceState,
): ToolDefinition {
  return {
    name: "run_python_hello",
    description: "Run hello.py only if it is the minimal accepted Hello, world! program.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(_input: JsonValue) {
      let source: string;
      try {
        source = await readFile(resolve(root, HELLO_FILE), "utf8");
      } catch {
        const result = { passed: false, output: "", error: "hello.py does not exist." };
        state.lastRun = result;
        return result as unknown as JsonValue;
      }

      if (!isAcceptedHelloSource(source)) {
        const result = {
          passed: false,
          output: "",
          error: 'hello.py must contain only print("Hello, world!").',
        };
        state.lastRun = result;
        return result as unknown as JsonValue;
      }

      try {
        // The source contract is checked before execution. The child receives
        // a minimal environment and never inherits the API key.
        const result = await execFileAsync("python3", [HELLO_FILE], {
          cwd: root,
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            PYTHONIOENCODING: "utf-8",
            PYTHONUNBUFFERED: "1",
          },
          timeout: 5_000,
          maxBuffer: 16 * 1024,
        });
        const passed = result.stdout.trim() === EXPECTED_OUTPUT;
        const run: PythonRunResult = {
          passed,
          output: result.stdout,
          ...(passed ? {} : { error: `Expected ${EXPECTED_OUTPUT}.` }),
        };
        state.lastRun = run;
        return run as unknown as JsonValue;
      } catch (error) {
        const detail = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        const run = {
          passed: false,
          output: detail.stdout ?? "",
          error: detail.stderr ?? detail.message ?? "python3 failed",
        };
        state.lastRun = run;
        return run as unknown as JsonValue;
      }
    },
  };
}

function isAcceptedHelloSource(source: string): boolean {
  return /^print\((['"])Hello, world!\1\)\s*$/u.test(source.trim());
}
