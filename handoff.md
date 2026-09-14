# Downs handoff — 2.8 focused GUI polish

## Current state

Downs is a dependency-free Manifest V3 extension that detects HLS traffic,
inspects playlists, and locally assembles a strictly bounded set of VOD layouts
into MP4. The normal path has no localhost bridge, native companion, upload
service, or external FFmpeg dependency.

Version **2.8.0** is the first deliberately narrow interface-polish pass over
the working 2.7 media core. It does not expand format support.

Preserve:

- muxed MPEG-TS VOD DIRECT downloads;
- separate H.264 video + AAC audio fMP4/CMAF VOD downloads;
- alternate-audio selection;
- strict encryption, layout, timeline, and codec gates;
- conservative playback grouping and sanitized Referer-origin replay;
- the persistent Downloads manager, OPFS retention, export, retry, cancel, and
  failure-detail behavior.

## What 2.8 changes

### Human-first stream rows

Primary detected rows now use the active page title when available. Their
secondary line defaults to a query-free host/path summary such as:

```text
Example Player · Episode 12
HLS · cdn.example.com/live/master.m3u8
```

After a playlist is explicitly inspected, the row can show facts actually
returned by the parser, for example:

```text
Master · 3 variants · 3 audio tracks
```

Do not auto-fetch every detected playlist merely to improve labels. Do not
invent resolution, codec, variant, audio, support, or media-type metadata before
inspection.

### Optional complete URLs

An inspected playlist has a collapsed **Technical details** disclosure. It
contains the complete final URL, **Copy URL**, playlist/request facts, and auth
presence indicators. Unsupported reasons remain visible outside the disclosure.

Downloads → Settings also offers **Show full URLs in stream list**. It is stored
beside the filename preference, takes effect immediately, and does not overwrite
the filename mode. Full URLs remain available in Technical details regardless of
the setting.

Long-press is not the only route to technical data: it is hard to discover,
has no desktop equivalent, and can collide with Kiwi's context menu.

### Truthful status hierarchy

The inspector renders subdued chips from already-known parser/support results:

```text
[VOD] [fMP4 / CMAF] [Split A/V] [3 audio tracks] [Supported]
```

The detailed grid is still available. Supported media receives a clear action
block:

```text
Ready to download
VOD · fMP4 / CMAF · separate audio · Japanese

[ Download 1080p ]
```

The existing support result supplies this text. The popup does not create a
second support policy.

### Downloads handoff

The popup entry reports exact useful state:

```text
Downloads
1 active · 2 ready to save
```

The popup already changed the action text while queueing, but focusing a new
browser tab closes a popup before a success message can reliably be read. The
manager therefore shows **Added to Downloads · filename.mp4** and briefly
highlights the new row. This works both when the manager is newly opened and
when an existing manager tab receives a new stored job.

## Deliberately deferred

Do not fold these into the 2.8 pass:

- editable filename before queueing — filename generation currently belongs to
  the background job-creation boundary and deserves its own tested override
  path;
- whole-row manager tapping — mobile action buttons are already 44px and a
  row-wide target may cause accidental expansion while scrolling;
- dark mode — convert both popup and manager colors coherently in a separate
  pass after the hierarchy settles;
- removal of the version footer — it remains useful while Kiwi installs
  development archives beside older copies;
- any new media format, byte-range, live/event, codec, CAPTURE, or DUMP support.

## Current DIRECT layouts

### MPEG-TS VOD

- finite playlist with `EXT-X-ENDLIST`;
- muxed H.264 video and AAC audio;
- no encryption, byte ranges, discontinuities, gaps, or iframe-only layout;
- JavaScript remux through the bundled mux.js MP4 build;
- finite MP4 movie and track durations patched into output.

### Separate-track fMP4/CMAF VOD

- one finite clear H.264 video playlist and one finite clear AAC audio playlist;
- exactly one full `EXT-X-MAP` per track;
- no byte-range init/media segments, multiple maps, encryption,
  discontinuities, gaps, or live/event input;
- playlist durations differ by no more than two seconds;
- initialization metadata verifies one H.264 video track and one AAC audio
  track before assembly;
- audio track IDs are remapped when required and fragments are interleaved by
  playlist time without re-encoding.

## Verification for the 2.8 slice

The deterministic popup preview exercises:

- default compact rows and parsed summaries;
- master → 1080p variant inspection;
- alternate-audio choice;
- VOD/container/layout/audio/support chips;
- collapsed and expanded Technical details;
- complete URL copying;
- Ready and Added states;
- the full-URL row preference;
- exact 420×640 and 320×640 viewport widths with no horizontal overflow.

The real unpacked extension manager is exercised in Chrome-for-Testing at
900px and 360px for:

- new-job confirmation and row highlight;
- settings drawer/sheet layout;
- persistence of `showFullUrls` without losing the current filename mode;
- zero horizontal overflow and no relevant console errors.

Browser plugin support was unavailable for this pass, so regular Playwright was
used with the already-installed Chrome-for-Testing binary. Screenshots and
temporary QA scripts were kept outside the repository and removed after review.

Run the release checks:

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
python3 tools/package_extensions.py
unzip -t dist/downs-chromium.zip
unzip -t dist/downs-firefox.zip
git diff --check
```

## Manual testing priority

The next useful evidence is not another speculative feature:

1. keep testing supported real-world downloads and record exact failures;
2. load the 2.8 Chromium archive in physical Kiwi;
3. verify compact rows, related-playlist expansion, Technical details, Copy URL,
   audio selection, Ready state, manager confirmation, export, and the full-URL
   preference;
4. check that long page titles and signed URLs remain usable at phone width;
5. retain precise rejection reasons for unsupported streams.

After that evidence, take one bounded follow-up at a time. Dark mode is the
best visual candidate; editable filenames should be a separate state-flow pass.

## Kiwi packaging note

```bash
python3 tools/package_extensions.py
adb push dist/downs-chromium.zip \
  /storage/emulated/0/Documents/codex/downs-chromium-2.8.0.zip
```

Kiwi may install a development ZIP beside older Downs builds with a different
extension ID. Disable old copies while testing rather than assuming an upgrade.

## Continuation prompt

```text
Read README.md, handoff.md, tests/playground.md, and
tests/playground-findings.md before changing behavior.

Downs 2.8 is a focused hierarchy pass over the working 2.7 media core. Preserve
all current DIRECT support gates, request-context behavior, grouping, alternate
audio, manager, storage, and export behavior.

Prioritize real-world download evidence and physical Kiwi verification. Do not
auto-fetch detected playlists just to label them and never invent unparsed
metadata. Keep complete URLs available through Technical details, Copy URL, and
the optional full-URL stream-list setting.

Treat dark mode, editable preflight filenames, and broader manager-row
interaction as separate future passes. Do not combine UI work with new media
format support.
```
