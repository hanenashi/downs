#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output_dir="$repo_root/test-artifacts/dash-av1-fixture"

if ! command -v ffmpeg >/dev/null 2>&1; then
  printf 'ffmpeg is required to generate the DASH AV1 fixture.\n' >&2
  exit 1
fi

mkdir -p "$output_dir"
find "$output_dir" -maxdepth 1 -type f -delete

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=320x180:rate=25' \
  -f lavfi -i 'sine=frequency=659:sample_rate=48000' \
  -t 6 -map 0:v:0 -map 1:a:0 \
  -c:v libaom-av1 -cpu-used 8 -row-mt 1 -crf 40 -b:v 0 \
  -g 50 -keyint_min 50 \
  -c:a aac -b:a 96k \
  -f dash -seg_duration 2 -use_template 1 -use_timeline 1 \
  -init_seg_name 'init-$RepresentationID$.mp4' \
  -media_seg_name 'chunk-$RepresentationID$-$Number%05d$.m4s' \
  "$output_dir/manifest.mpd"

printf 'DASH AV1 Downs fixture generated in %s\n' "$output_dir"
printf 'Open http://127.0.0.1:8765/dash-av1-page.html after starting tools/serve-fixtures.js\n'
