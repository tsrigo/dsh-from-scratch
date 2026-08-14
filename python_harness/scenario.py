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
    "收集：取得完成目标所需的事实；有明确进展后停止本轮。",
    "实施：根据已有事实完成主要动作；记录结果后停止本轮。",
    "核验：检查交付是否满足目标，并清理临时能力。",
)


async def run_long_task(goal: Goal, run_round: RunRound) -> Goal:
    while goal.status == "active" and goal.rounds_started < goal.max_rounds:
        instruction = ROUND_INSTRUCTIONS[goal.rounds_started]
        goal.rounds_started += 1
        result = await run_round(f"目标：{goal.objective}\n本轮：{instruction}")
        if "accepted" in result:
            goal.status, goal.reason = "completed", "目标已经通过核验"
        elif "blocked" in result:
            goal.status, goal.reason = "blocked", result

    if goal.status == "active":
        goal.status, goal.reason = "limit_reached", "达到最大轮数"
    return goal
