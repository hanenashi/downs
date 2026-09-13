<div align="center">
  <img src="downs.png" alt="Downs icon" width="220">
</div>

# Downs

A small browser extension for detecting and inspecting HLS streams from the
browser session that is already playing them.

No Python helper. No localhost bridge. No external FFmpeg for the normal path.

## Current status

Downs 2.0 is experimental. The current **Milestone A** build is a detector and
playlist inspector; it does not download media yet.

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
media playlist.

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
playlist requests and `storage` to retain a small per-tab list while the
browser session is active.

The extension does not store cookie or authorization values. It records only
whether those headers were observed, plus non-secret request/page metadata used
for diagnosis. Playlist bodies are parsed locally and are not sent to Downs or
any third-party service.

## Known limits

- No media download, muxing, remuxing, or transcoding is implemented yet.
- No DRM bypass. Protected media is reported as unsupported.
- Live playlists are detected but not captured.
- Extension-context fetches can still fail when a site requires request
  provenance or headers that extensions cannot reproduce.
- Large-file storage and output architecture remain Milestone B work.
- Firefox has a generated experimental build, but Chrome desktop and Kiwi are
  the first compatibility targets.

## Development

Run the parser tests and source checks:

```bash
node --test tests/*.test.js
node --check extension/hls-parser.js
node --check extension/background.js
node --check extension/popup.js
node tools/validate-extension.mjs
```

Build dependency-free Chromium and Firefox zip packages:

```bash
python3 tools/package_extensions.py
```

The parser is deliberately usable without launching a browser. Representative
fixtures cover master playlists, split audio, TS, fMP4, AES-128, protected
media, live playlists, HTML error bodies, and relative or tokenized URLs.

## Direction

Milestone B will support the simplest honest DIRECT path first: finite VOD,
muxed MPEG-TS audio/video, no DRM, bounded segment concurrency, JavaScript
remuxing, and browser-managed file output. The extension service worker remains
a detector/coordinator; it will not be trusted to own a long-running download.

Small streams. Clear answers. No cathedral.
