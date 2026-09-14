# Downs media test ground

Use this protocol before changing format support or diagnosing a player-specific
report. Public players expose real request patterns; the local fixture gives us
a repeatable baseline; `ffprobe` and `ffmpeg` decide whether an exported file is
structurally and decodably healthy.

## 1. Establish the local baseline

Build/load the current extension, then start the development-only fixture server:

```bash
node tools/serve-fixtures.js
```

Open `http://127.0.0.1:8765/download-page.html`, inspect the detected
`mux-short.m3u8` playlist in Downs, download it, and export the MP4. The playlist
contains three ten-second MPEG-TS segments, so validate the result with:

```bash
mkdir -p test-artifacts
node tools/validate-media.js \
  --playlist tests/fixtures/mux-short.m3u8 \
  --json test-artifacts/mux-short.json \
  /path/to/exported-file.mp4
```

A pass means:

- MP4/MOV container with finite duration close to the playlist's `EXTINF` sum;
- H.264 video with non-zero decoded dimensions and readable frames;
- AAC audio with valid channels and sample rate;
- mutually consistent container, video, and audio durations;
- non-regressing decode timestamps across appended media fragments;
- a complete `ffmpeg` decode with no error-level diagnostics.

This server is a repository test tool. It is not part of the extension, a media
bridge, or a product runtime dependency.

For request-context testing, open
`http://127.0.0.1:8765/referer-page.html`. Its detected playlist deliberately
returns HTTP 403 to a plain extension request and HTTP 200 when Downs temporarily
replays the serving page's Referer origin. This fixture tests request provenance;
it does not weaken any media support gate.

For the modern separate-track path, generate a 12-second synthetic H.264/AAC
fMP4 fixture before starting the server:

```bash
tools/generate-modern-fixture.sh
node tools/serve-fixtures.js
```

Open `http://127.0.0.1:8765/modern-page.html`, select its single video variant,
choose either English or Japanese, download, export, and validate against
`test-artifacts/modern-fixture/video.m3u8`. The tones are deliberately distinct,
so decoded-audio MD5 can also prove which rendition was assembled. Generated
media remains ignored and must not be committed.

For a deliberate Kiwi run, bind the fixture server to the development machine's
interfaces, open the displayed path using that machine's reachable LAN or
tailnet address, and stop the server afterward:

```bash
node tools/serve-fixtures.js --host 0.0.0.0
```

## 2. Explore public player pages

Use the best target for the question being investigated:

- hls.js demo: broad HLS, ABR, rendition, and diagnostics coverage;
- Wowza test players: conventional hosted-player sanity check;
- Bitmovin test-your-stream: commercial-player behavior when the page is accessible.

Public pages are manual exploration targets, never CI dependencies. If one is
blocked, changed, or rate-limited, record that and move to another.

For every useful case, record one row:

| Case | Date | Browser | Page/player | Master/media | TS/fMP4 | A/V layout | VOD/live | Variants/codecs | URL context | Downs result | Fetch result | Output validation | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| example-01 | YYYY-MM-DD | Chrome/Kiwi/Firefox + version | hls.js/Wowza/Bitmovin | master → media | TS | muxed | VOD | 3; H.264/AAC | relative; query redacted | supported | success | PASS report.json | duplicate requests? |

Use stable case IDs so the MP4 and JSON report can share the same basename in
the ignored `test-artifacts/` directory.

Commit redacted observations to `tests/playground-findings.md` after each
exploration pass.

## 3. Interpret a result

- Validator fails: treat it as a Downs/remux/container defect until isolated.
- Validator passes but one player fails: investigate that player's tolerance and
  seek behavior without weakening the file checks.
- Native validator passes but a web metadata viewer shows numeric frame types,
  `0x0` display dimensions, or an unrelated huge frame-analysis duration: treat
  that display as suspect and retain the JSON report as the evidence.
- Page plays but extension fetch fails: record request-context behavior; do not
  loosen the media support gate.
- Unsupported playlist: record the exact rejection and frequency before choosing
  a new implementation milestone.

Repeat high-value cases in Chrome desktop and Kiwi Android. Use Firefox when a
popup or browser-specific API difference is involved.

## Privacy and repository hygiene

Test only open or user-authorized media. Never commit downloaded media, cookies,
authorization headers, signed query strings, or private page URLs. Redact query
values in findings. Keep raw MP4s and validator reports under `test-artifacts/`,
which Git ignores.
