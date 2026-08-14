import asyncio
import unittest

from python_harness.agent import Agent, Tool
from python_harness.context import project_tool_result
from python_harness.runtime import Context
from python_harness.runtime_tools import runtime_tools_plugin
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


class HarnessTests(unittest.TestCase):
    def test_agent_loop(self):
        async def read(_arguments):
            return {"path": "src/checkout.ts", "content": "return merchandise + shipping"}

        tool = Tool("read", "read source", {"required": [], "properties": {}}, read)
        self.assertEqual(asyncio.run(Agent(ScriptedLlm(), [tool]).run("fix CHECKOUT-417")), "accepted")

    def test_projection_is_bounded(self):
        self.assertIn("omitted", project_tool_result("x" * 800, limit=100))

    def test_dynamic_plugin_defined_run_stopped_undefined(self):
        context = Context()
        context.mount(runtime_tools_plugin())
        code = "\n".join([
            "def plugin_factory():",
            "    from types import SimpleNamespace",
            "    async def execute(arguments):",
            "        return {'words': len(arguments['text'].split())}",
            "    def setup(ctx):",
            "        ctx.register_tool('word_count', SimpleNamespace(",
            "            parameters={'type': 'object', 'properties': {'text': {'type': 'string'}}, 'required': ['text']},",
            "            execute=execute,",
            "        ))",
            "    return SimpleNamespace(name='word-count', setup=setup)",
        ])
        tools = context.tools
        call = lambda name: tools[name].value.execute
        defined = asyncio.run(call("cordis_define")({
            "name": "word-count", "purpose": "count words", "code": code,
        }))
        self.assertTrue(defined["ok"])
        plugin_id = defined["pluginId"]
        self.assertNotIn("word_count", tools)

        ran = asyncio.run(call("cordis_run")({"pluginId": plugin_id}))
        self.assertTrue(ran["ok"])
        self.assertIn("word_count", tools)
        self.assertEqual(
            asyncio.run(call("word_count")({"text": "a b c"})),
            {"words": 3},
        )

        stopped = asyncio.run(call("cordis_stop")({"pluginId": plugin_id}))
        self.assertTrue(stopped["ok"])
        self.assertNotIn("word_count", tools)

        undefined = asyncio.run(call("cordis_undefine")({"pluginId": plugin_id}))
        self.assertTrue(undefined["ok"])
        self.assertNotIn(plugin_id, context.inspect()["plugins"])

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
