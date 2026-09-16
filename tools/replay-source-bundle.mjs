#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";


const require = createRequire(import.meta.url);
const toolPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(toolPath), "..");
const Fmp4 = require(path.join(root, "extension/fmp4-core.js"));
const { FlatMp4Builder } = require(path.join(root, "extension/mp4-finalizer.js"));
const TAR_BLOCK = 512;
const COPY_BLOCK = 1024 * 1024;


function usage() {
  return [
    "Usage: node tools/replay-source-bundle.mjs BUNDLE [options]",
    "",
    "Options:",
    "  --output FILE  Write the reconstructed MP4 to FILE.",
    "  --ffprobe      Print an FFprobe stream/format summary after replay.",
    "  --force        Replace an existing output file.",
    "  --help         Show this help.",
    "",
    "The command verifies TAR headers and manifest hashes, never contacts the",
    "source host, and removes its temporary extraction directory afterward."
  ].join("\n");
}


export function parseArgs(argv) {
  const result = { bundle: "", output: "", ffprobe: false, force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      result.help = true;
    } else if (value === "--ffprobe") {
      result.ffprobe = true;
    } else if (value === "--force") {
      result.force = true;
    } else if (value === "--output") {
      result.output = argv[index + 1] || "";
      if (!result.output) throw new Error("--output requires a file path.");
      index += 1;
    } else if (value.startsWith("-")) {
      throw new Error(`Unknown option: ${value}`);
    } else if (!result.bundle) {
      result.bundle = value;
    } else {
      throw new Error(`Unexpected argument: ${value}`);
    }
  }
  return result;
}


function readExact(fd, buffer, position) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const count = readSync(fd, buffer, offset, buffer.byteLength - offset, position + offset);
    if (!count) throw new Error("Unexpected end of TAR archive.");
    offset += count;
  }
}


function tarString(header, offset, length) {
  const value = header.subarray(offset, offset + length);
  const end = value.indexOf(0);
  return value.subarray(0, end < 0 ? value.length : end).toString("utf8").trim();
}


function tarOctal(header, offset, length) {
  const text = tarString(header, offset, length).replace(/\s/g, "");
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`Invalid TAR octal value: ${text}`);
  return Number.parseInt(text, 8);
}


function isZeroBlock(header) {
  return header.every((value) => value === 0);
}


function verifyTarChecksum(header) {
  const expected = tarOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.byteLength; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    throw new Error(`TAR header checksum mismatch (${expected} != ${actual}).`);
  }
}


export function safeArchivePath(value) {
  const name = String(value || "");
  if (!name || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new Error(`Unsafe TAR path: ${name || "(empty)"}`);
  }
  const normalized = path.posix.normalize(name);
  if (normalized !== name || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Unsafe TAR path: ${name}`);
  }
  return normalized;
}


function extractTar(archivePath, destination) {
  const archiveFd = openSync(archivePath, "r");
  const archiveSize = fstatSync(archiveFd).size;
  const names = new Set();
  let position = 0;
  let zeroBlocks = 0;
  try {
    while (position + TAR_BLOCK <= archiveSize) {
      const header = Buffer.alloc(TAR_BLOCK);
      readExact(archiveFd, header, position);
      position += TAR_BLOCK;
      if (isZeroBlock(header)) {
        zeroBlocks += 1;
        if (zeroBlocks === 2) break;
        continue;
      }
      zeroBlocks = 0;
      verifyTarChecksum(header);
      const prefix = tarString(header, 345, 155);
      const base = tarString(header, 0, 100);
      const name = safeArchivePath(prefix ? `${prefix}/${base}` : base);
      const type = header[156];
      if (type !== 0 && type !== 0x30) {
        throw new Error(`Unsupported TAR entry type for ${name}.`);
      }
      if (names.has(name)) throw new Error(`Duplicate TAR entry: ${name}`);
      names.add(name);
      const size = tarOctal(header, 124, 12);
      const paddedSize = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
      if (!Number.isSafeInteger(size) || position + paddedSize > archiveSize) {
        throw new Error(`Invalid TAR entry size for ${name}.`);
      }
      const outputPath = path.join(destination, ...name.split("/"));
      mkdirSync(path.dirname(outputPath), { recursive: true });
      const outputFd = openSync(outputPath, "wx", 0o600);
      try {
        let remaining = size;
        let sourcePosition = position;
        const buffer = Buffer.alloc(Math.min(COPY_BLOCK, Math.max(1, remaining)));
        while (remaining > 0) {
          const length = Math.min(buffer.byteLength, remaining);
          const count = readSync(archiveFd, buffer, 0, length, sourcePosition);
          if (count !== length) throw new Error(`Unexpected end of TAR entry ${name}.`);
          writeSync(outputFd, buffer, 0, count);
          sourcePosition += count;
          remaining -= count;
        }
      } finally {
        closeSync(outputFd);
      }
      position += paddedSize;
    }
  } finally {
    closeSync(archiveFd);
  }
  if (zeroBlocks < 2) throw new Error("TAR archive is missing its end marker.");
  return names;
}


function bundleFile(extractionRoot, relativePath, names) {
  const safe = safeArchivePath(relativePath);
  if (!names.has(safe)) throw new Error(`Bundle file is missing: ${safe}`);
  return path.join(extractionRoot, ...safe.split("/"));
}


function sha256File(filename) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}


function verifyAsset(asset, extractionRoot, names, label) {
  if (!asset || typeof asset.file !== "string") throw new Error(`${label} has no file path.`);
  const filename = bundleFile(extractionRoot, asset.file, names);
  const size = statSync(filename).size;
  if (size !== Number(asset.size)) {
    throw new Error(`${label} size mismatch (${size} != ${asset.size}).`);
  }
  if (!/^[a-f0-9]{64}$/i.test(asset.sha256 || "")) {
    throw new Error(`${label} has an invalid SHA-256 value.`);
  }
  const digest = sha256File(filename);
  if (digest !== asset.sha256.toLowerCase()) {
    throw new Error(`${label} SHA-256 mismatch.`);
  }
  return filename;
}


function validateManifest(manifest, extractionRoot, names) {
  if (manifest?.format !== "downs-source-1") {
    throw new Error(`Unsupported source bundle format: ${manifest?.format || "missing"}`);
  }
  if (!Array.isArray(manifest.tracks) || !manifest.tracks.length) {
    throw new Error("Source bundle manifest has no tracks.");
  }
  for (const track of manifest.tracks) {
    if (!Array.isArray(track.segments) || !track.segments.length) {
      throw new Error(`${track.kind || "Unknown"} track has no segments.`);
    }
    if (track.init) verifyAsset(track.init, extractionRoot, names, `${track.kind} initialization`);
    track.segments.forEach((segment, index) => {
      verifyAsset(segment, extractionRoot, names, `${track.kind} segment ${index + 1}`);
    });
  }
}


function loadMuxJs() {
  const context = {
    console,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Math,
    Number,
    String,
    Object,
    Error,
    Infinity,
    NaN,
    parseInt,
    parseFloat
  };
  vm.createContext(context);
  vm.runInContext(
    readFileSync(path.join(root, "extension/vendor/mux-mp4.min.js"), "utf8"),
    context,
    { filename: "mux-mp4.min.js" }
  );
  if (!context.muxjs?.Transmuxer) throw new Error("Bundled mux.js did not load.");
  return context.muxjs;
}


function outputWriter(filename, force) {
  const fd = openSync(filename, force ? "w" : "wx", 0o600);
  let offset = 0;
  let closed = false;
  return {
    get offset() {
      return offset;
    },
    append(value) {
      const data = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      let written = 0;
      while (written < buffer.byteLength) {
        written += writeSync(fd, buffer, written, buffer.byteLength - written);
      }
      offset += buffer.byteLength;
    },
    close() {
      if (!closed) {
        closeSync(fd);
        closed = true;
      }
    },
    abort() {
      this.close();
      if (existsSync(filename)) unlinkSync(filename);
    }
  };
}


function replayTs(manifest, extractionRoot, names, writer) {
  const track = manifest.tracks.find((entry) => entry.kind === "muxed");
  if (!track || manifest.tracks.length !== 1) {
    throw new Error("TS replay requires exactly one muxed track.");
  }
  const muxjs = loadMuxJs();
  const muxer = new muxjs.Transmuxer({ remux: true });
  let outputs = [];
  let muxError = null;
  muxer.on("data", (output) => outputs.push(output));
  muxer.on("error", (error) => {
    muxError = error instanceof Error ? error : new Error(String(error));
  });
  let builder = null;
  track.segments.forEach((segment, index) => {
    outputs = [];
    muxError = null;
    muxer.push(new Uint8Array(readFileSync(bundleFile(extractionRoot, segment.file, names))));
    muxer.flush();
    if (muxError) throw new Error(`mux.js failed at segment ${index + 1}: ${muxError.message}`);
    if (!outputs.length) throw new Error(`mux.js produced no media for segment ${index + 1}.`);
    for (const output of outputs) {
      if (!builder) {
        builder = new FlatMp4Builder(output.initSegment);
        writer.append(builder.initialBytes);
      }
      for (const part of builder.consume(output.data, writer.offset)) writer.append(part);
    }
  });
  if (!builder) throw new Error("The TS bundle produced no MP4 initialization metadata.");
  writer.append(builder.finalize());
  return builder;
}


function replaySplitFmp4(manifest, extractionRoot, names, writer) {
  const video = manifest.tracks.find((track) => track.kind === "video");
  const audio = manifest.tracks.find((track) => track.kind === "audio");
  if (!video?.init || !audio?.init || manifest.tracks.length !== 2) {
    throw new Error("Split-fMP4 replay requires one initialized video track and one initialized audio track.");
  }
  const combined = Fmp4.combineInitialization(
    new Uint8Array(readFileSync(bundleFile(extractionRoot, video.init.file, names))),
    new Uint8Array(readFileSync(bundleFile(extractionRoot, audio.init.file, names)))
  );
  const builder = new FlatMp4Builder(combined.bytes);
  writer.append(builder.initialBytes);
  const schedule = Fmp4.interleaveSegments(video.segments, audio.segments);
  schedule.forEach((segment, index) => {
    const oldId = segment.kind === "audio" ? combined.audioTrackId : combined.videoTrackId;
    const newId = segment.kind === "audio" ? combined.outputAudioTrackId : combined.videoTrackId;
    const source = new Uint8Array(readFileSync(bundleFile(extractionRoot, segment.file, names)));
    const remapped = Fmp4.remapFragment(source, oldId, newId, index + 1);
    for (const part of builder.consume(remapped, writer.offset)) writer.append(part);
  });
  writer.append(builder.finalize());
  return builder;
}


function replaySummary(builder) {
  return [...builder.tracks.values()].map((track) => ({
    id: track.id,
    kind: track.kind === "vide" ? "video" : "audio",
    samples: track.sizes.length,
    chunks: track.chunks.length,
    syncSamples: track.syncSamples.length,
    durationSeconds: Number(((track.decodeEnd - (track.firstDecodeTime || 0)) / track.timescale).toFixed(6))
  }));
}


function runFfprobe(filename) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries",
    "format=format_name,start_time,duration,size:stream=index,codec_name,codec_type,time_base,start_time,duration,nb_frames",
    "-of", "json",
    filename
  ], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("ffprobe is not installed.");
  if (result.status !== 0) throw new Error(result.stderr.trim() || "ffprobe failed.");
  process.stdout.write(`${result.stdout.trim()}\n`);
}


async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.bundle) throw new Error(`A source bundle is required.\n\n${usage()}`);
  const bundlePath = path.resolve(options.bundle);
  if (!existsSync(bundlePath) || !statSync(bundlePath).isFile()) {
    throw new Error(`Source bundle does not exist: ${bundlePath}`);
  }
  const defaultBase = bundlePath.replace(/(?:\.downs-source)?\.tar$/i, "");
  const outputPath = path.resolve(options.output || `${defaultBase}.replayed.mp4`);
  if (outputPath === bundlePath) throw new Error("Output path must differ from the source bundle.");
  if (existsSync(outputPath) && !options.force) {
    throw new Error(`Output already exists: ${outputPath}\nUse --force to replace it.`);
  }

  const temporary = mkdtempSync(path.join(tmpdir(), "downs-replay-"));
  let writer = null;
  try {
    console.log(`Extracting and validating ${path.basename(bundlePath)}…`);
    const names = extractTar(bundlePath, temporary);
    const manifestPath = bundleFile(temporary, "manifest.json", names);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    validateManifest(manifest, temporary, names);
    console.log(`Verified ${manifest.tracks.reduce((total, track) => total + track.segments.length, 0)} media segments.`);

    writer = outputWriter(outputPath, options.force);
    const builder = manifest.supportMode === "direct-ts-vod"
      ? replayTs(manifest, temporary, names, writer)
      : manifest.supportMode === "direct-fmp4-split-vod"
        ? replaySplitFmp4(manifest, temporary, names, writer)
        : (() => { throw new Error(`Unsupported replay mode: ${manifest.supportMode}`); })();
    writer.close();
    writer = null;
    console.log(JSON.stringify({
      output: outputPath,
      size: statSync(outputPath).size,
      sha256: sha256File(outputPath),
      tracks: replaySummary(builder)
    }, null, 2));
    if (options.ffprobe) runFfprobe(outputPath);
  } catch (error) {
    writer?.abort();
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}


if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  main().catch((error) => {
    console.error(`Replay failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
