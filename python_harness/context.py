"""Chapter 2: deterministic context projection and prefix estimates."""

from __future__ import annotations

import json
from typing import Any


def project_tool_result(value: Any, *, limit: int = 520) -> Any:
    """Keep full values in the session, but send bounded text to the model."""
    if not isinstance(value, str) or len(value) <= limit:
        return value

    omitted = len(value) - limit
    marker = f"\n… omitted {omitted} characters …\n"
    head_size = limit // 2
    tail_size = limit - head_size
    return value[:head_size] + marker + value[-tail_size:]


def build_request(
    system: str,
    tools: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    dynamic_context: str,
) -> dict[str, Any]:
    projected = []
    for message in messages:
        copy = dict(message)
        if copy.get("role") == "tool":
            copy["content"] = project_tool_result(copy.get("content"))
        projected.append(copy)
    return {
        "system": system,
        "tools": tools,
        "messages": projected,
        "dynamicContext": dynamic_context,
    }


def approximate_tokens(value: Any) -> int:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return max(1, (len(text) + 3) // 4)


def shared_prefix(left: dict[str, Any] | None, right: dict[str, Any]) -> dict[str, Any]:
    if left is None:
        return {"shared_parts": 0, "first_invalidation": "first request"}
    ordered = ("system", "tools", "messages", "dynamicContext")
    count = next((index for index, key in enumerate(ordered) if left.get(key) != right.get(key)), len(ordered))
    return {"shared_parts": count, "first_invalidation": ordered[count] if count < len(ordered) else None}
