const test = require("node:test");
const assert = require("node:assert/strict");

const {
  dateStampFilename,
  filenameForMode,
  mp4HandlerTypes,
  patchMp4Durations,
  processInOrder,
  randomHash,
  safeFilename,
  suggestFilename,
  validateDirectPlaylist,
  validateSplitFmp4Playlists
} = require("../extension/download-core.js");

function mp4Box(type, payloads) {
  const size = 8 + payloads.reduce((total, payload) => total + payload.byteLength, 0);
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  view.setUint32(0, size);
  result.set([...type].map((character) => character.charCodeAt(0)), 4);
  let offset = 8;
  for (const payload of payloads) {
    result.set(payload, offset);
    offset += payload.byteLength;
  }
  return result;
}

function timingBox(type, timescale = 0) {
  const body = new Uint8Array(type === "tkhd" ? 24 : 20);
  const view = new DataView(body.buffer);
  if (type === "tkhd") {
    view.setUint32(20, 0xffffffff);
  } else {
    view.setUint32(12, timescale);
    view.setUint32(16, 0xffffffff);
  }
  return mp4Box(type, [body]);
}

function uint32AfterType(data, type, offsetAfterType) {
  const signature = [...type].map((character) => character.charCodeAt(0));
  for (let index = 0; index <= data.byteLength - 4; index += 1) {
    if (signature.every((value, part) => data[index + part] === value)) {
      return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(index + 4 + offsetAfterType);
    }
  }
  throw new Error(`Missing ${type} box`);
}

function media(overrides = {}) {
  return {
    kind: "media",
    vod: true,
    live: false,
    drm: false,
    encrypted: false,
    segmented: "ts",
    maps: [],
    mapUrl: "",
    segments: [{ url: "https://example.com/one.ts" }],
    ...overrides
  };
}

test("accepts only finite, clear, muxed MPEG-TS media playlists", () => {
  assert.equal(validateDirectPlaylist(media()).supported, true);
  assert.equal(validateDirectPlaylist({ kind: "master" }).code, "master");
  assert.equal(validateDirectPlaylist(media({ vod: false, live: true })).code, "live");
  assert.equal(validateDirectPlaylist(media({ drm: true, encrypted: true })).code, "protected");
  assert.equal(
    validateDirectPlaylist(media({ encrypted: true, encryptionMethod: "AES-128" })).code,
    "encrypted"
  );
  assert.equal(validateDirectPlaylist(media({ segmented: "fmp4", mapUrl: "init.mp4" })).code, "fmp4");
  assert.equal(validateDirectPlaylist(media({ hasByteRanges: true })).code, "byte-range");
  assert.equal(validateDirectPlaylist(media({ hasDiscontinuities: true })).code, "discontinuity");
  assert.equal(validateDirectPlaylist(media({ hasGaps: true })).code, "gap");
  assert.equal(validateDirectPlaylist(media({ iframeOnly: true })).code, "iframe-only");
  assert.equal(validateDirectPlaylist(media(), { hasSeparateAudio: true }).code, "separate-audio");
  assert.equal(validateDirectPlaylist(media({ segments: [] })).code, "empty");
});

test("accepts only a simple clear fMP4 video and separate audio pair", () => {
  const video = media({
    segmented: "fmp4",
    mapUrl: "https://example.com/video-init.mp4",
    maps: [{ url: "https://example.com/video-init.mp4" }],
    segments: [{ url: "https://example.com/video-1.m4s" }]
  });
  const audio = media({
    segmented: "fmp4",
    mapUrl: "https://example.com/audio-init.mp4",
    maps: [{ url: "https://example.com/audio-init.mp4" }],
    segments: [{ url: "https://example.com/audio-1.m4s" }]
  });

  assert.equal(
    validateDirectPlaylist(video, {
      hasSeparateAudio: true,
      audioPlaylistUrl: "https://example.com/audio.m3u8"
    }).code,
    "direct-fmp4-split-vod"
  );
  assert.equal(validateSplitFmp4Playlists(video, audio).supported, true);
  assert.equal(validateSplitFmp4Playlists(video, { ...audio, live: true, vod: false }).code, "live");
  assert.equal(validateSplitFmp4Playlists(video, { ...audio, maps: [] }).code, "fmp4-layout");
  assert.equal(
    validateSplitFmp4Playlists(video, {
      ...audio,
      maps: [{ url: "https://example.com/audio-init.mp4", byteRange: "100@0" }]
    }).code,
    "fmp4-layout"
  );
  assert.equal(validateSplitFmp4Playlists(video, { ...audio, hasDiscontinuities: true }).code, "fmp4-layout");
  assert.equal(
    validateSplitFmp4Playlists(video, {
      ...audio,
      segments: [{ url: "https://example.com/audio-1.m4s", duration: 5 }]
    }).code,
    "track-alignment"
  );
});

test("sanitizes filenames and always returns one mp4 suffix", () => {
  assert.equal(safeFilename('  Episode: 1 / "Pilot".MP4  '), "Episode- 1 - -Pilot-.mp4");
  assert.equal(safeFilename("../"), "downs-video.mp4");
  assert.equal(suggestFilename("A Show", "1080p"), "A Show - 1080p.mp4");
  assert.ok(safeFilename("x".repeat(500)).length <= 180);
});

test("supports suggested, local date stamp, and ten-character hash filenames", () => {
  const localDate = new Date(2026, 8, 14, 20, 42);
  assert.equal(dateStampFilename(localDate), "2026-09-14_20-42.mp4");
  assert.equal(randomHash(() => 0), "aaaaaaaaaa");
  assert.equal(filenameForMode("A Show", "720p", "suggested"), "A Show - 720p.mp4");
  assert.equal(filenameForMode("ignored", "", "date", { date: localDate }), "2026-09-14_20-42.mp4");
  assert.equal(filenameForMode("ignored", "", "hash", { random: () => 0 }), "aaaaaaaaaa.mp4");
});

test("replaces fragmented MP4 unknown-duration sentinels with finite track durations", () => {
  const movieHeader = timingBox("mvhd", 90000);
  const trackHeader = timingBox("tkhd");
  const mediaHeader = timingBox("mdhd", 44100);
  const init = mp4Box("moov", [movieHeader, mp4Box("trak", [trackHeader, mp4Box("mdia", [mediaHeader])])]);
  const patched = patchMp4Durations(init, 12.5);

  assert.equal(uint32AfterType(patched, "mvhd", 16), 1125000);
  assert.equal(uint32AfterType(patched, "tkhd", 20), 1125000);
  assert.equal(uint32AfterType(patched, "mdhd", 16), 551250);
  assert.equal(uint32AfterType(init, "mvhd", 16), 0xffffffff, "source bytes stay unchanged");
});

test("processes concurrent producer results in source order", async () => {
  const delays = [35, 5, 20, 1, 10];
  const consumed = [];
  let active = 0;
  let peak = 0;

  await processInOrder(
    delays,
    3,
    async (delay, index) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return index;
    },
    async (value) => {
      consumed.push(value);
    }
  );

  assert.deepEqual(consumed, [0, 1, 2, 3, 4]);
  assert.equal(peak, 3);
});

test("stops ordered consumption at a failed producer", async () => {
  const consumed = [];
  await assert.rejects(
    processInOrder(
      [0, 1, 2],
      2,
      async (value) => {
        if (value === 1) {
          throw new Error("segment failed");
        }
        return value;
      },
      async (value) => consumed.push(value)
    ),
    /segment failed/
  );
  assert.deepEqual(consumed, [0]);
});

test("finds video and audio handler types in MP4 initialization bytes", () => {
  const bytes = new Uint8Array(48);
  bytes.set([0x68, 0x64, 0x6c, 0x72], 4);
  bytes.set([0x76, 0x69, 0x64, 0x65], 16);
  bytes.set([0x68, 0x64, 0x6c, 0x72], 28);
  bytes.set([0x73, 0x6f, 0x75, 0x6e], 40);
  assert.deepEqual(mp4HandlerTypes(bytes), ["vide", "soun"]);
});
