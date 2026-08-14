import asyncio
import unittest

from python_harness.agent import Agent, Tool
from python_harness.context import project_tool_result
from python_harness.runtime import Context
from python_harness.runtime_tools import RuntimeTools
from python_harness.scenario import Goal, run_long_task
from python_harness.session import SessionLog


class ScriptedLlm:
    def __init__(self):
        self.step = 0

    async def complete(self, request):
        self.step += 1
        if self.step == 1:
            return {"content": "read", "tool_calls": [{"name": "read", "arguments": {}}]}
        return {"content": "accepted", "tool_calls": []}


class Capability:
    name = "capability:typescript_analysis"

    def setup(self, context):
        context.register_tool("find_references", object())
        context.contribute_prompt("inspect calculateTotal callers")


class HarnessTests(unittest.TestCase):
    def test_agent_loop(self):
        async def read(_arguments):
            return {"path": "src/checkout.ts", "content": "return merchandise + shipping"}

        tool = Tool("read", "read source", {"required": [], "properties": {}}, read)
        self.assertEqual(asyncio.run(Agent(ScriptedLlm(), [tool]).run("fix CHECKOUT-417")), "accepted")

    def test_projection_is_bounded(self):
        self.assertIn("omitted", project_tool_result("x" * 800, limit=100))

    def test_plugin_is_removed_without_residue(self):
        context = Context()
        tools = RuntimeTools(context, {"typescript_analysis": Capability})
        self.assertTrue(tools.install_capability("typescript_analysis")["ok"])
        self.assertIn("find_references", context.tools)
        tools.remove_capability("typescript_analysis")
        self.assertEqual(context.inspect(), {"plugins": [], "tools": [], "prompts": []})

    def test_request_reconstruction(self):
        log = SessionLog()
        log.append("user/message", content="fix CHECKOUT-417")
        log.append("request/header", step_id="step-1", system="rules", tools=[], dynamic_context="round=1")
        self.assertEqual(log.build_request("step-1")["messages"], [{"role": "user", "content": "fix CHECKOUT-417"}])

    def test_long_task_completes(self):
        replies = iter(("diagnosed", "repaired", "accepted"))

        async def run_round(_instruction):
            return next(replies)

        goal = asyncio.run(run_long_task(Goal("fix CHECKOUT-417"), run_round))
        self.assertEqual((goal.status, goal.rounds_started), ("completed", 3))


if __name__ == "__main__":
    unittest.main()
