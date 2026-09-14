# Downs handoff — public HLS playground pass

## Implementation update — Downs 2.5

The grouping/deduplication milestone is implemented. The popup now presents a
primary playlist per conservative playback group and collapses child variants,
audio playlists, ABR switches, and same-path token refreshes behind **Show
related playlists**. Every detected URL remains reachable and individually
inspectable; no media eligibility gate changed.

Grouping requires the same request host plus either a meaningful shared path or
a short same-page startup burst. Different hosts stay separate, and generic
single-directory matches do not merge after the burst window. Unit fixtures
cover Mux-style ABR, switched sources, cross-host URLs, generic `/live` layouts,
and token refreshes. The popup preview passed at 420×640 and 320×640 with no
overflow or console errors, including expansion and child inspection.

This grouping pass did not use ADB. The new layout and request-context API path
still need quick manual confirmation in Kiwi and Firefox. After that, choose
between fMP4/CMAF VOD and separate audio/video based on the public-playground
frequency and implementation risk.

## Previous implementation update — Downs 2.4

The evidence-backed request-context milestone is implemented. Downs now records
only the HTTP(S) origin of an observed Referer, passes that sanitized context
through master/variant inspection and download jobs, and applies it to each
extension fetch with a temporary exact-URL session rule. The rule is removed in
`finally`; stale reserved rules are also cleared when the background worker
starts. Cookie and authorization values remain observation booleans only, and
Origin is not replayed.

Deterministic coverage lives at `referer-page.html` /
`referer-required.m3u8`. Desktop Chromium proved 403 without context, 200 with
context, a complete three-segment download, and zero remaining temporary rules.
This pass intentionally did not use ADB or the Pixel. The next milestone should
be detection grouping/deduplication; Kiwi and Firefox remain manual compatibility
checks for this new browser API path.

## Mission

Downs is now far enough along that the next useful step is not more synthetic fixtures first. We need a few real public player pages that generate realistic HLS traffic in-browser so the extension can be exercised against something closer to normal sites.

Use the public demo/player sites below as the primary playgrounds. Do not hard-code Downs around any one of them. Inspect them on the fly and pick whichever is most useful for the specific behavior being tested.

The goal is to learn what modern real-world HLS layouts Downs encounters, identify the highest-value unsupported cases, and then choose the next implementation milestone from evidence rather than guessing.

---

## Three public playgrounds

### 1. hls.js demo

https://hlsjs.video-dev.org/demo/

Why it is useful:

- real browser-side HLS playback through hls.js / MSE;
- quality/rendition switching;
- audio-track handling;
- lots of player diagnostics;
- easy to swap between known streams;
- good everyday test target for detection, master playlists, child media playlists, ABR behavior and player-driven request patterns.

This is probably the first place to try when exploring a general HLS behavior.

### 2. Wowza test players

https://www.wowza.com/testplayers

Why it is useful:

- behaves more like a conventional hosted/commercial player page;
- public HLS test player;
- useful sanity check that Downs works outside developer-centric hls.js tooling;
- can be used with alternative stream URLs where appropriate.

Good for checking whether Downs behaves well on a more ordinary player integration.

### 3. Bitmovin test-your-stream demo

https://bitmovin.com/demos/test-stream/

Why it is useful:

- heavier commercial player stack;
- useful for observing a different request pattern and player architecture;
- accepts custom test streams/configurations;
- good second opinion when a case works in hls.js but behaves differently in a production-style player.

---

## How to use them

Do not assume one page is "the canonical test page".

Codex should inspect the current Downs capabilities and then choose whichever of the three sites best fits the thing being investigated.

Suggested decision rule:

```text
Need broad HLS/ABR/audio inspection?  -> hls.js demo
Need normal hosted-player sanity?      -> Wowza
Need commercial-player behavior?       -> Bitmovin
```

If one site changes, is temporarily broken, rate-limited, or no longer exposes a useful stream, move to another instead of bending the code around it.

---

## What we want to learn

Use these pages to answer questions such as:

- What playlist shapes does Downs see in practice?
- How often is the first detected URL a master vs a media playlist?
- Are fMP4/CMAF streams common in these players?
- How often is audio split into a separate rendition?
- Do query parameters propagate cleanly to child playlists and segments?
- Does the extension see duplicate playlist requests because of ABR/player retries?
- How should Downs group multiple detected URLs that are clearly part of one playback session?
- Which unsupported layout would unlock the most additional streams?
- Does the manager remain sane when the player changes quality while Downs is open?
- Are there cases where a stream is playable but extension-context fetch still differs from the player's successful request path?

Log observations rather than immediately coding around the first oddity.

---

## Current Downs status to preserve

Current main already has a working extension-only architecture with:

- HLS detection in the authenticated browser session;
- playlist inspection/classification;
- master/media handling;
- variant listing;
- conservative support gating;
- DIRECT MPEG-TS VOD path for the supported subset;
- JS remuxing to MP4;
- persistent Downs download manager;
- retained finished output and explicit Save to device;
- retry/cancel/history behavior;
- filename settings;
- Chrome desktop and Kiwi Android manual success on real sites.

Do not regress the working supported path just to chase one interesting demo-page edge case.

---

## Exploration pass before new format work

For each useful page/stream:

1. Start playback normally.
2. Open Downs.
3. Record what URLs were detected.
4. Inspect the master/media classification.
5. Record:
   - TS vs fMP4/CMAF;
   - muxed vs separate audio;
   - VOD/live/event;
   - codecs;
   - variant count;
   - any redirects/tokenized URLs;
   - whether DIRECT is currently allowed or rejected;
   - exact rejection reason.
6. If DIRECT is supported, complete a download and verify duration/audio/video.
7. If unsupported, do not immediately loosen the support gate. First decide whether the case represents a worthwhile next milestone.

A short findings note in the repo is useful if several patterns emerge.

---

## Candidate next milestones after exploration

Do not pre-commit to one of these. Pick based on what the playgrounds actually reveal.

Likely candidates:

### fMP4 / CMAF VOD

High value if most modern demos are using `EXT-X-MAP` + `.m4s`.

Questions to settle first:

- can existing fragments be assembled/remuxed without ffmpeg.wasm?
- what init-segment assumptions are safe?
- how should final MP4 metadata/duration be normalized?

### Separate audio/video renditions

High value if common masters expose `EXT-X-MEDIA:TYPE=AUDIO` with separate media playlists.

Questions:

- how to select the correct/default audio rendition;
- how to keep timestamps aligned;
- how to mux the tracks cleanly in JS;
- how to present language choices without bloating the popup.

### Better grouping/deduplication

If players generate many related playlist requests, consider grouping them as one logical playback session instead of showing a pile of near-duplicates.

### Request-context hardening

If the page plays correctly but extension-context fetch fails, investigate the specific browser request-context difference before touching muxing.

---

## Testing philosophy

Public playgrounds are exploratory targets, not permanent CI fixtures.

Do not write brittle automated tests that depend on these pages remaining unchanged.

Use them for manual/browser QA and discovery.

Keep deterministic local/unit fixtures for parser/downloader tests.

Public demos tell us what the wild looks like; local fixtures prove our code does not forget how to walk.

### Media test ground

Before drawing conclusions from player behavior, establish the local baseline:

```bash
node tools/serve-fixtures.js
```

Download and export the detected three-segment fixture through Downs, then run:

```bash
node tools/validate-media.js \
  --playlist tests/fixtures/mux-short.m3u8 \
  /path/to/exported-file.mp4
```

The development-only validator uses native FFprobe/FFmpeg to check finite and
consistent durations, H.264/AAC stream shape, decoded dimensions and frames,
non-regressing decode timestamps, and a complete error-free decode. It does not
add FFmpeg or a localhost dependency to the extension. The repeatable protocol,
public-player findings matrix, interpretation rules, and Kiwi-access command are
in `tests/playground.md`.

---

## Chrome + Kiwi

Where practical, repeat the most interesting case in both:

```text
Chrome desktop
Kiwi Android
```

A case that works only on desktop may expose a browser/API/lifetime/storage difference rather than an HLS-format problem.

Do not assume desktop findings automatically transfer to Kiwi.

---

# Beechan / Codex CLI prompt

```text
Read the whole repository first, especially README.md, handoff.md, the current extension detector/inspector, popup, download manager, downloader/remux code, tests and packaging scripts.

Current situation:

Downs is working end-to-end for its current supported DIRECT MPEG-TS VOD path, including the persistent manager. Before choosing the next format-support milestone, perform a real-world exploration pass against public HLS player/demo pages.

Use these three playgrounds:

1. https://hlsjs.video-dev.org/demo/
2. https://www.wowza.com/testplayers
3. https://bitmovin.com/demos/test-stream/

Choose whichever one best fits each test on the fly. Do not hard-code around one site and do not treat any of them as a stable automated test fixture.

Primary task:

- exercise Downs against realistic public HLS playback;
- inspect what playlist/request shapes are actually encountered;
- determine which unsupported layout is the highest-value next milestone;
- preserve the currently working DIRECT path and manager behavior.

For each useful case, record at least:

- master vs media;
- TS vs fMP4/CMAF;
- muxed vs separate audio;
- VOD/live/event;
- codecs and variants;
- whether URLs are tokenized or redirected;
- whether Downs supports or rejects the case;
- exact rejection/failure reason;
- whether the player can play while extension-context fetch fails;
- whether duplicate/ABR requests create confusing UI entries.

Do not loosen support gates merely to make a demo pass. First understand the layout and decide whether it deserves proper support.

After exploration, choose the next implementation target based on evidence. Likely candidates are:

- fMP4/CMAF VOD;
- separate audio/video rendition support;
- better detected-stream grouping/deduplication;
- request-context hardening.

If a clear winner emerges, implement it carefully and add deterministic local/unit fixtures for the new behavior. Do not make CI depend on the public demo sites.

Keep Chrome desktop and Kiwi Android in mind. If a useful case can be repeated in both, note any behavioral/API differences.

Update README.md only when behavior actually changes. Keep the extension small and failure messages explicit. No Python helper, localhost bridge, external FFmpeg, userscript or native companion app.

When done, summarize:

1. which of the three playgrounds were useful;
2. what HLS layouts were observed;
3. which cases Downs handled already;
4. which cases failed and why;
5. what next milestone you chose and why;
6. tests run;
7. anything Stan should manually verify in Chrome/Kiwi.
```
