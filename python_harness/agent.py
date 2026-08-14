"""Chapter 1: the smallest useful agent loop."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol


Json = dict[str, Any] | list[Any] | str | int | float | bool | None


class Llm(Protocol):
    async def complete(self, request: dict[str, Any]) -> dict[str, Any]: ...


ToolHandler = Callable[[dict[str, Any]], Awaitable[Json]]


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    execute: ToolHandler


def validate_arguments(schema: dict[str, Any], arguments: dict[str, Any]) -> str | None:
    """Validate the small JSON-Schema subset used by this tutorial."""
    required = schema.get("required", [])
    missing = [name for name in required if name not in arguments]
    if missing:
        return f"missing required fields: {', '.join(missing)}"
    properties = schema.get("properties", {})
    if schema.get("additionalProperties") is False:
        unknown = [name for name in arguments if name not in properties]
        if unknown:
            return f"unknown fields: {', '.join(unknown)}"
    return None


class Agent:
    def __init__(self, llm: Llm, tools: list[Tool], *, max_steps: int = 8) -> None:
        self.llm = llm
        self.tools = {tool.name: tool for tool in tools}
        self.max_steps = max_steps

    async def run(self, objective: str) -> str:
        messages: list[dict[str, Any]] = [{"role": "user", "content": objective}]
        schemas = [
            {"name": tool.name, "description": tool.description, "parameters": tool.parameters}
            for tool in self.tools.values()
        ]

        for step in range(1, self.max_steps + 1):
            request = {
                "system": "使用给定工具完成目标；根据工具结果继续，完成后停止调用工具。",
                "tools": schemas,
                "messages": messages,
                "dynamic_context": f"step={step}",
            }
            response = await self.llm.complete(request)
            messages.append({"role": "assistant", "content": response.get("content", "")})
            calls = response.get("tool_calls", [])
            if not calls:
                return str(response.get("content", ""))

            for call in calls:
                name, arguments = call["name"], call.get("arguments", {})
                tool = self.tools.get(name)
                error = "unknown tool" if tool is None else validate_arguments(tool.parameters, arguments)
                result: Json = {"error": error}
                if tool is not None and error is None:
                    try:
                        result = await tool.execute(arguments)
                    except Exception as exc:  # Tool errors become model-readable results.
                        result = {"error": str(exc)}
                messages.append({"role": "tool", "name": name, "content": result})

        raise RuntimeError(f"agent exceeded {self.max_steps} steps")
