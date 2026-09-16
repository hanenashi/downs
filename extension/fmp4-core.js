(function initDownsFmp4(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsFmp4 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "mvex", "moof", "traf"]);

  function bytes(value) {
    return value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  }

  function typeAt(data, offset) {
    return String.fromCharCode(...data.subarray(offset + 4, offset + 8));
  }

  function boxesIn(data, start = 0, end = data.byteLength) {
    const result = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let offset = start; offset + 8 <= end;) {
      let size = view.getUint32(offset);
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > end) break;
        size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) break;
      result.push({
        type: typeAt(data, offset),
        start: offset,
        content: offset + headerSize,
        end: offset + size,
        size
      });
      offset += size;
    }
    return result;
  }

  function walkBoxes(data, start = 0, end = data.byteLength, result = []) {
    for (const box of boxesIn(data, start, end)) {
      result.push(box);
      if (CONTAINERS.has(box.type)) {
        walkBoxes(data, box.content, box.end, result);
      }
    }
    return result;
  }

  function concat(parts) {
    const normalized = parts.map(bytes);
    const output = new Uint8Array(normalized.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of normalized) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    return output;
  }

  function makeBox(type, parts) {
    const payload = concat(parts);
    const output = new Uint8Array(payload.byteLength + 8);
    const view = new DataView(output.buffer);
    view.setUint32(0, output.byteLength);
    for (let index = 0; index < 4; index += 1) {
      output[index + 4] = type.charCodeAt(index);
    }
    output.set(payload, 8);
    return output;
  }

  function sliceBox(data, box) {
    return data.slice(box.start, box.end);
  }

  function handlerType(data) {
    const hdlr = walkBoxes(data).find((box) => box.type === "hdlr");
    return hdlr && hdlr.content + 12 <= hdlr.end
      ? String.fromCharCode(...data.subarray(hdlr.content + 8, hdlr.content + 12))
      : "";
  }

  function trackId(data) {
    const tkhd = walkBoxes(data).find((box) => box.type === "tkhd");
    if (!tkhd) return 0;
    const version = data[tkhd.content];
    const offset = tkhd.content + (version === 1 ? 20 : 12);
    return offset + 4 <= tkhd.end
      ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset)
      : 0;
  }

  function remapTrackMetadata(value, oldId, newId) {
    const data = bytes(value).slice();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (const box of walkBoxes(data)) {
      let offset = -1;
      if (box.type === "tkhd") {
        offset = box.content + (data[box.content] === 1 ? 20 : 12);
      } else if (box.type === "trex") {
        offset = box.content + 4;
      }
      if (offset >= 0 && offset + 4 <= box.end && view.getUint32(offset) === oldId) {
        view.setUint32(offset, newId);
      }
    }
    return data;
  }

  function patchNextTrackId(value, nextTrackId) {
    const data = bytes(value).slice();
    const mvhd = walkBoxes(data).find((box) => box.type === "mvhd");
    if (mvhd && mvhd.end - 4 >= mvhd.content) {
      new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(mvhd.end - 4, nextTrackId);
    }
    return data;
  }

  function remapFragment(value, oldId, newId, sequenceNumber) {
    const data = bytes(value).slice();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (const box of walkBoxes(data)) {
      if (box.type === "tfhd" && box.content + 8 <= box.end && view.getUint32(box.content + 4) === oldId) {
        view.setUint32(box.content + 4, newId);
      } else if (box.type === "sidx" && box.content + 8 <= box.end && view.getUint32(box.content + 4) === oldId) {
        view.setUint32(box.content + 4, newId);
      } else if (box.type === "mfhd" && box.content + 8 <= box.end && Number.isInteger(sequenceNumber)) {
        view.setUint32(box.content + 4, sequenceNumber);
      }
    }
    return data;
  }

  function combineInitialization(videoValue, audioValue) {
    const video = bytes(videoValue);
    const audio = bytes(audioValue);
    const videoTop = boxesIn(video);
    const audioTop = boxesIn(audio);
    const ftyp = videoTop.find((box) => box.type === "ftyp");
    const videoMoov = videoTop.find((box) => box.type === "moov");
    const audioMoov = audioTop.find((box) => box.type === "moov");
    if (!ftyp || !videoMoov || !audioMoov) {
      throw new Error("Both fMP4 tracks need valid initialization segments.");
    }

    const videoChildren = boxesIn(video, videoMoov.content, videoMoov.end);
    const audioChildren = boxesIn(audio, audioMoov.content, audioMoov.end);
    const videoTracks = videoChildren.filter((box) => box.type === "trak");
    const audioTracks = audioChildren.filter((box) => box.type === "trak");
    const videoTrack = videoTracks.find((box) => handlerType(sliceBox(video, box)) === "vide");
    const audioTrack = audioTracks.find((box) => handlerType(sliceBox(audio, box)) === "soun");
    if (!videoTrack || !audioTrack) {
      throw new Error("The selected initialization segments need one video track and one audio track.");
    }

    const videoTrackBytes = sliceBox(video, videoTrack);
    const audioTrackBytes = sliceBox(audio, audioTrack);
    const videoTrackId = trackId(videoTrackBytes);
    const audioTrackId = trackId(audioTrackBytes);
    if (!videoTrackId || !audioTrackId) {
      throw new Error("Could not read fMP4 track identifiers.");
    }
    const outputAudioTrackId = Math.max(
      videoTrackId,
      ...videoTracks.map((box) => trackId(sliceBox(video, box)))
    ) + 1;

    const videoMvex = videoChildren.find((box) => box.type === "mvex");
    const audioMvex = audioChildren.find((box) => box.type === "mvex");
    if (!videoMvex || !audioMvex) {
      throw new Error("Both initialization segments need movie-fragment metadata.");
    }
    const videoMvexChildren = boxesIn(video, videoMvex.content, videoMvex.end).map((box) => sliceBox(video, box));
    const audioTrex = boxesIn(audio, audioMvex.content, audioMvex.end)
      .filter((box) => box.type === "trex")
      .map((box) => remapTrackMetadata(sliceBox(audio, box), audioTrackId, outputAudioTrackId));
    if (!audioTrex.length) {
      throw new Error("The audio initialization segment has no track defaults.");
    }

    const moovParts = [];
    for (const box of videoChildren) {
      if (box.type !== "trak" && box.type !== "mvex") {
        const source = sliceBox(video, box);
        moovParts.push(box.type === "mvhd" ? patchNextTrackId(source, outputAudioTrackId + 1) : source);
      }
    }
    moovParts.push(videoTrackBytes);
    moovParts.push(remapTrackMetadata(audioTrackBytes, audioTrackId, outputAudioTrackId));
    moovParts.push(makeBox("mvex", [...videoMvexChildren, ...audioTrex]));

    return {
      bytes: concat([sliceBox(video, ftyp), makeBox("moov", moovParts)]),
      videoTrackId,
      audioTrackId,
      outputAudioTrackId
    };
  }

  function timedSegments(segments, kind) {
    let start = 0;
    return (segments || []).map((segment, index) => {
      const item = { ...segment, kind, index, start };
      start += Number(segment.duration) || 0;
      return item;
    });
  }

  function interleaveSegments(videoSegments, audioSegments) {
    return [...timedSegments(videoSegments, "video"), ...timedSegments(audioSegments, "audio")]
      .sort((left, right) => left.start - right.start || (left.kind === "video" ? -1 : 1));
  }

  return {
    boxesIn,
    combineInitialization,
    concat,
    handlerType,
    interleaveSegments,
    makeBox,
    remapFragment,
    remapTrackMetadata,
    trackId,
    walkBoxes
  };
});
