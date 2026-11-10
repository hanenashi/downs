(function initDownsBlobPlaylist(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsBlobPlaylist = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const MAX_PLAYLIST_BYTES = 512 * 1024;
  const MESSAGE_TYPE = "downs-blob-playlist-v1";
  const HLS_CONTENT_TYPES = new Set([
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl"
  ]);

  function normalizeContentType(value) {
    return String(value || "").split(";", 1)[0].trim().toLowerCase();
  }

  function normalizeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      url.hash = "";
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch (_error) {
      return "";
    }
  }

  function textBytes(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function validateCandidate(input) {
    const contentType = normalizeContentType(input?.contentType);
    if (!HLS_CONTENT_TYPES.has(contentType)) {
      return { ok: false, code: "content-type" };
    }

    if (typeof input?.text !== "string") {
      return { ok: false, code: "text" };
    }
    const byteLength = textBytes(input.text);
    if (!byteLength || byteLength > MAX_PLAYLIST_BYTES) {
      return { ok: false, code: "size" };
    }

    const normalizedText = input.text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const firstLine = normalizedText.split("\n").find((line) => line.trim())?.trim() || "";
    if (firstLine !== "#EXTM3U") {
      return { ok: false, code: "not-hls" };
    }

    const frameUrl = normalizeHttpUrl(input.frameUrl);
    const pageUrl = normalizeHttpUrl(input.pageUrl) || frameUrl;
    const baseUrl = normalizeHttpUrl(input.baseUrl) || frameUrl || pageUrl;
    if (!baseUrl) {
      return { ok: false, code: "base-url" };
    }

    return {
      ok: true,
      candidate: {
        text: normalizedText,
        byteLength,
        contentType,
        baseUrl,
        frameUrl: frameUrl || baseUrl,
        pageUrl: pageUrl || baseUrl
      }
    };
  }

  return {
    HLS_CONTENT_TYPES,
    MAX_PLAYLIST_BYTES,
    MESSAGE_TYPE,
    normalizeContentType,
    normalizeHttpUrl,
    validateCandidate
  };
});
