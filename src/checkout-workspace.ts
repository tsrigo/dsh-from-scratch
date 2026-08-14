import { readFile, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { JsonValue, ToolDefinition } from "./protocol.js";
import { ServiceToken } from "./runtime.js";

export const ISSUE_ID = "CHECKOUT-417";
export const SOURCE_PATH = "src/checkout.ts";
export const BUGGY_RETURN = "  return merchandise + shipping - input.orderDiscount;";
export const FIXED_RETURN = "  return merchandise + shipping;";

export const WORKSPACE_PATHS = [
  "issue.md",
  SOURCE_PATH,
  "tests/checkout.test.ts",
  "ci.log",
] as const;

export type WorkspacePath = (typeof WORKSPACE_PATHS)[number];

export interface CheckoutWorkspaceFixture {
  issueId: typeof ISSUE_ID;
  files: Record<WorkspacePath, string>;
}

export interface AcceptedPatch {
  issueId: typeof ISSUE_ID;
  path: typeof SOURCE_PATH;
  summary: string;
}

export interface CheckoutWorkspaceState {
  fixture: CheckoutWorkspaceFixture;
  files: Record<WorkspacePath, string>;
  testsPassed: boolean;
  acceptedPatch: AcceptedPatch | null;
}

export const CHECKOUT_WORKSPACE = new ServiceToken<CheckoutWorkspaceState>(
  "checkout-workspace",
);

const readFileAsync = promisify(readFile);
const defaultWorkspace = new URL("../demo-workspace/", import.meta.url);

export const CHECKOUT_FIXTURE = parseWorkspace(
  Object.fromEntries(
    WORKSPACE_PATHS.map((path) => [path, readFileSync(new URL(path, defaultWorkspace), "utf8")]),
  ),
  defaultWorkspace.pathname,
);

export function createCheckoutState(
  fixture: CheckoutWorkspaceFixture = CHECKOUT_FIXTURE,
): CheckoutWorkspaceState {
  return {
    fixture: structuredClone(fixture),
    files: structuredClone(fixture.files),
    testsPassed: false,
    acceptedPatch: null,
  };
}

export async function loadCheckoutWorkspace(
  workspace: string,
): Promise<CheckoutWorkspaceFixture> {
  const entries = await Promise.all(
    WORKSPACE_PATHS.map(async (path) => {
      const file = join(workspace, path);
      try {
        return [path, await readFileAsync(file, "utf8")] as const;
      } catch (error) {
        throw new Error(
          `Cannot load the bounded checkout workspace file ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
  return parseWorkspace(Object.fromEntries(entries), workspace);
}

export function createWorkspaceTools(state: CheckoutWorkspaceState): ToolDefinition[] {
  return [
    {
      name: "read_workspace_file",
      description: "Read one file from the fixed CHECKOUT-417 teaching workspace.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", enum: WORKSPACE_PATHS } },
        required: ["path"],
        additionalProperties: false,
      },
      execute(input) {
        const path = readPath(input);
        return { path, content: state.files[path] };
      },
    },
    {
      name: "apply_patch",
      description: "Replace one exact, unique string in src/checkout.ts inside the bounded workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", enum: [SOURCE_PATH] },
          oldText: { type: "string", minLength: 1 },
          newText: { type: "string" },
        },
        required: ["path", "oldText", "newText"],
        additionalProperties: false,
      },
      execute(input) {
        const { path, oldText, newText } = input as {
          path: typeof SOURCE_PATH;
          oldText: string;
          newText: string;
        };
        const source = state.files[path];
        const matches = source.split(oldText).length - 1;
        if (matches !== 1) {
          return {
            ok: false,
            error: matches === 0 ? "oldText was not found." : `oldText matched ${matches} locations.`,
          };
        }
        state.files[path] = source.replace(oldText, newText);
        state.testsPassed = false;
        state.acceptedPatch = null;
        return {
          ok: true,
          path,
          replacements: 1,
          diff: `- ${oldText.trim()}\n+ ${newText.trim()}`,
        };
      },
    },
  ];
}

export function createTestTools(state: CheckoutWorkspaceState): ToolDefinition[] {
  return [
    {
      name: "run_tests",
      description: "Run the deterministic checkout regression suite in the bounded workspace.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute() {
        const passed = hasExpectedFix(state.files[SOURCE_PATH]);
        state.testsPassed = passed;
        return {
          passed,
          command: "pnpm vitest run tests/checkout.test.ts",
          summary: passed ? "43 passed, 0 failed" : "42 passed, 1 failed",
          output: testOutput(passed),
        };
      },
    },
    {
      name: "submit_patch",
      description: "Submit the tested CHECKOUT-417 patch to the deterministic verifier.",
      inputSchema: {
        type: "object",
        properties: { summary: { type: "string", minLength: 1 } },
        required: ["summary"],
        additionalProperties: false,
      },
      execute(input) {
        const summary = (input as { summary: string }).summary;
        const accepted = state.testsPassed && hasExpectedFix(state.files[SOURCE_PATH]);
        if (accepted) {
          state.acceptedPatch = { issueId: ISSUE_ID, path: SOURCE_PATH, summary };
        }
        return {
          accepted,
          issueId: ISSUE_ID,
          changedFiles: accepted ? [SOURCE_PATH] : [],
          verification: accepted
            ? "Regression suite passed; orderDiscount is applied exactly once."
            : "Patch is not accepted until the expected source change passes the regression suite.",
        };
      },
    },
  ];
}

export function hasExpectedFix(source: string): boolean {
  return source.includes(FIXED_RETURN) && !source.includes(BUGGY_RETURN);
}

function readPath(input: JsonValue): WorkspacePath {
  return (input as { path: WorkspacePath }).path;
}

function parseWorkspace(
  value: Record<string, string>,
  source: string,
): CheckoutWorkspaceFixture {
  if (!WORKSPACE_PATHS.every((path) => typeof value[path] === "string")) {
    throw new Error(`Invalid checkout workspace at ${source}: required files are missing.`);
  }
  const files = value as Record<WorkspacePath, string>;
  if (
    !files["issue.md"].includes(ISSUE_ID) ||
    !files[SOURCE_PATH].includes(BUGGY_RETURN) ||
    !files["tests/checkout.test.ts"].includes("toBe(100)") ||
    !files["ci.log"].includes("expected 80 to be 100")
  ) {
    throw new Error(`Invalid checkout workspace at ${source}: fixture contract does not match ${ISSUE_ID}.`);
  }
  return { issueId: ISSUE_ID, files: structuredClone(files) };
}

function testOutput(passed: boolean): string {
  const cases = Array.from({ length: 39 }, (_, index) =>
    ` ✓ checkout regression / ordinary basket fixture ${String(index + 1).padStart(2, "0")}`,
  );
  const combined = passed
    ? " ✓ checkout regression / applies order and shipping discounts once"
    : [
        " × checkout regression / applies order and shipping discounts once",
        "   AssertionError: expected 80 to be 100",
        "   at tests/checkout.test.ts:23:18",
      ].join("\n");
  return [
    " RUN  v3.2.4 /workspace/checkout-demo",
    "",
    ...cases,
    " ✓ checkout regression / keeps shipping when no shipping discount exists",
    " ✓ checkout regression / never makes merchandise negative",
    " ✓ checkout regression / handles an empty basket",
    combined,
    "",
    passed ? " Test Files  1 passed (1)" : " Test Files  1 failed (1)",
    passed ? "      Tests  43 passed (43)" : "      Tests  1 failed | 42 passed (43)",
    "   Duration  418ms",
  ].join("\n");
}
