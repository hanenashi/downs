(function initDownsMp4Finalizer(root, factory) {
  const dependency = typeof module === "object" && module.exports
    ? require("./fmp4-core.js")
    : root.DownsFmp4;
  const api = factory(dependency);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsMp4Finalizer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (Fmp4) => {
  "use strict";

  function bytes(value) {
    return value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  }

  function fullBoxBody(version, flags, payloads = []) {
    return Fmp4.concat([
      new Uint8Array([version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]),
      ...payloads
    ]);
  }

  function uint32s(values) {
    const output = new Uint8Array(values.length * 4);
    const view = new DataView(output.buffer);
    values.forEach((value, index) => view.setUint32(index * 4, Number(value) >>> 0));
    return output;
  }

  function uint64s(values) {
    const output = new Uint8Array(values.length * 8);
    const view = new DataView(output.buffer);
    values.forEach((value, index) => {
      const number = Number(value);
      view.setUint32(index * 8, Math.floor(number / 2 ** 32));
      view.setUint32(index * 8 + 4, number >>> 0);
    });
    return output;
  }

  function runEntries(values) {
    const entries = [];
    for (const value of values) {
      const prior = entries[entries.length - 1];
      if (prior && prior.value === value && prior.count < 0xffffffff) {
        prior.count += 1;
      } else {
        entries.push({ count: 1, value });
      }
    }
    return entries;
  }

  function makeTimeToSample(values) {
    const entries = runEntries(values);
    return Fmp4.makeBox("stts", [
      fullBoxBody(0, 0, [
        uint32s([entries.length]),
        uint32s(entries.flatMap((entry) => [entry.count, entry.value]))
      ])
    ]);
  }

  function makeCompositionOffsets(values) {
    if (!values.some((value) => value !== 0)) return null;
    const entries = runEntries(values);
    const signed = entries.some((entry) => entry.value < 0);
    const payload = new Uint8Array(entries.length * 8);
    const view = new DataView(payload.buffer);
    entries.forEach((entry, index) => {
      view.setUint32(index * 8, entry.count);
      if (signed) {
        view.setInt32(index * 8 + 4, entry.value);
      } else {
        view.setUint32(index * 8 + 4, entry.value);
      }
    });
    return Fmp4.makeBox("ctts", [
      fullBoxBody(signed ? 1 : 0, 0, [uint32s([entries.length]), payload])
    ]);
  }

  function makeSampleToChunk(chunks) {
    const entries = [];
    chunks.forEach((chunk, index) => {
      const prior = entries[entries.length - 1];
      if (!prior || prior.samplesPerChunk !== chunk.sampleCount || prior.descriptionIndex !== chunk.descriptionIndex) {
        entries.push({
          firstChunk: index + 1,
          samplesPerChunk: chunk.sampleCount,
          descriptionIndex: chunk.descriptionIndex
        });
      }
    });
    return Fmp4.makeBox("stsc", [
      fullBoxBody(0, 0, [
        uint32s([entries.length]),
        uint32s(entries.flatMap((entry) => [
          entry.firstChunk,
          entry.samplesPerChunk,
          entry.descriptionIndex
        ]))
      ])
    ]);
  }

  function makeSampleSizes(sizes) {
    return Fmp4.makeBox("stsz", [
      fullBoxBody(0, 0, [uint32s([0, sizes.length]), uint32s(sizes)])
    ]);
  }

  function makeChunkOffsets(chunks) {
    return Fmp4.makeBox("co64", [
      fullBoxBody(0, 0, [uint32s([chunks.length]), uint64s(chunks.map((chunk) => chunk.offset))])
    ]);
  }

  function makeSyncSamples(track) {
    if (track.kind !== "vide" || track.syncSamples.length === track.sizes.length) return null;
    return Fmp4.makeBox("stss", [
      fullBoxBody(0, 0, [uint32s([track.syncSamples.length]), uint32s(track.syncSamples)])
    ]);
  }

  function flagsAt(data, offset) {
    return (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  }

  function readUint64(view, offset) {
    return view.getUint32(offset) * 2 ** 32 + view.getUint32(offset + 4);
  }

  function timingLayout(data, box) {
    const version = data[box.content];
    if (box.type === "mvhd" || box.type === "mdhd") {
      return version === 1
        ? { timescale: box.content + 20, duration: box.content + 24, bytes: 8 }
        : { timescale: box.content + 12, duration: box.content + 16, bytes: 4 };
    }
    if (box.type === "tkhd") {
      return version === 1
        ? { duration: box.content + 28, bytes: 8 }
        : { duration: box.content + 20, bytes: 4 };
    }
    return null;
  }

  function patchDuration(value, type, ticks) {
    const data = bytes(value).slice();
    const box = Fmp4.boxesIn(data).find((entry) => entry.type === type);
    if (!box) throw new Error(`Initialization metadata is missing ${type}.`);
    const layout = timingLayout(data, box);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const duration = Math.max(0, Math.round(ticks));
    if (layout.bytes === 8) {
      view.setUint32(layout.duration, Math.floor(duration / 2 ** 32));
      view.setUint32(layout.duration + 4, duration >>> 0);
    } else {
      view.setUint32(layout.duration, Math.min(duration, 0xfffffffe));
    }
    return data;
  }

  function childBytes(data, parent) {
    return Fmp4.boxesIn(data, parent.content, parent.end).map((box) => ({
      box,
      bytes: data.slice(box.start, box.end)
    }));
  }

  function trackInfo(data, trak) {
    const boxes = Fmp4.walkBoxes(data, trak.content, trak.end);
    const tkhd = boxes.find((box) => box.type === "tkhd");
    const mdhd = boxes.find((box) => box.type === "mdhd");
    const hdlr = boxes.find((box) => box.type === "hdlr");
    const stsd = boxes.find((box) => box.type === "stsd");
    if (!tkhd || !mdhd || !hdlr || !stsd) {
      throw new Error("Each track needs tkhd, mdhd, hdlr, and stsd metadata.");
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tkhdVersion = data[tkhd.content];
    const mdhdLayout = timingLayout(data, mdhd);
    const id = view.getUint32(tkhd.content + (tkhdVersion === 1 ? 20 : 12));
    const timescale = view.getUint32(mdhdLayout.timescale);
    const kind = String.fromCharCode(...data.subarray(hdlr.content + 8, hdlr.content + 12));
    if (!id || !timescale || !["vide", "soun"].includes(kind)) {
      throw new Error("Only ordinary video and audio tracks can be finalized.");
    }
    return {
      id,
      timescale,
      kind,
      trak,
      stsdBytes: data.slice(stsd.start, stsd.end),
      sizes: [],
      durations: [],
      compositionOffsets: [],
      syncSamples: [],
      chunks: [],
      firstDecodeTime: null,
      decodeEnd: 0
    };
  }

  function parseTrexDefaults(data, moov) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const defaults = new Map();
    for (const box of Fmp4.walkBoxes(data, moov.content, moov.end)) {
      if (box.type !== "trex" || box.content + 24 > box.end) continue;
      defaults.set(view.getUint32(box.content + 4), {
        descriptionIndex: view.getUint32(box.content + 8),
        duration: view.getUint32(box.content + 12),
        size: view.getUint32(box.content + 16),
        flags: view.getUint32(box.content + 20)
      });
    }
    return defaults;
  }

  function parseTfhd(data, box, defaults) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const flags = flagsAt(data, box.content);
    const trackId = view.getUint32(box.content + 4);
    let offset = box.content + 8;
    if (flags & 0x000001) {
      throw new Error("Absolute fragment data offsets are not supported.");
    }
    const result = { trackId, ...(defaults.get(trackId) || {}) };
    if (flags & 0x000002) {
      result.descriptionIndex = view.getUint32(offset);
      offset += 4;
    }
    if (flags & 0x000008) {
      result.duration = view.getUint32(offset);
      offset += 4;
    }
    if (flags & 0x000010) {
      result.size = view.getUint32(offset);
      offset += 4;
    }
    if (flags & 0x000020) {
      result.flags = view.getUint32(offset);
    }
    return result;
  }

  function parseDecodeTime(data, box) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return data[box.content] === 1
      ? readUint64(view, box.content + 4)
      : view.getUint32(box.content + 4);
  }

  function parseTrun(data, box, tfhd) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = data[box.content];
    const flags = flagsAt(data, box.content);
    const sampleCount = view.getUint32(box.content + 4);
    let offset = box.content + 8;
    let dataOffset = null;
    let firstSampleFlags = null;
    if (flags & 0x000001) {
      dataOffset = view.getInt32(offset);
      offset += 4;
    }
    if (flags & 0x000004) {
      firstSampleFlags = view.getUint32(offset);
      offset += 4;
    }
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      let duration = tfhd.duration;
      let size = tfhd.size;
      let sampleFlags = index === 0 && firstSampleFlags !== null ? firstSampleFlags : tfhd.flags;
      let compositionOffset = 0;
      if (flags & 0x000100) {
        duration = view.getUint32(offset);
        offset += 4;
      }
      if (flags & 0x000200) {
        size = view.getUint32(offset);
        offset += 4;
      }
      if (flags & 0x000400) {
        sampleFlags = view.getUint32(offset);
        offset += 4;
      }
      if (flags & 0x000800) {
        compositionOffset = version === 1 ? view.getInt32(offset) : view.getUint32(offset);
        offset += 4;
      }
      if (!Number.isInteger(duration) || duration <= 0 || !Number.isInteger(size) || size <= 0) {
        throw new Error("Every fragment sample needs a positive duration and size.");
      }
      samples.push({ duration, size, flags: sampleFlags, compositionOffset });
    }
    return { dataOffset, samples };
  }

  function isSyncSample(flags) {
    if (!Number.isInteger(flags)) return false;
    const dependsOn = (flags >>> 24) & 0x03;
    return !(flags & 0x00010000) && dependsOn !== 1;
  }

  class FlatMp4Builder {
    constructor(initialization) {
      this.init = bytes(initialization);
      const top = Fmp4.boxesIn(this.init);
      this.ftyp = top.find((box) => box.type === "ftyp");
      this.moov = top.find((box) => box.type === "moov");
      if (!this.ftyp || !this.moov) {
        throw new Error("A fragmented MP4 initialization segment is required.");
      }
      this.initialBytes = this.init.slice(this.ftyp.start, this.ftyp.end);
      this.defaults = parseTrexDefaults(this.init, this.moov);
      this.tracks = new Map(
        Fmp4.boxesIn(this.init, this.moov.content, this.moov.end)
          .filter((box) => box.type === "trak")
          .map((trak) => {
            const track = trackInfo(this.init, trak);
            return [track.id, track];
          })
      );
      if (!this.tracks.size) throw new Error("The initialization segment has no media tracks.");
      this.fragmentCount = 0;
    }

    consume(fragmentValue, outputOffset) {
      const data = bytes(fragmentValue);
      const top = Fmp4.boxesIn(data);
      const writes = [];
      let pendingMoof = null;
      for (const box of top) {
        if (box.type === "moof") {
          if (pendingMoof) throw new Error("A movie fragment is missing its media data box.");
          pendingMoof = box;
        } else if (box.type === "mdat" && pendingMoof) {
          const trafs = Fmp4.boxesIn(data, pendingMoof.content, pendingMoof.end)
            .filter((entry) => entry.type === "traf");
          if (trafs.length !== 1) {
            throw new Error("Each supported movie fragment must contain exactly one track fragment.");
          }
          const children = Fmp4.boxesIn(data, trafs[0].content, trafs[0].end);
          const tfhdBox = children.find((entry) => entry.type === "tfhd");
          const tfdtBox = children.find((entry) => entry.type === "tfdt");
          const truns = children.filter((entry) => entry.type === "trun");
          if (!tfhdBox || !tfdtBox || truns.length !== 1) {
            throw new Error("Each supported track fragment needs one tfhd, tfdt, and trun.");
          }
          const tfhd = parseTfhd(data, tfhdBox, this.defaults);
          const track = this.tracks.get(tfhd.trackId);
          if (!track) throw new Error(`Fragment references unknown track ${tfhd.trackId}.`);
          const decodeTime = parseDecodeTime(data, tfdtBox);
          const trun = parseTrun(data, truns[0], tfhd);
          if (trun.dataOffset === null || pendingMoof.start + trun.dataOffset !== box.content) {
            throw new Error("Fragment sample data does not begin at the expected media-data offset.");
          }
          const sampleBytes = trun.samples.reduce((total, sample) => total + sample.size, 0);
          if (sampleBytes !== box.end - box.content) {
            throw new Error("Fragment sample sizes do not match its media-data payload.");
          }
          if (track.firstDecodeTime === null) track.firstDecodeTime = decodeTime;
          if (track.sizes.length && Math.abs(decodeTime - track.decodeEnd) > 1) {
            throw new Error("Fragment decode timeline has a gap or regression.");
          }
          const writeOffset = outputOffset + writes.reduce((total, part) => total + part.byteLength, 0);
          track.chunks.push({
            offset: writeOffset + (box.content - box.start),
            sampleCount: trun.samples.length,
            descriptionIndex: tfhd.descriptionIndex || 1
          });
          let sampleNumber = track.sizes.length;
          for (const sample of trun.samples) {
            sampleNumber += 1;
            track.sizes.push(sample.size);
            track.durations.push(sample.duration);
            track.compositionOffsets.push(sample.compositionOffset);
            if (track.kind === "vide" && isSyncSample(sample.flags)) {
              track.syncSamples.push(sampleNumber);
            }
          }
          track.decodeEnd = decodeTime + trun.samples.reduce((total, sample) => total + sample.duration, 0);
          writes.push(data.subarray(box.start, box.end));
          pendingMoof = null;
          this.fragmentCount += 1;
        }
      }
      if (pendingMoof) throw new Error("A movie fragment is missing its media data box.");
      if (!writes.length) throw new Error("The segment contains no supported movie fragments.");
      return writes;
    }

    rebuildTrack(track, movieTimescale) {
      const duration = Math.max(0, track.decodeEnd - (track.firstDecodeTime || 0));
      const tableParts = [
        track.stsdBytes,
        makeTimeToSample(track.durations)
      ];
      const composition = makeCompositionOffsets(track.compositionOffsets);
      if (composition) tableParts.push(composition);
      tableParts.push(
        makeSampleToChunk(track.chunks),
        makeSampleSizes(track.sizes),
        makeChunkOffsets(track.chunks)
      );
      const sync = makeSyncSamples(track);
      if (sync) tableParts.push(sync);

      const rebuildMinf = (value) => {
        const data = bytes(value);
        const parent = Fmp4.boxesIn(data)[0];
        return Fmp4.makeBox("minf", childBytes(data, parent).map((child) =>
          child.box.type === "stbl" ? Fmp4.makeBox("stbl", tableParts) : child.bytes
        ));
      };
      const rebuildMdia = (value) => {
        const data = bytes(value);
        const parent = Fmp4.boxesIn(data)[0];
        return Fmp4.makeBox("mdia", childBytes(data, parent).map((child) => {
          if (child.box.type === "mdhd") return patchDuration(child.bytes, "mdhd", duration);
          if (child.box.type === "minf") return rebuildMinf(child.bytes);
          return child.bytes;
        }));
      };

      const source = this.init.slice(track.trak.start, track.trak.end);
      const parent = Fmp4.boxesIn(source)[0];
      return {
        bytes: Fmp4.makeBox("trak", childBytes(source, parent).filter(
          (child) => child.box.type !== "edts"
        ).map((child) => {
          if (child.box.type === "tkhd") {
            return patchDuration(child.bytes, "tkhd", duration * movieTimescale / track.timescale);
          }
          if (child.box.type === "mdia") return rebuildMdia(child.bytes);
          return child.bytes;
        })),
        durationSeconds: duration / track.timescale
      };
    }

    finalize() {
      if (!this.fragmentCount) throw new Error("No movie fragments were collected.");
      for (const track of this.tracks.values()) {
        if (!track.sizes.length || track.firstDecodeTime === null) {
          throw new Error(`Track ${track.id} has no media samples.`);
        }
        if (track.kind === "vide" && !track.syncSamples.length) {
          throw new Error("The video track has no independently decodable samples.");
        }
      }
      const view = new DataView(this.init.buffer, this.init.byteOffset, this.init.byteLength);
      const mvhd = Fmp4.boxesIn(this.init, this.moov.content, this.moov.end)
        .find((box) => box.type === "mvhd");
      if (!mvhd) throw new Error("Initialization metadata is missing mvhd.");
      const movieTimescale = view.getUint32(timingLayout(this.init, mvhd).timescale);
      if (!movieTimescale) throw new Error("The movie timescale is invalid.");
      const rebuiltTracks = new Map();
      let movieDuration = 0;
      for (const track of this.tracks.values()) {
        const rebuilt = this.rebuildTrack(track, movieTimescale);
        rebuiltTracks.set(track.id, rebuilt.bytes);
        movieDuration = Math.max(movieDuration, rebuilt.durationSeconds);
      }
      const parts = [];
      for (const child of childBytes(this.init, this.moov)) {
        if (child.box.type === "mvex") continue;
        if (child.box.type === "mvhd") {
          parts.push(patchDuration(child.bytes, "mvhd", movieDuration * movieTimescale));
        } else if (child.box.type === "trak") {
          const id = Fmp4.trackId(child.bytes);
          parts.push(rebuiltTracks.get(id) || child.bytes);
        } else {
          parts.push(child.bytes);
        }
      }
      return Fmp4.makeBox("moov", parts);
    }
  }

  return {
    FlatMp4Builder,
    isSyncSample,
    runEntries
  };
});
