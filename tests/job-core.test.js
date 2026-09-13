const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createJob,
  jobKey,
  pruneJobs,
  resetForRetry,
  summarizeJobs,
  transitionJob
} = require("../extension/job-core.js");

function newJob(id, now = 100) {
  return createJob({
    id,
    playlistUrl: `https://example.com/${id}.m3u8`,
    filename: `${id}.mp4`,
    variantLabel: "720p",
    supportSummary: "supported"
  }, now);
}

test("creates a persistent queued job without media bytes", () => {
  const job = newJob("one");
  assert.equal(job.state, "queued");
  assert.equal(job.attempt, 1);
  assert.equal(job.playlistUrl, "https://example.com/one.m3u8");
  assert.equal(job.filename, "one.mp4");
  assert.equal(jobKey(job.id), "download-job:one");
  assert.equal("segments" in job, false);
});

test("finished jobs retain private output metadata independently of export", () => {
  const done = transitionJob(newJob("output"), "done", {
    outputStorage: "opfs",
    outputKey: "downs-output-output.mp4",
    outputSize: 858403,
    exportedAt: 0
  }, 200);

  assert.equal(done.filename, "output.mp4");
  assert.equal(done.outputStorage, "opfs");
  assert.equal(done.outputKey, "downs-output-output.mp4");
  assert.equal(done.outputSize, 858403);
  assert.equal(done.exportedAt, 0);
});

test("persists detailed failure metadata through a state transition", () => {
  const failed = transitionJob(newJob("failure"), "failed", {
    error: {
      code: "http",
      message: "Media segment request failed with HTTP 403.",
      segmentIndex: 418,
      httpStatus: 403
    }
  }, 200);

  assert.equal(failed.state, "failed");
  assert.equal(failed.updatedAt, 200);
  assert.equal(failed.error.segmentIndex, 418);
  assert.equal(failed.error.httpStatus, 403);
});

test("retry resets stale progress, errors, and output metadata", () => {
  const failed = transitionJob(newJob("retry"), "failed", {
    segmentCount: 500,
    completedSegments: 418,
    bytesDownloaded: 123456,
    speedBytesPerSecond: 999,
    outputStorage: "opfs",
    outputKey: "old.mp4",
    outputSize: 456,
    exportedAt: 50,
    error: { code: "http", message: "expired" }
  }, 200);
  const retried = resetForRetry(failed, 300);

  assert.equal(retried.state, "queued");
  assert.equal(retried.attempt, 2);
  assert.equal(retried.segmentCount, 0);
  assert.equal(retried.completedSegments, 0);
  assert.equal(retried.bytesDownloaded, 0);
  assert.equal(retried.outputStorage, "");
  assert.equal(retried.outputKey, "");
  assert.equal(retried.outputSize, 0);
  assert.equal(retried.exportedAt, 0);
  assert.equal(retried.error, null);
});

test("history pruning retains active jobs and only the newest terminal jobs", () => {
  const active = transitionJob(newJob("active", 10), "downloading", {}, 500);
  const terminal = [1, 2, 3, 4].map((number) =>
    transitionJob(newJob(`done-${number}`, number), "done", {}, number * 10)
  );
  const { kept, removed } = pruneJobs([terminal[0], active, ...terminal.slice(1)], 3);

  assert.deepEqual(kept.map((job) => job.id), ["active", "done-4", "done-3"]);
  assert.deepEqual(removed.map((job) => job.id), ["done-2", "done-1"]);
});

test("summary counts active and finished-unexported jobs", () => {
  const queued = newJob("queued");
  const downloading = transitionJob(newJob("active"), "downloading");
  const ready = transitionJob(newJob("ready"), "done", { outputSize: 100 });
  const saved = transitionJob(newJob("saved"), "done", { outputSize: 100, exportedAt: 50 });
  const failed = transitionJob(newJob("failed"), "failed");

  assert.deepEqual(summarizeJobs([queued, downloading, ready, saved, failed]), {
    active: 2,
    ready: 1
  });
});
