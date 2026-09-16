const test = require("node:test");
const assert = require("node:assert/strict");

const Fmp4 = require("../extension/fmp4-core.js");
const { FlatMp4Builder, runEntries } = require("../extension/mp4-finalizer.js");

function box(type, ...parts) {
  return Fmp4.makeBox(type, parts);
}

function fullBox(size, fields = []) {
  const body = new Uint8Array(size);
  const view = new DataView(body.buffer);
  for (const [offset, value] of fields) view.setUint32(offset, value);
  return body;
}

function initialization() {
  const mvhd = box("mvhd", fullBox(100, [[12, 1000], [16, 0xffffffff]]));
  const tkhd = box("tkhd", fullBox(84, [[12, 1], [20, 0xffffffff]]));
  const mdhd = box("mdhd", fullBox(20, [[12, 1000], [16, 0xffffffff]]));
  const hdlr = fullBox(24);
  hdlr.set([..."vide"].map((value) => value.charCodeAt(0)), 8);
  const stsd = box("stsd", fullBox(8));
  const stbl = box("stbl", stsd, box("stts", fullBox(8)), box("stsc", fullBox(8)), box("stsz", fullBox(12)), box("stco", fullBox(8)));
  const minf = box("minf", box("vmhd", fullBox(8)), box("dinf", fullBox(8)), stbl);
  const trak = box("trak", tkhd, box("mdia", mdhd, box("hdlr", hdlr), minf));
  const trex = box("trex", fullBox(24, [[4, 1], [8, 1], [12, 1000], [16, 4], [20, 0x02000000]]));
  return Fmp4.concat([box("ftyp", new Uint8Array([0x69, 0x73, 0x6f, 0x6d])), box("moov", mvhd, trak, box("mvex", trex))]);
}

function fragment() {
  const tfhd = box("tfhd", fullBox(8, [[4, 1]]));
  const tfdt = box("tfdt", fullBox(8));
  const trunBody = fullBox(12, [[4, 2]]);
  trunBody[3] = 1;
  let moof = box("moof", box("mfhd", fullBox(8)), box("traf", tfhd, tfdt, box("trun", trunBody)));
  const trun = Fmp4.walkBoxes(moof).find((entry) => entry.type === "trun");
  new DataView(moof.buffer).setInt32(trun.content + 8, moof.byteLength + 8);
  return Fmp4.concat([moof, box("mdat", new Uint8Array(8))]);
}

test("turns supported movie fragments into flat sample tables", () => {
  const builder = new FlatMp4Builder(initialization());
  const writes = builder.consume(fragment(), builder.initialBytes.byteLength);
  const movie = builder.finalize();
  const output = Fmp4.concat([builder.initialBytes, ...writes, movie]);
  const top = Fmp4.boxesIn(output);
  const types = Fmp4.walkBoxes(output).map((entry) => entry.type);

  assert.deepEqual(top.map((entry) => entry.type), ["ftyp", "mdat", "moov"]);
  assert.equal(types.includes("moof"), false);
  assert.equal(types.includes("mvex"), false);
  assert.equal(types.includes("stts"), true);
  assert.equal(types.includes("co64"), true);
  assert.equal(types.includes("stss"), false, "all-sync video does not need stss");
});

test("run-length encodes adjacent timing values", () => {
  assert.deepEqual(runEntries([3, 3, 4, 4, 4, 3]), [
    { count: 2, value: 3 },
    { count: 3, value: 4 },
    { count: 1, value: 3 }
  ]);
});
