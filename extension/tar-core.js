(function initDownsTar(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsTar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const encoder = new TextEncoder();

  function writeString(target, offset, length, value) {
    const encoded = encoder.encode(String(value));
    if (encoded.byteLength > length) throw new Error(`TAR path is too long: ${value}`);
    target.set(encoded, offset);
  }

  function writeOctal(target, offset, length, value) {
    const text = Math.max(0, Math.floor(Number(value) || 0)).toString(8).padStart(length - 1, "0");
    writeString(target, offset, length, `${text.slice(-(length - 1))}\0`);
  }

  function header(name, size, modifiedAt = Date.now()) {
    const output = new Uint8Array(512);
    writeString(output, 0, 100, name);
    writeOctal(output, 100, 8, 0o644);
    writeOctal(output, 108, 8, 0);
    writeOctal(output, 116, 8, 0);
    writeOctal(output, 124, 12, size);
    writeOctal(output, 136, 12, modifiedAt / 1000);
    output.fill(0x20, 148, 156);
    output[156] = 0x30;
    writeString(output, 257, 6, "ustar\0");
    writeString(output, 263, 2, "00");
    writeString(output, 265, 32, "Downs");
    writeString(output, 297, 32, "Downs");
    const checksum = output.reduce((sum, value) => sum + value, 0);
    const checksumText = checksum.toString(8).padStart(6, "0").slice(-6);
    writeString(output, 148, 8, `${checksumText}\0 `);
    return output;
  }

  function padding(size) {
    const remainder = Number(size) % 512;
    return remainder ? new Uint8Array(512 - remainder) : new Uint8Array(0);
  }

  function endBlocks() {
    return new Uint8Array(1024);
  }

  function segmentName(kind, index, extension) {
    const prefix = kind ? `${kind}/` : "";
    return `${prefix}segments/${String(index + 1).padStart(6, "0")}.${extension}`;
  }

  function normalizedPlaylist(playlist, options = {}) {
    const extension = options.extension || (playlist.segmented === "ts" ? "ts" : "m4s");
    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(Math.max(...playlist.segments.map((segment) => Number(segment.duration) || 0))))}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXT-X-PLAYLIST-TYPE:VOD"
    ];
    if (playlist.mapUrl) {
      lines.push("#EXT-X-MAP:URI=\"init.mp4\"");
    }
    playlist.segments.forEach((segment, index) => {
      lines.push(`#EXTINF:${Number(segment.duration) || 0},`);
      lines.push(segmentName("", index, extension));
    });
    lines.push("#EXT-X-ENDLIST", "");
    return encoder.encode(lines.join("\n"));
  }

  return {
    endBlocks,
    header,
    normalizedPlaylist,
    padding,
    segmentName
  };
});
