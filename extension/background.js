const ext = globalThis.browser || globalThis.chrome;

if (!globalThis.DownsHls && typeof importScripts === "function") {
  importScripts("hls-parser.js");
}
if (!globalThis.DownsBlobPlaylist && typeof importScripts === "function") {
  importScripts("blob-playlist-core.js");
}
if (!globalThis.DownsDash && typeof importScripts === "function") {
  importScripts("dash-parser.js");
}
if (!globalThis.DownsAes && typeof importScripts === "function") {
  importScripts("aes-core.js");
}
if (!globalThis.DownsDownload && typeof importScripts === "function") {
  importScripts("download-core.js");
}
if (!globalThis.DownsJobs && typeof importScripts === "function") {
  importScripts("job-core.js");
}
if (!globalThis.DownsRequestContext && typeof importScripts === "function") {
  importScripts("request-context.js");
}

const MAX_LINKS_PER_TAB = 50;
const MAX_BLOB_LINKS_PER_TAB = 10;
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const PLAYLIST_TIMEOUT_MS = 20_000;
const REQUEST_RULE_FIRST = 880_000;
const REQUEST_RULE_LAST = 880_999;
const tabQueues = new Map();
const requestContexts = new Map();
const activeRequestRules = new Set();
let nextRequestRuleId = REQUEST_RULE_FIRST;
const tabStorageArea = ext.storage.session || ext.storage.local;
const jobStorageArea = ext.storage.local;

function storageKey(tabId) {
  return `tab:${tabId}`;
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch (_error) {
    return "";
  }
}

function responseHeader(details, wantedName) {
  const wanted = wantedName.toLowerCase();
  const header = (details.responseHeaders || []).find(
    (candidate) => (candidate.name || "").toLowerCase() === wanted
  );
  return header?.value || "";
}

function manifestKind(details) {
  const url = details.url || "";
  if (/\.m3u8(?:$|[?#])/i.test(url)) {
    return "hls";
  }
  if (/\.mpd(?:$|[?#])/i.test(url)) {
    return "dash";
  }

  const contentType = responseHeader(details, "content-type").toLowerCase();
  if ([
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl"
  ].some((type) => contentType.includes(type))) {
    return "hls";
  }
  if (
    contentType.includes("application/dash+xml") ||
    contentType.includes("application/vnd.dvb.dash-playlist+xml")
  ) {
    return "dash";
  }
  return "";
}

function summarizeRequestHeaders(details) {
  const summary = {
    referer: "",
    hasCookie: false,
    hasAuthorization: false
  };

  for (const header of details.requestHeaders || []) {
    const name = (header.name || "").toLowerCase();
    if (name === "referer") {
      summary.referer = header.value || "";
    } else if (name === "cookie") {
      summary.hasCookie = true;
    } else if (name === "authorization") {
      summary.hasAuthorization = true;
    }
  }

  return globalThis.DownsRequestContext.sanitize(summary);
}

async function clearStaleRequestRules() {
  if (!ext.declarativeNetRequest?.getSessionRules) {
    return;
  }
  const rules = await ext.declarativeNetRequest.getSessionRules();
  const removeRuleIds = rules
    .map((rule) => rule.id)
    .filter((id) => id >= REQUEST_RULE_FIRST && id <= REQUEST_RULE_LAST);
  if (removeRuleIds.length) {
    await ext.declarativeNetRequest.updateSessionRules({ removeRuleIds });
  }
}

const requestRulesReady = clearStaleRequestRules().catch(() => undefined);

async function acquireRequestRule(rawUrl, rawContext) {
  const api = ext.declarativeNetRequest;
  if (!api?.updateSessionRules) {
    return { leaseId: 0, replayed: false };
  }
  await requestRulesReady;
  let leaseId = 0;
  for (let count = 0; count <= REQUEST_RULE_LAST - REQUEST_RULE_FIRST; count += 1) {
    const candidate = nextRequestRuleId;
    nextRequestRuleId = candidate >= REQUEST_RULE_LAST ? REQUEST_RULE_FIRST : candidate + 1;
    if (!activeRequestRules.has(candidate)) {
      leaseId = candidate;
      break;
    }
  }
  if (!leaseId) {
    throw new Error("Too many simultaneous request-context operations.");
  }
  const rule = globalThis.DownsRequestContext.createRefererRule(
    leaseId,
    normalizeUrl(rawUrl),
    rawContext,
    new URL(ext.runtime.getURL("")).hostname
  );
  if (!rule) {
    return { leaseId: 0, replayed: false };
  }
  await api.updateSessionRules({ addRules: [rule] });
  activeRequestRules.add(leaseId);
  return { leaseId, replayed: true };
}

async function releaseRequestRule(leaseId) {
  if (!activeRequestRules.delete(leaseId)) {
    return;
  }
  await ext.declarativeNetRequest.updateSessionRules({ removeRuleIds: [leaseId] });
}

async function withRequestContext(url, context, operation) {
  let lease = { leaseId: 0, replayed: false };
  try {
    lease = await acquireRequestRule(url, context);
  } catch (_error) {
    // A browser without usable session rules falls back to the ordinary request.
  }
  try {
    return await operation(lease.replayed);
  } finally {
    if (lease.leaseId) {
      await releaseRequestRule(lease.leaseId).catch(() => undefined);
    }
  }
}

async function readResponsePrefix(response, limit) {
  if (!response.body?.getReader) {
    const contentLength = Number(response.headers.get("content-length"));
    if (!Number.isFinite(contentLength) || contentLength > 64 * 1024) return new Uint8Array();
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.slice(0, limit);
  }
  const reader = response.body.getReader();
  const prefix = new Uint8Array(limit);
  let written = 0;
  try {
    while (written < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      const count = Math.min(chunk.byteLength, limit - written);
      prefix.set(chunk.subarray(0, count), written);
      written += count;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return prefix.subarray(0, written);
}

async function probeMpegTs(rawUrl, requestContext, signal) {
  const url = normalizeUrl(rawUrl);
  if (!url) return false;
  try {
    const response = await withRequestContext(url, requestContext, () => fetch(url, {
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      signal,
      headers: { Range: "bytes=0-375" }
    }));
    if (!response.ok) return false;
    return globalThis.DownsHls.looksLikeMpegTs(await readResponsePrefix(response, 376));
  } catch (_error) {
    return false;
  }
}

function rememberRequestContext(details) {
  if (details.tabId < 0) {
    return;
  }

  requestContexts.set(details.requestId, {
    method: details.method || "GET",
    ...summarizeRequestHeaders(details)
  });
}

function registerRequestHeaderListener() {
  const filter = { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] };

  try {
    ext.webRequest.onBeforeSendHeaders.addListener(
      rememberRequestContext,
      filter,
      ["requestHeaders", "extraHeaders"]
    );
  } catch (_error) {
    ext.webRequest.onBeforeSendHeaders.addListener(
      rememberRequestContext,
      filter,
      ["requestHeaders"]
    );
  }
}

async function getTabLinks(tabId) {
  const key = storageKey(tabId);
  const stored = await tabStorageArea.get(key);
  return stored[key] || [];
}

async function setTabLinks(tabId, links) {
  await tabStorageArea.set({ [storageKey(tabId)]: links.slice(0, MAX_LINKS_PER_TAB) });
}

function publicLink(link) {
  const { playlistText: _playlistText, ...safe } = link;
  return safe;
}

function limitBlobLinks(links) {
  let blobCount = 0;
  return links.filter((link) => {
    if (link.discoverySource !== "blob-playlist") return true;
    blobCount += 1;
    return blobCount <= MAX_BLOB_LINKS_PER_TAB;
  });
}

function queueTabUpdate(tabId, operation) {
  const previous = tabQueues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  tabQueues.set(tabId, next);
  const cleanUp = () => {
    if (tabQueues.get(tabId) === next) {
      tabQueues.delete(tabId);
    }
  };
  next.then(cleanUp, cleanUp);
  return next;
}

async function rememberLink(details) {
  const mediaType = manifestKind(details);
  if (details.tabId < 0 || !mediaType) {
    requestContexts.delete(details.requestId);
    return;
  }

  const url = normalizeUrl(details.url);
  if (!url) {
    requestContexts.delete(details.requestId);
    return;
  }

  const requestContext = requestContexts.get(details.requestId) || {};
  requestContexts.delete(details.requestId);

  await queueTabUpdate(details.tabId, async () => {
    const links = await getTabLinks(details.tabId);
    const existing = links.find((link) => link.url === url);

    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.hitCount = (existing.hitCount || 1) + 1;
      existing.statusCode = details.statusCode;
      existing.contentType = responseHeader(details, "content-type");
      existing.requestContext = requestContext;
      existing.mediaType = mediaType;
    } else {
      links.unshift({
        url,
        pageUrl: details.documentUrl || details.initiator || "",
        initiator: details.initiator || "",
        foundAt: Date.now(),
        lastSeenAt: Date.now(),
        hitCount: 1,
        statusCode: details.statusCode,
        contentType: responseHeader(details, "content-type"),
        mediaType,
        discoverySource: "network",
        requestContext
      });
    }

    await setTabLinks(details.tabId, links);
    await ext.action.setBadgeText({
      tabId: details.tabId,
      text: String(Math.min(links.length, 99))
    });
    await ext.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#1f6b3a" });
  });
}

async function rememberBlobPlaylist(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || tabId < 0) {
    return { ok: false, accepted: false };
  }

  const validation = globalThis.DownsBlobPlaylist.validateCandidate({
    text: message.text,
    contentType: message.contentType,
    baseUrl: message.baseUrl,
    frameUrl: sender.url || message.frameUrl,
    pageUrl: sender.tab?.url || message.pageUrl
  });
  if (!validation.ok) {
    return { ok: true, accepted: false, reason: validation.code };
  }

  const candidate = validation.candidate;
  await queueTabUpdate(tabId, async () => {
    const links = await getTabLinks(tabId);
    const existing = links.find((link) =>
      link.discoverySource === "blob-playlist" &&
      link.baseUrl === candidate.baseUrl &&
      link.playlistText === candidate.text
    );
    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.hitCount = (existing.hitCount || 1) + 1;
    } else {
      const id = createJobId();
      links.unshift({
        url: `downs-blob://${id}/playlist.m3u8`,
        inlinePlaylistId: id,
        discoverySource: "blob-playlist",
        playlistText: candidate.text,
        playlistBytes: candidate.byteLength,
        baseUrl: candidate.baseUrl,
        frameUrl: candidate.frameUrl,
        pageUrl: candidate.pageUrl,
        initiator: candidate.frameUrl,
        foundAt: Date.now(),
        lastSeenAt: Date.now(),
        hitCount: 1,
        statusCode: 0,
        contentType: candidate.contentType,
        requestContext: {}
      });
    }

    const kept = limitBlobLinks(links);
    await setTabLinks(tabId, kept);
    await ext.action.setBadgeText({
      tabId,
      text: String(Math.min(kept.length, 99))
    });
    await ext.action.setBadgeBackgroundColor({ tabId, color: "#1f6b3a" });
  });
  return { ok: true, accepted: true };
}

function forgetRequest(details) {
  requestContexts.delete(details.requestId);
}

async function inspectPlaylist(rawUrl, requestContext = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { ok: false, error: { code: "invalid-url", message: "This is not an HTTP or HTTPS URL." } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);

  try {
    let refererReplayed = false;
    const response = await withRequestContext(url, requestContext, async (replayed) => {
      refererReplayed = replayed;
      return fetch(url, {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, audio/mpegurl, */*"
        }
      });
    });

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PLAYLIST_BYTES) {
      return {
        ok: false,
        error: { code: "too-large", message: "The response is too large to be an HLS playlist." }
      };
    }

    const body = await response.text();
    if (body.length > MAX_PLAYLIST_BYTES) {
      return {
        ok: false,
        error: { code: "too-large", message: "The response is too large to be an HLS playlist." }
      };
    }

    const fetchInfo = {
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || url,
      contentType: response.headers.get("content-type") || "",
      refererReplayed
    };

    if (!response.ok) {
      return {
        ok: false,
        fetch: fetchInfo,
        error: {
          code: "http",
          message: `Playlist request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`
        }
      };
    }

    const playlist = globalThis.DownsHls.parsePlaylist(body, fetchInfo.finalUrl);
    if (playlist.kind === "not-hls") {
      return {
        ok: false,
        fetch: fetchInfo,
        playlist,
        error: { code: "not-hls", message: playlist.reason }
      };
    }

    if (
      playlist.kind === "media" &&
      playlist.segmented === "unknown" &&
      !playlist.encrypted &&
      !playlist.hasByteRanges &&
      playlist.segments[0]?.url &&
      await probeMpegTs(playlist.segments[0].url, requestContext, controller.signal)
    ) {
      playlist.segmented = "ts";
      playlist.containerProbe = "mpeg-ts-sync";
    }

    return { ok: true, fetch: fetchInfo, playlist };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      error: {
        code: timedOut ? "timeout" : "network",
        message: timedOut
          ? "Playlist request timed out after 20 seconds."
          : `Playlist request failed: ${error?.message || "unknown network error"}`
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectDash(rawUrl, requestContext = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { ok: false, error: { code: "invalid-url", message: "This is not an HTTP or HTTPS URL." } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);
  try {
    let refererReplayed = false;
    const response = await withRequestContext(url, requestContext, async (replayed) => {
      refererReplayed = replayed;
      return fetch(url, {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: { Accept: "application/dash+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1" }
      });
    });

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PLAYLIST_BYTES) {
      return { ok: false, error: { code: "too-large", message: "The response is too large to be a DASH MPD." } };
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_PLAYLIST_BYTES) {
      return { ok: false, error: { code: "too-large", message: "The response is too large to be a DASH MPD." } };
    }

    const fetchInfo = {
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || url,
      contentType: response.headers.get("content-type") || "",
      refererReplayed,
      source: "network"
    };
    if (!response.ok) {
      return {
        ok: false,
        fetch: fetchInfo,
        error: {
          code: "http",
          message: `MPD request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`
        }
      };
    }

    let dash;
    try {
      dash = globalThis.DownsDash.parseMpd(body, fetchInfo.finalUrl);
    } catch (error) {
      return {
        ok: false,
        fetch: fetchInfo,
        error: { code: "invalid-mpd", message: `The MPD XML is invalid: ${error?.message || "parse error"}` }
      };
    }
    if (dash.kind !== "dash") {
      return {
        ok: false,
        fetch: fetchInfo,
        dash,
        error: { code: "not-dash", message: dash.reason }
      };
    }
    return { ok: true, fetch: fetchInfo, dash };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      error: {
        code: timedOut ? "timeout" : "network",
        message: timedOut
          ? "MPD request timed out after 20 seconds."
          : `MPD request failed: ${error?.message || "unknown network error"}`
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectBlobPlaylist(inlinePlaylistId) {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return { ok: false, error: { code: "missing-tab", message: "The source tab is no longer available." } };
  }
  const links = await getTabLinks(tab.id);
  const link = links.find((candidate) =>
    candidate.discoverySource === "blob-playlist" &&
    candidate.inlinePlaylistId === inlinePlaylistId
  );
  if (!link?.playlistText) {
    return {
      ok: false,
      error: { code: "missing-blob-playlist", message: "This in-memory playlist is no longer available." }
    };
  }

  const playlist = globalThis.DownsHls.parsePlaylist(link.playlistText, link.baseUrl);
  if (playlist.kind === "not-hls") {
    return {
      ok: false,
      playlist,
      error: { code: "not-hls", message: playlist.reason }
    };
  }
  return {
    ok: true,
    fetch: {
      status: 0,
      statusText: "",
      finalUrl: link.url,
      contentType: link.contentType,
      refererReplayed: false,
      source: "blob-playlist",
      baseUrl: link.baseUrl
    },
    playlist
  };
}

function createJobId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function startDownloadJob(message) {
  const requestContext = globalThis.DownsRequestContext.sanitize(message.requestContext);
  const inspection = await inspectPlaylist(message.url, requestContext);
  if (!inspection.ok) {
    return inspection;
  }

  let audioInspection = null;
  let eligibility = globalThis.DownsDownload.validateDirectPlaylist(inspection.playlist, {
    hasSeparateAudio: Boolean(message.hasSeparateAudio),
    audioPlaylistUrl: message.audioPlaylistUrl
  });
  if (eligibility.supported && eligibility.code === "direct-fmp4-split-vod") {
    audioInspection = await inspectPlaylist(message.audioPlaylistUrl, requestContext);
    if (!audioInspection.ok) {
      return {
        ok: false,
        error: {
          code: "audio-playlist",
          message: `The selected audio playlist could not be inspected: ${audioInspection.error?.message || "unknown error"}`
        }
      };
    }
    eligibility = globalThis.DownsDownload.validateSplitFmp4Playlists(
      inspection.playlist,
      audioInspection.playlist
    );
  }
  if (!eligibility.supported) {
    return {
      ok: false,
      error: { code: eligibility.code, message: eligibility.reason }
    };
  }

  const [sourceTab] = await ext.tabs.query({ active: true, currentWindow: true });
  const storedSettings = await jobStorageArea.get(globalThis.DownsDownload.SETTINGS_KEY);
  const filenameMode = storedSettings[globalThis.DownsDownload.SETTINGS_KEY]?.filenameMode || "suggested";
  const outputMode = message.outputMode === "source-bundle" ? "source-bundle" : "mp4";
  if (outputMode === "source-bundle" && eligibility.code === "direct-ts-aes128-vod") {
    return {
      ok: false,
      error: {
        code: "encrypted-source-bundle",
        message: "Encrypted source bundles are disabled because Downs never stores decryption keys."
      }
    };
  }
  const id = createJobId();
  const suggestedFilename = globalThis.DownsDownload.filenameForMode(
    sourceTab?.title || "downs-video",
    message.variantLabel || "",
    filenameMode
  );
  const job = globalThis.DownsJobs.createJob({
    id,
    playlistUrl: inspection.fetch.finalUrl,
    audioPlaylistUrl: audioInspection?.fetch.finalUrl || "",
    sourcePageTitle: sourceTab?.title || "",
    filename: globalThis.DownsDownload.outputFilename(suggestedFilename, outputMode),
    variantLabel: message.variantLabel || "",
    hasSeparateAudio: Boolean(message.hasSeparateAudio),
    audioLabel: message.audioLabel || "",
    supportMode: eligibility.code,
    outputMode,
    supportSummary: eligibility.reason,
    requestContext
  });

  await jobStorageArea.set({ [globalThis.DownsJobs.jobKey(id)]: job });
  await openDownloadsManager();
  return { ok: true, id };
}

async function startDashDownloadJob(message) {
  const requestContext = globalThis.DownsRequestContext.sanitize(message.requestContext);
  const inspection = await inspectDash(message.url, requestContext);
  if (!inspection.ok) return inspection;

  const eligibility = globalThis.DownsDash.validateDirectPair(
    inspection.dash,
    message.videoRepresentationId,
    message.audioRepresentationId
  );
  if (!eligibility.supported) {
    return { ok: false, error: { code: eligibility.code, message: eligibility.reason } };
  }

  const [sourceTab] = await ext.tabs.query({ active: true, currentWindow: true });
  const storedSettings = await jobStorageArea.get(globalThis.DownsDownload.SETTINGS_KEY);
  const filenameMode = storedSettings[globalThis.DownsDownload.SETTINGS_KEY]?.filenameMode || "suggested";
  const id = createJobId();
  const variantLabel = message.videoLabel || (eligibility.video.height ? `${eligibility.video.height}p` : "DASH");
  const suggestedFilename = globalThis.DownsDownload.filenameForMode(
    sourceTab?.title || "downs-video",
    variantLabel,
    filenameMode
  );
  const job = globalThis.DownsJobs.createJob({
    id,
    playlistUrl: inspection.fetch.finalUrl,
    mediaType: "dash",
    dashVideoId: eligibility.video.id,
    dashAudioId: eligibility.audio.id,
    sourcePageTitle: sourceTab?.title || "",
    filename: globalThis.DownsDownload.outputFilename(suggestedFilename, "mp4"),
    variantLabel,
    hasSeparateAudio: true,
    audioLabel: eligibility.audio.language || eligibility.audio.codecs || "AAC",
    supportMode: eligibility.code,
    outputMode: "mp4",
    supportSummary: eligibility.reason,
    requestContext
  });

  await jobStorageArea.set({ [globalThis.DownsJobs.jobKey(id)]: job });
  await openDownloadsManager();
  return { ok: true, id };
}

async function getDownloadJobs() {
  const stored = await jobStorageArea.get(null);
  return Object.entries(stored)
    .filter(([key, value]) => globalThis.DownsJobs.isJobKey(key) && value?.id)
    .map(([, value]) => value);
}

async function openDownloadsManager() {
  const managerUrl = ext.runtime.getURL("downloads.html");
  const tabs = await ext.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.startsWith(managerUrl));
  if (existing?.id !== undefined) {
    await ext.tabs.update(existing.id, { active: true });
    return existing.id;
  }
  const created = await ext.tabs.create({ url: managerUrl });
  return created?.id;
}

registerRequestHeaderListener();

ext.webRequest.onHeadersReceived.addListener(
  rememberLink,
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] },
  ["responseHeaders"]
);

ext.webRequest.onCompleted.addListener(
  forgetRequest,
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] }
);

ext.webRequest.onErrorOccurred.addListener(
  forgetRequest,
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] }
);

ext.tabs.onRemoved.addListener((tabId) => {
  tabStorageArea.remove(storageKey(tabId));
  tabQueues.delete(tabId);
});

ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabStorageArea.remove(storageKey(tabId));
    ext.action.setBadgeText({ tabId, text: "" });
  }
});

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "blob-playlist-detected") {
      sendResponse(await rememberBlobPlaylist(message, sender));
      return;
    }

    if (message?.type === "get-links") {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      const links = tab?.id === undefined ? [] : await getTabLinks(tab.id);
      sendResponse({
        ok: true,
        tabId: tab?.id,
        pageUrl: tab?.url || "",
        pageTitle: tab?.title || "",
        links: links.map(publicLink)
      });
      return;
    }

    if (message?.type === "inspect-playlist") {
      sendResponse(message.inlinePlaylistId
        ? await inspectBlobPlaylist(message.inlinePlaylistId)
        : message.mediaType === "dash"
          ? await inspectDash(message.url, message.requestContext)
          : await inspectPlaylist(message.url, message.requestContext));
      return;
    }

    if (message?.type === "start-download") {
      sendResponse(await startDownloadJob(message));
      return;
    }

    if (message?.type === "start-dash-download") {
      sendResponse(await startDashDownloadJob(message));
      return;
    }

    if (message?.type === "acquire-request-context") {
      sendResponse({ ok: true, ...(await acquireRequestRule(message.url, message.requestContext)) });
      return;
    }

    if (message?.type === "release-request-context") {
      await releaseRequestRule(Number(message.leaseId));
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "get-download-summary") {
      sendResponse({ ok: true, ...globalThis.DownsJobs.summarizeJobs(await getDownloadJobs()) });
      return;
    }

    if (message?.type === "open-downloads-manager") {
      sendResponse({ ok: true, tabId: await openDownloadsManager() });
      return;
    }

    sendResponse({ ok: false, error: { code: "unknown-message", message: "Unknown message." } });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: { code: "internal", message: error?.message || "Unexpected extension error." }
    });
  });

  return true;
});
