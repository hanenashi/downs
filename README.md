<div align="center">
  <img src="downs.png" alt="Downs icon" width="220">
</div>

# Downs

A small browser extension for detecting, inspecting, and directly saving a
carefully bounded subset of HLS streams from the browser session that is
already playing them.

No Python helper. No localhost bridge. No external FFmpeg for the normal path.

## Current status

Downs 2.9 is experimental. In addition to the bounded MPEG-TS path, persistent
Downloads manager, request-context replay, and playback grouping, it can now
assemble a conservative modern HLS layout: finite unencrypted fMP4/CMAF VOD
with one separate H.264 video track and a user-selected AAC audio rendition.
Finished DIRECT output now uses conventional flat MP4 sample tables for fast,
reliable seeking while preserving the source H.264/AAC samples.

It can:

- detect M3U8 URLs and HLS response content types in the active tab;
- fetch a selected playlist from the extension context with browser credentials;
- distinguish master, media, and non-HLS responses;
- list variants with resolution, bandwidth, and codecs;
- list split audio renditions and select among those matching a video variant;
- identify VOD versus live/event playlists;
- identify MPEG-TS, fMP4/CMAF, `EXT-X-MAP`, and `EXT-X-KEY`;
- distinguish ordinary AES-128 metadata from likely protected media;
- report HTTP, timeout, HTML-response, and other useful failure reasons;
- present detected playbacks with page titles and compact URL summaries, then
  add parsed stream facts only after a playlist has actually been inspected;
- keep complete playlist URLs in a collapsible **Technical details** section
  with **Copy URL**, plus an optional URL-first stream-list setting;
- open or focus a dedicated Downloads manager for supported media playlists;
- fetch up to four MPEG-TS segments concurrently while consuming them in order;
- remux MPEG-TS with bundled mux.js, then finalize its samples into a flat MP4;
- combine separate H.264 and AAC fMP4 initialization metadata, remap colliding
  track IDs, and finalize their samples without re-encoding;
- build truthful timing, keyframe, sample-size, and 64-bit chunk-offset tables;
- optionally save an exact source diagnostic TAR containing fetched segments,
  local replay playlists, sizes, durations, and SHA-256 hashes;
- stream output to browser-private storage when available, with a bounded
  in-memory fallback;
- persist queued, active, finished, failed, and cancelled job metadata;
- retain finished private MP4s until **Save to device** or **Delete** is chosen;
- save again without rebuilding, retry failures from the current playlist, and
  remove partial output when a job is cancelled;
- derive finite movie and per-track durations from actual fragment sample timing;
- name new jobs from the suggested page title, a local date stamp, or a random
  ten-character ID selected in **Settings**;
- replay a detected player page's origin as Referer while inspecting or fetching
  that stream, using temporary exact-URL browser rules that are removed after
  each request;
- collapse related playlist detections under one primary row while keeping every
  observed URL available through **Show related playlists**.

The old Python/Tkinter + FFmpeg desktop application is preserved at the
[`v1-python`](https://github.com/hanenashi/downs/tree/v1-python) tag.

## Install in Chrome or Chromium desktop

1. Clone or download this repository.
2. Open `chrome://extensions` (or the equivalent page in Edge or Brave).
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the `extension/` directory.
6. Open an HLS fixture or another authorized, non-DRM HLS page and start playback.
7. Open Downs from the browser toolbar.

The popup lists playbacks detected on the current tab using the page title and
a compact host/path summary. Select one to fetch and inspect it. Parsed status
chips appear only after inspection. Expand **Technical details** for the full
playlist URL, request facts, and **Copy URL**. If the playlist is a master,
select a variant to inspect that child media playlist. A clear **Ready to
download** block and **Download** button appear only when the selected media
playlist passes the current DIRECT support checks.

The secondary **Source bundle** action creates an advanced `.downs-source.tar`
diagnostic job instead of a finished MP4. It stores each fetched segment or
fragment byte-for-byte, with locally replayable playlists and a manifest. It is
intended for reproducible debugging and can be as large as the source media.

For a supported fMP4 master with separate audio, Downs initially selects that
variant's default audio rendition. When several matching renditions exist, a
compact **Audio** selector appears in the inspected variant before download.
The manager fetches the chosen playlist, verifies both tracks' simple VOD shape
and actual H.264/AAC initialization metadata, then assembles their samples into
one seekable MP4.

Players often request a master plus several variants or audio playlists while
switching quality. Downs groups conservative same-CDN URL families and short
same-page startup bursts into one playback row. Expand **Show related playlists**
to inspect any individual observed URL. Different CDN hosts and clearly
different URL families remain separate.

Choosing **Download** creates a queued job and opens the Downs Downloads tab.
A brief confirmation and highlighted job row make that handoff visible. The
manager owns processing, progress, cancellation, retry, and export. Downs
rechecks the current playlist before fetching its segments. When a job reaches
**Done**, choose **Save to device** to invoke the browser save dialog. The
private copy stays available for **Save again** until it is deleted or aged out
of the bounded 30-job history.

The popup's **Downloads** entry shows active and ready-to-save counts and opens
the existing manager tab when one is already present.

The manager's **Settings** pane controls names for new downloads. **Suggested
title** preserves the existing behavior, **Date stamp** produces names such as
`2026-09-14_20-42.mp4`, and **Random hash** produces names such as
`k7m2p9x4qa.mp4`. Existing job names are not changed. **Show full URLs in stream
list** restores URL-first popup rows for technical testing; full URLs remain
available in playlist details regardless of that setting.

## Kiwi Android compatibility target

Kiwi 137 on the project Pixel is a required manual compatibility target. Build
the Chromium zip with:

```bash
python3 tools/package_extensions.py
```

Then use Kiwi's Extensions page in developer mode to load
`dist/downs-chromium.zip`. Downs 2.7's media paths were verified on the physical
Pixel for both MPEG-TS and a generated two-language fMP4 fixture. The Japanese
alternate rendition survived selection, assembly, device export, and native
audio-fingerprint validation. The 2.8 interface passed desktop Chromium QA at
420px and 320px. Downs 2.9's flat finalizer and source bundle now need the next
physical Kiwi pass. Kiwi may install a new development zip
beside an older build rather than replacing it.

Kiwi Browser is discontinued and no longer receives engine maintenance. Downs
therefore treats it as a specifically tested compatibility target, not a safe
or maintained recommendation for new users.

## Open test fixtures

- Mux VOD / MPEG-TS ABR:
  `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
- Apple classic MPEG-TS:
  `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8`
- Apple fMP4 with separate audio:
  `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8`
- Tears of Steel:
  `https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8`

Use open or user-authorized streams for testing.

## Permissions and privacy

Downs requests HTTP(S) host access because HLS playlists and their child
renditions may be served from unrelated CDNs. It uses `webRequest` to observe
playlist requests, temporary `declarativeNetRequest` session rules to replay a
detected Referer origin on its own exact-URL requests, `storage` to retain small
per-tab metadata and persistent download job records, and `downloads` to export
a completed MP4 through the browser only after the user chooses **Save to
device**.

The extension does not store cookie or authorization values. It records only
whether those headers were observed. A Referer is reduced to its HTTP(S) origin
before storage, so its path, query, fragment, and credentials are discarded.
Downs never replays an observed Origin header. Playlist bodies and media are
processed locally and are not sent to Downs or any third-party service. Segment
requests still go to the stream's own servers. Source bundles replace remote
URLs with local paths and never contain cookies or authorization values, but
they do contain the complete downloaded media and should be shared deliberately.

## Known limits

- No DRM bypass. Protected media is reported as unsupported.
- Live/event playlists, AES-128 encryption, byte-range segments or init maps,
  discontinuities, gaps, I-frame-only media, and unsupported codecs are not
  downloaded.
- fMP4/CMAF support currently requires one map per track, separate H.264 video
  and AAC audio VOD playlists whose durations differ by no more than two
  seconds. Multiplexed fMP4, multiple map periods, and advanced edit/timeline
  layouts remain unsupported.
- Both DIRECT paths preserve the encoded H.264/AAC media rather than
  re-encoding it.
- Flat finalization accepts only the simple one-track-per-fragment layouts used
  by the current DIRECT gates. Unexpected offsets or sample tables fail clearly
  instead of producing a misleading file.
- Extension-context fetches can still fail when a site requires an exact page
  path, custom headers, signed request values, or provenance that an extension
  cannot safely reproduce. Downs deliberately replays only the page origin as
  Referer; it never replays cookie or authorization header values.
- Browsers without Origin Private File System support use an in-memory fallback
  capped at 256 MiB. Keep the Downloads tab open while such an output is waiting
  to be saved. Available storage quota can still limit larger files.
- Closing the Downloads tab interrupts active work. On reopening, Downs marks
  that job failed, cleans its partial output, and offers **Retry**. Completed
  OPFS-backed outputs survive closing the tab.
- Firefox has a generated experimental build, but Chrome desktop and Kiwi are
  the first compatibility targets.

## Development

Run the parser tests and source checks:

```bash
node --test tests/*.test.js
node --check extension/audio-core.js
node --check extension/hls-parser.js
node --check extension/download-core.js
node --check extension/download-worker.js
node --check extension/fmp4-core.js
node --check extension/job-core.js
node --check extension/link-group-core.js
node --check extension/request-context.js
node --check extension/downloads.js
node --check extension/background.js
node --check extension/popup.js
node tools/validate-extension.mjs
```

For repeatable browser/remux QA, start the development-only fixture page:

```bash
node tools/serve-fixtures.js
```

After exporting its three-segment MP4 from Downs, validate the complete file
with native FFprobe/FFmpeg development tools:

```bash
node tools/validate-media.js \
  --playlist tests/fixtures/mux-short.m3u8 \
  /path/to/exported-file.mp4
```

The validator compares playlist and container durations, checks H.264/AAC stream
shape and decoded dimensions, counts readable frames, checks decode timestamps,
and performs a full decode.
It is test tooling only; FFmpeg is not bundled or used by the extension. See
[`tests/playground.md`](tests/playground.md) for the public-player findings
matrix and interpretation rules.

`http://127.0.0.1:8765/referer-page.html` is the deterministic request-context
fixture. Its playlist returns HTTP 403 without the serving page's Referer origin
and HTTP 200 with it.

Generate the deterministic separate-track fMP4/CMAF fixture, then open its page:

```bash
tools/generate-modern-fixture.sh
node tools/serve-fixtures.js
# http://127.0.0.1:8765/modern-page.html
```

Generated media stays under ignored `test-artifacts/`. FFmpeg is used only to
create and validate development fixtures; it is not part of the extension.

Build dependency-free Chromium and Firefox zip packages:

```bash
python3 tools/package_extensions.py
```

The parser and DIRECT support gate are deliberately testable without launching
a browser. Representative fixtures cover master playlists, split audio, TS,
fMP4, AES-128, protected media, live playlists, HTML error bodies, relative or
tokenized URLs, bounded concurrency, and filename safety. The short Mux fixture
uses three segments from Mux's public HLS test stream for browser-level remux QA.

## Bundled software

Downs vendors the browser MP4 build of
[`mux.js` 6.3.0](https://github.com/videojs/mux.js), licensed under Apache-2.0.
Its license is shipped at `extension/vendor/LICENSE.mux.js` and in both built
extension packages.

## Direction

The immediate work is real-world VLC/Kiwi testing of flat 2.9 MP4 output and the
opt-in source diagnostic bundle. Dark mode, editable preflight filenames, and
broader manager-row interactions remain separate UI passes. Broader fMP4
compatibility, larger-file stress testing, and Firefox verification remain next
for DIRECT; CAPTURE and DUMP stay later, separate strategies.

Small streams. Clear answers. No cathedral.
