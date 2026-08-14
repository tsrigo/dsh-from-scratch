import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "../src/runtime.js";
import { pythonHelloWorkspacePlugin } from "../src/python-workspace.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("bounded Python hello workspace", () => {
  it("writes and runs only the accepted hello-world file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nano-dsh-python-"));
    temporaryDirectories.push(directory);
    const context = new Context();
    await context.mount(pythonHelloWorkspacePlugin(directory));

    const writer = context.getTool("write_python_file");
    const runner = context.getTool("run_python_hello");
    expect(writer).toBeDefined();
    expect(runner).toBeDefined();
    expect(await writer!.execute({ path: "other.py", content: "print('no')" })).toEqual({
      ok: false,
      error: "Only hello.py can be written.",
    });
    await writer!.execute({ path: "hello.py", content: 'print("Hello, world!")\n' });
    expect(await runner!.execute({})).toMatchObject({ passed: true, output: "Hello, world!\n" });
    await expect(readFile(join(directory, "hello.py"), "utf8")).resolves.toBe('print("Hello, world!")\n');
  });
});
