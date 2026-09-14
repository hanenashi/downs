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
