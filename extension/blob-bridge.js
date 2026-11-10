(function bridgeBlobPlaylists() {
  "use strict";

  const ext = globalThis.browser || globalThis.chrome;
  const BlobPlaylist = globalThis.DownsBlobPlaylist;
  if (!ext?.runtime?.sendMessage || !BlobPlaylist) return;

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.data?.type !== BlobPlaylist.MESSAGE_TYPE ||
      event.data?.version !== 1
    ) {
      return;
    }

    const validation = BlobPlaylist.validateCandidate({
      text: event.data.text,
      contentType: event.data.contentType,
      baseUrl: document.baseURI,
      frameUrl: location.href,
      pageUrl: location.href
    });
    if (!validation.ok) return;

    const response = ext.runtime.sendMessage({
      type: "blob-playlist-detected",
      ...validation.candidate
    });
    response?.catch?.(() => undefined);
  });
})();
