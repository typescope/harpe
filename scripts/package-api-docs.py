#!/usr/bin/env python3
"""Package generated Jo API documentation as a versioned release asset."""

import argparse
import hashlib
import zipfile
from pathlib import Path


PACKAGES = {
    "caps": "harpe-caps",
    "harpe": "harpe",
    "testing": "harpe-testing-python",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    for module, package in PACKAGES.items():
        source = Path(".build") / module / "doc"
        if not (source / "index.html").is_file():
            raise SystemExit(f"missing generated documentation: {source}")
        archive = args.output / f"{package}-api-docs-v{args.version}.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for path in sorted(source.rglob("*")):
                if path.is_file():
                    relative = Path(package) / args.version / path.relative_to(source)
                    output.write(path, relative.as_posix())
        digest = hashlib.sha512(archive.read_bytes()).hexdigest()
        archive.with_name(archive.name + ".sha512").write_text(f"{digest}  {archive.name}\n")
        print(archive)


if __name__ == "__main__":
    main()
