<div align="center">
  <img src="downs.png" alt="Downs icon" width="220">
</div>

# Downs

A small browser extension for detecting, inspecting, and directly saving a
carefully bounded subset of HLS streams from the browser session that is
already playing them.

No Python helper. No localhost bridge. No external FFmpeg for the normal path.

## Current status

Downs 2.3 is experimental. The current **Milestone C** build keeps the bounded
DIRECT download path from Milestone B and adds a persistent Downs-owned
Downloads manager. The supported media shape is still finite, unencrypted,
muxed MPEG-TS VOD containing H.264 video and AAC audio.

It can:

- detect M3U8 URLs and HLS response content types in the active tab;
- fetch a selected playlist from the extension context with browser credentials;
- distinguish master, media, and non-HLS responses;
- list variants with resolution, bandwidth, and codecs;
- list split audio renditions;
- identify VOD versus live/event playlists;
- identify MPEG-TS, fMP4/CMAF, `EXT-X-MAP`, and `EXT-X-KEY`;
- distinguish ordinary AES-128 metadata from likely protected media;
- report HTTP, timeout, HTML-response, and other useful failure reasons.
- open or focus a dedicated Downloads manager for supported media playlists;
- fetch up to four MPEG-TS segments concurrently while consuming them in order;
- remux MPEG-TS to fragmented MP4 in JavaScript with the bundled mux.js library;
- stream output to browser-private storage when available, with a bounded
  in-memory fallback;
- persist queued, active, finished, failed, and cancelled job metadata;
- retain finished private MP4s until **Save to device** or **Delete** is chosen;
- save again without rebuilding, retry failures from the current playlist, and
  remove partial output when a job is cancelled.
- write finite movie and track durations into remuxed MP4 headers for players
  that do not treat mux.js's unknown-duration sentinel correctly;
- name new jobs from the suggested page title, a local date stamp, or a random
  ten-character ID selected in **Settings**.

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

The popup lists playlists detected on the current tab. Select one to fetch and
inspect it. If it is a master playlist, select a variant to inspect that child
media playlist. A **Download** button appears only when the selected media
playlist passes the current DIRECT support checks.

Choosing **Download** creates a queued job and opens the Downs Downloads tab.
That tab owns processing, progress, cancellation, retry, and export. Downs
rechecks the current playlist before fetching its segments. When a job reaches
**Done**, choose **Save to device** to invoke the browser save dialog. The
private copy stays available for **Save again** until it is deleted or aged out
of the bounded 30-job history.

The popup's **Downloads** entry shows active and ready-to-save counts and opens
the existing manager tab when one is already present.

The manager's **Settings** pane controls names for new downloads. **Suggested
title** preserves the existing behavior, **Date stamp** produces names such as
`2026-09-14_20-42.mp4`, and **Random hash** produces names such as
`k7m2p9x4qa.mp4`. Existing job names are not changed.

## Kiwi Android compatibility target

Kiwi 137 on the project Pixel is a required manual compatibility target. Build
the Chromium zip with:

```bash
python3 tools/package_extensions.py
```

Then use Kiwi's Extensions page in developer mode to load
`dist/downs-chromium.zip`. Exact installation behavior and the extension APIs
must be verified on the physical device before Kiwi support is claimed.

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
playlist requests, `storage` to retain small per-tab metadata and persistent
download job records, and `downloads` to export a completed MP4 through the
browser only after the user chooses **Save to device**.

The extension does not store cookie or authorization values. It records only
whether those headers were observed, plus non-secret request/page metadata used
for diagnosis. Playlist bodies and media are processed locally and are not sent
to Downs or any third-party service. Segment requests still go to the stream's
own servers.

## Known limits

- No DRM bypass. Protected media is reported as unsupported.
- Live/event playlists, AES-128 encryption, fMP4/CMAF input, split audio
  renditions, byte-range segments, discontinuities, gaps, I-frame-only media,
  audio-only playlists, and video-only playlists are not downloaded.
- The current muxer path expects H.264 video and AAC audio in MPEG-TS. It remuxes
  rather than re-encoding.
- Extension-context fetches can still fail when a site requires request
  provenance or headers that extensions cannot reproduce.
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
node --check extension/hls-parser.js
node --check extension/download-core.js
node --check extension/download-worker.js
node --check extension/job-core.js
node --check extension/downloads.js
node --check extension/background.js
node --check extension/popup.js
node tools/validate-extension.mjs
```

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

The next DIRECT work is compatibility hardening on physical Kiwi and Firefox,
larger-file stress testing, and deciding which currently rejected layouts can
be added without weakening failure clarity. CAPTURE and DUMP remain later,
separate strategies; neither is silently substituted for DIRECT.

Small streams. Clear answers. No cathedral.
