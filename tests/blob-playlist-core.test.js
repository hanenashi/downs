const test = require("node:test");
const assert = require("node:assert/strict");

const BlobPlaylist = require("../extension/blob-playlist-core.js");

function candidate(overrides = {}) {
  return {
    text: "#EXTM3U\n#EXT-X-ENDLIST\n",
    contentType: "application/vnd.apple.mpegurl",
    baseUrl: "https://player.example.test/watch/episode",
    frameUrl: "https://player.example.test/watch/episode",
    pageUrl: "https://player.example.test/watch/episode",
    ...overrides
  };
}

test("accepts a bounded explicitly typed in-memory HLS playlist", () => {
  const result = BlobPlaylist.validateCandidate(candidate({
    contentType: "Application/Vnd.Apple.MpegURL; charset=utf-8",
    text: "\uFEFF#EXTM3U\r\nvariant.m3u8\r\n"
  }));

  assert.equal(result.ok, true);
  assert.equal(result.candidate.contentType, "application/vnd.apple.mpegurl");
  assert.equal(result.candidate.text, "#EXTM3U\nvariant.m3u8\n");
  assert.equal(result.candidate.baseUrl, "https://player.example.test/watch/episode");
});

test("rejects untyped, malformed, and oversized Blob candidates", () => {
  assert.deepEqual(
    BlobPlaylist.validateCandidate(candidate({ contentType: "text/plain" })),
    { ok: false, code: "content-type" }
  );
  assert.deepEqual(
    BlobPlaylist.validateCandidate(candidate({ text: "not a playlist" })),
    { ok: false, code: "not-hls" }
  );
  assert.deepEqual(
    BlobPlaylist.validateCandidate(candidate({
      text: `#EXTM3U\n${"x".repeat(BlobPlaylist.MAX_PLAYLIST_BYTES)}`
    })),
    { ok: false, code: "size" }
  );
});

test("requires a trusted HTTP base for relative playlist references", () => {
  assert.deepEqual(
    BlobPlaylist.validateCandidate(candidate({
      baseUrl: "data:text/html,fixture",
      frameUrl: "about:blank",
      pageUrl: "file:///tmp/fixture.html"
    })),
    { ok: false, code: "base-url" }
  );
});
