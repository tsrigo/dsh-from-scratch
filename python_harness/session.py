"""Chapter 4: one append-only history for requests and traces."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Event:
    id: int
    type: str
    data: dict[str, Any]


class SessionLog:
    def __init__(self) -> None:
        self.events: list[Event] = []

    def append(self, event_type: str, **data: Any) -> Event:
        event = Event(len(self.events) + 1, event_type, data)
        self.events.append(event)
        return event

    def request_step_ids(self) -> list[str]:
        return [event.data["step_id"] for event in self.events if event.type == "request/header"]

    def build_request(self, step_id: str) -> dict[str, Any]:
        header_index = next(
            index
            for index, event in enumerate(self.events)
            if event.type == "request/header" and event.data["step_id"] == step_id
        )
        header = self.events[header_index].data
        history = self.events[:header_index]
        checkpoint_index = max(
            (index for index, event in enumerate(history) if event.type == "context/checkpoint"),
            default=-1,
        )
        messages: list[dict[str, Any]] = []
        if checkpoint_index >= 0:
            checkpoint = history[checkpoint_index]
            messages.append({"role": "system", "content": checkpoint.data["summary"]})
            history = history[checkpoint_index + 1 :]
        for event in history:
            message = self._message_from(event)
            if message is not None:
                messages.append(message)
        return {
            "system": header["system"],
            "tools": header["tools"],
            "messages": messages,
            "dynamicContext": header["dynamic_context"],
        }

    @staticmethod
    def _message_from(event: Event) -> dict[str, Any] | None:
        roles = {"user/message": "user", "assistant/message": "assistant", "tool/result": "tool"}
        role = roles.get(event.type)
        if role is None:
            return None
        message = {"role": role, "content": event.data.get("content", "")}
        if role == "tool":
            message["name"] = event.data["name"]
        return message

    def trace(self) -> list[dict[str, Any]]:
        return [{"event_id": event.id, "type": event.type, **event.data} for event in self.events]
