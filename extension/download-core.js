(function initDownsDownload(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsDownload = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DEFAULT_FILENAME = "downs-video.mp4";
  const SETTINGS_KEY = "downs-settings";
  const FILENAME_MODES = new Set(["suggested", "date", "hash"]);
  const RANDOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
  const MP4_CONTAINERS = new Set(["moov", "trak", "mdia"]);

  function unsupported(code, reason) {
    return { supported: false, code, reason };
  }

  function validateDirectPlaylist(playlist, options = {}) {
    if (!playlist || playlist.kind === "not-hls") {
      return unsupported("not-hls", "The response is not an HLS playlist.");
    }
    if (playlist.kind === "master") {
      return unsupported("master", "Choose and inspect a media variant first.");
    }
    if (playlist.kind !== "media") {
      return unsupported("not-media", "Downs needs a media playlist with segment URLs.");
    }
    if (playlist.drm) {
      return unsupported("protected", "DRM or protected media cannot be downloaded.");
    }
    if (playlist.encrypted) {
      return unsupported(
        "encrypted",
        `${playlist.encryptionMethod || "Encrypted"} playlists are not supported yet.`
      );
    }
    if (options.hasSeparateAudio) {
      return unsupported("separate-audio", "This playlist uses separate audio tracks.");
    }
    if (!playlist.vod || playlist.live) {
      return unsupported(
        "live",
        "This playlist has no EXT-X-ENDLIST. Live and event downloads are not supported yet."
      );
    }
    if (playlist.maps?.length || playlist.mapUrl || playlist.segmented === "fmp4") {
      return unsupported("fmp4", "fMP4 / CMAF playlists are not supported yet.");
    }
    if (playlist.iframeOnly) {
      return unsupported("iframe-only", "I-frame-only playlists are not supported.");
    }
    if (playlist.hasByteRanges) {
      return unsupported("byte-range", "Byte-range media segments are not supported yet.");
    }
    if (playlist.hasDiscontinuities) {
      return unsupported("discontinuity", "Playlists with media discontinuities are not supported yet.");
    }
    if (playlist.hasGaps) {
      return unsupported("gap", "Playlists containing EXT-X-GAP segments are not supported.");
    }
    if (playlist.segmented !== "ts") {
      return unsupported(
        "container",
        "This milestone supports MPEG-TS segments only."
      );
    }
    if (!Array.isArray(playlist.segments) || playlist.segments.length === 0) {
      return unsupported("empty", "The playlist does not contain any media segments.");
    }

    return {
      supported: true,
      code: "direct-ts-vod",
      reason: "VOD · MPEG-TS · muxed A/V · unencrypted"
    };
  }

  function safeFilename(value) {
    let name = String(value || "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .replace(/^\.+/g, "")
      .trim();

    name = name.replace(/\.mp4$/i, "").replace(/[. ]+$/g, "").trim();
    if (!name || !/[\p{L}\p{N}]/u.test(name)) {
      return DEFAULT_FILENAME;
    }

    const suffix = ".mp4";
    return `${name.slice(0, 180 - suffix.length).replace(/[. ]+$/g, "")}${suffix}`;
  }

  function suggestFilename(pageTitle, variantLabel = "") {
    const title = String(pageTitle || "").trim();
    const variant = String(variantLabel || "").trim();
    return safeFilename([title || "downs-video", variant].filter(Boolean).join(" - "));
  }

  function padNumber(value) {
    return String(value).padStart(2, "0");
  }

  function dateStampFilename(date = new Date()) {
    const stamp = [
      date.getFullYear(),
      padNumber(date.getMonth() + 1),
      padNumber(date.getDate())
    ].join("-");
    const time = [padNumber(date.getHours()), padNumber(date.getMinutes())].join("-");
    return `${stamp}_${time}.mp4`;
  }

  function randomHash(random = Math.random) {
    let result = "";
    for (let index = 0; index < 10; index += 1) {
      result += RANDOM_ALPHABET[Math.floor(random() * RANDOM_ALPHABET.length) % RANDOM_ALPHABET.length];
    }
    return result;
  }

  function filenameForMode(pageTitle, variantLabel, mode = "suggested", options = {}) {
    const selectedMode = FILENAME_MODES.has(mode) ? mode : "suggested";
    if (selectedMode === "date") {
      return dateStampFilename(options.date || new Date());
    }
    if (selectedMode === "hash") {
      return `${randomHash(options.random)}.mp4`;
    }
    return suggestFilename(pageTitle, variantLabel);
  }

  function boxType(data, offset) {
    return String.fromCharCode(...data.subarray(offset + 4, offset + 8));
  }

  function collectMp4Boxes(data, start = 0, end = data.byteLength, boxes = []) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let offset = start; offset + 8 <= end;) {
      let size = view.getUint32(offset);
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > end) break;
        const high = view.getUint32(offset + 8);
        const low = view.getUint32(offset + 12);
        size = (high * 2 ** 32) + low;
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) break;
      const type = boxType(data, offset);
      boxes.push({ type, content: offset + headerSize, end: offset + size });
      if (MP4_CONTAINERS.has(type)) {
        collectMp4Boxes(data, offset + headerSize, offset + size, boxes);
      }
      offset += size;
    }
    return boxes;
  }

  function readTimingLayout(view, box) {
    if (box.content >= box.end) return null;
    const version = view.getUint8(box.content);
    let layout = null;
    if (box.type === "mvhd" || box.type === "mdhd") {
      layout = version === 1
        ? { timescaleOffset: box.content + 20, durationOffset: box.content + 24, durationBytes: 8 }
        : { timescaleOffset: box.content + 12, durationOffset: box.content + 16, durationBytes: 4 };
    } else if (box.type === "tkhd") {
      layout = version === 1
        ? { durationOffset: box.content + 28, durationBytes: 8 }
        : { durationOffset: box.content + 20, durationBytes: 4 };
    }
    if (!layout || layout.durationOffset + layout.durationBytes > box.end) return null;
    if (layout.timescaleOffset && layout.timescaleOffset + 4 > box.end) return null;
    return layout;
  }

  function writeDuration(view, offset, bytes, value) {
    const ticks = Math.max(1, Math.round(value));
    if (bytes === 8) {
      view.setUint32(offset, Math.floor(ticks / 2 ** 32));
      view.setUint32(offset + 4, ticks >>> 0);
    } else {
      view.setUint32(offset, Math.min(ticks, 0xfffffffe));
    }
  }

  function patchMp4Durations(bytes, durationSeconds) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const data = new Uint8Array(source);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || data.byteLength < 8) {
      return data;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const boxes = collectMp4Boxes(data);
    const movieHeader = boxes.find((box) => box.type === "mvhd");
    const movieLayout = movieHeader && readTimingLayout(view, movieHeader);
    const movieTimescale = movieLayout ? view.getUint32(movieLayout.timescaleOffset) : 0;

    for (const box of boxes) {
      const layout = readTimingLayout(view, box);
      if (!layout) continue;
      const timescale = box.type === "tkhd" ? movieTimescale : view.getUint32(layout.timescaleOffset);
      if (timescale > 0) {
        writeDuration(view, layout.durationOffset, layout.durationBytes, durationSeconds * timescale);
      }
    }
    return data;
  }

  async function processInOrder(items, limit, producer, consumer) {
    if (!Array.isArray(items)) {
      throw new TypeError("items must be an array");
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("limit must be a positive integer");
    }

    const pending = new Map();
    let nextToStart = 0;

    function start(index) {
      const outcome = Promise.resolve()
        .then(() => producer(items[index], index))
        .then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error })
        );
      pending.set(index, outcome);
      nextToStart += 1;
    }

    while (nextToStart < Math.min(items.length, limit)) {
      start(nextToStart);
    }

    for (let index = 0; index < items.length; index += 1) {
      const outcome = await pending.get(index);
      pending.delete(index);

      if (!outcome.ok) {
        throw outcome.error;
      }

      await consumer(outcome.value, items[index], index);
      if (nextToStart < items.length) {
        start(nextToStart);
      }
    }
  }

  function mp4HandlerTypes(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const types = new Set();

    for (let index = 0; index + 15 < data.length; index += 1) {
      if (
        data[index] === 0x68 &&
        data[index + 1] === 0x64 &&
        data[index + 2] === 0x6c &&
        data[index + 3] === 0x72
      ) {
        types.add(String.fromCharCode(...data.subarray(index + 12, index + 16)));
      }
    }

    return [...types];
  }

  return {
    DEFAULT_FILENAME,
    FILENAME_MODES,
    SETTINGS_KEY,
    dateStampFilename,
    filenameForMode,
    mp4HandlerTypes,
    patchMp4Durations,
    processInOrder,
    randomHash,
    safeFilename,
    suggestFilename,
    validateDirectPlaylist
  };
});
