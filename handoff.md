# Downs handoff — 2.7

## Where the project stands

Downs is a dependency-free Manifest V3 browser extension that detects HLS
traffic in the active browser tab, inspects playlists, and locally assembles a
strictly bounded set of VOD layouts into MP4. The normal path has no Python
helper, localhost bridge, external FFmpeg, native companion, or upload service.

The current version is **2.7.0**. It combines the 2.6 separate-track fMP4
implementation with the 2.7 alternate-audio UI.

## Supported DIRECT layouts

### MPEG-TS VOD

- finite playlist with `EXT-X-ENDLIST`;
- muxed H.264 video and AAC audio;
- no encryption, byte ranges, discontinuities, gaps, or iframe-only layout;
- JavaScript remux through the bundled mux.js MP4 build;
- finite MP4 movie and track durations patched into the output.

### Separate-track fMP4/CMAF VOD

- one finite, clear H.264 video playlist and one finite, clear AAC audio
  playlist;
- exactly one full `EXT-X-MAP` per track;
- no byte-range init or media segments, multiple maps, encryption,
  discontinuities, gaps, or live/event input;
- playlist durations must differ by no more than two seconds;
- init metadata is checked for exactly one H.264 video track and one AAC audio
  track before assembly;
- audio track IDs are remapped when necessary and existing CMAF fragments are
  interleaved by playlist time without re-encoding.

The master playlist's default rendition is selected initially. In 2.7, an
inspected video variant shows a compact **Audio** selector when its referenced
group has more than one playable rendition URL. The explicit selection and
human-readable label are stored in the job.

## Manager and request behavior

- supported downloads become persistent jobs in a dedicated Downloads tab;
- OPFS is preferred, with a bounded 256 MiB memory fallback;
- finished private output is retained for **Save to device** / **Save again**
  until deletion or history pruning;
- jobs support progress, cancel, retry, failure details, and a 30-job history;
- filename settings offer suggested title, local date stamp, or a random
  ten-character ID;
- related master, variant, audio, ABR, and token-refresh detections are grouped
  conservatively while every URL remains inspectable;
- a sanitized player-page origin can be replayed temporarily as Referer for an
  exact extension fetch; cookie and authorization values are never replayed;
- temporary request-header rules are removed in `finally` and stale reserved
  rules are cleared at worker startup.

## Deliberate limits

Do not loosen gates merely to make one site pass. Downs still rejects:

- live and event playlists;
- DRM, SAMPLE-AES, and ordinary AES-128 encryption;
- multiplexed fMP4;
- byte-range media or init segments;
- multiple init-map periods and discontinuities;
- non-H.264 video or non-AAC audio;
- split tracks whose playlist durations differ by more than two seconds.

CAPTURE and DUMP remain separate future strategies. DIRECT must not silently
fall back to either.

## Verification evidence

### Automated

```bash
node --test tests/*.test.js
node --check extension/audio-core.js
node --check extension/hls-parser.js
node --check extension/download-core.js
node --check extension/download-worker.js
node --check extension/fmp4-core.js
node --check extension/job-core.js
node --check extension/popup.js
node tools/validate-extension.mjs
python3 tools/package_extensions.py
unzip -t dist/downs-chromium.zip
unzip -t dist/downs-firefox.zip
```

The 2.7 release pass has 50 passing Node tests. Packaging and both manifests
validate successfully.

### Deterministic media fixture

```bash
tools/generate-modern-fixture.sh
node tools/serve-fixtures.js
# open http://127.0.0.1:8765/modern-page.html
```

The generated 12-second fixture contains:

- one 320×180 H.264 video track;
- default English AAC at 440 Hz;
- alternate Japanese AAC at 880 Hz.

Desktop Chromium and Kiwi 137 on the Pixel both selected Japanese and exported
556,365-byte MP4s. Both passed `tools/validate-media.js` at 12.021 seconds with
360 video frames and a clean full decode. Their decoded-audio MD5 exactly
matched the Japanese playlist (`6e54481556bf7c7f268781b65d2f7218`), while
English differed (`d929d4078926b765897715cd11b1bffa`).

The static popup interaction also passed at 420×640 and 320×640 with no
horizontal overflow or relevant console errors. Kiwi used its native choice
sheet and updated the download explanation after the selection.

### Public exploratory evidence

Shaka Angel One's 144p/default-English fMP4 pair produced a 1,721,844-byte MP4:
60.000 seconds, H.264 192×144, stereo AAC 48 kHz, 1,500 frames, zero video or
audio DTS regressions, and clean decode. Public media is not a CI dependency.

Earlier hls.js, Wowza, Bitmovin, request-context, grouping, and Kiwi findings
are recorded chronologically in `tests/playground-findings.md`.

## Kiwi packaging note

Build and beam the Chromium archive with:

```bash
python3 tools/package_extensions.py
adb push dist/downs-chromium.zip \
  /storage/emulated/0/Documents/codex/downs-chromium-2.7.0.zip
```

Kiwi may install each development zip beside the prior build under a new
extension ID rather than upgrading it. Disable the older Downs copies during
testing instead of assuming the newest one replaced them. At the end of the
2.7 pass only the corrected 2.7 build was enabled; older 2.5, 2.6, and the
superseded 2.7 test install were left disabled rather than deleted.

## Best next pass

Prefer evidence gathering before another format expansion:

1. sample more clear fMP4 VOD masters and record which strict check rejects
   each unsupported case;
2. stress OPFS and cancellation with a substantially larger supported VOD;
3. repeat the current popup, alternate-audio, manager, and export flow in the
   experimental Firefox package, especially on macOS High Sierra;
4. only then choose the next bounded format milestone, likely multiplexed fMP4
   or a narrowly defined byte-range layout.

Keep public sites exploratory and add deterministic fixtures for every behavior
that becomes supported.

## Continuation prompt

```text
Read README.md, handoff.md, tests/playground.md, and
tests/playground-findings.md before changing behavior.

Downs 2.7 supports bounded muxed MPEG-TS VOD and separate H.264/AAC fMP4 VOD,
including alternate audio selection. Preserve the working manager, request
context, grouping, output-duration, and strict format-gate behavior.

Perform a compatibility/stress pass against clear fMP4 VOD. Record exact
playlist shapes and rejection reasons before changing support. Keep public
players exploratory; any implementation must receive deterministic local/unit
coverage and complete exported-media validation. Repeat meaningful UI or
storage behavior in Chrome desktop and Kiwi where practical. Firefox remains
experimental and needs explicit verification.
```
