#!/usr/bin/env python3
"""Build self-contained Chromium and Firefox packages for Downs."""

from pathlib import Path
import json
import shutil
import zipfile


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_DIR = ROOT / "extension"
BUILD_ROOT = ROOT / "build"
DIST_DIR = ROOT / "dist"
FILES = [
    "hls-parser.js",
    "download-core.js",
    "download-worker.js",
    "job-core.js",
    "link-group-core.js",
    "request-context.js",
    "downloads.html",
    "downloads.css",
    "downloads.js",
    "background.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "vendor/mux-mp4.min.js",
    "vendor/LICENSE.mux.js",
]


def build_flavor(name, manifest_name, archive_name):
    build_dir = BUILD_ROOT / f"{name}-extension"
    archive_path = DIST_DIR / archive_name

    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir(parents=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    manifest = json.loads((EXTENSION_DIR / manifest_name).read_text(encoding="utf-8"))
    (build_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )

    for filename in FILES:
        destination = build_dir / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(EXTENSION_DIR / filename, destination)

    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(path for path in build_dir.rglob("*") if path.is_file()):
            archive.write(path, path.relative_to(build_dir))

    print(f"{name.title()} unpacked extension: {build_dir}")
    print(f"{name.title()} extension zip: {archive_path}")


def main():
    build_flavor("chromium", "manifest.json", "downs-chromium.zip")
    build_flavor("firefox", "manifest.firefox.json", "downs-firefox.zip")


if __name__ == "__main__":
    main()
