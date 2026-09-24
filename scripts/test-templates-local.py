#!/usr/bin/env python3
"""Build and test disposable template copies against this checkout's Harpe sources."""

import argparse
import json
import re
import shutil
import subprocess
import tempfile
import tomllib
from pathlib import Path


FRAMEWORK = Path(__file__).resolve().parents[1]
MODULES = {
    "harpe": "harpe",
    "harpe-caps": "caps",
    "harpe-testing": "testing",
    "harpe-testing-python": "testing",
}


def use_sources(spec):
    sections = re.split(r"(?=^\[)", spec.read_text(), flags=re.MULTILINE)
    for index, section in enumerate(sections):
        packages = re.search(r"^packages\s*=\s*(\[.*?\])", section, re.MULTILINE | re.DOTALL)
        if packages is None:
            continue
        dependencies = tomllib.loads("packages = " + packages[1])["packages"]
        sources = ", ".join(
            '{ id = ' + json.dumps(MODULES[dependency["name"]])
            + ', path = ' + json.dumps(str(FRAMEWORK)) + ' }'
            for dependency in dependencies
        )
        section = section[:packages.start()] + section[packages.end():]
        modules = re.search(r"^modules\s*=\s*\[(.*?)\]", section, re.MULTILINE | re.DOTALL)
        if modules is None:
            section += "\nmodules = [" + sources + "]\n\n"
        else:
            existing = modules[1].strip().rstrip(",")
            combined = ", ".join(part for part in [existing, sources] if part)
            section = section[:modules.start(1)] + combined + section[modules.end(1):]
        sections[index] = section
    updated = "".join(sections)
    tomllib.loads(updated)
    spec.write_text(updated)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--templates", type=Path, default=FRAMEWORK / "templates",
                        help="templates directory, including any pending release migrations")
    args = parser.parse_args()
    names = [json.loads(line)["name"] for line in
             (FRAMEWORK / "jo-templates.jsonl").read_text().splitlines() if line.strip()]
    with tempfile.TemporaryDirectory(prefix="harpe-local-templates-") as scratch:
        for name in names:
            target = Path(scratch) / name
            shutil.copytree(args.templates / name, target, ignore=shutil.ignore_patterns(
                ".build", ".venv", "jo.lock", ".env", "logs", "data", "__pycache__"))
            for spec in target.rglob("jo.toml"):
                use_sources(spec)
            print(f"\nTesting {name} against {FRAMEWORK}", flush=True)
            for spec in sorted((target / "sandbox").rglob("jo.toml")):
                subprocess.run(["jo", "build", "--spec", str(spec), "guest"], cwd=target, check=True)
            subprocess.run(["jo", "build", "agent"], cwd=target, check=True)
            modules = tomllib.loads((target / "jo.toml").read_text())["module"]
            if "tests" in modules:
                subprocess.run(["jo", "run", "tests"], cwd=target, check=True)


if __name__ == "__main__":
    main()
