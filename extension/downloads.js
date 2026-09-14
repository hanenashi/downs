"use strict";

const ext = globalThis.browser || globalThis.chrome;
const jobsEl = document.getElementById("jobs");
const emptyEl = document.getElementById("empty");
const summaryEl = document.getElementById("summary");
const clearExportedButton = document.getElementById("clear-exported");
const announcerEl = document.getElementById("announcer");
const openSettingsButton = document.getElementById("open-settings");
const settingsLayer = document.getElementById("settings-layer");
const settingsScrim = document.getElementById("settings-scrim");
const closeSettingsButton = document.getElementById("close-settings");
const settingsDoneButton = document.getElementById("settings-done");
const dateExampleEl = document.getElementById("date-example");
const hashExampleEl = document.getElementById("hash-example");
const filenameModeInputs = [...document.querySelectorAll('input[name="filename-mode"]')];

const jobs = new Map();
const memoryOutputs = new Map();
const detailJobs = new Set();
const pendingDeletes = new Set();
const persistTimers = new Map();
const exportDownloads = new Map();
const activeRequestLeases = new Set();
let activeWorker = null;
let activeJobId = "";
let cancelRequested = false;
let speedSample = null;
let clearExportedPending = false;
let priorSettingsFocus = null;

function createElement(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function percentFor(job) {
  if (!job.segmentCount) {
    return 0;
  }
  return Math.min(100, Math.round((job.completedSegments / job.segmentCount) * 100));
}

function stateText(job) {
  if (job.state === "downloading") {
    return job.segmentCount ? `Downloading · ${percentFor(job)}%` : "Downloading…";
  }
  if (job.state === "remuxing") {
    return "Remuxing…";
  }
  if (job.state === "done") {
    return `${job.exportedAt ? "Saved" : "Done"} · ${formatBytes(job.outputSize)}`;
  }
  return {
    queued: "Queued",
    failed: "Failed",
    cancelled: "Cancelled"
  }[job.state] || "Failed";
}

function progressText(job) {
  const parts = [];
  if (job.segmentCount) {
    parts.push(`${job.completedSegments} / ${job.segmentCount} segments`);
  }
  if (job.bytesDownloaded) {
    parts.push(formatBytes(job.bytesDownloaded));
  }
  if (job.speedBytesPerSecond > 0 && job.state === "downloading") {
    parts.push(`${formatBytes(job.speedBytesPerSecond)}/s`);
  }
  if (job.state === "queued") {
    parts.push("Waiting for the current job");
  }
  return parts.join(" · ");
}

function errorText(job) {
  if (!job.error) {
    return "The download stopped before it finished.";
  }
  if (job.error.segmentIndex && job.error.httpStatus) {
    return `Segment ${job.error.segmentIndex} · HTTP ${job.error.httpStatus}`;
  }
  return job.error.message || "The download failed.";
}

function actionButton(label, action, jobId, className = "action-button") {
  const button = createElement("button", className, label);
  button.type = "button";
  button.dataset.action = action;
  button.dataset.jobId = jobId;
  return button;
}

function renderDetails(job, row) {
  if (!detailJobs.has(job.id)) {
    return;
  }
  const details = createElement("div", "job-details");
  const entries = [
    ["Playlist URL", job.playlistUrl || "Unavailable"],
    ["Attempt", String(job.attempt || 1)]
  ];
  if (job.error) {
    entries.push(["Error code", job.error.httpStatus ? `HTTP ${job.error.httpStatus}` : job.error.code || "unknown"]);
  }
  if (job.outputStorage) {
    entries.push(["Private copy", job.outputStorage === "opfs" ? "Retained by Downs" : "Memory only — keep this page open"]);
  }
  for (const [label, value] of entries) {
    const detail = createElement("div", "detail-row");
    detail.append(createElement("span", "detail-label", `${label}:`));
    detail.append(createElement("span", "detail-value", value));
    details.append(detail);
  }
  row.append(details);
}

function renderActions(job, row) {
  const actions = createElement("div", "job-actions");

  if (["downloading", "remuxing"].includes(job.state)) {
    const cancel = actionButton(cancelRequested && job.id === activeJobId ? "Cancelling…" : "Cancel", "cancel", job.id);
    cancel.disabled = cancelRequested && job.id === activeJobId;
    actions.append(cancel);
  } else if (job.state === "queued") {
    actions.append(actionButton("Cancel", "cancel", job.id));
  } else if (job.state === "done") {
    const save = actionButton(
      job.exporting ? "Saving…" : job.exportedAt ? "Save again" : "Save to device",
      "save",
      job.id,
      job.exportedAt ? "action-button" : "action-button primary"
    );
    save.disabled = Boolean(job.exporting);
    actions.append(save);
    actions.append(
      actionButton(
        pendingDeletes.has(job.id) ? "Delete?" : "Delete",
        "delete",
        job.id,
        pendingDeletes.has(job.id) ? "quiet-action confirm-delete" : "quiet-action"
      )
    );
  } else if (job.state === "failed") {
    actions.append(actionButton("Retry", "retry", job.id, "action-button primary"));
    actions.append(actionButton("Details", "details", job.id));
    actions.append(
      actionButton(
        pendingDeletes.has(job.id) ? "Delete?" : "Delete",
        "delete",
        job.id,
        pendingDeletes.has(job.id) ? "quiet-action confirm-delete" : "quiet-action"
      )
    );
  } else {
    actions.append(actionButton("Retry", "retry", job.id, "action-button primary"));
    actions.append(
      actionButton(
        pendingDeletes.has(job.id) ? "Delete?" : "Delete",
        "delete",
        job.id,
        pendingDeletes.has(job.id) ? "quiet-action confirm-delete" : "quiet-action"
      )
    );
  }

  actions.classList.add(`actions-${actions.children.length}`);
  row.append(actions);
}

function jobSort(a, b) {
  const aActive = globalThis.DownsJobs.ACTIVE_STATES.has(a.state) ? 1 : 0;
  const bActive = globalThis.DownsJobs.ACTIVE_STATES.has(b.state) ? 1 : 0;
  return bActive - aActive || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
}

function render() {
  const ordered = [...jobs.values()].sort(jobSort);
  jobsEl.textContent = "";

  for (const job of ordered) {
    const row = createElement("article", "job-row");
    row.dataset.state = job.state;
    if (job.exportedAt) {
      row.classList.add("is-saved");
    }
    const copy = createElement("div", "job-copy");
    copy.append(createElement("h2", "job-name", job.filename));
    copy.append(createElement("p", "job-state", stateText(job)));
    if (["queued", "downloading", "remuxing"].includes(job.state)) {
      copy.append(createElement("p", "job-meta", progressText(job)));
    }
    if (job.state === "done" && job.outputStorage === "memory") {
      copy.append(createElement("p", "job-meta", "Memory-only private copy · keep this page open"));
    }
    if (job.state === "failed") {
      copy.append(createElement("p", "job-error", errorText(job)));
    }
    if (job.exportError) {
      copy.append(createElement("p", "job-error", job.exportError));
    }
    if (["downloading", "remuxing"].includes(job.state)) {
      const progress = createElement("progress", "job-progress");
      progress.max = job.segmentCount || 1;
      progress.value = job.completedSegments || 0;
      progress.textContent = `${percentFor(job)}%`;
      progress.setAttribute("aria-label", `${job.filename} progress`);
      copy.append(progress);
    }
    row.append(copy);
    renderActions(job, row);
    renderDetails(job, row);
    jobsEl.append(row);
  }

  const summary = globalThis.DownsJobs.summarizeJobs(ordered);
  summaryEl.textContent = `${summary.active} active · ${summary.ready} ready`;
  clearExportedButton.hidden = !ordered.some((job) => job.state === "done" && job.exportedAt);
  clearExportedButton.textContent = clearExportedPending ? "Clear saved?" : "Clear saved";
  emptyEl.hidden = ordered.length !== 0;
}

function announce(message) {
  announcerEl.textContent = "";
  requestAnimationFrame(() => {
    announcerEl.textContent = message;
  });
}

async function persistJob(job, immediate = true) {
  jobs.set(job.id, job);
  render();
  const key = globalThis.DownsJobs.jobKey(job.id);

  if (immediate) {
    clearTimeout(persistTimers.get(job.id));
    persistTimers.delete(job.id);
    await ext.storage.local.set({ [key]: job });
    return;
  }

  if (!persistTimers.has(job.id)) {
    persistTimers.set(job.id, setTimeout(() => {
      persistTimers.delete(job.id);
      const latest = jobs.get(job.id);
      if (latest) {
        void ext.storage.local.set({ [key]: latest });
      }
    }, 400));
  }
}

function outputName(jobId) {
  return `downs-output-${jobId}.mp4`;
}

async function removeOutput(job) {
  memoryOutputs.delete(job.id);
  if (!navigator.storage?.getDirectory) {
    return;
  }
  const name = job.outputKey || outputName(job.id);
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
  } catch (_error) {
    // Missing output is already clean.
  }
}

async function hasStoredOutput(job) {
  if (job.outputStorage !== "opfs" || !job.outputKey || !navigator.storage?.getDirectory) {
    return false;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(job.outputKey);
    const file = await handle.getFile();
    return file.size > 0;
  } catch (_error) {
    return false;
  }
}

async function recoverJobs() {
  for (const job of [...jobs.values()]) {
    if (["downloading", "remuxing"].includes(job.state)) {
      await removeOutput(job);
      await persistJob(globalThis.DownsJobs.transitionJob(job, "failed", {
        error: {
          code: "manager-closed",
          message: "Processing stopped because Downs Downloads was closed. Retry to start again."
        },
        speedBytesPerSecond: 0
      }));
    } else if (job.state === "done" && job.outputStorage === "memory") {
      await persistJob(globalThis.DownsJobs.transitionJob(job, "failed", {
        error: {
          code: "output-lost",
          message: "The memory-only private copy was lost when Downs Downloads closed. Retry to rebuild it."
        },
        outputStorage: "",
        outputKey: "",
        outputSize: 0,
        exportedAt: 0,
        exporting: false
      }));
    } else if (job.state === "done" && job.outputStorage === "opfs" && !(await hasStoredOutput(job))) {
      await persistJob(globalThis.DownsJobs.transitionJob(job, "failed", {
        error: {
          code: "output-missing",
          message: "The private MP4 is no longer available. Retry to rebuild it."
        },
        outputStorage: "",
        outputKey: "",
        outputSize: 0,
        exportedAt: 0,
        exporting: false
      }));
    } else if (job.exporting) {
      await persistJob({
        ...job,
        exporting: false,
        exportError: "The previous Save to device action was interrupted."
      });
    }
  }
}

async function pruneHistory() {
  const { removed } = globalThis.DownsJobs.pruneJobs([...jobs.values()]);
  for (const job of removed) {
    await removeOutput(job);
    jobs.delete(job.id);
    await ext.storage.local.remove(globalThis.DownsJobs.jobKey(job.id));
  }
  render();
}

function clearActiveWorker() {
  activeWorker?.terminate();
  activeWorker = null;
  for (const leaseId of activeRequestLeases) {
    void ext.runtime.sendMessage({ type: "release-request-context", leaseId });
  }
  activeRequestLeases.clear();
  activeJobId = "";
  cancelRequested = false;
  speedSample = null;
}

async function failActiveJob(error) {
  const job = jobs.get(activeJobId);
  if (!job) {
    clearActiveWorker();
    return;
  }
  await removeOutput(job);
  const failed = globalThis.DownsJobs.transitionJob(job, "failed", {
    speedBytesPerSecond: 0,
    error: {
      code: error?.code || "worker",
      message: error?.message || "The processing worker stopped unexpectedly.",
      segmentIndex: error?.segmentIndex,
      httpStatus: error?.httpStatus
    }
  });
  clearActiveWorker();
  await persistJob(failed);
  announce(`${failed.filename} failed. ${errorText(failed)}`);
  void pumpQueue();
}

function calculateSpeed(bytes) {
  const now = performance.now();
  if (!speedSample) {
    speedSample = { bytes, time: now, speed: 0 };
    return 0;
  }
  const elapsed = now - speedSample.time;
  if (elapsed < 250 || bytes < speedSample.bytes) {
    return speedSample.speed;
  }
  const current = ((bytes - speedSample.bytes) * 1000) / elapsed;
  const speed = speedSample.speed ? (speedSample.speed * 0.6) + (current * 0.4) : current;
  speedSample = { bytes, time: now, speed };
  return Math.round(speed);
}

async function handleWorkerMessage(event) {
  const message = event.data;
  const job = jobs.get(activeJobId);
  if (!job) {
    return;
  }

  if (message?.type === "acquire-request-context") {
    let result;
    try {
      result = await ext.runtime.sendMessage({
        type: "acquire-request-context",
        url: message.url,
        requestContext: job.requestContext || {}
      });
    } catch (_error) {
      result = { leaseId: 0 };
    }
    if (result?.leaseId) {
      activeRequestLeases.add(result.leaseId);
    }
    activeWorker?.postMessage({
      type: "request-context-ready",
      requestId: message.requestId,
      leaseId: result?.leaseId || 0
    });
    return;
  }

  if (message?.type === "release-request-context") {
    const leaseId = Number(message.leaseId) || 0;
    activeRequestLeases.delete(leaseId);
    if (leaseId) {
      await ext.runtime.sendMessage({ type: "release-request-context", leaseId });
    }
    return;
  }

  if (message?.type === "progress") {
    const state = message.phase === "remuxing" ? "remuxing" : "downloading";
    const updated = globalThis.DownsJobs.transitionJob(job, state, {
      segmentCount: Number(message.total) || job.segmentCount || 0,
      completedSegments: Number(message.completed) || 0,
      bytesDownloaded: Number(message.bytes) || 0,
      speedBytesPerSecond: state === "downloading" ? calculateSpeed(Number(message.bytes) || 0) : 0,
      error: null
    });
    await persistJob(updated, false);
    return;
  }

  if (message?.type === "complete") {
    if (message.outputStorage === "memory" && message.file) {
      memoryOutputs.set(job.id, message.file);
    }
    const done = globalThis.DownsJobs.transitionJob(job, "done", {
      completedSegments: job.segmentCount,
      bytesDownloaded: Number(message.sourceBytes) || job.bytesDownloaded,
      outputSize: Number(message.size) || 0,
      outputStorage: message.outputStorage || "memory",
      outputKey: message.storageName || "",
      speedBytesPerSecond: 0,
      exportedAt: 0,
      exporting: false,
      exportError: "",
      error: null
    });
    clearActiveWorker();
    await persistJob(done);
    announce(`${done.filename} is ready to save.`);
    void pruneHistory();
    void pumpQueue();
    return;
  }

  if (message?.type === "cancelled") {
    const cancelled = globalThis.DownsJobs.transitionJob(job, "cancelled", {
      speedBytesPerSecond: 0,
      error: null
    });
    clearActiveWorker();
    await persistJob(cancelled);
    announce(`${cancelled.filename} cancelled.`);
    void pumpQueue();
    return;
  }

  if (message?.type === "error") {
    await failActiveJob(message);
  }
}

async function startJob(job) {
  activeJobId = job.id;
  cancelRequested = false;
  speedSample = null;
  await removeOutput(job);
  const downloading = globalThis.DownsJobs.transitionJob(job, "downloading", {
    segmentCount: 0,
    completedSegments: 0,
    bytesDownloaded: 0,
    speedBytesPerSecond: 0,
    outputStorage: "",
    outputKey: "",
    outputSize: 0,
    error: null,
    exportError: ""
  });
  await persistJob(downloading);

  try {
    activeWorker = new Worker("download-worker.js");
    activeWorker.addEventListener("message", (event) => void handleWorkerMessage(event));
    activeWorker.addEventListener("error", (event) => {
      void failActiveJob({ code: "worker", message: event.message || "The processing worker stopped." });
    });
    activeWorker.postMessage({ type: "start", job: downloading });
  } catch (error) {
    await failActiveJob({ code: "worker", message: error?.message || "Could not start the processing worker." });
  }
}

async function pumpQueue() {
  if (activeWorker || activeJobId) {
    return;
  }
  const next = [...jobs.values()]
    .filter((job) => job.state === "queued")
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))[0];
  if (next) {
    await startJob(next);
  }
}

async function cancelJob(job) {
  if (job.id === activeJobId && activeWorker) {
    cancelRequested = true;
    render();
    activeWorker.postMessage({ type: "cancel" });
    return;
  }
  if (job.state === "queued") {
    await persistJob(globalThis.DownsJobs.transitionJob(job, "cancelled", { error: null }));
  }
}

async function retryJob(job) {
  const queued = globalThis.DownsJobs.resetForRetry(job);
  jobs.set(job.id, queued);
  render();
  await removeOutput(job);
  memoryOutputs.delete(job.id);
  pendingDeletes.delete(job.id);
  await persistJob(queued);
  announce(`${job.filename} queued to retry from the current playlist.`);
  await pumpQueue();
}

async function deleteJob(job) {
  if (!pendingDeletes.has(job.id)) {
    pendingDeletes.add(job.id);
    render();
    return;
  }
  pendingDeletes.delete(job.id);
  detailJobs.delete(job.id);
  clearTimeout(persistTimers.get(job.id));
  persistTimers.delete(job.id);
  await removeOutput(job);
  jobs.delete(job.id);
  await ext.storage.local.remove(globalThis.DownsJobs.jobKey(job.id));
  render();
  announce(`${job.filename} deleted from Downs.`);
}

async function outputFile(job) {
  if (job.outputStorage === "memory") {
    const file = memoryOutputs.get(job.id);
    if (!file) {
      throw new Error("The memory-only private copy is no longer available. Retry to rebuild it.");
    }
    return file;
  }
  if (job.outputStorage === "opfs" && job.outputKey && navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(job.outputKey);
    return handle.getFile();
  }
  throw new Error("The private MP4 is no longer available. Retry to rebuild it.");
}

async function finishExport(downloadId, state, browserError = "") {
  const pending = exportDownloads.get(downloadId);
  if (!pending) {
    return;
  }
  exportDownloads.delete(downloadId);
  URL.revokeObjectURL(pending.objectUrl);
  const job = jobs.get(pending.jobId);
  if (!job) {
    return;
  }
  if (state === "complete") {
    await persistJob({
      ...job,
      updatedAt: Date.now(),
      exportedAt: Date.now(),
      exporting: false,
      exportError: ""
    });
    announce(`${job.filename} saved to the device.`);
  } else {
    await persistJob({
      ...job,
      updatedAt: Date.now(),
      exporting: false,
      exportError: browserError || "The browser did not finish saving this file."
    });
  }
}

function onDownloadChanged(delta) {
  if (!delta.state || !exportDownloads.has(delta.id)) {
    return;
  }
  if (["complete", "interrupted"].includes(delta.state.current)) {
    void finishExport(delta.id, delta.state.current, delta.error?.current || "");
  }
}

async function saveJob(job) {
  await persistJob({ ...job, updatedAt: Date.now(), exporting: true, exportError: "" });
  let objectUrl = "";
  try {
    const file = await outputFile(job);
    objectUrl = URL.createObjectURL(file);
    const downloadId = await ext.downloads.download({
      url: objectUrl,
      filename: globalThis.DownsDownload.safeFilename(job.filename),
      conflictAction: "uniquify",
      saveAs: true
    });
    exportDownloads.set(downloadId, { jobId: job.id, objectUrl });
    const matches = await ext.downloads.search({ id: downloadId });
    const state = matches?.[0]?.state;
    if (state === "complete" || state === "interrupted") {
      await finishExport(downloadId, state);
    }
  } catch (error) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    const latest = jobs.get(job.id) || job;
    await persistJob({
      ...latest,
      updatedAt: Date.now(),
      exporting: false,
      exportError: `Save to device failed: ${error?.message || "unknown browser error"}`
    });
  }
}

async function clearExported() {
  if (!clearExportedPending) {
    clearExportedPending = true;
    render();
    return;
  }
  clearExportedPending = false;
  const exported = [...jobs.values()].filter((job) => job.state === "done" && job.exportedAt);
  for (const job of exported) {
    await removeOutput(job);
    jobs.delete(job.id);
    await ext.storage.local.remove(globalThis.DownsJobs.jobKey(job.id));
  }
  render();
  announce(`${exported.length} exported download${exported.length === 1 ? "" : "s"} cleared.`);
}

async function loadSettings() {
  const stored = await ext.storage.local.get(globalThis.DownsDownload.SETTINGS_KEY);
  const storedMode = stored[globalThis.DownsDownload.SETTINGS_KEY]?.filenameMode;
  const mode = globalThis.DownsDownload.FILENAME_MODES.has(storedMode) ? storedMode : "suggested";
  for (const input of filenameModeInputs) {
    input.checked = input.value === mode;
  }
  dateExampleEl.textContent = globalThis.DownsDownload.dateStampFilename(new Date());
  hashExampleEl.textContent = `${globalThis.DownsDownload.randomHash()}.mp4`;
}

async function saveFilenameMode(mode) {
  const filenameMode = globalThis.DownsDownload.FILENAME_MODES.has(mode) ? mode : "suggested";
  await ext.storage.local.set({
    [globalThis.DownsDownload.SETTINGS_KEY]: { filenameMode }
  });
  announce(`New downloads will use ${filenameMode === "suggested" ? "the suggested title" : filenameMode === "date" ? "a date stamp" : "a random hash"}.`);
}

async function openSettings() {
  priorSettingsFocus = document.activeElement;
  await loadSettings();
  settingsLayer.hidden = false;
  document.body.classList.add("settings-open");
  document.body.style.overflow = "hidden";
  const checked = filenameModeInputs.find((input) => input.checked);
  (checked || closeSettingsButton).focus();
}

function closeSettings() {
  settingsLayer.hidden = true;
  document.body.classList.remove("settings-open");
  document.body.style.overflow = "";
  priorSettingsFocus?.focus();
  priorSettingsFocus = null;
}

async function handleAction(action, job) {
  if (action === "cancel") {
    await cancelJob(job);
  } else if (action === "retry") {
    await retryJob(job);
  } else if (action === "delete") {
    await deleteJob(job);
  } else if (action === "save") {
    await saveJob(job);
  } else if (action === "details") {
    if (detailJobs.has(job.id)) {
      detailJobs.delete(job.id);
    } else {
      detailJobs.add(job.id);
    }
    render();
  }
}

async function loadJobs() {
  const stored = await ext.storage.local.get(null);
  for (const [key, value] of Object.entries(stored)) {
    if (globalThis.DownsJobs.isJobKey(key) && value?.id) {
      jobs.set(value.id, value);
    }
  }
  await recoverJobs();
  await pruneHistory();
  render();
  await pumpQueue();
}

jobsEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const job = jobs.get(button.dataset.jobId);
  if (job) {
    void handleAction(button.dataset.action, job);
  }
});

clearExportedButton.addEventListener("click", () => void clearExported());
openSettingsButton.addEventListener("click", () => void openSettings());
settingsScrim.addEventListener("click", closeSettings);
closeSettingsButton.addEventListener("click", closeSettings);
settingsDoneButton.addEventListener("click", closeSettings);
for (const input of filenameModeInputs) {
  input.addEventListener("change", () => {
    if (input.checked) void saveFilenameMode(input.value);
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsLayer.hidden) closeSettings();
});
ext.downloads.onChanged.addListener(onDownloadChanged);
ext.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  let changed = false;
  for (const [key, change] of Object.entries(changes)) {
    if (key === globalThis.DownsDownload.SETTINGS_KEY && !settingsLayer.hidden) {
      void loadSettings();
      continue;
    }
    if (!globalThis.DownsJobs.isJobKey(key)) {
      continue;
    }
    changed = true;
    if (change.newValue?.id) {
      jobs.set(change.newValue.id, change.newValue);
    } else if (change.oldValue?.id) {
      jobs.delete(change.oldValue.id);
    }
  }
  if (changed) {
    render();
    void pumpQueue();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (activeWorker || exportDownloads.size) {
    event.preventDefault();
    event.returnValue = "";
  }
});

void loadJobs().catch((error) => {
  summaryEl.textContent = "Could not load downloads";
  emptyEl.hidden = false;
  emptyEl.querySelector("h2").textContent = "Downloads unavailable";
  emptyEl.querySelector("p").textContent = error?.message || "Extension storage could not be opened.";
});
