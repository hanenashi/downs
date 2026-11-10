#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output_dir="$repo_root/test-artifacts/aes-fixture"
clear_dir="$output_dir/clear"

for command_name in ffmpeg openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s is required to generate the AES-128 HLS fixture.\n' "$command_name" >&2
    exit 1
  fi
done

mkdir -p "$clear_dir"
find "$output_dir" -maxdepth 1 -type f -delete
find "$clear_dir" -maxdepth 1 -type f -delete

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=320x180:rate=25' \
  -f lavfi -i 'sine=frequency=660:sample_rate=48000' \
  -t 6 -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -g 50 -keyint_min 50 -sc_threshold 0 \
  -c:a aac -b:a 96k \
  -f segment -segment_time 2 -segment_format mpegts \
  "$clear_dir/segment-%03d.ts"

mapfile -t clear_segments < <(find "$clear_dir" -maxdepth 1 -type f -name 'segment-*.ts' | sort)
if [[ ${#clear_segments[@]} -ne 3 ]]; then
  printf 'Expected exactly 3 clear MPEG-TS segments, got %s.\n' "${#clear_segments[@]}" >&2
  exit 1
fi

key_one_hex='000102030405060708090a0b0c0d0e0f'
key_two_hex='101112131415161718191a1b1c1d1e1f'
printf '%s' 'AAECAwQFBgcICQoLDA0ODw==' | openssl base64 -d -A -out "$output_dir/key-one.bin"
printf '%s' 'EBESExQVFhcYGRobHB0eHw==' | openssl base64 -d -A -out "$output_dir/key-two.bin"

openssl enc -aes-128-cbc -e -K "$key_one_hex" -iv '000000000000000000000000000000aa' \
  -in "${clear_segments[0]}" -out "$output_dir/segment-000.ts"
openssl enc -aes-128-cbc -e -K "$key_one_hex" -iv '00000000000000000000000000000009' \
  -in "${clear_segments[1]}" -out "$output_dir/segment-001.ts"
openssl enc -aes-128-cbc -e -K "$key_two_hex" -iv '0000000000000000000000000000000a' \
  -in "${clear_segments[2]}" -out "$output_dir/segment-002.ts"

cat > "$output_dir/encrypted.m3u8" <<'PLAYLIST'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:8
#EXT-X-KEY:METHOD=AES-128,URI="key-one.bin",IV=0x000000000000000000000000000000aa
#EXTINF:2,
segment-000.ts
#EXT-X-KEY:METHOD=AES-128,URI="key-one.bin"
#EXTINF:2,
segment-001.ts
#EXT-X-KEY:METHOD=AES-128,URI="key-two.bin"
#EXTINF:2,
segment-002.ts
#EXT-X-ENDLIST
PLAYLIST

printf 'AES-128 Downs fixture generated in %s\n' "$output_dir"
printf 'Open http://127.0.0.1:8765/aes-page.html after starting tools/serve-fixtures.js\n'
