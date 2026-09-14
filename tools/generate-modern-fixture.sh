#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output_dir="$repo_root/test-artifacts/modern-fixture"

if ! command -v ffmpeg >/dev/null 2>&1; then
  printf 'ffmpeg is required to generate the modern HLS fixture.\n' >&2
  exit 1
fi

mkdir -p "$output_dir"
find "$output_dir" -maxdepth 1 -type f -delete

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -f lavfi -i 'sine=frequency=880:sample_rate=48000' \
  -t 12 -map 0:v:0 -map 1:a:0 -map 2:a:0 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a aac -b:a 96k \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_flags independent_segments \
  -master_pl_name master.m3u8 \
  -var_stream_map 'v:0,agroup:audio,name:video a:0,agroup:audio,default:yes,language:eng,name:english a:1,agroup:audio,language:jpn,name:japanese' \
  -hls_segment_filename "$output_dir/%v-segment-%03d.m4s" \
  "$output_dir/%v.m3u8"

printf 'Modern Downs fixture generated in %s\n' "$output_dir"
printf 'Open http://127.0.0.1:8765/modern-page.html after starting tools/serve-fixtures.js\n'
