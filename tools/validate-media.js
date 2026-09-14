#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ABSOLUTE_TOLERANCE = 2;
const DEFAULT_RELATIVE_TOLERANCE = 0.01;
const IMPLAUSIBLE_DURATION_SECONDS = 7 * 24 * 60 * 60;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function durationTolerance(duration) {
  return Math.max(DEFAULT_ABSOLUTE_TOLERANCE, Math.abs(duration) * DEFAULT_RELATIVE_TOLERANCE);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "unknown";
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const remainder = ((milliseconds % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`;
}

function playlistDuration(text) {
  const durations = [...String(text).matchAll(/^#EXTINF:([0-9]+(?:\.[0-9]+)?)/gim)]
    .map((match) => Number(match[1]));
  if (!durations.length || durations.some((value) => !Number.isFinite(value))) {
    throw new Error("The playlist has no valid EXTINF durations.");
  }
  return durations.reduce((total, value) => total + value, 0);
}

function issue(level, code, message) {
  return { level, code, message };
}

function analyzeProbe(probe, options = {}) {
  const issues = [];
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const format = probe?.format || {};
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const packets = Array.isArray(probe?.packets) ? probe.packets : [];
  const containerDuration = finiteNumber(format.duration);
  const expectedDuration = finiteNumber(options.expectedDuration);

  if (!String(format.format_name || "").split(",").some((name) => name === "mov" || name === "mp4")) {
    issues.push(issue("error", "container", `Expected MP4/MOV, found ${format.format_name || "unknown format"}.`));
  }

  if (containerDuration === null || containerDuration <= 0) {
    issues.push(issue("error", "container-duration", "The container has no finite positive duration."));
  } else if (containerDuration > IMPLAUSIBLE_DURATION_SECONDS && expectedDuration === null) {
    issues.push(issue(
      "error",
      "implausible-duration",
      `The container duration ${formatDuration(containerDuration)} exceeds seven days; pass --expected-duration if this is intentional.`
    ));
  }

  if (!video) {
    issues.push(issue("error", "video-missing", "No video stream was found."));
  } else {
    if (video.codec_name !== "h264") {
      issues.push(issue("error", "video-codec", `Expected H.264 video, found ${video.codec_name || "unknown"}.`));
    }
    if (!(finiteNumber(video.width) > 0) || !(finiteNumber(video.height) > 0)) {
      issues.push(issue("error", "video-dimensions", `Invalid video dimensions ${video.width || 0}x${video.height || 0}.`));
    }
    const frames = finiteNumber(video.nb_read_frames);
    if (frames === null) {
      issues.push(issue("warning", "frame-count", "ffprobe could not count decoded video frames."));
    } else if (frames <= 0) {
      issues.push(issue("error", "frame-count", "The video stream contains no readable frames."));
    }
  }

  if (!audio) {
    issues.push(issue("error", "audio-missing", "No audio stream was found."));
  } else {
    if (audio.codec_name !== "aac") {
      issues.push(issue("error", "audio-codec", `Expected AAC audio, found ${audio.codec_name || "unknown"}.`));
    }
    if (!(finiteNumber(audio.channels) > 0) || !(finiteNumber(audio.sample_rate) > 0)) {
      issues.push(issue("error", "audio-shape", "The audio stream has invalid channels or sample rate."));
    }
  }

  const videoDuration = finiteNumber(video?.duration);
  const audioDuration = finiteNumber(audio?.duration);

  if (expectedDuration !== null) {
    if (expectedDuration <= 0) {
      issues.push(issue("error", "expected-duration", "Expected duration must be positive."));
    } else if (containerDuration !== null && Math.abs(containerDuration - expectedDuration) > durationTolerance(expectedDuration)) {
      issues.push(issue(
        "error",
        "duration-mismatch",
        `Container duration ${formatDuration(containerDuration)} differs from expected ${formatDuration(expectedDuration)}.`
      ));
    }
  }

  for (const [label, streamDuration] of [["Video", videoDuration], ["Audio", audioDuration]]) {
    if (streamDuration !== null && containerDuration !== null &&
        Math.abs(streamDuration - containerDuration) > durationTolerance(containerDuration)) {
      issues.push(issue(
        "error",
        `${label.toLowerCase()}-duration-mismatch`,
        `${label} duration ${formatDuration(streamDuration)} differs from container duration ${formatDuration(containerDuration)}.`
      ));
    }
  }

  if (videoDuration !== null && audioDuration !== null &&
      Math.abs(videoDuration - audioDuration) > durationTolerance(Math.max(videoDuration, audioDuration))) {
    issues.push(issue(
      "error",
      "av-duration-mismatch",
      `Video duration ${formatDuration(videoDuration)} differs from audio duration ${formatDuration(audioDuration)}.`
    ));
  }

  const timestampSummary = {};
  for (const stream of [video, audio].filter(Boolean)) {
    const streamPackets = packets.filter((packet) => Number(packet.stream_index) === Number(stream.index));
    let previousDts = null;
    let regressions = 0;
    for (const packet of streamPackets) {
      const dts = finiteNumber(packet.dts_time);
      if (dts === null) continue;
      if (previousDts !== null && dts < previousDts - 0.000001) regressions += 1;
      previousDts = dts;
    }
    timestampSummary[stream.codec_type] = { packets: streamPackets.length, dtsRegressions: regressions };
    if (!streamPackets.length) {
      issues.push(issue("warning", `${stream.codec_type}-packets`, `ffprobe found no ${stream.codec_type} packets.`));
    } else if (regressions > 0) {
      issues.push(issue(
        "error",
        `${stream.codec_type}-timestamps`,
        `${stream.codec_type} decode timestamps moved backwards ${regressions} time${regressions === 1 ? "" : "s"}.`
      ));
    }
  }

  return {
    passed: !issues.some((item) => item.level === "error"),
    expectedDuration,
    containerDuration,
    video: video ? {
      codec: video.codec_name || "",
      width: finiteNumber(video.width),
      height: finiteNumber(video.height),
      duration: videoDuration,
      frames: finiteNumber(video.nb_read_frames),
      frameRate: video.avg_frame_rate || video.r_frame_rate || ""
    } : null,
    audio: audio ? {
      codec: audio.codec_name || "",
      channels: finiteNumber(audio.channels),
      sampleRate: finiteNumber(audio.sample_rate),
      duration: audioDuration,
      frames: finiteNumber(audio.nb_read_frames)
    } : null,
    timestamps: timestampSummary,
    issues
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} is required but was not found in PATH.`);
  }
  if (result.error) throw result.error;
  return result;
}

function probeFile(filename) {
  const result = run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    "-show_packets",
    "-count_frames",
    filename
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `ffprobe exited with status ${result.status}.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (_error) {
    throw new Error("ffprobe returned invalid JSON.");
  }
}

function decodeFile(filename) {
  const result = run("ffmpeg", [
    "-nostdin", "-hide_banner", "-v", "error",
    "-i", filename,
    "-map", "0:v:0?", "-map", "0:a:0?",
    "-f", "null", "-"
  ]);
  const diagnostics = result.stderr.trim();
  return {
    passed: result.status === 0 && diagnostics.length === 0,
    exitCode: result.status,
    diagnostics
  };
}

function validateFile(filename, options = {}) {
  const probe = probeFile(filename);
  const analysis = analyzeProbe(probe, options);
  const decode = options.decode === false ? null : decodeFile(filename);
  if (decode && !decode.passed) {
    analysis.issues.push(issue(
      "error",
      "decode",
      decode.diagnostics || `ffmpeg decode exited with status ${decode.exitCode}.`
    ));
    analysis.passed = false;
  }
  return {
    file: path.resolve(filename),
    size: fs.statSync(filename).size,
    ...analysis,
    decode
  };
}

function usage() {
  return `Usage: node tools/validate-media.js [options] FILE.mp4 [FILE.mp4 ...]

Options:
  --expected-duration SECONDS  Compare output with a known playlist duration
  --playlist FILE.m3u8        Sum EXTINF values and use that as expected duration
  --json FILE                 Write the complete report as JSON (use - for stdout)
  --no-decode                 Skip the full ffmpeg decode pass
  -h, --help                  Show this help`;
}

function parseArgs(argv) {
  const options = { files: [], decode: true, expectedDuration: null, json: "" };
  const valueAfter = (index, option) => {
    const value = argv[index + 1];
    if (value === undefined || (value.startsWith("-") && value !== "-")) {
      throw new Error(`${option} requires a value.`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") options.help = true;
    else if (argument === "--no-decode") options.decode = false;
    else if (argument === "--expected-duration") options.expectedDuration = Number(valueAfter(index++, argument));
    else if (argument === "--playlist") options.playlist = valueAfter(index++, argument);
    else if (argument === "--json") options.json = valueAfter(index++, argument);
    else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(argument);
  }
  if (options.playlist) {
    options.expectedDuration = playlistDuration(fs.readFileSync(options.playlist, "utf8"));
  }
  return options;
}

function printResult(result) {
  const state = result.passed ? "PASS" : "FAIL";
  console.log(`${state} ${result.file}`);
  console.log(`  container ${formatDuration(result.containerDuration)} · ${result.video?.codec || "no video"} ${result.video?.width || 0}x${result.video?.height || 0} · ${result.audio?.codec || "no audio"}`);
  if (result.expectedDuration !== null) console.log(`  expected  ${formatDuration(result.expectedDuration)}`);
  if (result.video?.frames !== null) console.log(`  frames    ${result.video.frames} at ${result.video.frameRate || "unknown rate"}`);
  console.log(`  decode    ${result.decode === null ? "skipped" : result.decode.passed ? "clean" : "errors"}`);
  for (const item of result.issues) console.log(`  ${item.level.toUpperCase()} [${item.code}] ${item.message}`);
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    if (!options.files.length) throw new Error("At least one MP4 file is required.");
    if (options.expectedDuration !== null && (!Number.isFinite(options.expectedDuration) || options.expectedDuration <= 0)) {
      throw new Error("Expected duration must be a positive number.");
    }

    const results = options.files.map((filename) => validateFile(filename, options));
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      passed: results.every((result) => result.passed),
      results
    };

    if (options.json === "-") console.log(JSON.stringify(report, null, 2));
    else {
      for (const result of results) printResult(result);
      if (options.json) fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
    }
    return report.passed ? 0 : 1;
  } catch (error) {
    console.error(`Media validation could not run: ${error.message}`);
    console.error(usage());
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  analyzeProbe,
  durationTolerance,
  formatDuration,
  parseArgs,
  playlistDuration,
  validateFile
};
