# Downs handoff — seek-safe MP4 pass + future companion seam

## 2.9 implementation update

The decisive A/B test used one real 22:52 Downs output with 344 genuine
keyframes. Native FFmpeg stream-copy variants preserved identical encoded
audio/video. A fragmented, keyframe-aligned file with `mfra` did not improve VLC
seeking materially; a conventional flat MP4 was clean and responsive.

Downs 2.9 therefore implements a bounded in-browser defragmenter for the
existing DIRECT gates. It copies encoded `mdat` payloads unchanged, reads actual
`tfdt`/`tfhd`/`trun` sample metadata, drops fragmented-only boxes, builds
`stts`/`ctts`/`stsc`/`stsz`/`co64`/`stss` tables, derives per-track durations,
and appends a conventional `moov`. MPEG-TS still passes through mux.js first;
the separate fMP4 path uses its original samples after track-ID remapping.

The popup also offers an advanced **Source bundle** action. It creates a
`.downs-source.tar` job containing exact fetched TS segments or fMP4 init/media
fragments, normalized local playlists, and a JSON manifest with duration, size,
and SHA-256 data. Signed source URLs, cookies, and authorization values are not
stored. This is diagnostic export for supported DIRECT inputs, not the later
arbitrary CAPTURE/DUMP strategy.

Focused local evidence is green: both the existing 10-minute mux.js artifact
and the generated two-language split-fMP4 fixture became flat, fully decodable
MP4s with finite per-track durations; a generated source bundle was accepted by
standard `tar`. Physical Kiwi/VLC testing remains the important next gate.

The repository now includes `tools/replay-source-bundle.mjs` for deterministic,
offline reproduction from that diagnostic export. It validates TAR headers and
paths plus every manifest size and SHA-256, supports both current TS and split
fMP4 bundle layouts, and invokes the same bundled mux.js / flat-finalizer code
as Downs. A real 18-segment, 90-second split-fMP4 capture replayed to a valid
H.264/AAC MP4 with zero source-network access; FFprobe reported 90.090-second
video and 90.256-second audio tracks.

---

## Mission

Downs is now good enough that the next pass should improve **finished-file playback quality**, not add another format.

Current real-world symptom:

- exported MP4s usually play fine in VLC;
- starting playback or seeking to arbitrary positions can show a short black screen;
- the picture can then reconstruct strangely around moving subjects before the full image settles;
- once decoding catches up, playback is normal.

This strongly suggests a random-access / fragment-timeline / keyframe-indexing problem rather than ordinary pixel corruption.

The goal of this pass is to make the current JS DIRECT output more seek-friendly and better finalized, while preserving zero-reencode behavior.

At the same time, leave a clean seam for a future optional **native FFmpeg companion** on Android / Windows / macOS. Do not build the companion now.

---

## Preserve the current architecture

Keep working behavior intact:

- muxed MPEG-TS VOD path via bundled mux.js;
- separate H.264 + AAC fMP4/CMAF path;
- alternate audio selection;
- persistent Downloads manager;
- OPFS retention and explicit Save to device;
- request-context replay;
- conservative grouping;
- strict support gates;
- no mandatory external process, helper app, localhost bridge, or cloud service.

Do not broaden media support in this pass.

---

## Main investigation: why arbitrary seeking is ugly

Treat the visible VLC behavior as evidence, not as a foregone diagnosis.

Inspect the actual MP4 structure we currently emit and answer:

1. Are video fragment decode times (`tfdt`) preserved and monotonic?
2. Are `trun` sample durations / composition offsets / flags valid after assembly?
3. Do HLS segment boundaries actually begin on independently decodable video samples?
4. Are sync / keyframe sample flags preserved correctly?
5. Are we relying too heavily on accumulated `EXTINF` duration when real fragment timing says something else?
6. Is the current fragmented MP4 structurally valid but simply poorly indexed for random seeking?
7. Is mux.js producing streaming-friendly fragmented MP4 that needs a better finished-file finalization step?

Do not assume every playlist segment is a valid seek point.

If `#EXT-X-INDEPENDENT-SEGMENTS` is present, use it as useful evidence, not as a substitute for checking the actual video fragments when practical.

---

## fMP4/CMAF path: prefer real fragment timing

The current split-track path interleaves fragments by accumulated playlist duration.

Improve this if practical by reading the fragments themselves:

- parse `tfdt` base decode time;
- understand each track timescale;
- use actual decode timeline for ordering / sanity checks;
- detect regressions, large gaps, or obviously incompatible timelines;
- preserve original media timestamps whenever possible instead of inventing replacements.

The goal is not to rewrite the encoded samples. It is to produce a more truthful container around them.

---

## Keyframe / sync-sample awareness

For video fragments, inspect enough `traf` / `trun` / sample-flag metadata to determine whether a fragment begins with a sync sample when possible.

We want to know the difference between:

```text
fragment starts on IDR / sync frame
→ good random-access boundary
```

and

```text
fragment starts with predicted frames that need earlier references
→ poor seek boundary
```

Do not pretend to fix a non-independent GOP by changing metadata alone.

If the encoded source genuinely requires earlier reference frames, keep the media untouched and avoid falsely advertising that boundary as independently seekable.

---

## Finished-file finalization

Consider adding a bounded finalization step after all media has arrived.

Conceptually:

```text
download / remux fragments
        ↓
inspect actual fragment timelines + sync information
        ↓
normalize only container metadata that is demonstrably wrong/incomplete
        ↓
build / repair seek-friendly movie metadata or fragment index
        ↓
finish MP4
```

The exact implementation is up to Codex after inspecting the files.

Potentially relevant MP4 structures include:

- `tfdt`
- `trun`
- `tfhd`
- `mfhd`
- `sidx`
- movie / track durations
- sync-sample or equivalent fragmented-MP4 random-access signaling

Do not create decorative metadata that does not reflect the samples.

Prefer a small correct finalizer over a full home-grown MP4 authoring library.

---

## MPEG-TS → MP4 path

Inspect what mux.js emits for the current TS path as a **finished saved file**, not only whether VLC can play it linearly.

If mux.js output is valid but weak for arbitrary seeking, see whether a lightweight post-finalization step can improve it without re-encoding.

Do not replace mux.js just because a future FFmpeg path may exist.

The lightweight JS path remains valuable for Kiwi/mobile and simple supported media.

---

## Very useful diagnostic experiment

Before embedding any new heavy technology, compare one problematic Downs output with a native FFmpeg **stream-copy remux** during development.

Example idea only; choose the exact command after inspecting the file:

```text
problematic Downs MP4
        ↓
FFmpeg remux, copy video/audio, no re-encode
        ↓
seek again in VLC
```

Interpretation:

- if FFmpeg stream-copy output seeks cleanly, the encoded media is likely fine and our container/finalization is the problem;
- if FFmpeg stream-copy still shows the same reconstruction behavior, the source GOP/random-access structure may itself be the limitation;
- only re-encoding would then manufacture new keyframes, which is outside the normal DIRECT goal.

FFmpeg may be used as a development comparison tool in this pass. It is not a runtime dependency.

---

## Future FFmpeg companion: leave plumbing space only

Do **not** implement the companion yet.

But avoid hard-wiring the job model so tightly to the current JS worker that a future native backend becomes painful.

Think in terms of a portable processing job:

```text
Job
  source playlist(s)
  selected variant
  selected audio rendition
  sanitized request context
  filename
  processing mode
  output intent
```

Today:

```text
processing mode = js-direct
```

Future possibilities:

```text
auto
js-direct
native-ffmpeg
```

A future Downs Companion could exist on:

- Windows
- macOS
- Android
- maybe Linux

and use native FFmpeg for difficult remux/finalization jobs.

Important product principle:

> The extension must continue to work by itself for supported JS-direct cases.

The companion should be an optional compatibility/power backend, never a mandatory dependency for ordinary Downs use.

Do not add ffmpeg.wasm now unless a very strong reason appears. Native companion remains the more plausible heavyweight path later.

---

## UI / settings: minimal change

Do not expose a confusing `mux.js vs FFmpeg` selector now.

For this pass, keep current user-facing processing behavior essentially unchanged.

If an internal processing-mode field is introduced, default it to something future-proof such as:

```text
auto
```

with current AUTO resolving to the existing JS path.

No companion installation prompts yet.

---

## Success criteria

A good result for this pass is:

- linear playback remains correct;
- arbitrary seeking in VLC becomes noticeably cleaner where the source permits it;
- seeking no longer spends several seconds reconstructing a half-valid picture merely because our container metadata/indexing was weak;
- audio/video sync remains correct;
- no re-encoding is introduced;
- current Kiwi-compatible JS path remains lightweight;
- unsupported / non-independent media is reported truthfully rather than "fixed" with fake flags;
- code structure leaves a reasonable backend seam for future native FFmpeg work.

---

## Testing philosophy for this pass

Do not turn this into a testing cathedral.

Use a few focused checks where they buy confidence:

- keep existing unit tests green;
- add small parser/helper tests only for new MP4 timing / sync logic that is easy to isolate;
- use FFprobe/FFmpeg locally when useful to inspect one or two representative outputs;
- avoid building a huge synthetic compatibility matrix before the user has tried real files.

The user will do the important real-world playback / seeking tests.

Manual evidence matters most here:

```text
start playback
seek near beginning
seek middle
seek near end
repeat several arbitrary seeks
watch for black frames / partial reconstruction
check audio sync
```

Try both:

- one MPEG-TS-origin output;
- one separate fMP4 video + audio output.

If a change improves one path but regresses the other, keep them independently finalized rather than forcing one algorithm over both.

---

## Do not do in this pass

- no new HLS formats;
- no live/event support;
- no encryption work;
- no CAPTURE/DUMP work;
- no FFmpeg companion implementation;
- no ffmpeg.wasm bundle;
- no native messaging bridge yet;
- no re-encoding / forced keyframe generation;
- no major UI redesign;
- no excessive automated-browser test suite.

---

## Continuation prompt for Beechan / Codex CLI

```text
Read the current README.md, handoff.md, extension/fmp4-core.js,
extension/download-worker.js, extension/download-core.js, the job model, and the
current tests before changing anything.

The next pass is seek-safe MP4 finalization, not new format support.

Real-world symptom: Downs exports usually play linearly in VLC, but playback
startup and arbitrary seeking can briefly show black frames followed by a
partially reconstructed image that fills in around moving subjects until the
picture stabilizes. Treat this as a likely random-access / fragment timing /
keyframe-indexing issue, but verify rather than assuming.

Investigate current MP4 output structure. Pay particular attention to tfdt,
trun/tfhd sample timing and flags, sync/keyframe boundaries, mfhd sequence
numbers, sidx or other random-access metadata, and the fact that the split-fMP4
path currently interleaves using accumulated playlist EXTINF time.

Prefer actual fragment decode timing over playlist approximation where practical.
Preserve encoded H.264/AAC samples and do not re-encode. Do not fake sync flags
for fragments that genuinely depend on earlier reference frames.

If useful, compare one problematic exported MP4 with a native FFmpeg stream-copy
remux as a development diagnostic. FFmpeg is allowed as a local test tool only;
it must not become a runtime dependency in this pass.

Keep mux.js / the current JS path as the lightweight normal backend. Add a small
finished-file finalization layer if that is enough to improve seeking. Avoid
building a full MP4 framework if a bounded metadata/index fix solves the issue.

Also leave architectural room for a future optional Downs Companion using native
FFmpeg on Android / Windows / macOS. Do not build it now. If you touch job or
processing-mode plumbing, keep it backend-neutral enough that future modes such
as auto / js-direct / native-ffmpeg can fit without rewriting the manager.
Current AUTO should still resolve to the existing JS path.

Testing should stay proportionate. Keep the existing suite green and add only
small targeted tests for new pure MP4 helpers. Do not spend the pass building a
large synthetic QA matrix; the user will do real-world VLC seeking tests.

Preserve current format gates, manager behavior, OPFS retention, Kiwi
compatibility, alternate audio selection, request-context behavior, and export
flow.
```
