const test = require("node:test");
const assert = require("node:assert/strict");

const Tar = require("../extension/tar-core.js");

test("creates a replayable normalized playlist without source URLs", () => {
  const text = new TextDecoder().decode(Tar.normalizedPlaylist({
    segmented: "fmp4",
    mapUrl: "https://signed.example/init.mp4?token=secret",
    segments: [
      { url: "https://signed.example/one.m4s?token=secret", duration: 2.5 },
      { url: "https://signed.example/two.m4s?token=secret", duration: 1.5 }
    ]
  }));

  assert.match(text, /#EXT-X-MAP:URI="init\.mp4"/);
  assert.match(text, /segments\/000001\.m4s/);
  assert.doesNotMatch(text, /signed|secret|https:/);
});

test("writes a complete ustar header and block padding", () => {
  const header = Tar.header("segments/000001.ts", 513, 0);
  assert.equal(header.byteLength, 512);
  assert.equal(new TextDecoder().decode(header.subarray(257, 262)), "ustar");
  assert.equal(Tar.padding(513).byteLength, 511);
  assert.equal(Tar.endBlocks().byteLength, 1024);
});
