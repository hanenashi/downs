<div align="center">
  <img src="downs.png" alt="Downs icon" width="220">

  <p>
    <a href="https://raw.githubusercontent.com/hanenashi/downs/144f022/dist/downs-chromium.zip"><strong>Download for Chromium / Kiwi</strong></a>
    ·
    <a href="https://raw.githubusercontent.com/hanenashi/downs/144f022/dist/downs-firefox.zip"><strong>Download for Firefox</strong></a>
  </p>
</div>

# Downs

A small browser extension for detecting and inspecting HLS/DASH manifests, and
directly saving a carefully bounded subset of HLS and DASH streams from the browser
session that is already playing them.

No Python helper. No localhost bridge. No external FFmpeg for the normal path.

## Current status

Downs 2.17 is experimental. In addition to the bounded MPEG-TS path, persistent
Downloads manager, request-context replay, and playback grouping, it can now
assemble conservative modern HLS layouts: finite unencrypted fMP4/CMAF VOD
with either separate H.264-or-AV1 video and AAC tracks or one muxed
H.264-or-AV1 plus AAC-LC
track pair. Finished DIRECT output uses conventional flat MP4 sample tables for
fast, reliable seeking while preserving the encoded source samples.

It can:

- detect M3U8 URLs and HLS response content types in the active tab;
- detect MPD URLs and DASH response content types, then safely inspect static or
  dynamic presentations, representations, codecs, protection, and addressing;
- assemble a conservative static, clear DASH layout with separate H.264-or-AV1
  video and AAC-LC audio fMP4 tracks addressed by finite SegmentTemplate metadata;
- detect explicitly typed, page-created M3U8 `Blob`s through a size-limited
  page-world probe and inspect them without widening the download gates;
- fetch a selected playlist from the extension context with browser credentials;
- distinguish master, media, and non-HLS responses;
- list variants with resolution, bandwidth, and codecs;
- list split audio renditions and select among those matching a video variant;
- identify VOD versus live/event playlists;
- identify MPEG-TS, fMP4/CMAF, `EXT-X-MAP`, and `EXT-X-KEY`;
- identify suffix-disguised MPEG-TS through a bounded two-packet byte probe;
- distinguish ordinary AES-128 metadata from likely protected media;
- decrypt finite MPEG-TS VOD protected with standard whole-segment AES-128,
  including explicit or media-sequence IVs and identity-key rotation;
- report HTTP, timeout, HTML-response, and other useful failure reasons;
- present detected playbacks with page titles and compact URL summaries, then
  add parsed stream facts only after a playlist has actually been inspected;
- keep complete playlist URLs in a collapsible **Technical details** section
  with **Copy URL**, plus an optional URL-first stream-list setting;
- open or focus one persistent Downloads manager in either a compact window or
  a normal browser tab;
- fetch up to four MPEG-TS segments concurrently while consuming them in order;
- remux MPEG-TS with bundled mux.js, then finalize its samples into a flat MP4;
- combine separate H.264-or-AV1 and AAC fMP4 initialization metadata, remap
  colliding track IDs, and finalize their samples without re-encoding;
- finalize bounded muxed HLS/CMAF fragments containing H.264 or AV1 video plus
  AAC-LC audio, including multiple explicit sample runs sharing one media box;
- build truthful timing, keyframe, sample-size, and 64-bit chunk-offset tables;
- optionally save an exact source diagnostic TAR containing fetched segments,
  local replay playlists, sizes, durations, and SHA-256 hashes;
- preserve selected DASH video/audio initialization and media fragments in the
  same offline-verifiable source-bundle format;
- stream output to browser-private storage when available, with a bounded
  in-memory fallback;
- persist queued, active, finished, failed, and cancelled job metadata;
- retain finished private MP4s until **Save to device** or **Delete** is chosen;
- save again without rebuilding, retry failures from the current playlist, and
  remove partial output when a job is cancelled;
- derive finite movie and per-track durations from actual fragment sample timing;
- name new jobs from the suggested page title, a local date stamp, or a random
  ten-character ID selected in **Settings**;
- replay the HTTP(S) Referer observed on the detected player request plus its
  matching Origin while inspecting or fetching that stream, preserving required
  page paths through temporary exact-URL rules removed after each request;
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

Some players manufacture an HLS manifest in JavaScript instead of requesting
an M3U8 URL. Downs 2.10 detects Blobs explicitly typed with a standard HLS MIME
type, validates at most 512 KiB of playlist text in an isolated bridge, and
labels the result as an **in-memory Blob playlist**. This first pass is
inspection-only: network child playlists can be inspected normally, but an
inline media playlist itself cannot enter DIRECT download processing.

DASH inspection accepts bounded XML without DOCTYPE or ENTITY declarations,
resolves ordinary BaseURL inheritance, and summarizes Period, AdaptationSet,
Representation, ContentProtection, SegmentTemplate/SegmentTimeline,
SegmentList, and SegmentBase metadata. Downs 2.13 can download one narrow
static, unencrypted, single-Period layout: separate H.264-or-AV1 video and AAC-LC audio
fMP4 tracks using finite SegmentTemplate timelines or fixed durations. Other
DASH remains clearly inspection-only; this is not generic DASH support.

The secondary **Source bundle** action creates an advanced `.downs-source.tar`
diagnostic job instead of a finished MP4. It stores each fetched segment or
fragment byte-for-byte, with locally replayable playlists and a manifest. It is
intended for reproducible debugging and can be as large as the source media.
It is deliberately unavailable for AES-128 jobs: Downs fetches authorized key
bytes only into memory, imports them as non-extractable Web Crypto keys, clears
the raw buffers, and never stores keys in a diagnostic archive.

For a supported fMP4 master with separate audio, Downs initially selects that
variant's default audio rendition. When several matching renditions exist, a
compact **Audio** selector appears in the inspected variant before download.
The manager fetches the chosen playlist, verifies both tracks' simple VOD shape
and actual H.264-or-AV1 video plus AAC initialization metadata, then assembles
their samples into
one seekable MP4.

For a supported muxed fMP4 media playlist, Downs verifies one shared
initialization segment containing exactly one H.264 or AV1 video track and one
AAC-LC audio track. It indexes explicitly addressed sample runs from both
tracks and preserves the original encoded samples in the finished seekable MP4.

Players often request a master plus several variants or audio playlists while
switching quality. Downs groups conservative same-CDN URL families and short
same-page startup bursts into one playback row. Expand **Show related playlists**
to inspect any individual observed URL. Different CDN hosts and clearly
different URL families remain separate.

Choosing **Download** creates a queued job and opens Downs Downloads in the
configured compact window or browser tab.
A brief confirmation and highlighted job row make that handoff visible. The
manager owns processing, progress, cancellation, retry, and export. Downs
rechecks the current playlist before fetching its segments. When a job reaches
**Done**, choose **Save to device** to invoke the browser save dialog. The
private copy stays available for **Save again** until it is deleted or aged out
of the bounded 30-job history.

The popup's **Downloads** entry shows active and ready-to-save counts and opens
the existing manager surface when one is already present. Downs reuses and can
move that page between a compact window and a normal tab without reloading it,
so changing the destination does not discard an active worker.

The manager's **Settings** pane controls names for new downloads. **Suggested
title** preserves the existing behavior, **Date stamp** produces names such as
`2026-09-14_20-42.mp4`, and **Random hash** produces names such as
`k7m2p9x4qa.mp4`. Existing job names are not changed. **Show full URLs in stream
list** restores URL-first popup rows for technical testing; full URLs remain
available in playlist details regardless of that setting. **Simple** mode keeps
the stream list and essential download actions, automatically choosing the
highest advertised video rendition and queuing its MP4 when that child passes
the normal support gates. **Detailed** mode restores technical
inspection and source-bundle controls. **Download manager** chooses a reused
**Compact window** or ordinary **Browser tab** and moves the current manager
immediately; existing installations retain the tab behavior until this setting
is changed.

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
420px and 320px. Downs 2.10's in-memory Blob probe now needs its physical Kiwi
compatibility pass. Kiwi may install a new development zip
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
detected Referer and matching Origin on its own exact-URL requests, `storage` to retain small
per-tab metadata and persistent download job records, and `downloads` to export
a completed MP4 through the browser only after the user chooses **Save to
device**. Its page-world Blob probe sees only Blob type and size before reading
an explicitly HLS-typed candidate; the isolated bridge revalidates the MIME
type, 512 KiB limit, `#EXTM3U` header, and HTTP(S) base before extension storage.

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
- Live/event playlists, byte-range segments or init maps, discontinuities,
  gaps, I-frame-only media, and unsupported codecs are not downloaded.
- Encrypted DIRECT support is intentionally limited to finite MPEG-TS VOD with
  HLS `METHOD=AES-128`, identity-format 16-byte keys, and AES-CBC segment
  encryption. SAMPLE-AES, FairPlay, CENC/DRM, encrypted fMP4, and other key
  formats remain unsupported; Downs does not bypass DRM.
- fMP4/CMAF support requires one map per track. Separate-track HLS requires
  H.264 or AV1 video and AAC audio VOD playlists whose durations differ by no more
  than two seconds. Muxed HLS requires exactly one H.264 or AV1 video track and
  one AAC-LC audio track with explicit fragment data offsets. Multiple map
  periods and advanced edit/timeline layouts remain unsupported.
- DIRECT paths preserve the encoded source media rather than re-encoding it.
- Flat finalization accepts bounded one- or two-track fragments and validates
  every sample run against its media-data payload. Implicit or absolute bases,
  uncovered bytes, overlaps, unexpected offsets, and timeline regressions fail
  clearly instead of producing a misleading file.
- Extension-context fetches can still fail when a site requires an exact page
  path, custom headers, signed request values, or provenance that an extension
  cannot safely reproduce. Downs deliberately replays only the page origin as
  Referer; it never replays cookie or authorization header values.
- Browsers without Origin Private File System support use an in-memory fallback
  capped at 256 MiB. Keep the Downloads page open while such an output is waiting
  to be saved. Available storage quota can still limit larger files.
- Closing the Downloads page interrupts active work. On reopening, Downs marks
  that job failed, cleans its partial output, and offers **Retry**. Completed
  OPFS-backed outputs survive closing the tab.
- Firefox has a generated experimental build, but Chrome desktop and Kiwi are
  the first compatibility targets.
- DASH DIRECT requires one zero-based static Period, finite presentation and
  track durations, HTTP(S) initialization/media URLs, separate H.264-or-AV1 and
  AAC-LC fMP4 representations, and SegmentTemplate with a finite Timeline or
  fixed duration. Dynamic MPDs, DRM/CENC, HE-AAC, SegmentList, SegmentBase,
  byte-range indexes, open-ended repeats, timeline gaps, and multiple Periods
  remain inspection-only.

## Development

Run the parser tests and source checks:

```bash
node --test tests/*.test.js
node --check extension/aes-core.js
node --check extension/audio-core.js
node --check extension/blob-playlist-core.js
node --check extension/blob-bridge.js
node --check extension/blob-page.js
node --check extension/dash-parser.js
node --check extension/hls-parser.js
node --check extension/download-core.js
node --check extension/download-worker.js
node --check extension/fmp4-core.js
node --check extension/mp4-finalizer.js
node --check extension/tar-core.js
node --check extension/job-core.js
node --check extension/link-group-core.js
node --check extension/request-context.js
node --check extension/downloads.js
node --check extension/background.js
node --check extension/popup.js
node --check tools/replay-source-bundle.mjs
node tools/validate-extension.mjs
```

### Replay a source diagnostic bundle

An exported `.downs-source.tar` can reproduce Downs' finalization path entirely
offline:

```bash
node tools/replay-source-bundle.mjs /path/capture.downs-source.tar \
  --output /tmp/replayed.mp4 \
  --ffprobe
```

The tool checks TAR header integrity, rejects unsafe archive paths, verifies
every media file against the manifest's size and SHA-256, then rebuilds the MP4
with the same bundled mux.js and flat finalizer used by the extension. It
supports the current MPEG-TS, HLS fMP4, and selected DASH fMP4 source-bundle
modes, never contacts the original host, and removes its temporary extraction
directory.
It refuses to replace an existing output unless `--force` is supplied.
`--ffprobe` is optional development diagnostics and requires a local FFprobe;
FFprobe is not used for replay and is not bundled with Downs.

For repeatable browser/remux QA, start the development-only fixture page:

```bash
node tools/serve-fixtures.js
```

`http://127.0.0.1:8765/blob-playlist-page.html` is the deterministic Blob
discovery fixture. Choose **Create playlist Blobs**, refresh the Downs popup,
and inspect the single detected in-memory playlist; its `text/plain` lookalike
must not be recorded.

`http://127.0.0.1:8765/dash-page.html` requests a deterministic static MPD with
two H.264 video representations, one AAC audio representation, inherited
BaseURLs, and SegmentTimelines. It exercises parser and representation-selection
metadata; its illustrative media URLs do not exist.

Generate the complete static DASH/fMP4 fixture and open its page:

```bash
tools/generate-dash-fixture.sh
node tools/serve-fixtures.js
# http://127.0.0.1:8765/dash-download-page.html
```

The six-second fixture contains separate H.264 and AAC-LC representations with
formatted Number templates and finite SegmentTimelines. A completed output can
be validated with `tools/validate-media.js --expected-duration 6`.

Generate the equivalent AV1/AAC-LC DASH fixture:

```bash
tools/generate-dash-av1-fixture.sh
node tools/serve-fixtures.js
# http://127.0.0.1:8765/dash-av1-page.html
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
fixture. Its playlist returns HTTP 403 without the full serving page Referer and
matching Origin, and HTTP 200 with them.

Generate the deterministic separate-track fMP4/CMAF fixture, then open its page:

```bash
tools/generate-modern-fixture.sh
node tools/serve-fixtures.js
# http://127.0.0.1:8765/modern-page.html
```

Generate the deterministic muxed H.264/AAC fMP4/CMAF fixture:

```bash
tools/generate-muxed-fmp4-fixture.sh
node tools/serve-fixtures.js
# http://127.0.0.1:8765/muxed-fmp4-page.html
```

Generated media stays under ignored `test-artifacts/`. FFmpeg is used only to
create and validate development fixtures; it is not part of the extension.

Generate the deterministic AES-128 MPEG-TS fixture to exercise explicit and
implicit IVs plus key rotation:

```bash
tools/generate-aes-fixture.sh
node tools/serve-fixtures.js
# http://127.0.0.1:8765/aes-page.html
```

The fixture uses development-only fixed keys. A successful export can be
checked with `tools/validate-media.js` against
`test-artifacts/aes-fixture/encrypted.m3u8`.

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

The immediate work is real-site Firefox/Kiwi validation of the bounded 2.17
AV1 parity, DASH source-bundle, muxed HLS/CMAF, Blob, and AES-128
compatibility testing. Live RECORD remains the next large architecture pass.
Dark mode, editable preflight filenames, and broader manager-row interactions
remain separate UI work.

Small streams. Clear answers. No cathedral.
