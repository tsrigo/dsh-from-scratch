"""Chapter 5: tools for bounded, trusted capability experiments."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .runtime import Context, Plugin


PluginFactory = Callable[[], Plugin]


class RuntimeTools:
    def __init__(self, context: Context, catalog: dict[str, PluginFactory]) -> None:
        self.context = context
        self.catalog = catalog
        self.installed: dict[str, Callable[[], None]] = {}

    def inspect_runtime(self) -> dict[str, Any]:
        return self.context.inspect()

    def install_capability(self, name: str) -> dict[str, Any]:
        factory = self.catalog.get(name)
        if factory is None:
            return {"ok": False, "error": f"unknown trusted capability: {name}"}
        if name in self.installed:
            return {"ok": False, "error": f"capability already installed: {name}"}

        self.installed[name] = self.context.mount(factory())
        return {
            "ok": True,
            "capability": name,
            "tools": list(self.context.tools),
        }

    def remove_capability(self, name: str) -> dict[str, Any]:
        dispose = self.installed.pop(name, None)
        if dispose is None:
            return {"ok": False, "error": f"capability is not installed: {name}"}
        dispose()
        return {"ok": True, "capability": name, "tools": list(self.context.tools)}
