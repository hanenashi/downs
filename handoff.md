# Downs handoff — seek-safe MP4 pass + future companion seam

## 2.17 simple workflow + persistent manager surfaces

Settings now separate interface density from manager placement. **Simple** mode
keeps the detected-stream list and essential job controls, hides diagnostic
inspection/source-bundle UI, automatically chooses the highest advertised video
rendition, and queues its MP4 when that child passes the normal support gates.
**Detailed** mode preserves the existing inspection-first workflow and every
diagnostic action.

The Downloads page can open in a reused 460×720 compact browser window or a
normal browser tab. It remains the persistent owner of the media worker; the
transient toolbar popup never owns active processing. When the configured
surface changes, the existing manager tab is moved between window types rather
than reloaded, preserving active work. Existing installs default to the prior
detailed/tab behavior when either preference is absent.

Chrome-for-Testing 156 verified both settings, the compact 460×720 window, and
moving the same live Downloads page back into a normal browser window. All 82
unit tests and the packaged-file validator remain green. Real Kiwi and Firefox
interaction remains the compatibility gate for this UI pass.

## 2.16 AV1 parity for separate fMP4 tracks

The existing finite clear separate-track fMP4 worker now accepts either H.264
or AV1 video initialization metadata with AAC audio. This applies to both HLS
split renditions and the bounded static DASH path; track combination, fragment
remapping, flat finalization, timing checks, and source bundles remain unchanged.
Other video/audio codecs and all existing live, encryption, range, map-change,
and timeline rejection gates stay in place.

Chrome-for-Testing 156 completed the generated six-second AV1/AAC-LC DASH
fixture through inspection, queueing, the common split-fMP4 worker, flat
finalization, and OPFS at 420×640. The 155,366-byte result contained 150 AV1
frames at 320×180 and 283 mono AAC frames at 48 kHz. Video lasted 6.000 seconds,
audio 6.021 seconds, and a full FFmpeg decode completed without errors.

## 2.15 DASH source-bundle parity

Supported static DASH selections now expose the same optional **Source bundle**
action as HLS. A DASH diagnostic job refetches and revalidates the selected
representation IDs, preserves both initialization segments and every selected
media fragment byte-for-byte, and writes local video/audio playlists plus size
and SHA-256 metadata. Remote MPD URLs, cookies, authorization values, and signed
media URLs are not stored in the archive.

`tools/replay-source-bundle.mjs` accepts the resulting
`direct-dash-fmp4-vod` manifest and rebuilds it through the existing split-track
combiner and flat finalizer without contacting the source host. The ordinary
DASH MP4 action and its strict static, clear codec gates were unchanged in that
pass; 2.16 later adds AV1 video parity without changing the layout gates.

Chrome-for-Testing 156 completed the generated six-second DASH fixture through
the new popup action, persistent manager, OPFS TAR, archive validation, and
offline replay at 420×640. The 272,384-byte bundle held two local playlists,
two init segments, seven exact media fragments, and manifest hashes. Replay
produced the same 256,938-byte MP4 as the direct path: 150 H.264 frames, 283 AAC
frames, 6.08-second container duration, and a clean full decode.

## 2.14 bounded muxed HLS/CMAF DIRECT update

Downs now accepts a second narrow HLS fMP4 shape: finite, clear VOD with one
`EXT-X-MAP`, no byte ranges, gaps, discontinuities, or map changes, and a shared
initialization segment containing exactly one H.264 or AV1 video track plus one
AAC-LC audio track. The encoded samples are copied without transcoding.

The flat-MP4 finalizer now indexes multiple `traf` boxes and multiple explicit
`trun` sample runs inside one movie fragment. It requires complex fragments to
use the movie fragment as their data-offset base, validates complete non-
overlapping coverage of each `mdat`, and maintains independent per-track decode
timelines and chunk tables. Ambiguous bases, implicit offsets, payload gaps or
overlaps, unknown tracks, and timing regressions fail explicitly. Source bundles
preserve the shared init plus exact `.m4s` fragments and a local playlist.

Chrome-for-Testing 156 completed the generated six-second H.264/AAC fixture
through popup, queue, worker, OPFS, and offline source-bundle replay. The
256,787-byte output contained 150 video frames plus 283 audio frames and fully
decoded without errors. The reported real 144p AV1/AAC specimen also completed
through the packaged extension: 146 fragments, 6,901,421 bytes, 583.648 seconds,
14,007 AV1 frames, 27,359 AAC frames, and a clean full decode.

## 2.13 bounded DASH fMP4 DIRECT update

Downs now materializes inherited DASH SegmentTemplate metadata into bounded
initialization and media URLs. The first DIRECT gate accepts one zero-based
static Period with finite duration, clear separate H.264 video and AAC-LC audio
fMP4 representations, HTTP(S) media, and either a finite SegmentTimeline or a
fixed segment duration. It resolves `$RepresentationID$`, `$Bandwidth$`,
formatted `$Number$`, `$Time$`, BaseURL inheritance, startNumber, timescale,
and presentationTimeOffset. It rejects dynamic/live MPDs, DRM/CENC, HE-AAC,
open-ended repeats, gaps/regressions, SegmentList/Base, multiple Periods, and
non-HTTP media.

The popup exposes video/audio representation selectors only when the pair
passes those gates. Jobs persist the MPD URL and representation IDs, refetch and
revalidate on Retry, verify actual initialization tracks, then reuse the
existing split-fMP4 combiner and flat-MP4 finalizer. The later 2.15 pass adds
offline source bundles without widening these download gates.

Chrome-for-Testing 156 completed the generated six-second SegmentTimeline
fixture through detection, popup, queue, worker, and OPFS. The 256,938-byte
output contained 150 H.264 frames at 320×180 plus AAC and fully decoded without
errors. A public DASH-IF ten-second fixed-duration AAC-LC vector also completed:
1,311,935 bytes, 240 H.264 frames at 640×360, synchronized AAC, and clean full
decode. A separate DASH-IF HE-AAC vector exposed non-monotonic audio behavior
and is now deliberately rejected rather than overclaimed.

## 2.12.2 probed-container worker handoff

The 2.12.1 inspector correctly identified suffix-disguised MPEG-TS and queued a
supported job, but the download worker independently reparsed the playlist and
lost that byte-probe decision. It then failed before fetching segments with
`container: This milestone supports MPEG-TS segments only.` The worker and
source-bundle path now restore the persisted `direct-ts-vod` decision when the
fresh playlist still has an unknown suffix. Existing 2.12.1 failed jobs can use
**Retry** after the extension is updated; they do not need to be recreated.

## 2.12.1 full Referer compatibility fix

Downs previously reduced every observed Referer to its origin before replaying
extension fetches. Some media hosts gate a selected variant on the player page
path, so an otherwise valid child playlist could return HTTP 403. Request
context now preserves the exact HTTP(S) Referer the browser originally sent,
while removing credentials and fragments and bounding its length, and replays
its matching Origin. Downs still does not synthesize provenance when no Referer
was observed, and temporary rules remain limited to one exact
extension-initiated target URL. The reported 720p child returned HTTP 403 with
the full Referer alone and HTTP 200 when the matching Origin was also present.
That child disguises MPEG-TS segments with `.jpeg` names and an image content
type. For otherwise bounded, clear media playlists whose suffix is unknown,
Downs now performs one 376-byte ranged probe and requires MPEG-TS sync bytes at
both packet boundaries before enabling the existing TS DIRECT path.

## 2.12 AES-128 MPEG-TS DIRECT update

Downs now accepts one deliberately narrow encrypted layout: finite, muxed
MPEG-TS VOD using HLS whole-segment `METHOD=AES-128` with identity-format
16-byte keys. The parser carries media-sequence numbers and per-segment key
state; the DIRECT gate validates explicit or sequence-derived IVs and permits
key rotation. SAMPLE-AES, DRM, encrypted fMP4, byte ranges, and other key
formats remain rejected.

The worker fetches keys through the existing authorized request context,
imports them as non-extractable Web Crypto AES-CBC keys, clears the raw key
buffers, decrypts each segment in memory, and passes only plaintext MPEG-TS to
the established mux.js and flat-MP4 finalizer. Keys are never persisted.
Encrypted source bundles are disabled so diagnostics cannot accidentally omit
or expose the material required to replay their ciphertext.

A deterministic three-segment fixture covers explicit IV, implicit
media-sequence IV, and key rotation. Chrome-for-Testing 156 completed the real
extension flow at 420px. The resulting 257,699-byte MP4 was 6.08 seconds with
150 H.264 frames at 320×180 plus AAC audio, and FFmpeg's full decode was clean.
Unit tests cover IV derivation, Web Crypto round-trip decryption, metadata
validation, parser key state, and the DIRECT gate. Real-site Kiwi and Firefox
validation remain the next compatibility gate.

## 2.11 DASH inspection update

Downs now detects `.mpd`, `application/dash+xml`, and DVB DASH-playlist response
types through the existing network observer. A dependency-free bounded parser
rejects DOCTYPE/ENTITY declarations and malformed XML, then summarizes static
versus dynamic presentation, duration, periods, inherited BaseURLs, video/audio
representations, codecs, ContentProtection, and SegmentTemplate/Timeline,
SegmentList, or SegmentBase addressing.

At the 2.11 milestone the popup labeled all DASH results **Inspection only** and
never rendered download actions. A deterministic static MPD passed
Chrome-for-Testing 156 at 420px and 320px with clean consoles. The later 2.13
pass widened only the explicitly documented static fMP4 subset above; all
other MPDs retain the 2.11 inspection behavior.

## 2.10 Blob playlist discovery update

Downs now observes page-created Blobs only when they declare one of the standard
HLS MIME types. A document-start MAIN-world proxy preserves native Blob instances
and passes bounded text to an isolated content-script bridge. The bridge and
background both require an HTTP(S) base, a valid `#EXTM3U` header, and no more
than 512 KiB. Exact duplicates are folded together and at most ten inline
playlists are retained per tab.

The popup labels provenance explicitly and parses relative references against
the creating frame's base URL. Inline media playlists remain inspection-only;
normal network child playlists from an inline master return to the established
URL-based inspection/download path. The existing DIRECT worker, request-context
rules, finalizer, and source-bundle logic are unchanged.

The deterministic fixture passed Chrome-for-Testing 156 at 420×640: one typed
playlist was detected, its `text/plain` lookalike was ignored, the inspection
showed the intentional unsupported reason, horizontal overflow was absent, and
the page/popup console was clean. Physical Kiwi and Firefox testing remains.

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
- separate H.264-or-AV1 + AAC fMP4/CMAF path;
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
Preserve encoded H.264/AV1/AAC samples and do not re-encode. Do not fake sync flags
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
