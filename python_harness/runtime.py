"""Chapter 3: a tiny plugin runtime with ownership and rollback."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol


Cleanup = Callable[[], None]


class Plugin(Protocol):
    name: str

    def setup(self, context: "Context") -> None: ...


@dataclass
class Contribution:
    value: Any
    owner: str


class Context:
    def __init__(self) -> None:
        self.services: dict[str, Contribution] = {}
        self.tools: dict[str, Contribution] = {}
        self.prompts: list[Contribution] = []
        self.listeners: dict[str, list[Contribution]] = {}
        self._installing: str | None = None
        self._effects: dict[str, list[Cleanup]] = {}

    def effect(self, cleanup: Cleanup) -> None:
        if self._installing is None:
            raise RuntimeError("contributions must be registered while mounting a plugin")
        self._effects[self._installing].append(cleanup)

    def mount(self, plugin: Plugin) -> Cleanup:
        if plugin.name in self._effects:
            raise ValueError(f"plugin already mounted: {plugin.name}")
        self._effects[plugin.name] = []
        self._installing = plugin.name
        try:
            plugin.setup(self)
        except Exception:
            self._rollback(plugin.name)
            raise
        finally:
            self._installing = None

        disposed = False

        def unmount() -> None:
            nonlocal disposed
            if disposed:
                return
            disposed = True
            self._rollback(plugin.name)

        return unmount

    def _rollback(self, owner: str) -> None:
        for cleanup in reversed(self._effects.pop(owner, [])):
            cleanup()

    def register_tool(self, name: str, tool: Any) -> None:
        owner = self._require_owner()
        if name in self.tools:
            raise ValueError(f"tool already registered: {name}")
        self.tools[name] = Contribution(tool, owner)
        self.effect(lambda: self.tools.pop(name, None))

    def contribute_prompt(self, text: str) -> None:
        contribution = Contribution(text, self._require_owner())
        self.prompts.append(contribution)
        self.effect(lambda: self.prompts.remove(contribution))

    def inspect(self) -> dict[str, Any]:
        return {
            "plugins": list(self._effects),
            "tools": [{"name": name, "plugin": item.owner} for name, item in self.tools.items()],
            "prompts": [{"text": item.value, "plugin": item.owner} for item in self.prompts],
        }

    def _require_owner(self) -> str:
        if self._installing is None:
            raise RuntimeError("no plugin is being installed")
        return self._installing
