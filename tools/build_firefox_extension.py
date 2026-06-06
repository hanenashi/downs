#!/usr/bin/env python3
"""Build the Firefox flavor of the Downs Link Sucker extension.

The Chrome/Chromium unpacked extension uses Manifest V3 service workers. Firefox's
MV3 implementation uses background scripts instead, so this script swaps in the
Firefox manifest while reusing the same popup/background source files.
"""

from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXTENSION_DIR = ROOT / "extension"
BUILD_DIR = ROOT / "build" / "firefox-extension"
DIST_DIR = ROOT / "dist"
ZIP_PATH = DIST_DIR / "downs-link-sucker-firefox.zip"
FILES = [
    "background.js",
    "popup.html",
    "popup.css",
    "popup.js",
]


def copy_file(source_name, dest_name=None):
    dest_name = dest_name or source_name
    shutil.copy2(EXTENSION_DIR / source_name, BUILD_DIR / dest_name)


def main():
    manifest = json.loads((EXTENSION_DIR / "manifest.firefox.json").read_text(encoding="utf-8"))

    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)

    BUILD_DIR.mkdir(parents=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    (BUILD_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8"
    )

    for filename in FILES:
        copy_file(filename)

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(BUILD_DIR.iterdir()):
            archive.write(path, path.name)

    print(f"Firefox unpacked extension: {BUILD_DIR}")
    print(f"Firefox extension zip: {ZIP_PATH}")


if __name__ == "__main__":
    main()
