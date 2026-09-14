const test = require("node:test");
const assert = require("node:assert/strict");

const Fmp4 = require("../extension/fmp4-core.js");

function box(type, ...payloads) {
  const payload = Fmp4.concat(payloads);
  const output = new Uint8Array(payload.byteLength + 8);
  new DataView(output.buffer).setUint32(0, output.byteLength);
  output.set([...type].map((character) => character.charCodeAt(0)), 4);
  output.set(payload, 8);
  return output;
}

function uint32Body(size, offset, value) {
  const body = new Uint8Array(size);
  new DataView(body.buffer).setUint32(offset, value);
  return body;
}

function track(handler, id) {
  const tkhd = box("tkhd", uint32Body(24, 12, id));
  const hdlrBody = new Uint8Array(12);
  hdlrBody.set([...handler].map((character) => character.charCodeAt(0)), 8);
  return box("trak", tkhd, box("mdia", box("hdlr", hdlrBody)));
}

function init(handler, id = 1) {
  return Fmp4.concat([
    box("ftyp", new Uint8Array([0x69, 0x73, 0x6f, 0x6d])),
    box("moov", track(handler, id), box("mvex", box("trex", uint32Body(8, 4, id))))
  ]);
}

function fragment(id, sequence = 9) {
  return Fmp4.concat([
    box("moof", box("mfhd", uint32Body(8, 4, sequence)), box("traf", box("tfhd", uint32Body(8, 4, id)))),
    box("mdat", new Uint8Array([1, 2, 3]))
  ]);
}

function fullBoxValue(data, type) {
  const entry = Fmp4.walkBoxes(data).find((candidate) => candidate.type === type);
  assert.ok(entry, `missing ${type}`);
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(entry.content + 4);
}

test("combines separate video and audio initialization segments with unique track IDs", () => {
  const combined = Fmp4.combineInitialization(init("vide"), init("soun"));
  const tracks = Fmp4.walkBoxes(combined.bytes).filter((entry) => entry.type === "trak");

  assert.equal(combined.videoTrackId, 1);
  assert.equal(combined.audioTrackId, 1);
  assert.equal(combined.outputAudioTrackId, 2);
  assert.deepEqual(tracks.map((entry) => Fmp4.handlerType(combined.bytes.slice(entry.start, entry.end))), ["vide", "soun"]);
  assert.deepEqual(tracks.map((entry) => Fmp4.trackId(combined.bytes.slice(entry.start, entry.end))), [1, 2]);
});

test("remaps audio fragments and assigns one movie-fragment sequence", () => {
  const remapped = Fmp4.remapFragment(fragment(1), 1, 2, 17);
  assert.equal(fullBoxValue(remapped, "tfhd"), 2);
  assert.equal(fullBoxValue(remapped, "mfhd"), 17);
});

test("interleaves unequal video and audio segment timelines without dropping tails", () => {
  const schedule = Fmp4.interleaveSegments(
    [{ url: "v1", duration: 2 }, { url: "v2", duration: 2 }],
    [{ url: "a1", duration: 1 }, { url: "a2", duration: 1 }, { url: "a3", duration: 2 }]
  );
  assert.deepEqual(schedule.map((item) => `${item.kind}:${item.url}@${item.start}`), [
    "video:v1@0", "audio:a1@0", "audio:a2@1", "video:v2@2", "audio:a3@2"
  ]);
});
