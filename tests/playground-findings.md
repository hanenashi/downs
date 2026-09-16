# Downs playground findings

Raw exported media and validator JSON stay in the ignored `test-artifacts/`
directory. Public URLs below had no signed query values at test time.

## 2026-09-14 — Kiwi baseline and public-player pass

Device/browser: Pixel 10a, Android 17, Kiwi 137.0.7337.0, Downs 2.3.

| Case | Player/source | Observed layout | Downs result | Output validation | Notes |
|---|---|---|---|---|---|
| kiwi-local-001 | Local `mux-short.m3u8` | Media; MPEG-TS; muxed H.264/AAC; VOD; 3 × 10 s | DIRECT success; 858,403-byte MP4 | PASS: 30.000136 s; 900 video frames; 646 audio packets; zero DTS regressions; clean decode | Phone and Beechan SHA-256 matched. |
| kiwi-hlsjs-mux-001 | hls.js 1.7.3; Mux Big Buck Bunny | Master → 5 MPEG-TS H.264/AAC muxed VOD variants; 64 segments in tested 184p variant | DIRECT success; 19,929,808-byte MP4 | PASS: playlist 634.634 s, container 634.634014 s; 19,039 video frames; 13,656 audio packets; zero DTS regressions; clean decode | No redirects or tokenized URLs observed. Playback produced master, 720p, then 1080p detections as ABR changed quality. |
| kiwi-hlsjs-angel-001 | hls.js 1.7.3; Shaka Angel One | Master → 5 fMP4/CMAF H.264 video variants; 6 separate AAC audio renditions; 4 subtitle renditions; VOD | Correctly rejected: `This playlist uses separate audio tracks.` | Not downloaded | Inspecting the 144p child showed fMP4/CMAF and `EXT-X-MAP`. No redirects or tokenized URLs observed. |
| kiwi-wowza-bbc-001 | Wowza Test Player default; BBC Testcard | Master → 6 fMP4/CMAF live video variants; 6 separate AAC audio renditions; subtitles | Correctly rejected direct video playlist: `This playlist has no EXT-X-ENDLIST. Live and event downloads are not supported yet.` | Not downloaded | The player requested master, video, audio, and subtitle playlists. `EXT-X-MAP` was present. |
| kiwi-wowza-mux-001 | Wowza Test Player with Mux Big Buck Bunny URL | Same 5-variant muxed MPEG-TS VOD used in `kiwi-hlsjs-mux-001` | Inspection succeeded; no second download needed | Covered by `kiwi-hlsjs-mux-001` | The tab accumulated 7 entries: 4 from Wowza's default live source plus Mux master and two ABR-selected children. |
| kiwi-bitmovin-default-001 | Bitmovin Test Your Stream default HLS | Player requested master, separate 1080p video, and stereo audio playlists; 210 s VOD | Detection succeeded; inspection failed with HTTP 403 while the page continued playback | Not downloaded | Plain request, Origin, and browser-like UA returned 403; adding `Referer: https://bitmovin.com/` returned 200. This strongly indicates request-context gating. |

## Early signal

The supported MPEG-TS path is healthy in both the short controlled case and a
complete 10:34 public VOD. The earlier huge-duration reports are therefore not
reproduced as a general remux defect.

Detection grouping is already a concrete UX issue: one hls.js tab showed the
Mux master plus two ABR-selected media playlists, then accumulated five Angel
One playlists after the demo switched sources, for eight entries total. They
were technically accurate but represented only two playback sessions.

The conventional Wowza case confirms that separate fMP4 audio/video is common,
but implementing it correctly requires track selection, timestamp alignment,
and muxing work. Bitmovin provides a narrower, directly reproduced failure: the
page can play a public HLS stream that extension-context fetch cannot inspect,
and the response changes from 403 to 200 when the page Referer is supplied.

Based on this pass, request-context hardening is the best next implementation
milestone. Better grouping/deduplication is the second choice because two of the
three public pages accumulated several technically related entries. fMP4 plus
separate audio remains valuable but is a larger format milestone and should not
be attempted by weakening the current support gate.

## 2026-09-14 — Request-context implementation pass

Device testing was intentionally skipped for this pass. Downs 2.4 now reduces a
detected Referer to its HTTP(S) origin and replays that origin only on the
extension's exact playlist or segment URL. Each browser session rule exists only
around its corresponding fetch and is removed afterward. Cookie and
authorization values are still neither captured nor replayed, and observed
Origin headers are no longer retained.

The deterministic local fixture reproduced the public Bitmovin shape in desktop
Chromium: extension inspection returned HTTP 403 without request context and
HTTP 200 with the captured origin. The successful response parsed as a
three-segment MPEG-TS media playlist. A complete queued download then reached
`done` with all three segments, and the reserved session-rule set was empty
afterward. No public demo is part of the automated suite.

The next evidence-backed milestone is grouping the related master, child
variant, audio, and ABR retry detections that currently appear as separate rows.

## 2026-09-14 — Grouping implementation pass

Downs 2.5 groups detected playlist URLs conservatively when they share a CDN
host and a meaningful directory family. A same-page, same-host eight-second
startup window covers generic layouts such as `/live/master.m3u8` plus
`/live/1080.m3u8`; same-path token refreshes also stay together. Different hosts
remain separate. This deliberately favors an occasional extra group over hiding
unrelated videos together.

The primary row prefers master/manifest/index filenames and shallower paths.
Related URLs are collapsed behind an explicit count and remain individually
inspectable. Deterministic examples cover the observed Mux ABR shape, switched
sources, separate hosts, generic startup bursts, and token refreshes.

Rendered desktop Chromium QA at 420×640 and 320×640 showed five fixture
playlists as two playbacks. Expanding the primary exposed all three related
children; selecting the 1080p child opened the normal media inspector and
Download action. Both widths had zero horizontal overflow and no page or console
errors. No ADB/device test was performed in this pass.

## 2026-09-14 — Separate fMP4/CMAF implementation pass

Downs 2.6 adds a deliberately bounded modern DIRECT layout: a finite,
unencrypted fMP4 video playlist with exactly one init map plus the selected
master variant's default finite, unencrypted fMP4 audio rendition. Actual init
metadata must contain one H.264 video track and one AAC audio track. Downs
combines the init metadata, assigns the audio track a non-colliding ID, rewrites
fragment track IDs and sequence numbers, and interleaves fragments by playlist
time without re-encoding.

The generated local fixture produced 6 video and 7 audio fragments. The complete
extension worker assembled and exported a 556,365-byte MP4: container 12.021333
seconds against 12.000 expected, H.264 320×180, AAC mono 48 kHz, 360 video
frames, zero video/audio DTS regressions, and a clean full decode.

The public Shaka Angel One fixture then exercised the same path with 15 video
and 15 default-English audio fragments. Its 1,721,844-byte export passed:
container and expected duration 60.000 seconds, H.264 192×144, stereo AAC 48
kHz, 1,500 video frames, zero DTS regressions for both tracks, and clean full
decode. The public URL remains exploratory rather than an automated dependency.

At the 2.6 milestone, the intentional limits were default audio only,
H.264/AAC only, one init map per track, at most two seconds of
playlist-duration difference, and no byte ranges, encryption, discontinuities,
gaps, or live/event playlists. Version 2.7 removes only the default-audio limit.

The generated fixture was also exercised through the physical Pixel 10a on
Kiwi 137.0.7337.0. Kiwi detected the master, displayed the split audio, enabled
the 180p action, completed the private job, and exported it through **Save to
device**. The ADB-pulled output was 556,365 bytes and passed the same native
validator: 12.021 seconds against 12.000 expected, H.264 320×180, AAC, 360
frames, and a clean full decode. Kiwi installed the 2.6 zip beside the existing
2.5 development build under a new extension ID; the old copy was disabled, not
deleted, for the test.

## 2026-09-15 — Alternate audio selection pass

Downs 2.7 adds a compact selector inside an inspected video variant when its
master audio group contains multiple playable rendition URLs. It prefers the
declared default but queues the explicitly chosen URL and label. Generic names
such as `audio_1` fall back to a localized language label.

The deterministic fixture now produces English 440 Hz and Japanese 880 Hz AAC
tracks. Desktop Chromium and Kiwi 137 each selected Japanese and exported a
556,365-byte MP4. Both files passed the normal validator at 12.021 seconds,
H.264 320×180, AAC, 360 frames, and clean full decode. Their decoded-audio MD5
was `6e54481556bf7c7f268781b65d2f7218`, exactly matching the Japanese playlist;
English was `d929d4078926b765897715cd11b1bffa`.

Static Chromium UI checks at 420×640 and 320×640 confirmed the default choice,
selection change, queued audio URL and label, and zero horizontal overflow or
console errors. On Kiwi, the selector opened the native Android choice sheet,
updated the explanatory copy to Japanese, and completed the same export path.

## 2026-09-15 — Focused GUI hierarchy pass

Downs 2.8 keeps the 2.7 media behavior and changes only presentation/state
feedback. Detected rows default to the active page title plus a query-free
host/path summary; parsed master/media facts appear only after explicit
inspection. Complete URLs remain accessible through collapsed Technical details
with Copy URL and through the persistent full-URL stream-list setting.

Regular Playwright used the installed Chrome-for-Testing binary because the
Browser plugin was unavailable. The popup passed its master → 1080p variant →
alternate audio → Ready → Added flow at 420×640 and 320×640, including chip
wrapping, URL copy, both compact/full URL modes, zero horizontal overflow, and
no console errors. The real unpacked extension manager passed at 900px and
360px: a newly stored job showed the confirmation banner and row highlight, and
the full-URL preference persisted without replacing the selected filename mode.

Physical Kiwi verification of the 2.8 hierarchy is intentionally pending while
real-world download testing continues. The prior 2.7 media/export evidence still
defines the current phone baseline.

## 2026-09-16 — Flat finalization and source diagnostics

A real 22:52 Downs MP4 contained 271 video fragments, 344 correctly flagged
keyframes, monotonic timing apart from harmless one-tick rounding, and no global
seek table. An FFmpeg fragmented stream-copy with `mfra` behaved much like the
original in VLC; a flat stream-copy was clean and responsive. Both retained
identical encoded audio/video hashes.

The 2.9 writer consequently copies media payloads unchanged and emits ordinary
flat MP4 sample tables. The existing 10-minute mux.js artifact passed FFprobe
and full video decode after conversion. The generated separate H.264/AAC
fixture likewise reported 12.000-second video and 12.021-second audio and passed
full decode. The new exact-input diagnostic TAR helper was also accepted by the
system `tar` reader. Real Kiwi exports and VLC seeking remain intentionally
delegated to the user's live pass.
