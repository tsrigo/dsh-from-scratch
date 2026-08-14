#!/usr/bin/env python3
"""Render, verify, and publish the six tutorial concept films."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Final


ROOT: Final = Path(__file__).resolve().parent
REPOSITORY: Final = ROOT.parent
PUBLIC: Final = REPOSITORY / "website" / "public" / "animations"
IMAGE: Final = "manimcommunity/manim:v0.20.1"

SCENES: Final = {
    "01-agent-loop": "Scene01AgentLoop",
    "02-context-cache": "Scene02ContextCache",
    "03-plugin-kernel": "Scene03PluginKernel",
    "04-session-log": "Scene04SessionLog",
    "05-runtime-evolution": "Scene05RuntimeEvolution",
    "06-long-task": "Scene06LongTask",
}

QUALITY_FLAGS: Final = {
    "low": "-ql",
    "medium": "-qm",
    "high": "-qh",
}


def run(
    command: list[str],
    *,
    cwd: Path = ROOT,
    env: dict[str, str] | None = None,
) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True, env=env)


def local_render_env() -> dict[str, str]:
    """Expose the project-local Cairo/Pango runtime without changing the host."""
    env = os.environ.copy()
    prefix = ROOT / ".native"
    if not prefix.exists():
        return env
    env["PATH"] = f"{prefix / 'bin'}:{env.get('PATH', '')}"
    env["PKG_CONFIG_PATH"] = f"{prefix / 'lib' / 'pkgconfig'}:{env.get('PKG_CONFIG_PATH', '')}"
    env["LD_LIBRARY_PATH"] = f"{prefix / 'lib'}:{env.get('LD_LIBRARY_PATH', '')}"
    return env


def render(scene_names: list[str], quality: str, engine: str) -> None:
    manim_args = [QUALITY_FLAGS[quality], "concept_scenes.py", *scene_names]
    if engine == "local":
        run(["uv", "run", "manim", *manim_args], env=local_render_env())
        return

    command = [
        "docker",
        "run",
        "--rm",
        f"--user={os.getuid()}:{os.getgid()}",
        "-v",
        f"{ROOT}:/manim",
    ]
    fonts = Path("/usr/share/fonts")
    if fonts.exists():
        command.extend(["-v", f"{fonts}:{fonts}:ro"])
    command.extend([IMAGE, "manim", *manim_args])
    run(command)


def locate_video(scene_name: str) -> Path:
    candidates = sorted(
        (ROOT / "media" / "videos").rglob(f"{scene_name}.mp4"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No rendered video found for {scene_name}")
    return candidates[0]


def probe(video: Path) -> dict[str, float | int | str]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,avg_frame_rate:format=duration",
            "-of",
            "json",
            str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    stream = payload["streams"][0]
    duration = float(payload["format"]["duration"])
    width = int(stream["width"])
    height = int(stream["height"])
    if duration < 12:
        raise RuntimeError(f"{video.name} is unexpectedly short: {duration:.2f}s")
    if width * 9 != height * 16:
        raise RuntimeError(f"{video.name} is not 16:9: {width}x{height}")
    return {
        "duration": round(duration, 3),
        "width": width,
        "height": height,
        "frameRate": stream["avg_frame_rate"],
    }


def publish(slugs: list[str]) -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict[str, float | int | str]] = {}
    for slug in slugs:
        scene_name = SCENES[slug]
        source = locate_video(scene_name)
        metadata = probe(source)
        target = PUBLIC / f"{slug}.mp4"
        poster = PUBLIC / f"{slug}.jpg"
        shutil.copy2(source, target)
        poster_second = max(1.0, float(metadata["duration"]) * 0.58)
        run([
            "ffmpeg",
            "-y",
            "-ss",
            f"{poster_second:.3f}",
            "-i",
            str(target),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(poster),
        ])
        manifest[slug] = {
            **metadata,
            "scene": scene_name,
            "video": f"/animations/{target.name}",
            "poster": f"/animations/{poster.name}",
        }
        print(f"published {slug}: {metadata['duration']}s {metadata['width']}x{metadata['height']}")

    manifest_path = PUBLIC / "manifest.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        previous.update(manifest)
        manifest = previous
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quality", choices=QUALITY_FLAGS, default="medium")
    parser.add_argument("--engine", choices=("docker", "local"), default="docker")
    parser.add_argument(
        "--only",
        action="append",
        choices=SCENES,
        help="Render one slug; repeat to select several. Defaults to all six.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    slugs = args.only or list(SCENES)
    render([SCENES[slug] for slug in slugs], args.quality, args.engine)
    publish(slugs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
