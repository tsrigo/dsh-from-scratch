from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from manim import (
    AnimationGroup,
    Arrow,
    BLACK,
    Brace,
    Circle,
    Create,
    DashedLine,
    DOWN,
    FadeIn,
    FadeOut,
    Flash,
    GrowArrow,
    Indicate,
    LEFT,
    LaggedStart,
    Line,
    ORIGIN,
    Rectangle,
    ReplacementTransform,
    RIGHT,
    RoundedRectangle,
    Scene,
    Square,
    Succession,
    SurroundingRectangle,
    Text,
    Transform,
    TransformFromCopy,
    UP,
    VGroup,
    WHITE,
    Write,
    config,
    linear,
)
from manim.utils.rate_functions import ease_in_out_cubic


BG = "#07142F"
PANEL = "#102755"
PANEL_2 = "#17366D"
GRID = "#294776"
TEXT = "#F1F6FF"
MUTED = "#8DA6C9"
CYAN = "#67D4F0"
BLUE = "#6EA8FE"
GREEN = "#76D7B1"
YELLOW = "#F2CF66"
RED = "#F08A91"
PURPLE = "#B79AF4"
FONT = "Noto Sans CJK SC"
MONO = "Noto Sans Mono CJK SC"

config.background_color = BG


def txt(
    value: str,
    size: float = 28,
    color: str = TEXT,
    *,
    weight: str = "NORMAL",
    font: str = FONT,
    max_width: float | None = None,
) -> Text:
    mob = Text(value, font=font, font_size=size, color=color, weight=weight)
    if max_width is not None and mob.width > max_width:
        mob.scale_to_fit_width(max_width)
    return mob


def code(value: str, size: float = 23, color: str = TEXT, max_width: float | None = None) -> Text:
    return txt(value, size, color, font=MONO, max_width=max_width)


def rounded_panel(width: float, height: float, *, stroke: str = GRID, fill: str = PANEL) -> RoundedRectangle:
    return RoundedRectangle(
        width=width,
        height=height,
        corner_radius=0.16,
        stroke_color=stroke,
        stroke_width=1.8,
        fill_color=fill,
        fill_opacity=0.92,
    )


def pill(value: str, color: str, *, width: float | None = None, size: float = 20) -> VGroup:
    label = code(value, size, BG, max_width=(width - 0.28) if width else None)
    box_width = width or max(1.35, label.width + 0.45)
    box = RoundedRectangle(
        width=box_width,
        height=0.52,
        corner_radius=0.25,
        stroke_width=0,
        fill_color=color,
        fill_opacity=1,
    )
    return VGroup(box, label.move_to(box))


def card(
    title: str,
    detail: str,
    *,
    width: float = 2.35,
    height: float = 1.18,
    color: str = BLUE,
    title_size: float = 23,
    detail_size: float = 17,
) -> VGroup:
    box = rounded_panel(width, height, stroke=color)
    heading = code(title, title_size, TEXT, max_width=width - 0.3)
    body = txt(detail, detail_size, MUTED, max_width=width - 0.34)
    content = VGroup(heading, body).arrange(DOWN, buff=0.14).move_to(box)
    return VGroup(box, content)


def event_row(index: str, kind: str, detail: str, color: str = BLUE, width: float = 5.3) -> VGroup:
    box = rounded_panel(width, 0.62, stroke=GRID, fill="#0D214B")
    dot = Circle(radius=0.075, fill_color=color, fill_opacity=1, stroke_width=0).move_to(box.get_left() + RIGHT * 0.25)
    number = code(index, 15, MUTED).next_to(dot, RIGHT, buff=0.14)
    name = code(kind, 17, TEXT, max_width=1.8).next_to(number, RIGHT, buff=0.2)
    note = txt(detail, 15, MUTED, max_width=2.55).align_to(box, RIGHT).shift(LEFT * 0.22)
    return VGroup(box, dot, number, name, note)


def small_check(label: str, *, ok: bool = True, width: float = 2.6) -> VGroup:
    color = GREEN if ok else RED
    box = rounded_panel(width, 0.54, stroke=color, fill="#0C2048")
    icon = txt("✓" if ok else "×", 20, color, weight="BOLD").move_to(box.get_left() + RIGHT * 0.25)
    body = txt(label, 17, TEXT, max_width=width - 0.65).next_to(icon, RIGHT, buff=0.12)
    return VGroup(box, icon, body)


def connect(left, right, color: str = MUTED, *, dashed: bool = False):
    cls = DashedLine if dashed else Arrow
    if dashed:
        return cls(left.get_right(), right.get_left(), color=color, stroke_width=2.2, dash_length=0.12)
    return cls(left.get_right(), right.get_left(), color=color, stroke_width=2.4, buff=0.1, max_tip_length_to_length_ratio=0.12)


class DshScene(Scene):
    header_group: VGroup
    caption_group: VGroup | None

    def setup(self) -> None:
        self.camera.background_color = BG
        self.header_group = VGroup()
        self.caption_group = None

    def chapter_header(self, number: str, question: str) -> VGroup:
        badge = pill(number, CYAN, width=0.72, size=17)
        question_text = txt(question, 31, TEXT, weight="BOLD", max_width=11.8)
        title = VGroup(badge, question_text).arrange(RIGHT, buff=0.26)
        title.to_edge(UP, buff=0.28).to_edge(LEFT, buff=0.42)
        rule = Line(LEFT * 6.7, RIGHT * 6.7, color=GRID, stroke_width=1).next_to(title, DOWN, buff=0.22)
        self.header_group = VGroup(title, rule)
        self.play(FadeIn(badge, shift=RIGHT * 0.12), Write(question_text), Create(rule), run_time=1.35)
        return self.header_group

    def caption(self, value: str, color: str = MUTED, *, hold: float = 0.7) -> VGroup:
        label = txt(value, 20, color, max_width=12.4)
        box = RoundedRectangle(
            width=max(5.2, label.width + 0.55),
            height=0.55,
            corner_radius=0.12,
            stroke_width=0,
            fill_color="#06112A",
            fill_opacity=0.9,
        )
        group = VGroup(box, label.move_to(box)).to_edge(DOWN, buff=0.18)
        if self.caption_group is None:
            self.play(FadeIn(group, shift=UP * 0.08), run_time=0.35)
        else:
            self.play(ReplacementTransform(self.caption_group, group), run_time=0.35)
        self.caption_group = group
        self.wait(hold)
        return group

    def finish_answer(self, lines: Sequence[tuple[str, str]], *, hold: float = 2.2) -> None:
        preserved = [self.header_group]
        if self.caption_group is not None:
            preserved.append(self.caption_group)
        preserved_ids = {
            id(member)
            for group in preserved
            for member in group.get_family()
        }
        removable = [
            mob
            for mob in self.mobjects
            if not any(id(member) in preserved_ids for member in mob.get_family())
        ]
        if removable:
            self.play(*[FadeOut(mob, scale=0.96) for mob in removable], run_time=0.6)
        answer_box = rounded_panel(12.1, 3.55, stroke=CYAN, fill="#0B2049")
        answer_label = txt("答案", 20, BG, weight="BOLD")
        answer_badge = RoundedRectangle(
            width=1.1,
            height=0.48,
            corner_radius=0.12,
            stroke_width=0,
            fill_color=CYAN,
            fill_opacity=1,
        )
        badge = VGroup(answer_badge, answer_label.move_to(answer_badge)).move_to(answer_box.get_top() + DOWN * 0.48)
        line_mobs = VGroup(*[
            code(text, 24 if index == len(lines) - 1 else 22, color, max_width=11.2)
            for index, (text, color) in enumerate(lines)
        ]).arrange(DOWN, buff=0.34).move_to(answer_box).shift(DOWN * 0.22)
        group = VGroup(answer_box, badge, line_mobs)
        self.play(FadeIn(answer_box, scale=0.97), FadeIn(badge, shift=DOWN * 0.1), run_time=0.7)
        self.play(LaggedStart(*[Write(line) for line in line_mobs], lag_ratio=0.28), run_time=1.9)
        self.wait(hold)


class Scene01AgentLoop(DshScene):
    """Question 1: DSH 的 Agent Loop 是什么样的？"""

    def construct(self) -> None:
        self.chapter_header("01", "DSH 的 Agent Loop 是什么样的？")

        turn = rounded_panel(12.25, 4.75, stroke=BLUE, fill="#091B3F").shift(DOWN * 0.15)
        turn_label = pill("TURN · bounded by maxSteps", BLUE, width=3.65, size=18).move_to(turn.get_top() + DOWN * 0.4 + LEFT * 3.85)
        brake = pill("maxSteps = 8", YELLOW, width=2.05, size=17).move_to(turn.get_top() + DOWN * 0.4 + RIGHT * 4.5)
        steps = VGroup(*[
            card(f"STEP {index}", "一次模型请求", width=1.68, height=1.02, color=CYAN if index == 1 else GRID, title_size=19, detail_size=15)
            for index in range(1, 6)
        ]).arrange(RIGHT, buff=0.36).move_to(turn).shift(UP * 0.24)
        ellipsis = code("…", 32, MUTED).next_to(steps, RIGHT, buff=0.25)
        self.play(FadeIn(turn, scale=0.98), FadeIn(turn_label), FadeIn(brake), run_time=0.75)
        self.play(LaggedStart(*[FadeIn(step, shift=RIGHT * 0.2) for step in steps], FadeIn(ellipsis), lag_ratio=0.13), run_time=1.2)
        self.caption("一个 Turn 不是一次模型调用，而是若干个有上限的 Step。")

        focus = steps[0].copy()
        self.play(
            FadeOut(VGroup(*steps[1:], ellipsis), shift=RIGHT * 0.25),
            FadeOut(turn_label),
            focus.animate.scale(1.42).move_to(ORIGIN + UP * 0.3),
            turn.animate.set_stroke(opacity=0.25),
            run_time=0.9,
        )
        self.remove(steps[0])
        self.add(focus)

        parts = VGroup(
            pill("system", BLUE, width=1.55),
            pill("tools", PURPLE, width=1.45),
            pill("messages", GREEN, width=1.82),
            pill("dynamic", YELLOW, width=1.7),
        ).arrange(RIGHT, buff=0.18).move_to(UP * 0.65)
        request = card("UnifiedRequest", "供应商无关的模型输入", width=3.15, height=1.25, color=CYAN)
        self.play(ReplacementTransform(focus, request), run_time=0.65)
        self.play(LaggedStart(*[FadeIn(part, shift=DOWN * 0.18) for part in parts], lag_ratio=0.12), run_time=0.9)
        self.play(*[part.animate.move_to(request.get_center()) for part in parts], run_time=0.8, rate_func=ease_in_out_cubic)
        self.play(FadeOut(parts), Indicate(request[0], color=CYAN), run_time=0.5)
        self.caption("每个 Step 都从 Context 与 Session Log 重新构建一份 UnifiedRequest。")

        llm = card("LLM", "只返回文字与 toolCalls[]", width=3.05, height=1.25, color=PURPLE).shift(RIGHT * 4.1 + UP * 0.3)
        request.generate_target()
        request.target.shift(LEFT * 4.05 + UP * 0.3)
        request_arrow = connect(request.target, llm, CYAN)
        self.play(request.animate.move_to(request.target), FadeIn(llm, shift=LEFT * 0.2), GrowArrow(request_arrow), run_time=0.9)
        response = pill("{ content, toolCalls[] }", PURPLE, width=3.0, size=17).move_to(request_arrow).shift(DOWN * 0.5)
        self.play(FadeIn(response, shift=DOWN * 0.12), Flash(llm, color=PURPLE, flash_radius=0.8), run_time=0.7)

        empty_branch = small_check("toolCalls.length = 0 → complete", ok=True, width=3.65).shift(RIGHT * 3.45 + DOWN * 1.15)
        calls_branch = small_check("toolCalls.length > 0 → execute", ok=True, width=3.65).shift(LEFT * 3.45 + DOWN * 1.15)
        branch_left = Arrow(response.get_bottom(), calls_branch.get_top(), color=YELLOW, buff=0.12, stroke_width=2.2)
        branch_right = Arrow(response.get_bottom(), empty_branch.get_top(), color=GREEN, buff=0.12, stroke_width=2.2)
        self.play(GrowArrow(branch_left), FadeIn(calls_branch), GrowArrow(branch_right), FadeIn(empty_branch), run_time=0.9)
        self.caption("模型不拥有循环：Harness 根据 toolCalls 是否为空决定继续还是完成。")

        self.play(
            VGroup(request, request_arrow, llm, response, empty_branch, branch_right).animate.set_opacity(0.2),
            calls_branch.animate.move_to(UP * 1.25),
            FadeOut(branch_left),
            run_time=0.7,
        )
        stages = VGroup(
            card("LOOKUP", "工具是否存在", width=2.1, color=BLUE),
            card("VALIDATE", "JSON Schema", width=2.1, color=YELLOW),
            card("EXECUTE", "捕获异常", width=2.1, color=PURPLE),
            card("RESULT", "结构化结果", width=2.1, color=GREEN),
        ).arrange(RIGHT, buff=0.36).move_to(DOWN * 0.2)
        arrows = VGroup(*[connect(stages[index], stages[index + 1], MUTED) for index in range(3)])
        self.play(LaggedStart(*[FadeIn(stage, shift=RIGHT * 0.18) for stage in stages], lag_ratio=0.14), run_time=1.1)
        self.play(LaggedStart(*[GrowArrow(arrow) for arrow in arrows], lag_ratio=0.16), run_time=0.75)
        bad = pill("unknown / invalid / thrown", RED, width=3.15, size=17).next_to(stages[3], DOWN, buff=0.42)
        normalized = pill("tool/result { ok:false, error }", GREEN, width=3.55, size=16).move_to(bad)
        self.play(FadeIn(bad, shift=UP * 0.12), run_time=0.45)
        self.play(ReplacementTransform(bad, normalized), Indicate(stages[3][0], color=GREEN), run_time=0.8)
        self.caption("成功、未知工具、参数错误和执行异常都会被整理成可记录的 tool/result。")

        log = rounded_panel(10.9, 0.92, stroke=GREEN, fill="#0A2444").shift(DOWN * 2.02)
        log_label = code("SESSION LOG", 18, GREEN).move_to(log.get_left() + RIGHT * 0.95)
        events = VGroup(
            pill("assistant/message", PURPLE, width=2.2, size=14),
            pill("tool/call", YELLOW, width=1.55, size=14),
            pill("tool/result", GREEN, width=1.7, size=14),
            pill("step/end", BLUE, width=1.5, size=14),
        ).arrange(RIGHT, buff=0.16).move_to(log).shift(RIGHT * 1.2)
        self.play(FadeIn(log, shift=UP * 0.1), FadeIn(log_label), run_time=0.55)
        self.play(LaggedStart(*[TransformFromCopy(stages[min(index, 3)], event) for index, event in enumerate(events)], lag_ratio=0.16), run_time=1.1)
        loop_arrow = Arrow(log.get_left() + UP * 0.05, request.get_bottom(), color=CYAN, stroke_width=3, buff=0.15, path_arc=-1.0)
        self.play(GrowArrow(loop_arrow), VGroup(request, request_arrow, llm).animate.set_opacity(1), run_time=0.8)
        self.caption("下一 Step 再从这份事实记录构建请求；循环由 Harness 驱动。")

        provider = pill("Provider adapter = 翻译层", MUTED, width=3.25, size=17).move_to(RIGHT * 4.65 + DOWN * 2.72)
        self.play(FadeIn(provider, shift=LEFT * 0.12), run_time=0.45)
        self.play(Indicate(brake, color=YELLOW), Indicate(empty_branch, color=GREEN), run_time=0.8)
        self.caption("停止条件有两类：无工具调用则完成；超过 maxSteps 则强制报错。")

        self.finish_answer([
            ("Turn 内运行有界 Step 循环；每个 Step 重建一次请求。", TEXT),
            ("模型决定调用什么；Harness 校验、执行、记录并决定是否继续。", TEXT),
            ("buildRequest → LLM → validate/execute → append → stop / next Step", CYAN),
        ])


class Scene02ContextCache(DshScene):
    """Question 2: 上下文如何组织，以及如何创造缓存复用机会？"""

    def construct(self) -> None:
        self.chapter_header("02", "上下文怎样组织，又为缓存复用做了什么？")

        raw_box = rounded_panel(5.35, 4.25, stroke=GREEN, fill="#0B2049").shift(LEFT * 3.35 + DOWN * 0.1)
        raw_title = code("SESSION LOG · 完整事实", 21, GREEN).move_to(raw_box.get_top() + DOWN * 0.35)
        raw_lines = VGroup(*[
            code(value, 15, MUTED, max_width=4.55)
            for value in [
                "#12 tool/result · ci.log",
                "FAIL checkout.test.ts:18",
                "expected 80 to be 100",
                *[f"stack frame {index:02d} …" for index in range(1, 8)],
                "43 tests · 1 failed",
            ]
        ]).arrange(DOWN, aligned_edge=LEFT, buff=0.105).move_to(raw_box).shift(DOWN * 0.12)
        self.play(FadeIn(raw_box, scale=0.98), Write(raw_title), run_time=0.7)
        self.play(LaggedStart(*[FadeIn(line, shift=DOWN * 0.08) for line in raw_lines], lag_ratio=0.07), run_time=1.0)
        self.caption("完整执行历史首先原样保存；上下文并不等于这整条历史。")

        projection_box = rounded_panel(5.35, 4.25, stroke=CYAN, fill="#0B2049").shift(RIGHT * 3.35 + DOWN * 0.1)
        projection_title = code("MODEL PROJECTION · 本次可见", 21, CYAN).move_to(projection_box.get_top() + DOWN * 0.35)
        projection = VGroup(
            code("#12 tool/result · ci.log", 15, TEXT),
            code("FAIL checkout.test.ts:18", 15, TEXT),
            code("expected 80 to be 100", 15, TEXT),
            pill("[… 604 chars omitted …]", YELLOW, width=3.2, size=14),
            code("43 tests · 1 failed", 15, TEXT),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.25).move_to(projection_box).shift(DOWN * 0.08)
        arrow = Arrow(raw_box.get_right(), projection_box.get_left(), color=CYAN, buff=0.16, stroke_width=3)
        self.play(FadeIn(projection_box, scale=0.98), Write(projection_title), GrowArrow(arrow), run_time=0.75)
        self.play(
            TransformFromCopy(VGroup(raw_lines[0], raw_lines[1], raw_lines[2]), VGroup(*projection[:3])),
            TransformFromCopy(raw_lines[-1], projection[-1]),
            FadeIn(projection[3], scale=0.9),
            run_time=1.05,
        )
        self.caption("长工具结果只在模型投影中保留头、尾和明确的省略量；原始收据没有被删。")

        checkpoint = pill("checkpoint: 已诊断并修复", PURPLE, width=3.6, size=15).move_to(projection_box).shift(DOWN * 1.42)
        covered = SurroundingRectangle(VGroup(*raw_lines[:7]), color=PURPLE, buff=0.12, stroke_width=2)
        self.play(Create(covered), FadeIn(checkpoint, shift=UP * 0.14), run_time=0.75)
        self.play(VGroup(*projection[:4]).animate.set_opacity(0.16), checkpoint.animate.move_to(projection_box.get_center() + UP * 0.25), run_time=0.7)
        self.caption("Checkpoint 只接替未来请求中的早期投影，旧事件仍可用于重建过去。")

        self.play(FadeOut(VGroup(raw_box, raw_title, raw_lines, covered, projection_box, projection_title, projection, arrow, checkpoint)), run_time=0.6)
        scattered = VGroup(
            pill("dynamic(step=2)", YELLOW, width=2.45, size=15).shift(LEFT * 4.1 + UP * 1.2),
            pill("messages[]", GREEN, width=2.0, size=16).shift(RIGHT * 3.8 + DOWN * 0.7),
            pill("tool schemas", PURPLE, width=2.25, size=16).shift(RIGHT * 3.4 + UP * 1.35),
            pill("system prompt", BLUE, width=2.25, size=16).shift(LEFT * 3.5 + DOWN * 0.85),
        )
        self.play(LaggedStart(*[FadeIn(item, scale=0.9) for item in scattered], lag_ratio=0.12), run_time=0.9)
        self.caption("缓存不理解语义；先把请求部件按变化频率重新排列。")

        ordered = VGroup(
            pill("SYSTEM · stable", BLUE, width=2.55, size=15),
            pill("TOOLS · stable", PURPLE, width=2.45, size=15),
            pill("MESSAGES · append-only", GREEN, width=3.25, size=15),
            pill("DYNAMIC · step-variable", YELLOW, width=3.3, size=15),
        ).arrange(RIGHT, buff=0.12).move_to(UP * 0.65)
        self.play(*[ReplacementTransform(scattered[index], ordered[[3, 2, 1, 0][index]]) for index in range(4)], run_time=1.2, rate_func=ease_in_out_cubic)
        frequency = VGroup(
            txt("低频变化", 17, BLUE),
            Arrow(LEFT * 1.4, RIGHT * 1.4, color=MUTED, stroke_width=2, buff=0),
            txt("高频变化", 17, YELLOW),
        ).arrange(RIGHT, buff=0.18).next_to(ordered, DOWN, buff=0.45)
        self.play(FadeIn(frequency, shift=UP * 0.08), run_time=0.5)
        self.caption("最终顺序：稳定 system、稳定 tools、只追加 messages、当前 Step 的 dynamic。")

        request_a = VGroup(
            pill("SYSTEM · stable", BLUE, width=2.55, size=15),
            pill("TOOLS · stable", PURPLE, width=2.45, size=15),
            pill("MESSAGES · 3 items", GREEN, width=3.25, size=15),
            pill("DYNAMIC · step=1", YELLOW, width=3.3, size=15),
        ).arrange(RIGHT, buff=0.12).scale(0.84).shift(UP * 1.15)
        request_b = VGroup(
            pill("SYSTEM · stable", BLUE, width=2.55, size=15),
            pill("TOOLS · stable", PURPLE, width=2.45, size=15),
            pill("MESSAGES · 5 items", GREEN, width=3.25, size=15),
            pill("DYNAMIC · step=2", YELLOW, width=3.3, size=15),
        ).arrange(RIGHT, buff=0.12).scale(0.84).shift(DOWN * 0.35)
        labels = VGroup(code("REQUEST A", 17, MUTED), code("REQUEST B", 17, MUTED))
        labels[0].next_to(request_a, LEFT, buff=0.28)
        labels[1].next_to(request_b, LEFT, buff=0.28)
        self.play(FadeOut(ordered), FadeOut(frequency), FadeIn(request_a), FadeIn(request_b), FadeIn(labels), run_time=0.7)

        scanner = Line(UP * 0.58, DOWN * 0.58, color=CYAN, stroke_width=4).move_to(request_a[0].get_left() + LEFT * 0.08 + DOWN * 0.75)
        shared_box = SurroundingRectangle(VGroup(request_a[0], request_a[1], request_b[0], request_b[1]), color=CYAN, buff=0.13, stroke_width=2.5)
        self.play(Create(scanner), run_time=0.35)
        self.play(scanner.animate.move_to(request_a[2].get_left() + LEFT * 0.08 + DOWN * 0.75), run_time=1.35, rate_func=linear)
        self.play(Create(shared_box), Flash(scanner, color=RED, flash_radius=0.45), run_time=0.65)
        mismatch = pill("first invalidation", RED, width=2.25, size=14).next_to(scanner, DOWN, buff=0.28)
        self.play(FadeIn(mismatch, shift=UP * 0.08), run_time=0.4)
        self.caption("相邻请求从左向右比较；首次差异之前的规范化内容才构成共享前缀。")

        plugin_change = pill("安装插件 → TOOLS 改变", RED, width=3.45, size=16).to_edge(DOWN, buff=0.92)
        earlier_scanner = scanner.copy().move_to(request_a[1].get_left() + LEFT * 0.08 + DOWN * 0.75)
        self.play(FadeIn(plugin_change, shift=UP * 0.1), ReplacementTransform(scanner, earlier_scanner), FadeOut(shared_box), run_time=0.7)
        shorter = SurroundingRectangle(VGroup(request_a[0], request_b[0]), color=YELLOW, buff=0.13, stroke_width=2.5)
        self.play(Create(shorter), run_time=0.45)
        self.caption("真实运行时变化越靠前，共享前缀就越短；这是正确失效，不是缓存故障。")

        estimate = pill("教学估计 ≠ Provider 实际缓存命中", MUTED, width=4.35, size=15).move_to(DOWN * 2.55)
        self.play(ReplacementTransform(plugin_change, estimate), run_time=0.45)
        self.wait(0.6)

        self.finish_answer([
            ("完整历史负责保存；模型上下文是它的裁剪 / checkpoint 投影。", TEXT),
            ("请求按 stable → append-only → step-variable 排列。", TEXT),
            ("复用机会 = 相邻请求的最长规范化相同前缀", CYAN),
        ])


class Scene03PluginKernel(DshScene):
    """Question 3: 如何实现“一切皆插件”？"""

    def construct(self) -> None:
        self.chapter_header("03", "如何实现“一切皆插件”？")

        preset = card("PRESET", "选择一组插件", width=3.15, height=1.25, color=BLUE)
        plugin = card("PLUGIN", "一次安装单元", width=3.15, height=1.25, color=CYAN)
        tool = card("TOOL", "模型可调用动作", width=3.15, height=1.25, color=YELLOW)
        layers = VGroup(preset, plugin, tool).arrange(RIGHT, buff=0.82).shift(UP * 0.25)
        arrows = VGroup(connect(preset, plugin, MUTED), connect(plugin, tool, MUTED))
        self.play(LaggedStart(*[FadeIn(item, shift=RIGHT * 0.18) for item in layers], lag_ratio=0.18), run_time=1.0)
        self.play(LaggedStart(*[GrowArrow(arrow) for arrow in arrows], lag_ratio=0.2), run_time=0.65)
        not_equal = VGroup(
            code("Preset", 19, BLUE),
            code("≠", 22, MUTED),
            code("Plugin", 19, CYAN),
            code("≠", 22, MUTED),
            code("Tool", 19, YELLOW),
        ).arrange(RIGHT, buff=0.18).shift(DOWN * 1.35)
        self.play(FadeIn(not_equal, shift=UP * 0.1), run_time=0.45)
        self.caption("Preset 负责选插件，Plugin 负责贡献能力，Tool 只是能力的一种。")

        plugin_focus = plugin.copy().scale(1.06).move_to(LEFT * 5.15 + UP * 1.35)
        self.play(
            ReplacementTransform(plugin, plugin_focus),
            FadeOut(VGroup(preset, tool, arrows, not_equal)),
            run_time=0.75,
        )
        setup = pill("Context.mount() → plugin.setup(ctx)", CYAN, width=4.55, size=17).next_to(plugin_focus, DOWN, buff=0.35)
        self.play(FadeIn(setup, shift=DOWN * 0.1), run_time=0.45)

        registry_specs = [
            ("SERVICES", "provide(token)", BLUE),
            ("TOOLS", "registerTool()", YELLOW),
            ("PROMPTS", "contributePrompt()", PURPLE),
            ("LISTENERS", "on(event)", GREEN),
        ]
        registries = VGroup(*[
            card(title, action, width=3.15, height=0.88, color=color, title_size=18, detail_size=14)
            for title, action, color in registry_specs
        ]).arrange(DOWN, buff=0.18).move_to(LEFT * 0.35 + DOWN * 0.15)
        stack_box = rounded_panel(3.05, 4.28, stroke=RED, fill="#0B2049").move_to(RIGHT * 4.85 + DOWN * 0.15)
        stack_title = code("INVERSE EFFECT STACK", 17, RED, max_width=2.65).move_to(stack_box.get_top() + DOWN * 0.34)
        owner = pill("owner = checkout-workspace", CYAN, width=3.55, size=14).move_to(LEFT * 2.8 + DOWN * 2.42)
        self.play(FadeIn(registries, shift=RIGHT * 0.15), FadeIn(stack_box), Write(stack_title), FadeIn(owner), run_time=0.75)

        inverse_labels = ["delete service", "delete tool", "delete prompt", "remove listener"]
        inverse_cards = VGroup(*[
            pill(label, color, width=2.55, size=14)
            for label, (_, _, color) in zip(inverse_labels, registry_specs)
        ]).arrange(DOWN, buff=0.16).move_to(stack_box).shift(DOWN * 0.18)
        owner_stamps = VGroup(*[
            pill("owner", CYAN, width=0.92, size=12).move_to(registry.get_right() + LEFT * 0.52)
            for registry in registries
        ])
        contribution_arrows = VGroup(*[
            Arrow(setup.get_right(), registry.get_left(), color=color, stroke_width=2.1, buff=0.12, max_tip_length_to_length_ratio=0.09)
            for registry, (_, _, color) in zip(registries, registry_specs)
        ])
        for registry, stamp, inverse, contribution_arrow in zip(registries, owner_stamps, inverse_cards, contribution_arrows):
            self.play(GrowArrow(contribution_arrow), Indicate(registry[0], color=stamp[0].get_fill_color()), run_time=0.35)
            self.play(FadeIn(stamp, scale=0.85), FadeIn(inverse, shift=UP * 0.12), run_time=0.35)
        self.caption("每次异构登记都盖上同一 owner，并同时把对应逆操作压入 effect 栈。")

        mounted = pill("state = mounted", GREEN, width=2.35, size=16).next_to(setup, DOWN, buff=0.42)
        disposer = pill("return once(dispose)", GREEN, width=2.9, size=16).next_to(stack_box, DOWN, buff=0.24)
        self.play(ReplacementTransform(setup.copy(), mounted), FadeIn(disposer, shift=UP * 0.12), run_time=0.7)
        self.caption("setup 成功后，这一整栈逆操作被封装成一个只生效一次的卸载函数。")

        pop_order = list(reversed(range(len(inverse_cards))))
        for index in pop_order:
            inverse = inverse_cards[index]
            registry = registries[index]
            stamp = owner_stamps[index]
            self.play(inverse.animate.move_to(registry).set_opacity(0.2), registry.animate.set_opacity(0.22), FadeOut(stamp), run_time=0.32)
        empty_stack = code("EMPTY", 24, MUTED).move_to(stack_box)
        inspection_zero = pill("inspect() → 0 residual contributions", GREEN, width=4.4, size=15).move_to(DOWN * 2.45)
        self.play(FadeIn(empty_stack), ReplacementTransform(disposer, inspection_zero), run_time=0.55)
        self.caption("主动卸载从栈顶逆序清理，Service、Tool、Prompt、Listener 和关系一起归零。")

        self.play(FadeOut(VGroup(registries, owner_stamps, contribution_arrows, mounted, inspection_zero, empty_stack)), run_time=0.45)
        failure_title = pill("如果 setup 在中途抛错？", RED, width=3.25, size=16).move_to(LEFT * 0.4 + UP * 1.8)
        failed_entries = VGroup(*[
            card(title, "registered", width=2.25, height=0.8, color=color, title_size=16, detail_size=13)
            for title, _, color in registry_specs[:3]
        ]).arrange(DOWN, buff=0.18).move_to(LEFT * 0.55)
        failed_inverse = VGroup(*[
            pill(label, color, width=2.35, size=13)
            for label, (_, _, color) in zip(inverse_labels[:3], registry_specs[:3])
        ]).arrange(DOWN, buff=0.16).move_to(stack_box).shift(DOWN * 0.18)
        self.play(FadeIn(failure_title, shift=DOWN * 0.1), FadeIn(failed_entries), FadeIn(failed_inverse), run_time=0.65)
        error = pill("throw setup failed", RED, width=2.65, size=15).next_to(failure_title, DOWN, buff=0.35)
        self.play(FadeIn(error, scale=0.88), Flash(error, color=RED, flash_radius=0.65), run_time=0.55)
        rollback = code("#rollback(record)", 21, RED).next_to(stack_box, DOWN, buff=0.28)
        self.play(Write(rollback), run_time=0.4)
        for index in reversed(range(len(failed_inverse))):
            self.play(
                failed_inverse[index].animate.move_to(failed_entries[index]).set_opacity(0),
                failed_entries[index].animate.set_opacity(0),
                run_time=0.3,
            )
        invariant = pill("失败前状态 = 回滚后状态", GREEN, width=3.45, size=16).move_to(LEFT * 0.55 + DOWN * 1.65)
        self.play(FadeIn(invariant, shift=UP * 0.12), run_time=0.45)
        self.caption("安装失败与主动卸载复用同一条 rollback 路径，所以部分安装不会留下残骸。")

        self.finish_answer([
            ("所有运行时能力只能在 plugin.setup() 中登记，并记录 owner。", TEXT),
            ("每次登记同时生成逆操作；成功返回 disposer，失败立即逆序回滚。", TEXT),
            ("mount = setup + owner ledger + inverse-effect stack", CYAN),
        ])


class Scene04SessionLog(DshScene):
    """Question 4: DSH 怎么记录和保存 Agent 执行过程？"""

    def construct(self) -> None:
        self.chapter_header("04", "DSH 怎么记录和保存 Agent 执行过程？")

        ledger_box = rounded_panel(5.7, 5.25, stroke=GREEN, fill="#091D42").shift(LEFT * 3.75 + DOWN * 0.2)
        ledger_title = VGroup(
            code("SESSION LOG", 21, GREEN),
            code("append-only", 15, MUTED),
        ).arrange(RIGHT, buff=0.2).move_to(ledger_box.get_top() + DOWN * 0.32)
        specs = [
            ("#01", "turn/start", "turn-1", BLUE),
            ("#02", "user/message", "Fix CHECKOUT-417", BLUE),
            ("#03", "step/start", "step-1", CYAN),
            ("#04", "assistant/message", "inspect files", PURPLE),
            ("#05", "tool/result", "full ci.log", GREEN),
            ("#06", "context/checkpoint", "covers through #05", YELLOW),
            ("#07", "request/header", "step-3", CYAN),
            ("#08", "assistant/message", "future event", MUTED),
        ]
        rows = VGroup(*[
            event_row(index, kind, detail, color, width=5.12)
            for index, kind, detail, color in specs
        ]).arrange(DOWN, buff=0.08).move_to(ledger_box).shift(DOWN * 0.13)
        self.play(FadeIn(ledger_box, scale=0.98), Write(ledger_title), run_time=0.7)
        self.play(LaggedStart(*[FadeIn(row, shift=DOWN * 0.1) for row in rows], lag_ratio=0.09), run_time=1.25)
        self.caption("Turn、Step、请求头、模型消息、工具结果等都成为带递增编号的类型化事件。")

        overwrite = pill("修改 #05？", RED, width=1.85, size=14).next_to(rows[4], RIGHT, buff=0.28)
        blocked = Line(overwrite.get_corner(UP + LEFT), overwrite.get_corner(DOWN + RIGHT), color=RED, stroke_width=4)
        self.play(FadeIn(overwrite, shift=LEFT * 0.1), Create(blocked), run_time=0.55)
        self.caption("已经发生的事件只追加、不改写；观察者拿到副本，也不能篡改账本。")
        self.play(FadeOut(VGroup(overwrite, blocked)), run_time=0.3)

        target_header = rows[6]
        cut = Line(UP * 2.46, DOWN * 2.46, color=CYAN, stroke_width=3).move_to(RIGHT * 0.05 + DOWN * 0.2)
        cut_label = pill("查询 step-3", CYAN, width=1.95, size=14).next_to(cut, UP, buff=0.12)
        self.play(Create(cut), FadeIn(cut_label, shift=DOWN * 0.08), Indicate(target_header[0], color=CYAN), run_time=0.75)
        self.play(rows[7].animate.set_opacity(0.13), run_time=0.4)
        self.caption("重建历史请求时，先在目标 request/header 处切开时间；未来事件不能影响过去。")

        projection_box = rounded_panel(5.35, 3.55, stroke=CYAN, fill="#0B2049").shift(RIGHT * 3.9 + UP * 0.55)
        projection_title = code("buildRequest(events, step-3)", 20, CYAN, max_width=4.75).move_to(projection_box.get_top() + DOWN * 0.36)
        self.play(FadeIn(projection_box, shift=LEFT * 0.15), Write(projection_title), run_time=0.65)

        checkpoint_highlight = SurroundingRectangle(rows[5], color=YELLOW, buff=0.08, stroke_width=2)
        covered_highlight = SurroundingRectangle(VGroup(*rows[:5]), color=MUTED, buff=0.11, stroke_width=1.5)
        summary = pill("system: [checkpoint] 已完成诊断", YELLOW, width=4.35, size=14).move_to(projection_box).shift(UP * 0.45)
        new_message = pill("messages after #05", GREEN, width=2.75, size=15).next_to(summary, DOWN, buff=0.28)
        header_parts = pill("system + tools + dynamic", CYAN, width=3.35, size=15).next_to(new_message, DOWN, buff=0.28)
        self.play(Create(covered_highlight), Create(checkpoint_highlight), run_time=0.55)
        self.play(TransformFromCopy(rows[5], summary), FadeIn(new_message), TransformFromCopy(target_header, header_parts), run_time=0.9)
        self.caption("只在时间切面左侧寻找最近 checkpoint；它替换模型投影，却不删除被覆盖事件。")

        exact = pill("=== llm.requests[2]", GREEN, width=2.75, size=16).next_to(projection_box, DOWN, buff=0.3)
        self.play(FadeIn(exact, scale=0.9), Flash(exact, color=GREEN, flash_radius=0.72), run_time=0.7)
        self.caption("测试要求：仅凭事件重建的请求，必须与当时真正发送的请求逐项相等。")

        trace_box = rounded_panel(5.35, 3.55, stroke=PURPLE, fill="#0B2049").move_to(projection_box)
        trace_title = code("replayTrace(the same events)", 20, PURPLE, max_width=4.75).move_to(trace_box.get_top() + DOWN * 0.36)
        trace_items = VGroup(
            txt("1 · 用户提出修复目标", 18, TEXT),
            txt("2 · 模型读取工作区", 18, TEXT),
            txt("3 · CI 结果成为事实", 18, TEXT),
            txt("4 · 建立上下文摘要点", 18, TEXT),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.27).move_to(trace_box).shift(DOWN * 0.15)
        self.play(
            ReplacementTransform(projection_box, trace_box),
            ReplacementTransform(projection_title, trace_title),
            FadeOut(VGroup(summary, new_message, header_parts, exact)),
            run_time=0.65,
        )
        self.play(LaggedStart(*[TransformFromCopy(rows[index], item) for index, item in zip([1, 3, 4, 5], trace_items)], lag_ratio=0.14), run_time=1.1)
        self.caption("人类 Trace 不是另写的一份故事，而是同一事件流的另一种阅读投影。")

        memory_note = pill("当前范围：内存日志，不承诺跨进程恢复", MUTED, width=4.45, size=14).next_to(trace_box, DOWN, buff=0.3)
        self.play(FadeIn(memory_note, shift=UP * 0.08), run_time=0.45)
        self.wait(0.55)

        self.finish_answer([
            ("Session Log 只追加保存规范事实；request/header 固化当时的请求配置。", TEXT),
            ("历史请求与人类 Trace 都从同一事件流投影，不维护第二份历史。", TEXT),
            ("request(step) = buildRequest(events before its header)", CYAN),
        ])


class Scene05RuntimeEvolution(DshScene):
    """Question 5: DSH 是如何持续自进化的？"""

    def construct(self) -> None:
        self.chapter_header("05", "DSH 是如何持续自进化的？")

        runtime = rounded_panel(5.25, 4.65, stroke=BLUE, fill="#091D42").shift(LEFT * 3.65 + DOWN * 0.15)
        runtime_title = code("inspect_runtime()", 22, BLUE).move_to(runtime.get_top() + DOWN * 0.36)
        state = VGroup(
            small_check("plugins · 7 mounted", width=3.75),
            small_check("tools · read / patch / test", width=3.75),
            small_check("prompts · editing / verify", width=3.75),
            small_check("relations · inspectable", width=3.75),
        ).arrange(DOWN, buff=0.22).move_to(runtime).shift(DOWN * 0.1)
        self.play(FadeIn(runtime, scale=0.98), Write(runtime_title), run_time=0.7)
        self.play(LaggedStart(*[FadeIn(item, shift=RIGHT * 0.12) for item in state], lag_ratio=0.12), run_time=0.95)
        self.caption("自进化的第一步不是安装，而是先检查当前 Context 中已有的能力与关系。")

        gap = pill("缺口：不知道 calculateTotal 的调用方与类型状态", YELLOW, width=5.05, size=15).shift(RIGHT * 3.75 + UP * 1.75)
        catalog = rounded_panel(5.25, 2.95, stroke=YELLOW, fill="#0B2049").shift(RIGHT * 3.65 + DOWN * 0.72)
        catalog_title = code("TRUSTED CAPABILITY CATALOG", 19, YELLOW, max_width=4.65).move_to(catalog.get_top() + DOWN * 0.36)
        choices = VGroup(
            pill("typescript_analysis", GREEN, width=2.8, size=16),
            pill("word_count", BLUE, width=2.15, size=16),
        ).arrange(DOWN, buff=0.26).move_to(catalog).shift(DOWN * 0.08)
        schema = code('schema.enum = ["typescript_analysis", "word_count"]', 14, MUTED, max_width=4.65).next_to(catalog, DOWN, buff=0.2)
        self.play(FadeIn(gap, shift=LEFT * 0.15), FadeIn(catalog), Write(catalog_title), FadeIn(choices), Write(schema), run_time=0.9)
        self.caption("候选能力不是任意网址，而是进程内可信目录；目录同时生成工具参数的 enum 边界。")

        untrusted = pill("remote_package", RED, width=2.35, size=16).move_to(RIGHT * 6.0 + UP * 0.08)
        gate = Line(UP * 0.52, DOWN * 0.52, color=RED, stroke_width=5).move_to(catalog.get_right() + RIGHT * 0.05)
        rejected = pill("AJV: invalid arguments", RED, width=2.85, size=14).next_to(untrusted, DOWN, buff=0.25)
        self.play(FadeIn(untrusted, shift=LEFT * 0.2), Create(gate), run_time=0.5)
        self.play(untrusted.animate.shift(LEFT * 0.45), Flash(gate, color=RED, flash_radius=0.45), FadeIn(rejected), run_time=0.55)
        self.caption("目录外名称在 JSON Schema 校验阶段就被拒绝，甚至不会进入安装函数。")
        self.play(FadeOut(VGroup(untrusted, gate, rejected)), run_time=0.3)

        self.play(
            FadeOut(VGroup(runtime, runtime_title, state, gap, catalog, catalog_title, choices, schema)),
            run_time=0.55,
        )
        current_request = card("REQUEST n", "工具表已经冻结", width=3.2, height=1.45, color=MUTED).shift(LEFT * 4.7 + UP * 0.75)
        install_call = pill("install_capability(typescript_analysis)", YELLOW, width=4.65, size=15).shift(LEFT * 4.0 + DOWN * 0.95)
        context = card("CONTEXT", "ctx.mount(plugin)", width=3.2, height=1.45, color=CYAN).shift(RIGHT * 0.15 + UP * 0.75)
        catalog_plugin = card("PLUGIN", "+ 2 tools  + 1 prompt", width=3.2, height=1.45, color=GREEN).shift(RIGHT * 4.75 + UP * 0.75)
        self.play(FadeIn(current_request), FadeIn(context), FadeIn(catalog_plugin), run_time=0.65)
        arrow_to_context = Arrow(current_request.get_bottom(), install_call.get_top(), color=YELLOW, buff=0.12, stroke_width=2.4)
        arrow_install = Arrow(install_call.get_right(), context.get_bottom(), color=YELLOW, buff=0.1, stroke_width=2.4)
        arrow_mount = connect(catalog_plugin, context, GREEN)
        self.play(GrowArrow(arrow_to_context), FadeIn(install_call), GrowArrow(arrow_install), GrowArrow(arrow_mount), run_time=0.85)
        frozen = pill("不会追溯性改变", RED, width=2.25, size=14).next_to(current_request, DOWN, buff=0.26)
        self.play(FadeIn(frozen, shift=UP * 0.08), Indicate(current_request[0], color=MUTED), run_time=0.55)
        self.caption("安装发生在 REQUEST n 执行期间；已经构建好的这份请求不会凭空多出新工具。")

        boundary = DashedLine(UP * 2.35, DOWN * 2.35, color=YELLOW, stroke_width=2.2, dash_length=0.14).move_to(RIGHT * 2.35 + DOWN * 0.1)
        boundary_label = pill("NEXT STEP", YELLOW, width=1.65, size=14).next_to(boundary, UP, buff=0.12)
        next_request = card("REQUEST n+1", "重新从 Context 编译", width=3.45, height=1.45, color=CYAN).shift(RIGHT * 4.75 + DOWN * 1.0)
        new_parts = VGroup(
            pill("find_references", GREEN, width=2.05, size=14),
            pill("check_types", GREEN, width=1.65, size=14),
            pill("analysis prompt", PURPLE, width=1.95, size=14),
        ).arrange(DOWN, buff=0.12).move_to(next_request)
        self.play(Create(boundary), FadeIn(boundary_label), run_time=0.5)
        self.play(FadeIn(next_request, shift=LEFT * 0.22), run_time=0.55)
        self.play(LaggedStart(*[TransformFromCopy(catalog_plugin, item) for item in new_parts], lag_ratio=0.15), run_time=0.9)
        self.caption("跨过 Step 边界后，buildRequest() 才把新 Tool 与 Prompt 编进 REQUEST n+1。")

        self.play(FadeOut(VGroup(current_request, frozen, install_call, arrow_to_context, arrow_install, boundary, boundary_label)), context.animate.shift(LEFT * 4.15), next_request.animate.shift(LEFT * 0.65), run_time=0.65)
        evidence = VGroup(
            small_check("4 references found", width=3.2),
            small_check("type diagnostics = 0", width=3.2),
        ).arrange(DOWN, buff=0.22).shift(RIGHT * 4.65 + UP * 0.62)
        calls = VGroup(
            pill("find_references(calculateTotal)", GREEN, width=3.9, size=14),
            pill("check_types()", GREEN, width=2.2, size=14),
        ).arrange(DOWN, buff=0.22).shift(RIGHT * 0.35 + UP * 0.62)
        arrows_to_evidence = VGroup(*[connect(call, result, GREEN) for call, result in zip(calls, evidence)])
        self.play(FadeIn(calls, shift=RIGHT * 0.12), run_time=0.55)
        self.play(LaggedStart(*[GrowArrow(arrow) for arrow in arrows_to_evidence], lag_ratio=0.18), LaggedStart(*[FadeIn(item) for item in evidence], lag_ratio=0.18), run_time=0.9)
        self.caption("能力是否有价值由真实调用方和类型检查结果验证，不由模型口头宣称。")

        disposer_map = pill("installed[name] = disposer", CYAN, width=3.35, size=15).move_to(LEFT * 4.1 + DOWN * 1.1)
        remove_call = pill("remove_capability(name)", RED, width=3.25, size=15).move_to(RIGHT * 0.35 + DOWN * 1.1)
        cleaned = card("REQUEST n+3", "临时工具与 Prompt 已消失", width=3.65, height=1.35, color=GREEN).move_to(RIGHT * 4.65 + DOWN * 1.1)
        self.play(FadeIn(disposer_map), FadeIn(remove_call), run_time=0.5)
        dispose_arrow = connect(disposer_map, remove_call, RED)
        clean_arrow = connect(remove_call, cleaned, GREEN)
        self.play(GrowArrow(dispose_arrow), GrowArrow(clean_arrow), FadeIn(cleaned, shift=LEFT * 0.15), run_time=0.85)
        self.caption("移除时调用安装时保存的同一个 disposer；后续请求恢复原工具集与 Prompt。")

        history = rounded_panel(11.4, 0.88, stroke=PURPLE, fill="#091D42").shift(DOWN * 2.45)
        lifecycle = VGroup(
            pill("inspect", BLUE, width=1.3, size=13),
            code("→", 18, MUTED),
            pill("mounted", YELLOW, width=1.45, size=13),
            code("→", 18, MUTED),
            pill("used + evidence", GREEN, width=2.15, size=13),
            code("→", 18, MUTED),
            pill("unmounted", RED, width=1.65, size=13),
        ).arrange(RIGHT, buff=0.16).move_to(history)
        self.play(FadeIn(history, shift=UP * 0.08), LaggedStart(*[FadeIn(item) for item in lifecycle], lag_ratio=0.08), run_time=0.8)
        self.caption("Session Log 保留完整实验闭环；新的能力缺口出现时，这条受控路径可以再次执行。")

        self.finish_answer([
            ("持续自进化不是任意改写自身，而是反复进行受信能力实验。", TEXT),
            ("安装经普通插件生命周期，下一请求生效；验证后可完整移除。", TEXT),
            ("inspect → trusted install → expose → evidence → remove / keep", CYAN),
        ])


class Scene06LongTask(DshScene):
    """Question 6: DSH 是如何持续完成长程任务的？"""

    def construct(self) -> None:
        self.chapter_header("06", "DSH 是如何持续完成长程任务的？")

        goal = rounded_panel(12.2, 4.85, stroke=CYAN, fill="#091B3F").shift(DOWN * 0.15)
        goal_label = pill("GOAL · Fix CHECKOUT-417", CYAN, width=3.65, size=16).move_to(goal.get_top() + DOWN * 0.38 + LEFT * 3.8)
        round_box = rounded_panel(9.65, 3.65, stroke=BLUE, fill="#0B2049").move_to(goal).shift(DOWN * 0.06)
        round_label = pill("ROUND", BLUE, width=1.35, size=16).move_to(round_box.get_top() + DOWN * 0.36 + LEFT * 3.7)
        turn_box = rounded_panel(7.1, 2.45, stroke=PURPLE, fill="#102755").move_to(round_box).shift(DOWN * 0.05)
        turn_label = pill("TURN", PURPLE, width=1.2, size=16).move_to(turn_box.get_top() + DOWN * 0.34 + LEFT * 2.45)
        step_boxes = VGroup(*[
            card(f"STEP {index}", "request + results", width=1.62, height=0.92, color=YELLOW, title_size=16, detail_size=12)
            for index in range(1, 4)
        ]).arrange(RIGHT, buff=0.34).move_to(turn_box).shift(DOWN * 0.18)
        self.play(FadeIn(goal, scale=0.98), FadeIn(goal_label), run_time=0.65)
        self.play(FadeIn(round_box, scale=0.96), FadeIn(round_label), run_time=0.55)
        self.play(FadeIn(turn_box, scale=0.96), FadeIn(turn_label), run_time=0.55)
        self.play(LaggedStart(*[FadeIn(step, shift=RIGHT * 0.13) for step in step_boxes], lag_ratio=0.14), run_time=0.8)
        hierarchy = code("Goal ⊃ Round ⊃ Turn ⊃ Step", 21, CYAN).move_to(DOWN * 2.72)
        self.play(Write(hierarchy), run_time=0.55)
        self.caption("长程续行不是把 Agent Loop 拉长，而是在有界 Turn 外再套一层有界 Round。")

        self.play(FadeOut(VGroup(round_box, round_label, turn_box, turn_label, step_boxes, hierarchy)), goal.animate.set_stroke(opacity=0.35), run_time=0.6)
        shared = VGroup(
            pill("same Agent", BLUE, width=1.65, size=14),
            pill("same Context", PURPLE, width=1.85, size=14),
            pill("same Session Log", GREEN, width=2.15, size=14),
        ).arrange(RIGHT, buff=0.2).move_to(goal.get_top() + DOWN * 0.92)
        rounds = VGroup(
            card("ROUND 1", "diagnose", width=3.25, height=2.0, color=BLUE),
            card("ROUND 2", "repair", width=3.25, height=2.0, color=YELLOW),
            card("ROUND 3", "verify-submit", width=3.25, height=2.0, color=GREEN),
        ).arrange(RIGHT, buff=0.52).move_to(goal).shift(DOWN * 0.38)
        round_arrows = VGroup(connect(rounds[0], rounds[1], MUTED), connect(rounds[1], rounds[2], MUTED))
        self.play(FadeIn(shared, shift=DOWN * 0.1), run_time=0.45)
        self.play(LaggedStart(*[FadeIn(item, shift=RIGHT * 0.18) for item in rounds], lag_ratio=0.16), run_time=1.0)
        self.play(LaggedStart(*[GrowArrow(arrow) for arrow in round_arrows], lag_ratio=0.2), run_time=0.55)
        self.caption("多个 Round 复用同一个 Agent、Context 和 Session Log，所以事实与运行时状态不会重置。")

        evidence_sets = [
            VGroup(
                small_check("inspect_runtime", width=2.55),
                small_check("4 fixed-path reads", width=2.55),
            ),
            VGroup(
                small_check("exact patch", width=2.55),
                small_check("testsPassed = true", width=2.55),
            ),
            VGroup(
                small_check("references + types", width=2.55),
                small_check("accepted + no residue", width=2.55),
            ),
        ]
        evidence_group = VGroup(*evidence_sets)
        for box, evidence in zip(rounds, evidence_sets):
            evidence.arrange(DOWN, buff=0.12).move_to(box).shift(DOWN * 0.22)
        self.play(*[FadeOut(round[1][1]) for round in rounds], run_time=0.25)
        self.play(LaggedStart(*[FadeIn(evidence, shift=UP * 0.12) for evidence in evidence_sets], lag_ratio=0.22), run_time=1.1)
        self.caption("每轮的完成条件都是可观察事实：工具结果与工作区状态，而不是模型说“完成了”。")

        claim = pill("模型：我完成了", RED, width=2.35, size=15).move_to(DOWN * 2.55 + LEFT * 3.7)
        evidence_gate = pill("EVIDENCE GATE", YELLOW, width=2.35, size=16).move_to(DOWN * 2.55)
        accepted_fact = pill("events + state", GREEN, width=2.25, size=15).move_to(DOWN * 2.55 + RIGHT * 3.7)
        claim_arrow = Arrow(claim.get_right(), evidence_gate.get_left(), color=RED, buff=0.12, stroke_width=2.3)
        fact_arrow = Arrow(accepted_fact.get_left(), evidence_gate.get_right(), color=GREEN, buff=0.12, stroke_width=2.3)
        self.play(FadeIn(claim), FadeIn(accepted_fact), GrowArrow(claim_arrow), GrowArrow(fact_arrow), FadeIn(evidence_gate), run_time=0.8)
        self.play(claim.animate.set_opacity(0.2), Flash(evidence_gate, color=YELLOW, flash_radius=0.65), run_time=0.6)
        self.caption("续行判断只接收 events 与真实 state；模型叙述不会单独打开下一轮。")

        self.play(FadeOut(VGroup(goal, goal_label, shared, rounds, round_arrows, evidence_group, claim, accepted_fact, claim_arrow, fact_arrow, evidence_gate)), run_time=0.6)
        decision_title = pill("每轮结束后的状态机", CYAN, width=3.05, size=17).shift(UP * 2.25)
        checks = VGroup(
            card("completed?", "yes → COMPLETED", width=3.0, height=0.9, color=GREEN, title_size=17, detail_size=14),
            card("blockedReason?", "yes → BLOCKED", width=3.0, height=0.9, color=RED, title_size=17, detail_size=14),
            card("progressed?", "no → BLOCKED", width=3.0, height=0.9, color=RED, title_size=17, detail_size=14),
            card("rounds ≥ max?", "yes → MAX-ROUNDS", width=3.0, height=0.9, color=YELLOW, title_size=17, detail_size=14),
            card("otherwise", "continue next Round", width=3.0, height=0.9, color=CYAN, title_size=17, detail_size=14),
        ).arrange(DOWN, buff=0.11).move_to(LEFT * 3.65 + DOWN * 0.18)
        tree_arrows = VGroup(*[
            Arrow(checks[index].get_bottom(), checks[index + 1].get_top(), color=MUTED, buff=0.06, stroke_width=1.8, max_tip_length_to_length_ratio=0.09)
            for index in range(4)
        ])
        self.play(FadeIn(decision_title, shift=DOWN * 0.1), run_time=0.4)
        self.play(LaggedStart(*[FadeIn(check, shift=DOWN * 0.1) for check in checks], lag_ratio=0.11), run_time=1.0)
        self.play(LaggedStart(*[GrowArrow(arrow) for arrow in tree_arrows], lag_ratio=0.1), run_time=0.6)

        partial = rounded_panel(5.15, 3.75, stroke=PURPLE, fill="#0B2049").shift(RIGHT * 3.65 + DOWN * 0.05)
        partial_title = code("部分进展，但证据不完整", 20, PURPLE).move_to(partial.get_top() + DOWN * 0.38)
        first_turn = small_check("Turn 1 · installed capability", width=4.2).move_to(partial).shift(UP * 0.72)
        follow = pill("最多一次针对性 follow-up Turn", YELLOW, width=4.15, size=15).move_to(partial)
        finish_or_block = VGroup(
            pill("证据齐全 → complete", GREEN, width=2.65, size=14),
            pill("仍无进展 → blocked", RED, width=2.65, size=14),
        ).arrange(DOWN, buff=0.2).move_to(partial).shift(DOWN * 0.8)
        self.play(FadeIn(partial), Write(partial_title), FadeIn(first_turn), run_time=0.65)
        self.play(FadeIn(follow, shift=UP * 0.12), run_time=0.45)
        self.play(LaggedStart(*[FadeIn(item, shift=UP * 0.08) for item in finish_or_block], lag_ratio=0.2), run_time=0.65)
        self.caption("只有具体的部分进展才允许一次补充 Turn；补充后仍无进展就停止。")

        terminals = VGroup(
            pill("COMPLETED", GREEN, width=2.25, size=17),
            pill("BLOCKED", RED, width=2.05, size=17),
            pill("MAX-ROUNDS", YELLOW, width=2.45, size=17),
        ).arrange(RIGHT, buff=0.5).move_to(DOWN * 2.62 + RIGHT * 3.65)
        self.play(FadeOut(finish_or_block), FadeIn(terminals, shift=UP * 0.12), run_time=0.6)
        self.caption("持续不等于无限：完成、无进展和轮数上限都是明确且会被记录的终态。")

        self.finish_answer([
            ("Goal 保存方向；Round 推进阶段；Turn 与 Step 仍保持各自边界。", TEXT),
            ("每轮复用同一历史，并由真实证据决定完成、补充、继续或停止。", TEXT),
            ("long task = shared history + evidence-gated bounded Rounds", CYAN),
        ])


SCENES = [
    Scene01AgentLoop,
    Scene02ContextCache,
    Scene03PluginKernel,
    Scene04SessionLog,
    Scene05RuntimeEvolution,
    Scene06LongTask,
]
