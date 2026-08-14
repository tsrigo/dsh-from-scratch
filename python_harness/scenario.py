"""Chapter 6: carry one goal through bounded rounds."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Literal


GoalStatus = Literal["active", "completed", "blocked", "limit_reached"]
RunRound = Callable[[str], Awaitable[str]]


@dataclass
class Goal:
    objective: str
    max_rounds: int = 3
    rounds_started: int = 0
    status: GoalStatus = "active"
    reason: str = ""


ROUND_INSTRUCTIONS = (
    "Collect: obtain the facts needed to complete the goal, then end the Round after making measurable progress.",
    "Implement: complete the main action from the available facts, record the result, and end the Round.",
    "Verify: check that the deliverable satisfies the goal and remove temporary capabilities.",
)


async def run_long_task(goal: Goal, run_round: RunRound) -> Goal:
    while goal.status == "active" and goal.rounds_started < goal.max_rounds:
        instruction = ROUND_INSTRUCTIONS[goal.rounds_started]
        goal.rounds_started += 1
        result = await run_round(f"Goal: {goal.objective}\nThis Round: {instruction}")
        if "accepted" in result:
            goal.status, goal.reason = "completed", "The goal passed verification"
        elif "blocked" in result:
            goal.status, goal.reason = "blocked", result

    if goal.status == "active":
        goal.status, goal.reason = "limit_reached", "The maximum number of Rounds was reached"
    return goal
