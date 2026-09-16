"use strict";

importScripts(
  "hls-parser.js",
  "download-core.js",
  "fmp4-core.js",
  "mp4-finalizer.js",
  "tar-core.js",
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

function bytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value || 0);
}

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
  const playlist = globalThis.DownsHls.parsePlaylist(text, response.finalUrl);
  playlist.sourceText = text;
  return playlist;
}

async function createOutputSink(jobId, extension = "mp4", mimeType = "video/mp4") {
  const storageName = `${OUTPUT_PREFIX}${jobId}.${extension}`;

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
      return { file: new Blob(chunks, { type: mimeType }), size, storageName: "" };
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

async function runTsJob(job, signal) {
  const playlistUrl = job?.playlistUrl || job?.url;
  if (!job?.id || !playlistUrl) {
    throw new DownloadError("job", "The download job is missing its playlist URL.");
  }

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
  let inputBytes = 0;
  let outputBytes = 0;
  let wroteInit = false;
  let checkedTracks = false;
  let finalizer = null;

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
          try {
            finalizer = new globalThis.DownsMp4Finalizer.FlatMp4Builder(output.initSegment);
          } catch (error) {
            throw new DownloadError(
              "mp4-finalize",
              `Could not prepare the finished MP4: ${error?.message || "invalid initialization metadata"}`
            );
          }
          await activeSink.write(finalizer.initialBytes);
          outputBytes += finalizer.initialBytes.byteLength;
          wroteInit = true;
        }
        if (output.data?.byteLength) {
          let writes;
          try {
            writes = finalizer.consume(output.data, outputBytes);
          } catch (error) {
            throw new DownloadError(
              "mp4-finalize",
              `Could not index a remuxed fragment: ${error?.message || "unsupported fragment layout"}`
            );
          }
          for (const part of writes) {
            await activeSink.write(part);
            outputBytes += part.byteLength;
          }
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

  try {
    const movie = finalizer.finalize();
    await activeSink.write(movie);
    outputBytes += movie.byteLength;
  } catch (error) {
    throw new DownloadError(
      "mp4-finalize",
      `Could not finish the seekable MP4: ${error?.message || "invalid sample table"}`
    );
  }

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

function playlistDuration(playlist) {
  return playlist.segments.reduce(
    (total, segment) => total + (Number(segment.duration) || 0),
    0
  );
}

async function runSplitFmp4Job(job, signal) {
  if (!job?.id || !job.playlistUrl || !job.audioPlaylistUrl) {
    throw new DownloadError("job", "The fMP4 job is missing its video or audio playlist URL.");
  }

  post("progress", { phase: "playlist", message: "Checking video and audio…", completed: 0, total: 0, bytes: 0 });
  const [videoPlaylist, audioPlaylist] = await Promise.all([
    fetchPlaylist(job.playlistUrl, signal),
    fetchPlaylist(job.audioPlaylistUrl, signal)
  ]);
  const eligibility = globalThis.DownsDownload.validateSplitFmp4Playlists(
    videoPlaylist,
    audioPlaylist
  );
  if (!eligibility.supported) {
    throw new DownloadError(eligibility.code, eligibility.reason);
  }

  const schedule = globalThis.DownsFmp4.interleaveSegments(
    videoPlaylist.segments,
    audioPlaylist.segments
  );
  if (schedule.length > MAX_SEGMENTS) {
    throw new DownloadError(
      "segment-count",
      `The selected tracks have more than the ${MAX_SEGMENTS.toLocaleString()} segment safety limit.`
    );
  }

  const [videoInit, audioInit] = await Promise.all([
    fetchBytes(videoPlaylist.mapUrl, signal, "Video initialization segment"),
    fetchBytes(audioPlaylist.mapUrl, signal, "Audio initialization segment")
  ]);
  const mp4Probe = globalThis.muxjs?.probe || globalThis.muxjs?.mp4?.probe;
  const videoTracks = mp4Probe?.tracks(videoInit.bytes) || [];
  const audioTracks = mp4Probe?.tracks(audioInit.bytes) || [];
  if (
    videoTracks.length !== 1 ||
    videoTracks[0].type !== "video" ||
    !/^avc[13]\b/i.test(videoTracks[0].codec || "") ||
    audioTracks.length !== 1 ||
    audioTracks[0].type !== "audio" ||
    !/^mp4a\.40\./i.test(audioTracks[0].codec || "")
  ) {
    throw new DownloadError(
      "fmp4-codecs",
      "This fMP4 milestone requires one H.264 video track and one AAC audio track."
    );
  }
  let combined;
  try {
    combined = globalThis.DownsFmp4.combineInitialization(videoInit.bytes, audioInit.bytes);
  } catch (error) {
    throw new DownloadError(
      "fmp4-init",
      `The fMP4 tracks could not be combined: ${error?.message || "invalid initialization metadata"}`
    );
  }

  activeSink = await createOutputSink(job.id);
  let finalizer;
  try {
    finalizer = new globalThis.DownsMp4Finalizer.FlatMp4Builder(combined.bytes);
  } catch (error) {
    throw new DownloadError(
      "mp4-finalize",
      `Could not prepare the finished MP4: ${error?.message || "invalid initialization metadata"}`
    );
  }
  await activeSink.write(finalizer.initialBytes);
  let inputBytes = videoInit.bytes.byteLength + audioInit.bytes.byteLength;
  let outputBytes = finalizer.initialBytes.byteLength;

  post("progress", {
    phase: "segments",
    message: "Downloading video and audio",
    completed: 0,
    total: schedule.length,
    bytes: inputBytes
  });

  await globalThis.DownsDownload.processInOrder(
    schedule,
    FETCH_CONCURRENCY,
    async (segment, index) => {
      ensureNotCancelled(signal);
      const response = await fetchBytes(segment.url, signal, `${segment.kind === "audio" ? "Audio" : "Video"} segment`, {
        segmentIndex: index + 1
      });
      inputBytes += response.bytes.byteLength;
      return response.bytes;
    },
    async (segmentBytes, segment, index) => {
      ensureNotCancelled(signal);
      const oldId = segment.kind === "audio" ? combined.audioTrackId : combined.videoTrackId;
      const newId = segment.kind === "audio" ? combined.outputAudioTrackId : combined.videoTrackId;
      const remapped = globalThis.DownsFmp4.remapFragment(segmentBytes, oldId, newId, index + 1);
      let writes;
      try {
        writes = finalizer.consume(remapped, outputBytes);
      } catch (error) {
        throw new DownloadError(
          "mp4-finalize",
          `Could not index a source fragment: ${error?.message || "unsupported fragment layout"}`
        );
      }
      for (const part of writes) {
        await activeSink.write(part);
        outputBytes += part.byteLength;
      }
      post("progress", {
        phase: "segments",
        message: "Downloading video and audio",
        completed: index + 1,
        total: schedule.length,
        bytes: inputBytes,
        outputBytes
      });
    }
  );

  ensureNotCancelled(signal);
  post("progress", {
    phase: "remuxing",
    message: "Finalizing MP4…",
    completed: schedule.length,
    total: schedule.length,
    bytes: inputBytes,
    outputBytes
  });
  try {
    const movie = finalizer.finalize();
    await activeSink.write(movie);
    outputBytes += movie.byteLength;
  } catch (error) {
    throw new DownloadError(
      "mp4-finalize",
      `Could not finish the seekable MP4: ${error?.message || "invalid sample table"}`
    );
  }
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

async function sha256Hex(value) {
  const data = bytes(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function writeTarEntry(sink, name, value) {
  const data = bytes(value);
  await sink.write(globalThis.DownsTar.header(name, data.byteLength));
  await sink.write(data);
  const padding = globalThis.DownsTar.padding(data.byteLength);
  if (padding.byteLength) await sink.write(padding);
}

function sourceHost(url) {
  try {
    return new URL(url).hostname;
  } catch (_error) {
    return "unknown";
  }
}

function sourceReadme() {
  return new TextEncoder().encode([
    "Downs source diagnostic bundle",
    "",
    "Media files are the exact bytes fetched from the selected HLS playlists.",
    "Playlist URLs were replaced with local paths; cookies and authorization values are not included.",
    "This bundle still contains the complete downloaded media and should be shared deliberately.",
    "See manifest.json for ordering, durations, sizes, and SHA-256 hashes.",
    ""
  ].join("\n"));
}

async function runSourceBundle(job, signal) {
  post("progress", { phase: "playlist", message: "Checking source playlists…", completed: 0, total: 0, bytes: 0 });
  const split = job?.supportMode === "direct-fmp4-split-vod";
  const [videoPlaylist, audioPlaylist] = await Promise.all([
    fetchPlaylist(job.playlistUrl, signal),
    split ? fetchPlaylist(job.audioPlaylistUrl, signal) : Promise.resolve(null)
  ]);
  const eligibility = split
    ? globalThis.DownsDownload.validateSplitFmp4Playlists(videoPlaylist, audioPlaylist)
    : globalThis.DownsDownload.validateDirectPlaylist(videoPlaylist, { hasSeparateAudio: false });
  if (!eligibility.supported) throw new DownloadError(eligibility.code, eligibility.reason);

  const schedule = split
    ? globalThis.DownsFmp4.interleaveSegments(videoPlaylist.segments, audioPlaylist.segments)
    : videoPlaylist.segments.map((segment, index) => ({ ...segment, kind: "", index }));
  if (schedule.length > MAX_SEGMENTS) {
    throw new DownloadError("segment-count", `The selected tracks have more than the ${MAX_SEGMENTS.toLocaleString()} segment safety limit.`);
  }

  activeSink = await createOutputSink(job.id, "tar", "application/x-tar");
  await writeTarEntry(activeSink, "README.txt", sourceReadme());
  const manifest = {
    format: "downs-source-1",
    createdAt: new Date().toISOString(),
    supportMode: job.supportMode,
    sourceHost: sourceHost(job.playlistUrl),
    tracks: []
  };
  let inputBytes = 0;
  let outputBytes = 0;

  const writeTracked = async (name, data) => {
    const before = data.byteLength;
    await writeTarEntry(activeSink, name, data);
    outputBytes += 512 + before + globalThis.DownsTar.padding(before).byteLength;
  };

  if (split) {
    const [videoInit, audioInit] = await Promise.all([
      fetchBytes(videoPlaylist.mapUrl, signal, "Video initialization segment"),
      fetchBytes(audioPlaylist.mapUrl, signal, "Audio initialization segment")
    ]);
    inputBytes += videoInit.bytes.byteLength + audioInit.bytes.byteLength;
    await writeTracked("video/playlist.m3u8", globalThis.DownsTar.normalizedPlaylist(videoPlaylist));
    await writeTracked("audio/playlist.m3u8", globalThis.DownsTar.normalizedPlaylist(audioPlaylist));
    await writeTracked("video/init.mp4", videoInit.bytes);
    await writeTracked("audio/init.mp4", audioInit.bytes);
    manifest.tracks.push(
      { kind: "video", playlist: "video/playlist.m3u8", init: { file: "video/init.mp4", size: videoInit.bytes.byteLength, sha256: await sha256Hex(videoInit.bytes) }, segments: [] },
      { kind: "audio", playlist: "audio/playlist.m3u8", init: { file: "audio/init.mp4", size: audioInit.bytes.byteLength, sha256: await sha256Hex(audioInit.bytes) }, segments: [] }
    );
  } else {
    await writeTracked("playlist.m3u8", globalThis.DownsTar.normalizedPlaylist(videoPlaylist));
    manifest.tracks.push({ kind: "muxed", playlist: "playlist.m3u8", segments: [] });
  }

  post("progress", { phase: "segments", message: "Capturing source media", completed: 0, total: schedule.length, bytes: inputBytes });
  await globalThis.DownsDownload.processInOrder(
    schedule,
    FETCH_CONCURRENCY,
    async (segment, index) => {
      ensureNotCancelled(signal);
      const response = await fetchBytes(segment.url, signal, "Source media segment", { segmentIndex: index + 1 });
      inputBytes += response.bytes.byteLength;
      return { bytes: response.bytes, sha256: await sha256Hex(response.bytes) };
    },
    async (result, segment, index) => {
      ensureNotCancelled(signal);
      const extension = split ? "m4s" : "ts";
      const file = globalThis.DownsTar.segmentName(segment.kind, segment.index, extension);
      await writeTracked(file, result.bytes);
      const target = split
        ? manifest.tracks.find((track) => track.kind === segment.kind)
        : manifest.tracks[0];
      target.segments.push({
        file,
        duration: Number(segment.duration) || 0,
        size: result.bytes.byteLength,
        sha256: result.sha256
      });
      post("progress", {
        phase: "segments",
        message: "Capturing source media",
        completed: index + 1,
        total: schedule.length,
        bytes: inputBytes,
        outputBytes
      });
    }
  );

  ensureNotCancelled(signal);
  post("progress", { phase: "remuxing", message: "Finalizing source bundle…", completed: schedule.length, total: schedule.length, bytes: inputBytes, outputBytes });
  await writeTracked("manifest.json", new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
  await activeSink.write(globalThis.DownsTar.endBlocks());
  outputBytes += 1024;
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

async function runJob(job) {
  activeController = new AbortController();
  activeRequestContext = job?.requestContext || {};
  if (job?.outputMode === "source-bundle") {
    return runSourceBundle(job, activeController.signal);
  }
  if (job?.supportMode === "direct-fmp4-split-vod") {
    return runSplitFmp4Job(job, activeController.signal);
  }
  return runTsJob(job, activeController.signal);
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
