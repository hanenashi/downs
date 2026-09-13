"use strict";

const ext = globalThis.browser || globalThis.chrome;
const sourceEl = document.getElementById("source");
const filenameEl = document.getElementById("filename");
const supportEl = document.getElementById("support");
const readyStatusEl = document.getElementById("ready-status");
const startButton = document.getElementById("start");
const activityEl = document.getElementById("activity");
const activityTitleEl = document.getElementById("activity-title");
const activityDetailEl = document.getElementById("activity-detail");
const activityMetaEl = document.getElementById("activity-meta");
const progressEl = document.getElementById("progress");
const cancelButton = document.getElementById("cancel");
const resultEl = document.getElementById("result");
const resultTitleEl = document.getElementById("result-title");
const resultMessageEl = document.getElementById("result-message");
const doneButton = document.getElementById("done");

let job = null;
let worker = null;
let downloadId = null;
let objectUrl = "";
let storageName = "";

function jobIdFromHash() {
  return decodeURIComponent(location.hash.replace(/^#/, ""));
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
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function setReady(enabled, message = "Ready to process") {
  startButton.disabled = !enabled;
  filenameEl.disabled = !enabled;
  readyStatusEl.textContent = message;
}

function showResult(kind, title, message, showDone = false) {
  resultEl.hidden = false;
  resultEl.className = `result ${kind}`;
  resultTitleEl.textContent = title;
  resultMessageEl.textContent = message;
  doneButton.hidden = !showDone;
}

function clearResult() {
  resultEl.hidden = true;
  resultEl.className = "result";
  doneButton.hidden = true;
}

async function removeStoredOutput(name) {
  if (!name || !navigator.storage?.getDirectory) {
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name);
  } catch (_error) {
    // A failed/cancelled worker may already have removed the partial file.
  }
}

async function finishJob() {
  if (job?.id) {
    try {
      await ext.runtime.sendMessage({ type: "finish-download-job", id: job.id });
    } catch (_error) {
      // Cleanup is best-effort if the extension is being reloaded.
    }
  }
}

async function releaseOutput() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = "";
  }
  await removeStoredOutput(storageName);
  storageName = "";
}

async function downloadState(id) {
  try {
    const matches = await ext.downloads.search({ id });
    return matches?.[0]?.state || "";
  } catch (_error) {
    return "";
  }
}

async function handleDownloadTerminal(state, errorText = "") {
  ext.downloads.onChanged.removeListener(onDownloadChanged);
  cancelButton.disabled = true;
  activityEl.hidden = true;
  await releaseOutput();
  await finishJob();

  if (state === "complete") {
    showResult(
      "success",
      "MP4 sent to your browser",
      `${globalThis.DownsDownload.safeFilename(filenameEl.value)} is saved.`,
      true
    );
    setReady(false, "Done");
  } else {
    showResult(
      "error",
      "Browser save interrupted",
      errorText || "The browser did not finish saving the MP4."
    );
    setReady(true, "You can try again");
    downloadId = null;
  }
}

function onDownloadChanged(delta) {
  if (delta.id !== downloadId || !delta.state) {
    return;
  }
  if (delta.state.current === "complete" || delta.state.current === "interrupted") {
    void handleDownloadTerminal(delta.state.current, delta.error?.current || "");
  }
}

async function handToBrowser(file) {
  activityTitleEl.textContent = "Saving MP4";
  activityDetailEl.textContent = "Waiting for the browser";
  activityMetaEl.textContent = `${formatBytes(file.size)} output`;
  progressEl.value = 1;
  progressEl.max = 1;

  objectUrl = URL.createObjectURL(file);
  ext.downloads.onChanged.addListener(onDownloadChanged);
  try {
    downloadId = await ext.downloads.download({
      url: objectUrl,
      filename: globalThis.DownsDownload.safeFilename(filenameEl.value),
      conflictAction: "uniquify",
      saveAs: true
    });
  } catch (error) {
    ext.downloads.onChanged.removeListener(onDownloadChanged);
    await releaseOutput();
    throw new Error(`Browser save could not start: ${error?.message || "unknown download error"}`);
  }

  const state = await downloadState(downloadId);
  if (state === "complete" || state === "interrupted") {
    await handleDownloadTerminal(state);
  }
}

function updateProgress(message) {
  const completed = Number(message.completed) || 0;
  const total = Number(message.total) || 0;
  activityTitleEl.textContent = message.message || "Building MP4";
  activityDetailEl.textContent = total ? `${completed} of ${total} segments` : "Reading playlist";
  progressEl.max = total || 1;
  progressEl.value = total ? completed : 0;
  activityMetaEl.textContent = message.outputBytes
    ? `${formatBytes(message.bytes)} fetched · ${formatBytes(message.outputBytes)} MP4`
    : `${formatBytes(message.bytes)} fetched`;
}

async function handleWorkerMessage(event) {
  const message = event.data;
  if (message?.type === "progress") {
    updateProgress(message);
    return;
  }

  if (message?.type === "complete") {
    storageName = message.storageName || "";
    worker?.terminate();
    worker = null;
    try {
      await handToBrowser(message.file);
    } catch (error) {
      activityEl.hidden = true;
      showResult("error", "Could not save MP4", error?.message || "The browser save failed.");
      setReady(true, "You can try again");
    }
    return;
  }

  if (message?.type === "cancelled") {
    worker?.terminate();
    worker = null;
    activityEl.hidden = true;
    showResult("error", "Download cancelled", "The partial MP4 was removed.");
    setReady(true, "Ready to process");
    return;
  }

  if (message?.type === "error") {
    worker?.terminate();
    worker = null;
    activityEl.hidden = true;
    const unsupportedCodes = new Set([
      "byte-range",
      "container",
      "discontinuity",
      "empty",
      "encrypted",
      "fmp4",
      "gap",
      "iframe-only",
      "live",
      "master",
      "not-hls",
      "not-media",
      "protected",
      "separate-audio",
      "tracks",
      "transmux-empty"
    ]);
    showResult(
      "error",
      unsupportedCodes.has(message.code) ? "Download not supported" : "Download failed",
      message.message || "The download failed."
    );
    setReady(true, "You can try again");
  }
}

function startDownload() {
  if (!job || worker) {
    return;
  }

  clearResult();
  filenameEl.value = globalThis.DownsDownload.safeFilename(filenameEl.value);
  setReady(false, "Processing in this tab…");
  activityEl.hidden = false;
  cancelButton.disabled = false;
  updateProgress({ message: "Checking playlist…", completed: 0, total: 0, bytes: 0 });

  try {
    worker = new Worker("download-worker.js");
    worker.addEventListener("message", (event) => void handleWorkerMessage(event));
    worker.addEventListener("error", (event) => {
      activityEl.hidden = true;
      showResult("error", "Download failed", event.message || "The processing worker stopped.");
      setReady(true, "You can try again");
      worker?.terminate();
      worker = null;
    });
    worker.postMessage({ type: "start", job });
  } catch (error) {
    activityEl.hidden = true;
    showResult("error", "Download failed", error?.message || "Could not start the processing worker.");
    setReady(true, "You can try again");
    worker = null;
  }
}

async function cancelDownload() {
  cancelButton.disabled = true;
  activityTitleEl.textContent = "Cancelling…";
  if (downloadId !== null) {
    try {
      await ext.downloads.cancel(downloadId);
    } catch (_error) {
      await handleDownloadTerminal("interrupted", "Download cancelled.");
    }
  } else if (worker) {
    worker.postMessage({ type: "cancel" });
  }
}

async function loadJob() {
  const id = jobIdFromHash();
  if (!id) {
    sourceEl.textContent = "No download job was provided.";
    supportEl.textContent = "Open a supported media playlist from the Downs popup.";
    supportEl.classList.add("unsupported");
    setReady(false, "Download job unavailable");
    return;
  }

  try {
    const response = await ext.runtime.sendMessage({ type: "get-download-job", id });
    if (!response?.ok || !response.job) {
      throw new Error(response?.error?.message || "This download job expired.");
    }

    job = response.job;
    sourceEl.textContent = job.url;
    filenameEl.value = job.filename;
    supportEl.textContent = job.supportSummary;
    supportEl.classList.remove("unsupported");
    setReady(true, "Ready to process");
  } catch (error) {
    sourceEl.textContent = "Download job unavailable";
    supportEl.textContent = error?.message || "This download job could not be loaded.";
    supportEl.classList.add("unsupported");
    setReady(false, "Return to the source tab and open Downs again");
  }
}

startButton.addEventListener("click", startDownload);
cancelButton.addEventListener("click", () => void cancelDownload());
doneButton.addEventListener("click", () => window.close());
filenameEl.addEventListener("blur", () => {
  filenameEl.value = globalThis.DownsDownload.safeFilename(filenameEl.value);
});
window.addEventListener("beforeunload", (event) => {
  if (worker || downloadId !== null) {
    event.preventDefault();
    event.returnValue = "";
  }
});

void loadJob();
