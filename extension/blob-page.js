(function observePlaylistBlobs() {
  "use strict";

  const NativeBlob = window.Blob;
  const marker = Symbol.for("downs.blobPlaylistProbe.v1");
  if (typeof NativeBlob !== "function" || window[marker]) return;

  const MESSAGE_TYPE = "downs-blob-playlist-v1";
  const MAX_PLAYLIST_BYTES = 512 * 1024;
  const HLS_CONTENT_TYPES = new Set([
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl"
  ]);

  function inspect(blob) {
    const contentType = String(blob?.type || "").split(";", 1)[0].trim().toLowerCase();
    if (!HLS_CONTENT_TYPES.has(contentType) || !blob.size || blob.size > MAX_PLAYLIST_BYTES) {
      return;
    }

    blob.text().then((text) => {
      window.postMessage({
        type: MESSAGE_TYPE,
        version: 1,
        contentType,
        text
      }, "*");
    }).catch(() => undefined);
  }

  let BlobProxy;
  BlobProxy = new Proxy(NativeBlob, {
    construct(target, argumentsList, newTarget) {
      const blob = Reflect.construct(
        target,
        argumentsList,
        newTarget === BlobProxy ? target : newTarget
      );
      inspect(blob);
      return blob;
    }
  });

  Object.defineProperty(window, marker, { value: true });
  window.Blob = BlobProxy;
})();
