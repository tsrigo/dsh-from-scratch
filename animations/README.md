# Manim 核心概念动画

六段动画分别回答教程六章的核心问题。教学论证与源码证据见 [STORYBOARD.md](./STORYBOARD.md)。

环境使用 Manim Community Edition 0.20.1。推荐使用官方 Docker 镜像进行完全隔离的渲染；也保留 Python 3.12 + `uv` 的本地开发配置。画面只使用 Pango 文本，不要求安装 LaTeX。

```sh
cd animations
python render.py --quality medium

# 可选：已经安装 Linux cairo/pango 开发库时使用本地环境
uv sync
uv run manim -ql concept_scenes.py Scene01AgentLoop
```

`render.py` 会渲染六段视频、验证输出，并把成片与 poster 复制到 `website/public/animations/`。
