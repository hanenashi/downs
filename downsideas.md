# Downs ideas — lessons from Live Stream Downloader

Research date: 2026-11-10. Status: ideas / investigation, **not an implementation specification**.

## Goal

Expand Downs' ability to discover and save authorized, non-DRM media while protecting the stable 2.9 DIRECT pipeline. Make small, testable additions rather than replacing the download engine.

Compared repositories:
- Downs: https://github.com/hanenashi/downs (main, 2.9 at review)
- Live Stream Downloader: https://github.com/chandler-stimson/live-stream-downloader (master, v3)
- Upstream license: MPL-2.0, see upstream LICENSE. Ideas can be independently implemented; direct source reuse requires compliance with MPL-2.0.

## Current baseline worth protecting

Downs 2.9 already:
- Detects network M3U8 requests, inspects master/media playlists, variants and audio renditions.
- Supports finite, unencrypted MPEG-TS VOD remux through bundled mux.js.
- Supports a bounded split H.264-or-AV1 + AAC fMP4/CMAF VOD layout.
- Supports bounded muxed H.264-or-AV1 + AAC-LC fMP4/CMAF VOD with explicit
  multi-track sample-run addressing.
- Finalizes actual media samples as **flat, seek-friendly MP4** with timing and sync-sample tables, without re-encoding.
- Maintains persistent jobs, OPFS-backed output, explicit save/export, cancellation, retries and source-bundle TAR diagnostic replay.
- Replays sanitized Referer context through temporary exact-URL rules; does not persist cookies/authorization secrets.
- Targets Chromium/Firefox and requires care around Kiwi Android compatibility.

Do **not** regress the above or introduce a mandatory native helper, FFmpeg, server or cloud service.

## Priority A — new discovery paths

### A1. In-memory Blob M3U8 detector

Implementation status: bounded detection and inspection landed in Downs 2.10;
real-site Firefox/Kiwi compatibility remains a validation item. Inline media
playlists intentionally remain inspection-only.

Upstream code:
- `v3/plugins/blob-detector/inject/main.js`
- `v3/plugins/blob-detector/inject/isolated.js`
- `v3/plugins/blob-detector/core.js`

Their page-world hook proxies the `Blob` constructor, recognizes `application/vnd.apple.mpegurl` and sends playlist text across a page/isolated-world bridge. This detects some playlists manufactured by page JavaScript that network-only URL observation misses. **It is not a general-purpose blob: video or MediaSource recorder.**

Plan:
1. Add an optional, narrowly scoped page-world probe and isolated-world bridge. Investigate CSP, permissions, tab/frame ownership, Firefox and Kiwi behavior first.
2. Send only validated, size-limited playlist text plus provenance; never evaluate page-supplied code.
3. Resolve relative references against a trusted page/base URL if possible; otherwise label as inspection-only and request the necessary base context.
4. Deduplicate with existing request detections and retain an explicit source tag (`network` / `blob-playlist`).
5. Default to disabled or conservative activation if the interception is too invasive.

Tests: synthesized Blob playlist, false positive Blob, excessive payload, malformed playlist, duplicate network detection, cross-frame/page navigation, relative segment URLs, no leakage of credentials or page data. Avoid breaking the site's native Blob behavior.

Acceptance: a known in-memory HLS manifest is detected/inspectable when no URL-based M3U8 request was observed, while existing sites still behave normally.

### A2. DASH / MPD discovery before download support

Implementation status: the detection/inspection milestone landed in Downs
2.11. The bounded feasibility spike landed in 2.13 for static, clear,
single-Period H.264-or-AV1 + AAC-LC fMP4 using finite SegmentTemplate timelines or
fixed durations. Other DASH addressing, codecs, encryption, and live MPDs stay
inspection-only.

Upstream:
- `v3/network/core.js` registers `.mpd` among candidate extensions.
- `v3/data/job/parse.js` uses an MPD parser and enumerates representations.

First milestone: detect MPD by URL and appropriate response Content-Type, validate XML safely, classify video/audio representations, codecs, encryption and timeline structure, and display **inspect-only**. Keep unsupported MPD out of the DIRECT download button.

Subsequent experiment: map a *narrow, finite, unencrypted* DASH fMP4
H.264-or-AV1/AAC VOD representation pair into Downs' existing
assembly/finalizer. Reject unsupported segment templates, index layouts,
timelines, byte ranges, DRM, codecs or discontinuities explicitly.

Tests: static MPD, SegmentTemplate/SegmentTimeline, BaseURL resolution, separate audio/video, mismatched timing, encrypted MPD, missing segments, dynamic/live MPD. Do not claim generic DASH support from parsing alone.

## Priority B — AES-128 HLS (non-DRM)

Status: landed as the bounded 2.12 DIRECT pass. Finite muxed MPEG-TS VOD now
supports identity-format `METHOD=AES-128`, explicit or media-sequence IVs, and
key rotation. Keys remain in memory and encrypted source bundles are disabled.
SAMPLE-AES, DRM, encrypted fMP4, and non-identity key formats remain rejected.

Upstream: `v3/data/job/mget/plugins/decrypt.js` uses Web Crypto AES-CBC.

Downs distinguishes conventional HLS `METHOD=AES-128` from DRM/protected formats (e.g. SAMPLE-AES, FairPlay and CENC); **do not implement DRM circumvention**.

Possible bounded pipeline:
1. Validate finite TS VOD, supported key method/format, IV derivation, segment sequence and key rotation.
2. Fetch authorized keys in-memory through the extension's legitimate request context; avoid persisting keys, cookies or authorization headers.
3. Decrypt segment ciphertext using Web Crypto AES-CBC, validate padding/length and feed original plaintext TS into existing mux.js + finalization.
4. Handle per-segment IV, key rotation and retry failure safely; zero/release sensitive buffers where practical.
5. Keep fMP4 encryption and uncommon methods out of the first milestone.

Tests: encrypted TS fixtures with explicit and implicit IV, multiple keys, invalid key length, missing key, wrong padding, network errors, malformed IV, DRM markers, and end-to-end FFprobe + seeking checks.

Acceptance: reproducible authorized AES-128 TS fixture produces normal seekable MP4 without any change in unencrypted outputs.

## Priority C — live/event recording (separate mode)

Upstream's downloader takes a broader segmented-acquisition approach. Downs intentionally requires `EXT-X-ENDLIST` today.

Potential **RECORD** mode: poll/reload active media playlists, identify segments by media sequence and discontinuity sequence (not URL alone), capture unseen segments before they expire, tolerate sliding windows and bounded gaps, and finalize only when stopped. Define pause/reconnect, wall-clock stop, storage ceiling, duplicate avoidance, interruptions and partial recovery before implementation.

Important: mixing TS discontinuities, fMP4 init-map changes and codec switches into one MP4 is nontrivial. Initially support one consistent codec/timeline layout and reject or split recordings on incompatible transitions. Treat recording as a distinct state machine, not a small relaxation of the DIRECT VOD support check.

Tests: fixture server with shifting live window, late arrival, repeated URLs, segment expiration, gaps, timeout, cancellation, disk full, discontinuities and resume.

## Priority D — optional workflow/UI improvements

- **Concurrency:** Upstream exposes 1–5 threads via `v3/data/job/plugins/threads.js`; Downs already fetches up to four TS segments concurrently. Consider a bounded advanced setting only after performance benchmarks; preserve ordered consumption and memory ceilings.
- **Direct file writing:** Upstream `v3/data/job/mget/plugins/disk.js` uses a File System Access API writer. Downs' OPFS/private-copy then explicit Save design is intentional. An opt-in direct-to-file mode may help huge live recordings on supporting desktop browsers, but must degrade gracefully on Firefox/Kiwi and expose partial-file semantics.
- **Filenames:** Upstream `v3/data/job/build.js` supports placeholders and page-derived values. Downs already offers suggested title/date/hash. Explore only a minimal, sanitized naming-template option if users need it; never execute selectors from untrusted input without controls.
- **Agent/API seam:** Upstream `v3/mcp/mcp.json` describes `find_media` and `download_media` commands. Later consider a narrow extension-message or explicitly enabled local API for Codex to list detected media, inspect support reasons, and enqueue jobs. Authentication/authorization, user consent and data minimization are required. No silent remote-control surface.
- **Diagnostics:** HLS and supported DASH source bundles now replay offline;
  keep adding fixture types and provenance metadata as modes grow.

## What NOT to copy/replace

- Do not replace Downs' mux.js → sample-based flat-MP4 finalizer merely because upstream has MP4Box or alternative parsers.
- Do not replace the persistent job manager, request-context privacy model or OPFS storage without a measured advantage.
- Do not equate Blob-M3U8 interception with generic `blob:`/MSE video extraction.
- Do not promise support for every playlist/MPD the extension can identify.
- Do not blindly paste MPL-covered files into Downs. If copying code, preserve applicable notices, source availability and MPL-covered file licensing.
- Do not introduce cloud uploads or require external processes for normal DIRECT downloads.

## Proposed order of work for Codex/Beechan

1. **Detection-only pass:** complete in 2.10/2.11 for scoped Blob playlist discovery and MPD inspection; Firefox/physical Kiwi validation remains.
2. **AES-128 TS DIRECT pass:** separately gated, with synthetic encrypted fixtures and regression playback tests.
3. **DASH feasibility spike:** complete in 2.13 for conservative finite
   SegmentTemplate H.264/AAC-LC, with AV1 video parity added in 2.16.
4. **Live RECORD architecture proposal:** design state, segment identity, storage and recovery; implement only after review.
5. Optional direct-write/agent interface based on actual user need.

For every pass:
- Write down supported/unsupported media gates before coding.
- Add local fixtures and tests; run the project's validation/build pipeline.
- Compare decoded duration, A/V sync, keyframes and arbitrary seeks with FFprobe/VLC where appropriate.
- Verify Chrome and Firefox manifests and mobile constraints.
- Preserve clear UI support reasons and existing privacy guarantees.
- Commit each feature separately; keep this document as a backlog, not evidence of completed functionality.

## Code references

**Downs**
- `extension/background.js` — network detection, sanitized request context and browser rules.
- `extension/hls-parser.js` — HLS parsing.
- `extension/download-core.js` — conservative DIRECT support gates.
- `extension/download-worker.js`, `extension/fmp4-core.js`, `extension/mp4-finalizer.js` — download and finishing pipeline.
- `extension/job-core.js`, `extension/request-context.js` — jobs/context.
- `handoff.md` — 2.9 finalizer rationale and test evidence.

**Live Stream Downloader**
- https://github.com/chandler-stimson/live-stream-downloader/tree/master/v3/plugins/blob-detector
- https://github.com/chandler-stimson/live-stream-downloader/blob/master/v3/data/job/parse.js
- https://github.com/chandler-stimson/live-stream-downloader/blob/master/v3/data/job/mget/plugins/decrypt.js
- https://github.com/chandler-stimson/live-stream-downloader/blob/master/v3/data/job/mget/mget.js
- https://github.com/chandler-stimson/live-stream-downloader/blob/master/v3/data/job/mget/plugins/disk.js
- https://github.com/chandler-stimson/live-stream-downloader/blob/master/v3/mcp/mcp.json
- https://github.com/chandler-stimson/live-stream-downloader/blob/master/LICENSE

These observations are based on source inspection, **not** proof that every upstream feature works across browsers or on specific real-world sites.
