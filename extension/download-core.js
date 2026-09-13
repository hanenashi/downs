(function initDownsDownload(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsDownload = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DEFAULT_FILENAME = "downs-video.mp4";

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
    mp4HandlerTypes,
    processInOrder,
    safeFilename,
    suggestFilename,
    validateDirectPlaylist
  };
});
