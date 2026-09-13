# Downs 2.0 handoff — extension-only HLS downloader

## Mission

Preserve the current Python/Tkinter + FFmpeg version of Downs exactly as a known-good legacy version, tag it, then rebuild `main` around a browser-extension-first architecture.

The new direction is:

- one extension, no Python runtime required
- no localhost helper/server
- no external FFmpeg binary requirement for the normal path
- Chrome/Chromium desktop first
- Kiwi Android as a first-class compatibility target from day one
- Firefox can follow with an alternate manifest/API shim
- detect HLS in the authenticated browser session, inspect it, fetch it from extension context, mux/remux in JS, and hand the finished file to the browser download system
- do not attempt DRM bypass
- do not proxy arbitrary sites
- fail loudly and explain why

The current Python app is still useful and should be preserved, not rewritten in place without a checkpoint.

---

## Step 0 — preserve the existing app before touching `main`

Before any architectural rewrite:

1. Confirm the current working tree / default branch is clean.
2. Create an annotated tag for the existing Python/Tkinter + FFmpeg implementation. Suggested tag:

   `v1-python`

   Suggested annotation:

   `Last Python/Tkinter + FFmpeg desktop version before extension-only rewrite`

3. Push the tag.
4. Do not delete the existing history. The old implementation must remain recoverable from the tag.
5. Then rewrite `main` for the new extension-only architecture.

If useful, add a short note to the new README pointing users to the `v1-python` tag for the old desktop app.

---

## Why this rewrite

The existing architecture already has a browser extension that sees HLS traffic, but it throws away most of the useful browser context and sends only the M3U8 URL to a localhost Python app.

Current rough flow:

```text
website/player
    ↓
Downs Link Sucker extension sees .m3u8
    ↓
POST URL only → http://127.0.0.1:8765/download
    ↓
Python/Tkinter
    ↓
FFmpeg performs a cold request
```

That cold FFmpeg request fails on many more defensive HLS setups because it may not reproduce the browser's successful request environment:

- Referer / Origin expectations
- authentication cookies
- signed or short-lived URLs
- tokenized child playlists
- split video/audio renditions
- AES-128 key requests
- master playlists where an explicit rendition should be chosen
- CMAF/fMP4 playlists
- live playlists without `#EXT-X-ENDLIST`

The extension is already sitting inside the environment where the stream works. The rewrite should exploit that instead of trying to make FFmpeg imitate the browser after the fact.

---

## Architectural decision

Target architecture:

```text
              authenticated website tab
                       │
                       │ HLS network traffic
                       ▼
┌─────────────────────────────────────────────┐
│ Downs browser extension                     │
│                                             │
│ 1. detect HLS traffic                       │
│ 2. associate requests with source tab/page  │
│ 3. inspect / classify playlists             │
│ 4. show variants / audio renditions         │
│ 5. fetch playlist + segments                │
│ 6. mux/remux in JS                          │
│ 7. hand finished file to browser downloads  │
└─────────────────────────────────────────────┘
```

No localhost HTTP bridge in the new normal path.

No Python dependency.

No external FFmpeg dependency for the normal path.

Do **not** make a separate userscript a required part of installation.

If page-context instrumentation is later needed for MSE/SourceBuffer work, the extension itself should inject a helper script into the page. The user should still install only one extension.

---

## Extension-only vs ordinary website JS

Do not move the core implementation to GitHub Pages or an ordinary website and expect it to behave like the extension.

A normal page inherits ordinary browser restrictions:

- CORS
- forbidden header manipulation
- inability to observe arbitrary requests from another origin/tab
- inability to inherit another site's authenticated request environment

The extension is the privileged transport and detector.

A GitHub-hosted page may still be useful later for documentation, fixtures, demos, release notes, or a non-privileged HLS inspector, but it must not become the required core downloader.

---

## One extension, not extension + userscript

The install target should be:

```text
Downs extension
├─ background / service worker
│  └─ detect and coordinate HLS jobs
├─ popup or extension page
│  └─ list streams, variants, status, actions
├─ long-lived processing context
│  └─ playlist fetching, segment fetching, mux/remux
├─ optional injected page helper
│  └─ only later, for player/MSE observation if needed
└─ downloads integration
   └─ save completed file
```

Users should not need Tampermonkey, Violentmonkey, Greasemonkey, or any external userscript manager.

---

## Browser targets

Primary targets for the first working pass:

```text
Chrome desktop      required
Chromium desktop    expected from same build
Edge / Brave        likely from same Chromium build
Kiwi Android        required compatibility target
```

Later:

```text
Firefox desktop     alternate manifest / API shim
Firefox Android     possible later
```

Keep code shared wherever possible.

Possible layout:

```text
extension/
  manifest.json
  manifest.kiwi.json        # only if Kiwi really needs differences
  manifest.firefox.json     # later
  src/
    background.js
    popup.js
    inspector.js
    hls-parser.js
    downloader.js
    mux/
```

Do not create separate codebases for desktop and Kiwi unless testing proves unavoidable.

---

## Important MV3 lifetime constraint

Do not trust the Manifest V3 service worker to own a two-hour download.

Treat it as detector/coordinator, not the long-lived media processor.

Suggested split:

```text
service worker
    detection
    request metadata
    tab association
    message routing
        │
        ▼
extension page / offscreen document / suitable long-lived extension context
    playlist parser
    segment downloader
    mux/remux
    progress
    cancellation
        │
        ▼
Downloads API / final Blob / filesystem path supported by browser
```

Research the best Chrome + Kiwi compatible long-lived context before choosing the exact implementation.

Do not store whole movies in `storage.session`.

Use IndexedDB or streaming/chunked processing where appropriate.

Avoid holding an entire multi-gigabyte video in RAM.

---

# HLS save lab — technical TLDR

## Two broad strategies

### DIRECT / PARSE mode — build this first

```text
playlist → classify → variants → segments → mux/remux → file
```

Needs:

- a real playlist URL
- reachable playlists / segments
- relevant authenticated browser context
- no DRM
- supported encryption/container layout

Can fail on:

- expired signed URLs
- site-specific request provenance rules
- inaccessible AES key requests
- unusual/nonstandard player behavior
- unsupported muxing/container details

### CAPTURE mode — later fallback

```text
working player → capture rendered media → encode → file
```

This is `video.captureStream()` + `MediaRecorder` territory.

It is **not** lossless stream extraction.

It usually re-encodes into a MediaRecorder-supported format such as WebM.

Needs:

- a player that works in the source document
- tab/player to remain alive
- supported capture APIs

Can fail on:

- DRM / protected media
- browser/API limitations
- player lifecycle

### DUMP mode — later experimental path

```text
MediaSource / SourceBuffer appendBuffer → preserve incoming fragments → reconstruct/remux
```

This is closer to lossless extraction than MediaRecorder and may preserve original AVC/AAC/fMP4 fragments, but it is substantially harder.

Do not build this in v1.

If it is ever needed, ship the page-context hook from the extension itself.

---

## Terminology to use in the UI/code

Prefer these names:

```text
DIRECT   authenticated HLS fetch + JS mux/remux
CAPTURE  rendered stream via MediaRecorder; may re-encode
DUMP     SourceBuffer fragment interception; experimental/later
```

Avoid calling both MediaRecorder capture and SourceBuffer interception simply "record mode"; they are technically very different.

---

# Playlist anatomy

Basic HLS structure:

```text
#EXTM3U
#EXT-X-VERSION:n
#EXT-X-INDEPENDENT-SEGMENTS          ; optional
```

## Master playlist

Contains pointers/renditions rather than media segments:

```text
#EXT-X-STREAM-INF:BANDWIDTH=...,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
variant-1080.m3u8

#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs.m3u8"
```

If `#EXT-X-STREAM-INF` exists, classify as MASTER.

Do not simply assume the master itself is the final media playlist.

Resolve child URIs relative to the parent playlist URL.

## Media playlist

Typical media tags:

```text
#EXT-X-TARGETDURATION:n
#EXT-X-PLAYLIST-TYPE:VOD|EVENT
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.006,
seg0.ts
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXT-X-ENDLIST
```

No `#EXT-X-ENDLIST` usually means live/event-like behavior and the job needs a user-selected stop/cap/cancel strategy.

---

## Segment/container types

### MPEG-TS

```text
.ts
```

Often multiplexed audio + video in the same segments.

Classic remux path.

AAC may need the equivalent of `aac_adtstoasc` when moving ADTS AAC from TS into MP4.

### fMP4 / CMAF

```text
#EXT-X-MAP:URI="init.mp4"
segment001.m4s
segment002.m4s
```

Needs init segment handling.

Do not apply TS-specific AAC handling blindly.

### split audio/video

Master may point to:

```text
video-1080.m3u8
+
audio-en.m3u8
```

DIRECT mode must fetch and mux both tracks.

Do not produce a silent video because only the video rendition was selected.

---

# Classification model

Suggested internal model:

```text
Playlist {
  url
  kind: 'master' | 'media' | 'not-hls'
  vod: boolean
  encrypted: boolean
  encryptionMethod?: string
  segmented: 'ts' | 'fmp4' | 'mixed' | 'unknown'
  mapUrl?: string
  variants: {
    bandwidth?: number
    resolution?: string
    codecs?: string
    url: string
    audioGroup?: string
  }[]
  audioRends: {
    groupId?: string
    name?: string
    url: string
    language?: string
  }[]
  segments: {
    duration?: number
    url: string
  }[]
  targetDuration?: number
}
```

Suggested job model:

```text
Job {
  mode: 'direct' | 'capture' | 'dump'
  sourceTabId
  pageUrl
  playlistUrl
  variantUrl?
  audioUrl?
  requestContext?
  liveCapSeconds?
  filename?
  state
  progress
}
```

Do not over-engineer the first implementation, but keep these distinctions explicit.

---

# Detection

The existing extension already detects `.m3u8` URLs and HLS content types via `webRequest.onHeadersReceived`.

Keep that idea, but evolve it.

For every detected HLS request, associate at least:

```text
url
source tab id
page/document/initiator URL when available
timestamp
response content type
```

Where browser APIs allow, capture useful request metadata from the actual successful request via `onBeforeSendHeaders` / related events and correlate it with the response.

Potentially relevant request context:

```text
Referer
Origin
User-Agent
Cookie / auth-related context when legitimately available through extension APIs
```

Do not assume every sensitive header will always be directly readable or replayable.

Do not build brittle logic around manually stealing cookie strings if browser-managed authenticated fetches already work.

Preferred rule:

**stay inside the authenticated browser transport whenever possible instead of reconstructing authentication manually.**

---

# DIRECT mode workflow

First useful implementation should roughly do this:

```text
1. detect HLS request
2. user opens Downs popup
3. show detected streams for active tab
4. user picks one
5. extension fetches playlist from privileged extension context
6. verify body begins with #EXTM3U
7. classify master/media
8. if master:
      parse variants
      parse audio groups
      present rendition choices
9. fetch chosen media playlist(s)
10. classify TS/fMP4, live/VOD, encryption
11. download segments with bounded concurrency
12. mux/remux in JS
13. save finished file through browser
14. show useful errors, not generic "failed"
```

Bound segment concurrency. Start around 4–6 and make it easy to tune.

Do not fire hundreds of simultaneous requests.

---

# First-pass UI

Keep the spirit of Downs: small, obvious, no cathedral.

Example popup:

```text
Downs

Detected on this tab

1080p   AVC / AAC   5.8 Mbps
720p    AVC / AAC   3.1 Mbps
480p    AVC / AAC   1.4 Mbps

✓ VOD
✓ media reachable
✓ muxed A/V
✓ MPEG-TS

[ Download 1080p ]
```

For a split/fMP4 stream:

```text
1080p AVC
Audio: Japanese AAC
Container: fMP4/CMAF
Video + audio: separate

[ Download ]
```

For failures:

```text
Could not start DIRECT download

Playlist: reachable
Variant: reachable
Media: AES-128 encrypted
Key: request denied

Reason: key could not be fetched in extension context.
```

Make the extension useful for diagnosis even when downloading fails.

---

# Fail loudly / inspector expectations

At minimum detect and report:

```text
HTML returned instead of playlist
not HLS / body does not start #EXTM3U
master vs media
VOD vs live
TS vs fMP4/CMAF
EXT-X-MAP present
EXT-X-KEY present
encryption method
split audio/video
number of variants
variant resolution / bandwidth / codecs when known
expired/403 playlist
segment failure
key failure
unsupported DRM/protection
unsupported muxing case
```

Do not display a meaningless generic FFmpeg-like "download error" if the actual reason can be classified.

---

# Encryption / DRM boundary

Important distinction:

### Ordinary HLS AES-128

If the playlist exposes:

```text
#EXT-X-KEY:METHOD=AES-128,URI="..."
```

and the authenticated extension can legitimately fetch the key with the same browser session/context, support may be possible later or in DIRECT mode.

### DRM / protected media

Examples include SAMPLE-AES used with DRM systems, EME/Widevine-style protected playback, FairPlay, or anything requiring license circumvention.

Do **not** bypass DRM.

If protected media is detected or strongly indicated:

```text
DRM / protected media — unsupported
```

Stop cleanly.

Do not attempt license extraction, CDM manipulation, key theft, or DRM circumvention.

---

# Mux/remux strategy

This is the biggest technical cost of dropping desktop FFmpeg.

Do not immediately embed ffmpeg.wasm unless a real unsupported case requires it.

Reasons:

- large WASM payload
- high memory usage
- startup cost
- mobile pain
- poor fit for multi-GB media

Prefer focused JS tooling.

Conceptual strategy:

```text
HLS parser
   │
   ├── muxed MPEG-TS A/V
   │      └─ JS demux/remux → MP4
   │
   ├── fMP4/CMAF
   │      └─ init + media fragment handling → final MP4
   │
   ├── split A/V
   │      └─ fetch both → mux tracks → MP4
   │
   └── unsupported/weird
          └─ fail clearly; consider WASM fallback later
```

Evaluate libraries such as mux.js and current lightweight MP4 muxers, but do not blindly add dependencies. Check license, maintenance, browser compatibility, bundle size, memory behavior, and Kiwi behavior.

Do not transcode when remuxing is sufficient.

The point of DIRECT mode is to preserve original stream quality whenever possible.

---

# Memory / large file handling

Design for large media early.

Bad:

```text
fetch every segment
→ keep all ArrayBuffers in one giant JS array
→ make 8 GB Blob
→ browser explodes on Android
```

Prefer:

- bounded fetch queue
- incremental parsing/remux
- IndexedDB or another disk-backed staging approach if needed
- incremental output where browser APIs permit
- explicit cleanup on cancellation/failure

Chrome desktop may tolerate sloppy memory behavior that Kiwi Android absolutely will not. Kiwi is therefore useful as an architectural stress test.

---

# Live streams

No `#EXT-X-ENDLIST` means the job must not wait forever without a policy.

For first pass:

- detect live
- do not pretend it is VOD
- either mark live as unsupported initially, or require a user-selected capture duration
- if supporting live, poll playlist updates and stop after `liveCapSeconds` or user cancel

Do not silently create infinite jobs.

---

# CAPTURE mode — later

Only after DIRECT mode works.

Possible first fallback:

```javascript
const stream = video.captureStream();
const rec = new MediaRecorder(stream, {
  mimeType: 'video/webm;codecs=vp9,opus'
});
```

Important UI truthfulness:

```text
Fallback capture
Real-time or near-real-time
May re-encode
Not guaranteed to preserve original stream codecs/quality
```

Do not label MediaRecorder output as a lossless download.

Fixed rendition / disabled auto-ABR may be useful while capturing.

---

# DUMP mode — later / experimental

Potential page-context injection could intercept:

```javascript
SourceBuffer.prototype.appendBuffer
```

and copy incoming init/media fragments before forwarding them to the original method.

Possible goal:

```text
player fetches authenticated media normally
→ Downs observes actual MSE fragments
→ reconstruct tracks
→ remux
```

This is substantially harder because of:

- SourceBuffer lifecycle
- separate audio/video buffers
- discontinuities
- ABR rendition switches
- init segment changes
- timestamp offsets
- memory pressure
- page isolation/injection details

Do not build this until DIRECT mode has real-world failures that justify it.

---

# Legal/open test fixtures

Use open, safe fixtures while developing.

### VOD muxed TS ABR

```text
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
```

Start here.

### Apple classic MPEG-TS master

```text
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8
```

### Apple fMP4 + separate audio

```text
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8
```

This is an important test because it catches assumptions that everything is muxed `.ts`.

### Tears of Steel HLS

```text
https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8
```

### Live fixture

```text
https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8
```

Reference/demo pages:

```text
https://developer.apple.com/streaming/examples/
https://hlsjs.video-dev.org/demo
https://ottverse.com/free-hls-m3u8-test-urls/
```

Do not use DRM-protected commercial content as a development fixture.

---

# Minimum first milestone

The first extension I want to manually load into Chrome and Kiwi does **not** need to finish the entire downloader rewrite.

It should prove the architecture.

## Milestone A — detector + inspector

Required:

1. Load unpacked in Chrome desktop.
2. Attempt load unpacked in Kiwi Android.
3. Detect HLS requests in the active tab.
4. Popup lists detected playlist URLs.
5. Selecting one fetches/parses the playlist from extension context.
6. Show:
   - master/media/not-HLS
   - VOD/live
   - variants
   - resolution
   - bandwidth
   - codecs if present
   - audio groups/renditions
   - TS/fMP4/unknown
   - `EXT-X-MAP`
   - `EXT-X-KEY`
7. For master playlists, allow selecting a variant and inspect the chosen media playlist.
8. Clear useful error states for 403/HTML/expired/etc.
9. No Python or localhost component.

A basic `Download` button may be present only when the first supported path is implemented correctly.

The inspector itself is already a successful first test.

---

# Minimum second milestone

## Milestone B — first real DIRECT download

Support the simplest reliable case first:

```text
VOD
master or media playlist
muxed MPEG-TS audio+video
no DRM
no unsupported encryption
```

Flow:

```text
choose rendition
→ fetch media playlist
→ fetch TS segments, bounded concurrency
→ JS remux
→ save MP4
```

Test against the open mux.dev fixture and Apple TS fixture.

Only once this works should fMP4/separate audio be added.

---

# Third milestone

## Milestone C — fMP4 + split audio

Add:

- `EXT-X-MAP`
- CMAF/fMP4 fragments
- separate audio rendition selection
- video + audio muxing

Test against the Apple fMP4 fixture.

---

# Fourth milestone

## Milestone D — real authenticated-browser cases

Once open fixtures work:

- test the extension on user-authorized, non-DRM real-world HLS pages that previously failed in Python Downs
- compare the request that the player successfully made with what DIRECT mode fetches
- improve request-context reuse only as needed
- document browser-specific restrictions instead of hiding them

Do not implement generic proxying or DRM bypass to make every site appear supported.

---

# README rewrite expectations

After tagging the old app and beginning the new main branch architecture, rewrite README around the new product.

Suggested opening:

```text
# Downs

A small browser extension for detecting and saving HLS streams from the browser session that is already playing them.

No Python helper. No localhost bridge. No external FFmpeg for the normal path.
```

README should explain:

- current status / experimental label
- Chrome desktop install instructions
- Kiwi Android install instructions once confirmed
- what DIRECT mode means
- supported HLS forms
- unsupported cases
- DRM boundary
- open test fixtures
- link to `v1-python` for the old desktop version

Do not claim support that has not been tested.

---

# Existing code worth studying/reusing conceptually

The current repo already contains useful pieces:

- HLS detection by URL/content type
- per-tab detected link storage
- popup plumbing
- Chrome + Firefox manifest split
- simple UI philosophy

Do not mechanically preserve the localhost feed architecture just because it exists.

Reuse the good detection/UI ideas, not the obsolete transport.

---

# Non-goals

Do **not** spend the first pass on:

- pretty animations
- giant framework migrations
- a GitHub Pages frontend as the core app
- userscript-manager dependency
- DRM bypass
- arbitrary proxy servers
- ffmpeg.wasm before simpler JS remuxing is evaluated
- SourceBuffer interception
- MediaRecorder capture
- live stream complexity unless trivial
- Firefox polish before Chrome + Kiwi architecture is proven

Get the architecture working first.

---

# Development style

Keep Downs small.

Prefer plain JS/HTML/CSS unless a dependency materially simplifies a hard media problem.

Avoid framework ceremony.

Every external dependency should earn its place.

When uncertain, build a small fixture/test before adding abstraction.

Add lightweight parser tests for representative playlist strings:

```text
master with variants
master with split audio
TS media playlist
fMP4 media playlist with EXT-X-MAP
AES-128 playlist
live playlist
HTML error body
relative child URLs
absolute child URLs
query-tokenized URLs
```

The parser/classifier should be testable without launching the browser.

---

# Definition of success for the first Beechan session

At the end of the first implementation session I want, ideally:

```text
✓ old Python Downs tagged/preserved
✓ main is clearly the new extension project
✓ README describes the new direction honestly
✓ no localhost/Python dependency in the new extension path
✓ Chrome can load the extension unpacked
✓ Kiwi can at least attempt to load the same extension/build
✓ popup sees HLS URLs on an open fixture page
✓ inspector parses master/media playlist structure
✓ variants are visible/selectable
✓ useful classification is shown
✓ obvious errors are readable
```

If Kiwi exposes an API incompatibility, document it immediately and isolate it behind the smallest possible compatibility layer. Do not fork the entire project.

---

# Prompt for Beechan Codex CLI

Use the following as the working prompt after reading this file:

> Read `handoff.md` completely before changing anything. Then inspect the current repository and git history. Preserve the current Python/Tkinter + FFmpeg Downs by creating and pushing an annotated `v1-python` tag before rewriting `main`; do not destroy the old history. After that, begin the extension-only Downs 2.0 rewrite described here. Keep the implementation small and dependency-light. Chrome desktop and Kiwi Android are the first compatibility targets; one extension install only, no required userscript, no Python helper, no localhost HTTP bridge, and no external FFmpeg in the normal new path. First build Milestone A: HLS detection + playlist inspector/classifier with a simple popup, using the legal/open fixtures listed in this document. Parse master/media playlists, variants, split audio metadata, VOD/live, TS/fMP4, EXT-X-MAP, and EXT-X-KEY, resolve relative URLs correctly, and produce useful errors. Use the extension's privileged browser context rather than a GitHub Pages app for core fetching. Treat MV3 service-worker lifetime carefully and do not design long downloads around a service worker staying alive. Do not implement DRM bypass, proxying, SourceBuffer dumping, or MediaRecorder capture in this first pass. Rewrite README for the new architecture and mention the `v1-python` legacy tag. Run any parser/unit checks you can locally and inspect the extension files for Chrome MV3 validity. If Kiwi compatibility cannot be tested directly on Beechan, keep APIs conservative, document anything uncertain, and prepare concise manual load/test steps for Stan. Commit sensible checkpoints. Do not ask Stan questions unless a genuinely blocking decision cannot be inferred from this handoff; make reasonable implementation choices and record them.

---

## Final reminder

The core idea is simple:

**The browser extension is already present in the authenticated environment where the HLS stream works. Stop throwing that advantage away.**

Build DIRECT mode there first. Preserve the tiny-goblin spirit.