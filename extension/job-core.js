(function initDownsJobs(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsJobs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const JOB_KEY_PREFIX = "download-job:";
  const HISTORY_LIMIT = 30;
  const ACTIVE_STATES = new Set(["queued", "downloading", "remuxing"]);
  const TERMINAL_STATES = new Set(["done", "failed", "cancelled"]);

  function jobKey(id) {
    return `${JOB_KEY_PREFIX}${id}`;
  }

  function isJobKey(key) {
    return typeof key === "string" && key.startsWith(JOB_KEY_PREFIX);
  }

  function createJob(input, now = Date.now()) {
    return {
      id: input.id,
      createdAt: now,
      updatedAt: now,
      playlistUrl: input.playlistUrl,
      sourcePageTitle: input.sourcePageTitle || "",
      variantLabel: input.variantLabel || "",
      hasSeparateAudio: Boolean(input.hasSeparateAudio),
      filename: input.filename,
      supportSummary: input.supportSummary || "",
      state: "queued",
      attempt: 1,
      segmentCount: 0,
      completedSegments: 0,
      bytesDownloaded: 0,
      outputSize: 0,
      speedBytesPerSecond: 0,
      outputStorage: "",
      outputKey: "",
      exportedAt: 0,
      error: null
    };
  }

  function transitionJob(job, state, patch = {}, now = Date.now()) {
    if (!job?.id) {
      throw new TypeError("job must have an id");
    }
    if (!ACTIVE_STATES.has(state) && !TERMINAL_STATES.has(state)) {
      throw new RangeError(`unknown job state: ${state}`);
    }
    return {
      ...job,
      ...patch,
      state,
      updatedAt: now
    };
  }

  function resetForRetry(job, now = Date.now()) {
    return {
      ...job,
      state: "queued",
      updatedAt: now,
      attempt: (Number(job.attempt) || 1) + 1,
      segmentCount: 0,
      completedSegments: 0,
      bytesDownloaded: 0,
      outputSize: 0,
      speedBytesPerSecond: 0,
      outputStorage: "",
      outputKey: "",
      exportedAt: 0,
      error: null,
      exportError: ""
    };
  }

  function pruneJobs(jobs, limit = HISTORY_LIMIT) {
    const sorted = [...jobs].sort(
      (a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
    );
    const active = sorted.filter((job) => ACTIVE_STATES.has(job.state));
    const terminal = sorted.filter((job) => !ACTIVE_STATES.has(job.state));
    const terminalSlots = Math.max(0, limit - active.length);
    const kept = [...active, ...terminal.slice(0, terminalSlots)].sort(
      (a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
    );
    const keptIds = new Set(kept.map((job) => job.id));
    return {
      kept,
      removed: sorted.filter((job) => !keptIds.has(job.id))
    };
  }

  function summarizeJobs(jobs) {
    return jobs.reduce(
      (summary, job) => {
        if (ACTIVE_STATES.has(job.state)) {
          summary.active += 1;
        }
        if (job.state === "done" && !job.exportedAt) {
          summary.ready += 1;
        }
        return summary;
      },
      { active: 0, ready: 0 }
    );
  }

  return {
    ACTIVE_STATES,
    HISTORY_LIMIT,
    JOB_KEY_PREFIX,
    TERMINAL_STATES,
    createJob,
    isJobKey,
    jobKey,
    pruneJobs,
    resetForRetry,
    summarizeJobs,
    transitionJob
  };
});
