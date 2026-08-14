"""Chapter 5: define, run, stop, and undefine dynamic plugins."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Awaitable, Callable

from .runtime import Context, Plugin

Tool = SimpleNamespace


def make_tool(
    parameters: dict[str, Any],
    execute: Callable[[dict[str, Any]], Awaitable[Any]],
) -> Tool:
    """Bundle a JSON-Schema parameters object with an async execute function.

    The agent loop validates arguments against parameters, then awaits
    execute(arguments), so every registered tool needs this shape.
    """
    return Tool(parameters=parameters, execute=execute)


def runtime_tools_plugin() -> Plugin:
    """A plugin exposing cordis_* tools for dynamic plugin experiments."""

    def setup(context: Context) -> None:
        definitions: dict[str, dict[str, Any]] = {}
        next_plugin_id = 1

        def cleanup() -> None:
            for definition in reversed(list(definitions.values())):
                dispose = definition.get("dispose")
                if dispose is not None:
                    dispose()
            definitions.clear()

        async def inspect_runtime(arguments: dict[str, Any]) -> dict[str, Any]:
            return context.inspect()

        async def define(arguments: dict[str, Any]) -> dict[str, Any]:
            name = arguments["name"]
            code = arguments["code"]
            compile(code, f"<dynamic:{name}>", "exec")
            nonlocal next_plugin_id
            plugin_id = f"dyn-{next_plugin_id}"
            next_plugin_id += 1
            definitions[plugin_id] = {
                "plugin_id": plugin_id,
                "name": name,
                "purpose": arguments["purpose"],
                "code": code,
            }
            return {"ok": True, "pluginId": plugin_id, "name": name, "status": "defined"}

        async def run(arguments: dict[str, Any]) -> dict[str, Any]:
            plugin_id = arguments["pluginId"]
            definition = definitions.get(plugin_id)
            if definition is None:
                return {"ok": False, "error": f"unknown dynamic plugin: {plugin_id}"}
            if definition.get("dispose") is not None:
                return {"ok": False, "error": f"{plugin_id} is already running"}
            plugin = instantiate_plugin(definition)
            definition["dispose"] = context.mount(plugin)
            return {
                "ok": True,
                "pluginId": plugin_id,
                "status": "running",
                "tools": list(context.tools),
            }

        async def stop(arguments: dict[str, Any]) -> dict[str, Any]:
            plugin_id = arguments["pluginId"]
            definition = definitions.get(plugin_id)
            if definition is None:
                return {"ok": False, "error": f"unknown dynamic plugin: {plugin_id}"}
            dispose = definition.get("dispose")
            if dispose is None:
                return {"ok": False, "error": f"{plugin_id} is not running"}
            dispose()
            definition["dispose"] = None
            return {"ok": True, "pluginId": plugin_id, "status": "stopped"}

        async def undefine(arguments: dict[str, Any]) -> dict[str, Any]:
            plugin_id = arguments["pluginId"]
            definition = definitions.get(plugin_id)
            if definition is None:
                return {"ok": False, "error": f"unknown dynamic plugin: {plugin_id}"}
            dispose = definition.get("dispose")
            if dispose is not None:
                dispose()
            definitions.pop(plugin_id, None)
            return {"ok": True, "pluginId": plugin_id, "status": "undefined"}

        context.effect(cleanup)
        context.contribute_prompt(
            "Inspect the current Context, define a small Cordis Plugin when the task needs a new capability, run it, use its tools, then stop or undefine it after the experiment.",
        )
        context.register_tool("cordis_inspect", make_tool({"type": "object", "properties": {}, "additionalProperties": False}, inspect_runtime))
        context.register_tool("cordis_define", make_tool(
            {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "minLength": 1},
                    "purpose": {"type": "string", "minLength": 1},
                    "code": {"type": "string", "minLength": 1},
                },
                "required": ["name", "purpose", "code"],
                "additionalProperties": False,
            },
            define,
        ))
        context.register_tool("cordis_run", make_tool(plugin_id_schema(), run))
        context.register_tool("cordis_stop", make_tool(plugin_id_schema(), stop))
        context.register_tool("cordis_undefine", make_tool(plugin_id_schema(), undefine))

    return SimpleNamespace(name="runtime-tools", setup=setup)


def instantiate_plugin(definition: dict[str, Any]) -> Plugin:
    """Execute the stored code and require a plugin_factory() returning a Plugin."""
    namespace: dict[str, Any] = {}
    exec(compile(definition["code"], f"<dynamic:{definition['name']}>", "exec"), namespace)
    factory = namespace.get("plugin_factory")
    if not callable(factory):
        raise RuntimeError("dynamic code must define plugin_factory() returning a Plugin")
    plugin = factory()
    if not hasattr(plugin, "name") or not callable(getattr(plugin, "setup", None)):
        raise RuntimeError("plugin_factory() must return a Plugin with name and setup(context)")
    return plugin


def plugin_id_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"pluginId": {"type": "string", "pattern": r"^dyn-[1-9][0-9]*$"}},
        "required": ["pluginId"],
        "additionalProperties": False,
    }
