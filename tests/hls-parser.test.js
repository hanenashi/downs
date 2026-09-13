const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAttributeList, parsePlaylist } = require("../extension/hls-parser.js");

test("parses quoted attribute lists without splitting codec commas", () => {
  const attributes = parseAttributeList(
    'BANDWIDTH=5800000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"'
  );

  assert.equal(attributes.BANDWIDTH, "5800000");
  assert.equal(attributes.RESOLUTION, "1920x1080");
  assert.equal(attributes.CODECS, "avc1.640028,mp4a.40.2");
});

test("classifies a master playlist and resolves tokenized relative variants", () => {
  const playlist = parsePlaylist(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5800000,AVERAGE-BANDWIDTH=5100000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="main"
video/1080.m3u8?token=abc
#EXT-X-STREAM-INF:BANDWIDTH=3100000,RESOLUTION=1280x720
https://media.example.net/720.m3u8?token=def
`, "https://cdn.example.com/path/master.m3u8?session=one");

  assert.equal(playlist.kind, "master");
  assert.equal(playlist.variants.length, 2);
  assert.equal(playlist.variants[0].url, "https://cdn.example.com/path/video/1080.m3u8?token=abc");
  assert.equal(playlist.variants[0].averageBandwidth, 5100000);
  assert.equal(playlist.variants[1].url, "https://media.example.net/720.m3u8?token=def");
});

test("parses split audio rendition metadata", () => {
  const playlist = parsePlaylist(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio/ja.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,AUDIO="aac"
video/main.m3u8
`, "https://example.com/hls/master.m3u8");

  assert.equal(playlist.audioRenditions.length, 1);
  assert.deepEqual(playlist.audioRenditions[0], {
    type: "audio",
    groupId: "aac",
    name: "Japanese",
    url: "https://example.com/hls/audio/ja.m3u8",
    language: "ja",
    default: true,
    autoSelect: true,
    channels: "2"
  });
});

test("classifies an ended MPEG-TS media playlist as VOD", () => {
  const playlist = parsePlaylist(`#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.006,first
seg-001.ts
#EXTINF:5.5,
https://media.example.com/seg-002.ts?sig=123
#EXT-X-ENDLIST
`, "https://example.com/show/index.m3u8");

  assert.equal(playlist.kind, "media");
  assert.equal(playlist.vod, true);
  assert.equal(playlist.live, false);
  assert.equal(playlist.segmented, "ts");
  assert.equal(playlist.targetDuration, 6);
  assert.equal(playlist.segments.length, 2);
  assert.equal(playlist.segments[0].url, "https://example.com/show/seg-001.ts");
});

test("recognizes fMP4 playlists with EXT-X-MAP", () => {
  const playlist = parsePlaylist(`#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
chunk-001.m4s
#EXT-X-ENDLIST
`, "https://example.com/cmaf/video.m3u8");

  assert.equal(playlist.segmented, "fmp4");
  assert.equal(playlist.mapUrl, "https://example.com/cmaf/init.mp4");
});

test("distinguishes ordinary AES-128 encryption from protected media", () => {
  const aes = parsePlaylist(`#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:4,
one.ts
#EXT-X-ENDLIST
`, "https://example.com/secure/index.m3u8");

  assert.equal(aes.encrypted, true);
  assert.equal(aes.encryptionMethod, "AES-128");
  assert.equal(aes.drm, false);
  assert.equal(aes.keys[0].url, "https://example.com/secure/key.bin");

  const protectedPlaylist = parsePlaylist(`#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://license",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:4,
one.m4s
`, "https://example.com/protected/index.m3u8");

  assert.equal(protectedPlaylist.drm, true);
});

test("classifies a media playlist without ENDLIST as live", () => {
  const playlist = parsePlaylist(`#EXTM3U
#EXT-X-PLAYLIST-TYPE:EVENT
#EXTINF:6,
live-100.ts
`, "https://example.com/live/index.m3u8");

  assert.equal(playlist.kind, "media");
  assert.equal(playlist.vod, false);
  assert.equal(playlist.live, true);
  assert.equal(playlist.playlistType, "EVENT");
});

test("records media features that the first DIRECT path must reject", () => {
  const playlist = parsePlaylist(`#EXTM3U
#EXT-X-I-FRAMES-ONLY
#EXTINF:4,
#EXT-X-BYTERANGE:1000@0
media.ts
#EXT-X-DISCONTINUITY
#EXT-X-GAP
#EXTINF:4,
gap.ts
#EXT-X-ENDLIST
`, "https://example.com/ranged/index.m3u8");

  assert.equal(playlist.iframeOnly, true);
  assert.equal(playlist.hasByteRanges, true);
  assert.equal(playlist.hasDiscontinuities, true);
  assert.equal(playlist.hasGaps, true);
  assert.equal(playlist.segments[0].byteRange, "1000@0");
  assert.equal(playlist.segments[1].discontinuity, true);
  assert.equal(playlist.segments[1].gap, true);
});

test("returns a useful classification for HTML and other non-HLS bodies", () => {
  const html = parsePlaylist("<!doctype html><title>Sign in</title>", "https://example.com/expired");
  assert.equal(html.kind, "not-hls");
  assert.match(html.reason, /HTML/);

  const plain = parsePlaylist("access denied", "https://example.com/denied");
  assert.equal(plain.kind, "not-hls");
  assert.match(plain.reason, /#EXTM3U/);
});
