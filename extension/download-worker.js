"use strict";

importScripts(
  "hls-parser.js",
  "download-core.js",
  "vendor/mux-mp4.min.js"
);

const PLAYLIST_LIMIT_BYTES = 5 * 1024 * 1024;
const SEGMENT_LIMIT_BYTES = 64 * 1024 * 1024;
const MEMORY_OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024;
const MAX_SEGMENTS = 20_000;
const FETCH_CONCURRENCY = 4;
const OUTPUT_PREFIX = "downs-output-";

let activeController = null;
let activeSink = null;
let activeRequestContext = {};
let nextContextRequestId = 1;
const contextRequests = new Map();

class DownloadError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "DownloadError";
    this.code = code;
    Object.assign(this, detail);
  }
}

function post(type, detail = {}) {
  self.postMessage({ type, ...detail });
}

function abortError() {
  return new DownloadError("cancelled", "Download cancelled.");
}

function ensureNotCancelled(signal) {
  if (signal.aborted) {
    throw abortError();
  }
}

async function fetchBytes(url, signal, kind, detail = {}) {
  let leaseId = 0;
  if (activeRequestContext.referer) {
    const requestId = nextContextRequestId++;
    const leasePromise = new Promise((resolve) => contextRequests.set(requestId, resolve));
    post("acquire-request-context", { requestId, url });
    leaseId = await leasePromise;
  }
  let response;
  try {
    response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      signal
    });
  } catch (error) {
    if (signal.aborted || error?.name === "AbortError") {
      throw abortError();
    }
    throw new DownloadError(
      "network",
      `${kind} request failed: ${error?.message || "network error"}`,
      detail
    );
  } finally {
    if (leaseId) {
      post("release-request-context", { leaseId });
    }
  }

  if (!response.ok) {
    throw new DownloadError(
      "http",
      `${kind} request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
      { ...detail, httpStatus: response.status }
    );
  }

  const limit = kind === "Playlist" ? PLAYLIST_LIMIT_BYTES : SEGMENT_LIMIT_BYTES;
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new DownloadError(
      "too-large",
      `${kind} is larger than the ${Math.round(limit / 1024 / 1024)} MiB safety limit.`
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > limit) {
    throw new DownloadError(
      "too-large",
      `${kind} is larger than the ${Math.round(limit / 1024 / 1024)} MiB safety limit.`
    );
  }

  return { bytes: new Uint8Array(buffer), finalUrl: response.url || url };
}

async function fetchPlaylist(url, signal) {
  const response = await fetchBytes(url, signal, "Playlist");
  const text = new TextDecoder().decode(response.bytes);
  return globalThis.DownsHls.parsePlaylist(text, response.finalUrl);
}

async function createOutputSink(jobId) {
  const storageName = `${OUTPUT_PREFIX}${jobId}.mp4`;

  if (navigator.storage?.getDirectory) {
    let root;
    try {
      root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(storageName, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      let size = 0;

      return {
        kind: "opfs",
        storageName,
        async write(bytes) {
          try {
            await writable.write(bytes);
          } catch (error) {
            throw new DownloadError(
              "storage",
              `Browser storage could not accept more MP4 data: ${error?.message || "storage quota or write error"}`
            );
          }
          size += bytes.byteLength;
        },
        async finish() {
          try {
            await writable.close();
            return { file: null, size, storageName };
          } catch (error) {
            throw new DownloadError(
              "storage",
              `Browser storage could not finish the MP4: ${error?.message || "storage error"}`
            );
          }
        },
        async abort() {
          try {
            await writable.abort();
          } catch (_error) {
            // The writable may already be closed after a storage failure.
          }
          try {
            await root.removeEntry(storageName);
          } catch (_error) {
            // There may be no partial file to remove.
          }
        }
      };
    } catch (_error) {
      if (root) {
        try {
          await root.removeEntry(storageName);
        } catch (_cleanupError) {
          // An output entry may not have been created yet.
        }
      }
    }
  }

  const chunks = [];
  let size = 0;
  return {
    kind: "memory",
    storageName: "",
    async write(bytes) {
      if (size + bytes.byteLength > MEMORY_OUTPUT_LIMIT_BYTES) {
        throw new DownloadError(
          "memory-limit",
          "This browser cannot stream to private storage, and the MP4 exceeded the 256 MiB memory fallback limit."
        );
      }
      chunks.push(bytes.slice());
      size += bytes.byteLength;
    },
    async finish() {
      return { file: new Blob(chunks, { type: "video/mp4" }), size, storageName: "" };
    },
    async abort() {
      chunks.length = 0;
      size = 0;
    }
  };
}

function createTransmuxer() {
  const Transmuxer = globalThis.muxjs?.Transmuxer || globalThis.muxjs?.mp4?.Transmuxer;
  if (!Transmuxer) {
    throw new DownloadError("muxer", "The bundled MPEG-TS remuxer did not load.");
  }

  const transmuxer = new Transmuxer({ remux: true });
  let outputs = [];
  let muxError = null;

  transmuxer.on("data", (segment) => {
    outputs.push({
      initSegment: segment.initSegment,
      data: segment.data
    });
  });
  transmuxer.on("error", (error) => {
    muxError = error instanceof Error ? error : new Error(String(error));
  });

  return {
    push(bytes) {
      outputs = [];
      muxError = null;
      try {
        transmuxer.push(bytes);
        transmuxer.flush();
      } catch (error) {
        throw new DownloadError(
          "transmux",
          `Could not remux an MPEG-TS segment: ${error?.message || "unknown muxer error"}`
        );
      }
      if (muxError) {
        throw new DownloadError("transmux", `Could not remux an MPEG-TS segment: ${muxError.message}`);
      }
      return outputs;
    }
  };
}

async function runJob(job) {
  const playlistUrl = job?.playlistUrl || job?.url;
  if (!job?.id || !playlistUrl) {
    throw new DownloadError("job", "The download job is missing its playlist URL.");
  }

  activeController = new AbortController();
  activeRequestContext = job.requestContext || {};
  const { signal } = activeController;
  post("progress", { phase: "playlist", message: "Checking playlist…", completed: 0, total: 0, bytes: 0 });

  const playlist = await fetchPlaylist(playlistUrl, signal);
  const eligibility = globalThis.DownsDownload.validateDirectPlaylist(playlist, {
    hasSeparateAudio: Boolean(job.hasSeparateAudio)
  });
  if (!eligibility.supported) {
    throw new DownloadError(eligibility.code, eligibility.reason);
  }
  if (playlist.segments.length > MAX_SEGMENTS) {
    throw new DownloadError(
      "segment-count",
      `This playlist has more than the ${MAX_SEGMENTS.toLocaleString()} segment safety limit.`
    );
  }

  activeSink = await createOutputSink(job.id);
  const muxer = createTransmuxer();
  const playlistDuration = playlist.segments.reduce(
    (total, segment) => total + (Number(segment.duration) || 0),
    0
  );
  let inputBytes = 0;
  let outputBytes = 0;
  let wroteInit = false;
  let checkedTracks = false;

  post("progress", {
    phase: "segments",
    message: "Downloading",
    completed: 0,
    total: playlist.segments.length,
    bytes: 0
  });

  await globalThis.DownsDownload.processInOrder(
    playlist.segments,
    FETCH_CONCURRENCY,
    async (segment, index) => {
      ensureNotCancelled(signal);
      const response = await fetchBytes(segment.url, signal, "Media segment", {
        segmentIndex: index + 1
      });
      inputBytes += response.bytes.byteLength;
      return response.bytes;
    },
    async (bytes, _segment, index) => {
      ensureNotCancelled(signal);
      const outputs = muxer.push(bytes);
      if (!outputs.length) {
        throw new DownloadError(
          "transmux-empty",
          `Segment ${index + 1} did not contain supported H.264/AAC MPEG-TS media.`
        );
      }

      for (const output of outputs) {
        if (!checkedTracks && output.initSegment) {
          const handlers = globalThis.DownsDownload.mp4HandlerTypes(output.initSegment);
          if (!handlers.includes("vide") || !handlers.includes("soun")) {
            throw new DownloadError(
              "tracks",
              "This playlist does not contain muxed H.264 video and AAC audio. Separate or single-track streams are not supported yet."
            );
          }
          checkedTracks = true;
        }

        if (!wroteInit && output.initSegment) {
          const finiteInit = globalThis.DownsDownload.patchMp4Durations(
            output.initSegment,
            playlistDuration
          );
          await activeSink.write(finiteInit);
          outputBytes += finiteInit.byteLength;
          wroteInit = true;
        }
        if (output.data?.byteLength) {
          await activeSink.write(output.data);
          outputBytes += output.data.byteLength;
        }
      }

      post("progress", {
        phase: "segments",
        message: "Downloading",
        completed: index + 1,
        total: playlist.segments.length,
        bytes: inputBytes,
        outputBytes
      });
    }
  );

  ensureNotCancelled(signal);
  if (!wroteInit || !checkedTracks || outputBytes === 0) {
    throw new DownloadError("transmux-empty", "The remuxer did not produce a playable MP4.");
  }

  post("progress", {
    phase: "remuxing",
    message: "Finalizing MP4…",
    completed: playlist.segments.length,
    total: playlist.segments.length,
    bytes: inputBytes,
    outputBytes
  });

  const result = await activeSink.finish();
  activeSink = null;
  post("complete", {
    file: result.file,
    size: result.size,
    storageName: result.storageName,
    outputStorage: result.storageName ? "opfs" : "memory",
    sourceBytes: inputBytes
  });
}

self.addEventListener("message", (event) => {
  const message = event.data;

  if (message?.type === "request-context-ready") {
    const resolve = contextRequests.get(message.requestId);
    contextRequests.delete(message.requestId);
    resolve?.(Number(message.leaseId) || 0);
    return;
  }

  if (message?.type === "cancel") {
    activeController?.abort();
    return;
  }

  if (message?.type !== "start" || activeController) {
    return;
  }

  runJob(message.job)
    .catch(async (error) => {
      if (activeSink) {
        await activeSink.abort();
        activeSink = null;
      }
      post(error?.code === "cancelled" ? "cancelled" : "error", {
        code: error?.code || "internal",
        message: error?.message || "Unexpected download error.",
        segmentIndex: error?.segmentIndex,
        httpStatus: error?.httpStatus
      });
    })
    .finally(() => {
      activeController = null;
      activeRequestContext = {};
    });
});
