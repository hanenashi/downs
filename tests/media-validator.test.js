const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzeProbe,
  durationTolerance,
  formatDuration,
  parseArgs,
  playlistDuration
} = require("../tools/validate-media.js");

function healthyProbe(overrides = {}) {
  return {
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "517.040000"
    },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        width: 960,
        height: 540,
        duration: "516.960000",
        nb_read_frames: "12924",
        avg_frame_rate: "25/1"
      },
      {
        index: 1,
        codec_type: "audio",
        codec_name: "aac",
        channels: 2,
        sample_rate: "44100",
        duration: "517.040000",
        nb_read_frames: "22266"
      }
    ],
    packets: [
      { stream_index: 0, dts_time: "0.000000", pts_time: "0.080000" },
      { stream_index: 1, dts_time: "0.000000", pts_time: "0.000000" },
      { stream_index: 1, dts_time: "0.023220", pts_time: "0.023220" },
      { stream_index: 0, dts_time: "0.040000", pts_time: "0.120000" }
    ],
    ...overrides
  };
}

test("accepts a finite H.264/AAC MP4 matching the playlist duration", () => {
  const result = analyzeProbe(healthyProbe(), { expectedDuration: 517 });

  assert.equal(result.passed, true);
  assert.equal(result.containerDuration, 517.04);
  assert.equal(result.video.frames, 12924);
  assert.equal(result.timestamps.video.dtsRegressions, 0);
  assert.deepEqual(result.issues, []);
});

test("rejects backwards decode timestamps across media fragments", () => {
  const probe = healthyProbe();
  probe.packets.push({ stream_index: 0, dts_time: "0.020000", pts_time: "0.160000" });

  const result = analyzeProbe(probe);

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((item) => item.code === "video-timestamps"));
});

test("rejects the unknown-duration sentinel and invalid decoded dimensions", () => {
  const probe = healthyProbe();
  probe.format.duration = "4294967296";
  probe.streams[0].duration = "4294967296";
  probe.streams[0].width = 0;
  probe.streams[0].height = 0;

  const result = analyzeProbe(probe);

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((item) => item.code === "implausible-duration"));
  assert.ok(result.issues.some((item) => item.code === "video-dimensions"));
});

test("rejects duration disagreement even when every duration is finite", () => {
  const result = analyzeProbe(healthyProbe(), { expectedDuration: 960 });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((item) => item.code === "duration-mismatch"));
});

test("sums playlist EXTINF values for an expected output duration", () => {
  const text = `#EXTM3U
#EXTINF:10.000,
one.ts
#EXTINF:9.967,title
two.ts
#EXT-X-ENDLIST`;

  assert.equal(playlistDuration(text), 19.967);
  assert.throws(() => playlistDuration("#EXTM3U\n#EXT-X-ENDLIST"), /EXTINF/);
});

test("uses a bounded duration tolerance and readable time formatting", () => {
  assert.equal(durationTolerance(30), 2);
  assert.equal(durationTolerance(1000), 10);
  assert.equal(formatDuration(517.04), "0:08:37.040");
  assert.equal(formatDuration(3599.9996), "1:00:00.000");
});

test("requires values for validator options", () => {
  assert.throws(() => parseArgs(["--json"]), /requires a value/);
  assert.throws(() => parseArgs(["--expected-duration", "--no-decode", "file.mp4"]), /requires a value/);
});
