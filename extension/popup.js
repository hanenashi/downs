const ext = globalThis.browser || globalThis.chrome;
const statusEl = document.getElementById("status");
const linksEl = document.getElementById("links");
const inspectorEl = document.getElementById("inspector");
const refreshButton = document.getElementById("refresh");
const settingsButton = document.getElementById("open-settings");
const downloadsButton = document.getElementById("open-downloads");
const downloadCountEl = document.getElementById("download-count");

let detectedLinks = [];
let selectedUrl = "";
let activeInspection = null;
let parentInspection = null;
let activePageTitle = "";
let showFullUrls = false;
let interfaceMode = "detailed";
let autoStartSimple = true;
const autoQueuedDownloads = new Set();
const expandedGroups = new Set();
const inspectionSummaries = new Map();

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function shortTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function streamName(link, index, primary = false) {
  if (primary && activePageTitle) {
    return activePageTitle;
  }
  if (link.discoverySource === "blob-playlist") {
    return `In-memory HLS playlist ${index + 1}`;
  }
  try {
    const url = new URL(link.url);
    const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return filename || (link.mediaType === "dash" ? `DASH manifest ${index + 1}` : `HLS playlist ${index + 1}`);
  } catch (_error) {
    return link.mediaType === "dash" ? `DASH manifest ${index + 1}` : `HLS playlist ${index + 1}`;
  }
}

function compactUrl(rawUrl, prefix = "HLS") {
  try {
    const url = new URL(rawUrl);
    let path = url.pathname || "/";
    try {
      path = decodeURIComponent(path);
    } catch (_error) {
      // Preserve the encoded path when it contains a malformed escape.
    }
    return `${prefix} · ${url.hostname}${path === "/" ? "" : path}`;
  } catch (_error) {
    return `${prefix} manifest`;
  }
}

function streamSummary(link) {
  if (link.discoverySource === "blob-playlist") {
    return "HLS · in-memory Blob playlist";
  }
  return compactUrl(link.url, link.mediaType === "dash" ? "DASH" : "HLS");
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function playlistSummary(playlist, variantLabel = "") {
  if (playlist.kind === "master") {
    const variantCount = playlist.variants?.length || 0;
    const audioCount = playlist.audioRenditions?.length || 0;
    const parts = ["Master", countLabel(variantCount, "variant")];
    if (audioCount) {
      parts.push(countLabel(audioCount, "audio track"));
    }
    return parts.join(" · ");
  }

  const parts = [];
  if (variantLabel) parts.push(variantLabel);
  parts.push(playlist.vod ? "VOD" : playlist.live ? "Live / event" : "Media playlist");
  parts.push(containerLabel(playlist.segmented));
  return parts.join(" · ");
}

function resolutionLabel(variant) {
  const height = variant.resolution?.split("x")[1];
  return height ? `${height}p` : "Variant";
}

function bestVideoChoice(values) {
  return [...values].sort((a, b) => {
    const [aResolutionWidth, aResolutionHeight] = String(a.resolution || "").split("x").map(Number);
    const [bResolutionWidth, bResolutionHeight] = String(b.resolution || "").split("x").map(Number);
    const aPixels = (Number(a.width) || aResolutionWidth || 0) * (Number(a.height) || aResolutionHeight || 0);
    const bPixels = (Number(b.width) || bResolutionWidth || 0) * (Number(b.height) || bResolutionHeight || 0);
    return bPixels - aPixels ||
      (Number(b.averageBandwidth || b.bandwidth) || 0) - (Number(a.averageBandwidth || a.bandwidth) || 0);
  })[0];
}

function formatBandwidth(value) {
  if (!value) {
    return "unknown rate";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} Mb/s`;
  }
  return `${Math.round(value / 1_000)} kb/s`;
}

function audioRenditionLabel(rendition) {
  return globalThis.DownsAudio.renditionLabel(rendition, navigator.languages);
}

function containerLabel(segmented) {
  return {
    ts: "MPEG-TS",
    fmp4: "fMP4 / CMAF",
    mixed: "Mixed TS / fMP4",
    unknown: "Unknown"
  }[segmented] || "Unknown";
}

function playbackLabel(playlist) {
  if (playlist.kind === "master") {
    return "Inspect a variant";
  }
  return playlist.vod ? "VOD" : "Live / event";
}

function encryptionLabel(playlist) {
  if (playlist.drm) {
    return "Protected media — unsupported";
  }
  if (playlist.encrypted) {
    return playlist.encryptionMethod || "Encrypted";
  }
  return "None";
}

function setStatus(message) {
  statusEl.textContent = message;
}

function applyInterfaceMode(mode) {
  interfaceMode = mode === "simple" ? "simple" : "detailed";
  document.body.classList.toggle("simple-mode", interfaceMode === "simple");
}

function autoQueuePrimaryDownload(action, key) {
  if (
    interfaceMode !== "simple" ||
    !autoStartSimple ||
    !action ||
    autoQueuedDownloads.has(key)
  ) return;
  const button = action.querySelector(".download-button:not(:disabled)");
  if (!button) return;
  autoQueuedDownloads.add(key);
  queueMicrotask(() => button.click());
}

function selectedLink() {
  return detectedLinks.find((link) => link.url === selectedUrl);
}

function appendDefinition(list, label, value, className = "") {
  list.append(createElement("dt", "", label));
  list.append(createElement("dd", className, value));
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_error) {
      // Fall through to the extension-page-compatible copy path.
    }
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.className = "copy-fallback";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy was not available.");
}

function appendUrlDefinition(list, label, value) {
  list.append(createElement("dt", "", label));
  const row = createElement("dd", "technical-url-row");
  row.append(createElement("span", "value-url", value));
  const copy = createElement("button", "copy-url", "Copy URL");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    const original = copy.textContent;
    try {
      await copyText(value);
      copy.textContent = "Copied";
    } catch (_error) {
      copy.textContent = "Copy failed";
    }
    setTimeout(() => {
      copy.textContent = original;
    }, 1400);
  });
  row.append(copy);
  list.append(row);
}

function streamRow(link, index, { primary = false } = {}) {
    const button = createElement("button", "stream-row");
    button.type = "button";
    button.setAttribute("aria-expanded", String(link.url === selectedUrl));
    button.setAttribute("aria-controls", "inspector");

    button.append(createElement("span", "stream-chevron"));

    const copy = createElement("span", "stream-copy");
    copy.append(createElement("strong", "stream-name", streamName(link, index, primary)));
    copy.append(
      createElement(
        "span",
        showFullUrls ? "stream-url" : "stream-summary",
        showFullUrls ? link.url : inspectionSummaries.get(link.url) || streamSummary(link)
      )
    );
    button.append(copy);
    button.append(createElement("time", "stream-time", shortTime(link.lastSeenAt || link.foundAt)));

    button.addEventListener("click", () => {
      selectedUrl = link.url;
      parentInspection = null;
      activeInspection = null;
      renderLinks();
      inspectUrl(link.url, "", {
        requestContext: link.requestContext || {},
        inlinePlaylistId: link.inlinePlaylistId || "",
        discoverySource: link.discoverySource || "network",
        mediaType: link.mediaType || "hls"
      });
    });

  return button;
}

function renderLinks() {
  linksEl.textContent = "";

  if (!detectedLinks.length) {
    const empty = createElement("div", "empty-state");
    empty.append(createElement("strong", "", "No HLS streams yet"));
    empty.append(
      createElement(
        "p",
        "",
        "Start video playback on this tab, then refresh the popup."
      )
    );
    linksEl.append(empty);
    return;
  }

  const indexes = new Map(detectedLinks.map((link, index) => [link.url, index]));
  const groups = globalThis.DownsLinkGroups.groupLinks(detectedLinks);

  groups.forEach((group, groupIndex) => {
    if (!group.related.length) {
      linksEl.append(streamRow(group.primary, indexes.get(group.primary.url), { primary: true }));
      return;
    }

    const groupEl = createElement("section", "stream-group");
    groupEl.append(streamRow(group.primary, indexes.get(group.primary.url), { primary: true }));

    const regionId = `related-streams-${groupIndex}`;
    const expanded = expandedGroups.has(group.id);
    const toggle = createElement(
      "button",
      "related-toggle",
      `${expanded ? "Hide" : "Show"} ${group.related.length} related playlist${group.related.length === 1 ? "" : "s"}`
    );
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-controls", regionId);

    const related = createElement("div", "related-streams");
    related.id = regionId;
    related.hidden = !expanded;
    for (const link of group.related) {
      related.append(streamRow(link, indexes.get(link.url)));
    }

    toggle.addEventListener("click", () => {
      if (expandedGroups.has(group.id)) {
        expandedGroups.delete(group.id);
      } else {
        expandedGroups.add(group.id);
      }
      renderLinks();
    });

    groupEl.append(toggle, related);
    linksEl.append(groupEl);
  });
}

function renderLoading(url) {
  inspectorEl.hidden = false;
  inspectorEl.textContent = "";
  const loading = createElement("div", "loading");
  loading.append(createElement("strong", "", "Inspecting media manifest…"));
  loading.append(createElement("div", "value-url", url));
  inspectorEl.append(loading);
}

function renderError(response, url) {
  inspectorEl.hidden = false;
  inspectorEl.textContent = "";

  const head = createElement("div", "inspector-head");
  head.append(createElement("h2", "", "Could not inspect manifest"));
  inspectorEl.append(head);

  const details = createElement("dl", "inspection-grid");
  appendDefinition(details, "Manifest", response?.fetch?.finalUrl || url, "value-url");
  if (response?.fetch?.status) {
    appendDefinition(
      details,
      "Response",
      `HTTP ${response.fetch.status}${response.fetch.statusText ? ` ${response.fetch.statusText}` : ""}`,
      "bad"
    );
  }
  appendDefinition(details, "Result", response?.error?.code || "unknown", "technical");
  inspectorEl.append(details);

  const notice = createElement(
    "p",
    "notice error",
    response?.error?.message || "The extension could not inspect this manifest."
  );
  inspectorEl.append(notice);
  inspectorEl.append(
    createElement(
      "p",
      "inspector-note",
      "No media was downloaded. The manifest request stayed inside the extension."
    )
  );
}

function renderVariants(playlist) {
  if (!playlist.variants.length) {
    return null;
  }

  const section = createElement("section", "subsection variants-section");
  section.append(createElement("h3", "", `Variants (${playlist.variants.length})`));
  const list = createElement("div", "variant-list");

  playlist.variants.forEach((variant) => {
    const button = createElement("button", "variant-row");
    button.type = "button";
    const label = resolutionLabel(variant);
    button.setAttribute("aria-label", `Inspect ${label}`);
    button.append(createElement("strong", "variant-resolution", label));
    button.append(
      createElement(
        "span",
        "variant-bandwidth",
        formatBandwidth(variant.averageBandwidth || variant.bandwidth)
      )
    );
    button.append(createElement("span", "variant-codecs", variant.codecs || "codecs not listed"));
    button.append(createElement("span", "variant-arrow", "›"));
    button.addEventListener("click", () => {
      parentInspection = activeInspection;
      const matchingAudio = globalThis.DownsAudio.matchingRenditions(playlist, variant);
      const audioRendition = globalThis.DownsAudio.preferredRendition(matchingAudio);
      const hasSeparateAudio = Boolean(variant.audioGroup && matchingAudio.length);
      inspectUrl(variant.url, label, {
        ...activeInspection.context,
        inlinePlaylistId: "",
        discoverySource: "network",
        hasSeparateAudio,
        audioRenditions: matchingAudio,
        audioPlaylistUrl: audioRendition?.url || "",
        audioLabel: audioRenditionLabel(audioRendition)
      });
    });
    list.append(button);
  });

  section.append(list);
  return section;
}

function renderRenditions(playlist) {
  if (!playlist.audioRenditions.length) {
    return null;
  }

  const section = createElement("section", "subsection audio-renditions-section");
  section.append(createElement("h3", "", `Audio (${playlist.audioRenditions.length})`));
  const list = createElement("ul", "rendition-list");

  playlist.audioRenditions.forEach((rendition) => {
    const item = document.createElement("li");
    item.append(createElement("strong", "", rendition.name || "Unnamed audio"));
    item.append(
      createElement(
        "span",
        "",
        [
          rendition.language,
          rendition.channels ? `${rendition.channels} ch` : "",
          rendition.default ? "default" : ""
        ]
          .filter(Boolean)
          .join(" · ") || "metadata only"
      )
    );
    list.append(item);
  });

  section.append(list);
  return section;
}

function renderStatusChips(playlist, context, eligibility) {
  const chips = createElement("div", "status-chips");
  const appendChip = (label, tone = "") => {
    chips.append(createElement("span", `status-chip${tone ? ` ${tone}` : ""}`, label));
  };

  if (playlist.kind === "master") {
    const variantCount = playlist.variants?.length || 0;
    const audioCount = playlist.audioRenditions?.length || 0;
    appendChip("Master");
    appendChip(countLabel(variantCount, "variant"));
    if (audioCount) {
      appendChip(countLabel(audioCount, "audio track"));
    }
    return chips;
  }

  appendChip(playlist.vod ? "VOD" : playlist.live ? "Live / event" : "Media");
  appendChip(containerLabel(playlist.segmented));
  if (context.hasSeparateAudio) {
    appendChip("Split A/V");
    if ((context.audioRenditions || []).length > 1) {
      appendChip(countLabel(context.audioRenditions.length, "audio track"));
    }
  } else if (playlist.segmented === "ts") {
    appendChip("Muxed A/V");
  }
  if (playlist.encrypted) {
    appendChip(playlist.encryptionMethod || "Encrypted", eligibility?.supported ? "good" : "warn");
  }
  if (eligibility) {
    appendChip(eligibility.supported ? "Supported" : "Unsupported", eligibility.supported ? "good" : "warn");
  }
  return chips;
}

function renderTechnicalDetails(response, rootLink) {
  const playlist = response.playlist;
  const disclosure = createElement("details", "technical-details");
  disclosure.append(createElement("summary", "", "Technical details"));

  const details = createElement("dl", "inspection-grid");
  if (response.fetch.source === "blob-playlist") {
    appendDefinition(details, "Playlist", "In-memory Blob playlist");
    appendUrlDefinition(details, "Base URL", response.fetch.baseUrl);
    appendDefinition(details, "Discovery", "Page-created Blob");
  } else {
    appendUrlDefinition(details, "Playlist", response.fetch.finalUrl);
    appendDefinition(details, "Discovery", "Network request");
  }
  appendDefinition(
    details,
    "Kind",
    playlist.kind === "master" ? "Master playlist" : "Media playlist"
  );
  appendDefinition(
    details,
    "Type",
    playbackLabel(playlist),
    playlist.live ? "warn" : playlist.vod ? "good" : ""
  );
  appendDefinition(details, "Segments", containerLabel(playlist.segmented));
  if (playlist.containerProbe === "mpeg-ts-sync") {
    appendDefinition(details, "Container evidence", "MPEG-TS sync-byte probe", "technical");
  }
  appendDefinition(
    details,
    "Encryption",
    encryptionLabel(playlist),
    playlist.drm ? "bad" : playlist.encrypted ? "warn" : "good"
  );
  appendDefinition(details, "EXT-X-MAP", playlist.mapUrl ? "Present" : "Not present");
  if (response.fetch.status) {
    appendDefinition(details, "Response", `HTTP ${response.fetch.status}`, "technical");
  }

  if (rootLink?.requestContext?.hasCookie || rootLink?.requestContext?.hasAuthorization) {
    const observations = [
      rootLink.requestContext.hasCookie ? "cookie" : "",
      rootLink.requestContext.hasAuthorization ? "authorization" : ""
    ].filter(Boolean);
    appendDefinition(details, "Auth seen", observations.join(" + "));
  }

  disclosure.append(details);
  return disclosure;
}

function renderDownloadAction(playlist, response, variantLabel, context, eligibility) {
  if (playlist.kind !== "media") {
    return null;
  }

  const section = createElement("section", "download-action");

  const audioRenditions = context.hasSeparateAudio ? context.audioRenditions || [] : [];
  if (audioRenditions.length > 1) {
    const field = createElement("label", "audio-choice");
    field.append(createElement("span", "audio-choice-label", "Audio"));
    const select = createElement("select", "audio-select");
    select.setAttribute("aria-label", "Audio rendition");
    for (const rendition of audioRenditions) {
      const option = createElement(
        "option",
        "",
        globalThis.DownsAudio.optionLabel(rendition, navigator.languages)
      );
      option.value = rendition.url;
      option.selected = rendition.url === context.audioPlaylistUrl;
      select.append(option);
    }
    select.addEventListener("change", () => {
      const rendition = audioRenditions.find((item) => item.url === select.value);
      if (!rendition) return;
      renderInspection(response, variantLabel, {
        ...context,
        audioPlaylistUrl: rendition.url,
        audioLabel: audioRenditionLabel(rendition)
      });
    });
    field.append(select);
    section.append(field);
  }

  if (!eligibility.supported) {
    section.append(createElement("strong", "download-label", "Direct download unavailable"));
    section.append(createElement("p", "download-reason", eligibility.reason));
    return section;
  }

  const ready = createElement("div", "ready-state");
  ready.append(createElement("strong", "", "Ready to download"));
  ready.append(
    createElement(
      "span",
      "",
      context.hasSeparateAudio && context.audioLabel
        ? `${eligibility.reason} · ${context.audioLabel}`
        : eligibility.reason
    )
  );
  section.append(ready);

  function makeDownloadButton(outputMode) {
    const sourceBundle = outputMode === "source-bundle";
    const idleLabel = sourceBundle
      ? "Source bundle"
      : variantLabel ? `Download ${variantLabel}` : "Download MP4";
    const button = createElement(
      "button",
      sourceBundle ? "source-button" : "download-button",
      idleLabel
    );
    button.type = "button";
    button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = sourceBundle ? "Adding bundle…" : "Adding to Downloads…";
    try {
      const result = await ext.runtime.sendMessage({
        type: "start-download",
        outputMode,
        url: response.fetch.finalUrl,
        variantLabel,
        hasSeparateAudio: Boolean(context.hasSeparateAudio),
        audioPlaylistUrl: context.audioPlaylistUrl || "",
        audioLabel: context.audioLabel || "",
        requestContext: context.requestContext || {}
      });
      if (!result?.ok) {
        throw new Error(result?.error?.message || "The download could not be added.");
      }
      button.textContent = "Added to Downloads ✓";
    } catch (error) {
      button.disabled = false;
      button.textContent = idleLabel;
      const prior = section.querySelector(".download-error");
      prior?.remove();
      section.append(
        createElement("p", "download-error", error?.message || "The download could not be added.")
      );
    }
    });
    return button;
  }
  section.append(makeDownloadButton("mp4"));
  if (eligibility.code !== "direct-ts-aes128-vod") {
    section.append(makeDownloadButton("source-bundle"));
  }
  section.append(
    createElement(
      "p",
      "download-reason",
      context.hasSeparateAudio
        ? `MP4 uses ${context.audioLabel || "the default audio track"}. Source bundle preserves exact fetched tracks for diagnostics.`
        : eligibility.code === "direct-ts-aes128-vod"
          ? "AES-128 segments are decrypted locally in memory. Keys are never stored; encrypted source bundles are disabled."
          : "MP4 creates a seekable finished file. Source bundle preserves exact fetched segments for diagnostics."
    )
  );
  return section;
}

function renderInspection(response, variantLabel = "", context = {}) {
  activeInspection = { response, variantLabel, context };
  const playlist = response.playlist;
  if (interfaceMode === "simple" && playlist.kind === "master" && playlist.variants.length) {
    const variant = bestVideoChoice(playlist.variants);
    const label = resolutionLabel(variant);
    const matchingAudio = globalThis.DownsAudio.matchingRenditions(playlist, variant);
    const audioRendition = globalThis.DownsAudio.preferredRendition(matchingAudio);
    parentInspection = null;
    void inspectUrl(variant.url, label, {
      ...context,
      inlinePlaylistId: "",
      discoverySource: "network",
      hasSeparateAudio: Boolean(variant.audioGroup && matchingAudio.length),
      audioRenditions: matchingAudio,
      audioPlaylistUrl: audioRendition?.url || "",
      audioLabel: audioRenditionLabel(audioRendition)
    });
    return;
  }
  const rootLink = selectedLink();
  const eligibility = playlist.kind === "media"
    ? context.discoverySource === "blob-playlist"
      ? {
          supported: false,
          code: "blob-inspection-only",
          reason: "In-memory playlist discovery is inspection-only in this pass."
        }
      : globalThis.DownsDownload.validateDirectPlaylist(playlist, context)
    : null;
  inspectorEl.hidden = false;
  inspectorEl.textContent = "";

  const head = createElement("div", "inspector-head");
  head.append(
    createElement(
      "h2",
      "",
      variantLabel || (playlist.kind === "master" ? "Master playlist" : "Media playlist")
    )
  );

  if (parentInspection) {
    const back = createElement("button", "back-button", "Back to master");
    back.type = "button";
    back.addEventListener("click", () => {
      const parent = parentInspection;
      parentInspection = null;
      renderInspection(parent.response, parent.variantLabel, parent.context);
    });
    head.append(back);
  }
  inspectorEl.append(head);
  inspectorEl.append(renderStatusChips(playlist, context, eligibility));
  inspectorEl.append(renderTechnicalDetails(response, rootLink));

  const variants = renderVariants(playlist);
  if (variants) {
    inspectorEl.append(variants);
  }

  const renditions = renderRenditions(playlist);
  if (renditions) {
    inspectorEl.append(renditions);
  }

  if (playlist.drm) {
    inspectorEl.append(
      createElement("p", "notice error", "DRM or protected media is unsupported. Downs will not attempt to bypass it.")
    );
  } else if (playlist.live) {
    inspectorEl.append(
      createElement("p", "notice", "This playlist has no EXT-X-ENDLIST and is live or event-like.")
    );
  } else if (playlist.encrypted && !eligibility?.supported) {
    inspectorEl.append(
      createElement("p", "notice", `${playlist.encryptionMethod} encryption detected. Download support is not implemented yet.`)
    );
  } else if (playlist.encrypted) {
    inspectorEl.append(
      createElement("p", "notice", "Whole-segment AES-128 will be decrypted locally with Web Crypto. Key bytes are not stored.")
    );
  }

  for (const warning of playlist.warnings || []) {
    inspectorEl.append(createElement("p", "notice", warning));
  }

  const downloadAction = renderDownloadAction(playlist, response, variantLabel, context, eligibility);
  if (downloadAction) {
    inspectorEl.append(downloadAction);
    autoQueuePrimaryDownload(
      downloadAction,
      [response.fetch.finalUrl, context.audioPlaylistUrl || "", variantLabel].join("|")
    );
  }

  inspectorEl.append(
    createElement(
      "p",
      "inspector-note",
      "Playlist details and supported media processing stay inside the extension."
    )
  );
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "Not declared";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function renderDashRepresentations(title, representations) {
  if (!representations.length) return null;
  const section = createElement("section", "subsection dash-representations");
  section.append(createElement("h3", "", `${title} (${representations.length})`));
  const list = createElement("ul", "rendition-list dash-representation-list");
  for (const representation of representations.slice(0, 50)) {
    const item = document.createElement("li");
    const dimensions = representation.width && representation.height
      ? `${representation.width}×${representation.height}`
      : representation.audioSamplingRate
        ? `${representation.audioSamplingRate.toLocaleString()} Hz`
        : representation.id || representation.kind;
    item.append(createElement("strong", "", dimensions));
    item.append(createElement(
      "span",
      "",
      [
        representation.bandwidth ? formatBandwidth(representation.bandwidth) : "",
        representation.codecs,
        representation.language,
        representation.mode,
        representation.protected ? "protected" : ""
      ].filter(Boolean).join(" · ") || "metadata only"
    ));
    list.append(item);
  }
  section.append(list);
  if (representations.length > 50) {
    section.append(createElement("p", "notice", `Showing the first 50 of ${representations.length} representations.`));
  }
  return section;
}

function dashVideoLabel(representation) {
  return representation.height
    ? `${representation.height}p${representation.bandwidth ? ` · ${formatBandwidth(representation.bandwidth)}` : ""}`
    : representation.id || "Video";
}

function dashAudioLabel(representation) {
  return [
    representation.language,
    representation.audioSamplingRate ? `${representation.audioSamplingRate.toLocaleString()} Hz` : "",
    representation.bandwidth ? formatBandwidth(representation.bandwidth) : ""
  ].filter(Boolean).join(" · ") || representation.id || "AAC audio";
}

function renderDashDownloadAction(response, eligibility, selection) {
  const section = createElement("section", "download-action");
  if (!eligibility.supported) {
    section.append(createElement("strong", "download-label", "Direct download unavailable"));
    section.append(createElement("p", "download-reason", eligibility.reason));
    return section;
  }

  const addChoice = (label, values, selectedId, ariaLabel, onChange) => {
    if (values.length < 2) return;
    const field = createElement("label", "audio-choice");
    field.append(createElement("span", "audio-choice-label", label));
    const select = createElement("select", "audio-select");
    select.setAttribute("aria-label", ariaLabel);
    for (const representation of values) {
      const option = createElement(
        "option",
        "",
        label === "Video" ? dashVideoLabel(representation) : dashAudioLabel(representation)
      );
      option.value = representation.id;
      option.selected = String(representation.id) === String(selectedId);
      select.append(option);
    }
    select.addEventListener("change", () => onChange(select.value));
    field.append(select);
    section.append(field);
  };

  addChoice("Video", eligibility.videos, eligibility.video.id, "DASH video representation", (id) => {
    renderDashInspection(response, { ...selection, videoId: id });
  });
  addChoice("Audio", eligibility.audios, eligibility.audio.id, "DASH audio representation", (id) => {
    renderDashInspection(response, { ...selection, audioId: id });
  });

  const ready = createElement("div", "ready-state");
  ready.append(createElement("strong", "", "Ready to download"));
  ready.append(createElement("span", "", `${eligibility.reason} · ${dashAudioLabel(eligibility.audio)}`));
  section.append(ready);

  const label = eligibility.video.height ? `${eligibility.video.height}p` : "DASH";
  const makeButton = (outputMode) => {
    const sourceBundle = outputMode === "source-bundle";
    const idleLabel = sourceBundle ? "Source bundle" : `Download ${label}`;
    const button = createElement("button", sourceBundle ? "source-button" : "download-button", idleLabel);
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = sourceBundle ? "Adding bundle…" : "Adding to Downloads…";
      try {
        const rootLink = selectedLink();
        const result = await ext.runtime.sendMessage({
          type: "start-dash-download",
          outputMode,
          url: response.fetch.finalUrl,
          videoRepresentationId: eligibility.video.id,
          audioRepresentationId: eligibility.audio.id,
          videoLabel: label,
          requestContext: rootLink?.requestContext || {}
        });
        if (!result?.ok) throw new Error(result?.error?.message || "The DASH download could not be added.");
        button.textContent = "Added to Downloads ✓";
      } catch (error) {
        button.disabled = false;
        button.textContent = idleLabel;
        section.querySelector(".download-error")?.remove();
        section.append(createElement("p", "download-error", error?.message || "The DASH download could not be added."));
      }
    });
    return button;
  };
  section.append(makeButton("mp4"), makeButton("source-bundle"));
  section.append(createElement(
    "p",
    "download-reason",
    "MP4 combines the selected H.264 or AV1 video and AAC audio into one seekable file. Source bundle preserves their exact init and media fragments for offline replay."
  ));
  return section;
}

function renderDashInspection(response, selection = {}) {
  const dash = response.dash;
  let eligibility = globalThis.DownsDash.validateDirectPair(dash, selection.videoId, selection.audioId);
  if (interfaceMode === "simple" && !selection.videoId && eligibility.supported) {
    const video = bestVideoChoice(eligibility.videos);
    eligibility = globalThis.DownsDash.validateDirectPair(dash, video.id, eligibility.audio.id);
  }
  const normalizedSelection = eligibility.supported
    ? { videoId: eligibility.video.id, audioId: eligibility.audio.id }
    : selection;
  activeInspection = { response, variantLabel: "", context: { mediaType: "dash", ...normalizedSelection } };
  inspectorEl.hidden = false;
  inspectorEl.textContent = "";

  const head = createElement("div", "inspector-head");
  head.append(createElement("h2", "", "DASH manifest"));
  inspectorEl.append(head);

  const chips = createElement("div", "status-chips");
  chips.append(createElement("span", "status-chip", dash.dynamic ? "Dynamic / live" : "Static VOD"));
  chips.append(createElement("span", "status-chip", countLabel(dash.representations.length, "representation")));
  chips.append(createElement("span", `status-chip ${dash.encrypted ? "warn" : "good"}`, dash.encrypted ? "Protected" : "Clear"));
  chips.append(createElement(
    "span",
    `status-chip ${eligibility.supported ? "good" : "warn"}`,
    eligibility.supported ? "Supported" : "Inspection only"
  ));
  inspectorEl.append(chips);

  const disclosure = createElement("details", "technical-details");
  disclosure.append(createElement("summary", "", "Technical details"));
  const details = createElement("dl", "inspection-grid");
  appendUrlDefinition(details, "Manifest", response.fetch.finalUrl);
  appendDefinition(details, "Discovery", "Network request");
  appendDefinition(details, "Presentation", dash.dynamic ? "Dynamic / live" : "Static");
  appendDefinition(details, "Duration", formatDuration(dash.durationSeconds));
  appendDefinition(details, "Periods", String(dash.periodCount));
  appendDefinition(details, "Addressing", dash.addressing.join(" + ") || "Not declared");
  appendDefinition(details, "Protection", dash.encrypted ? countLabel(dash.protections.length, "descriptor") : "None");
  appendDefinition(details, "Response", `HTTP ${response.fetch.status}`, "technical");
  disclosure.append(details);
  inspectorEl.append(disclosure);

  for (const [title, representations] of [
    ["Video", dash.videoRepresentations],
    ["Audio", dash.audioRepresentations],
    ["Other", dash.otherRepresentations]
  ]) {
    const section = renderDashRepresentations(title, representations);
    if (section) inspectorEl.append(section);
  }
  for (const warning of dash.warnings || []) {
    inspectorEl.append(createElement("p", "notice", warning));
  }
  if (dash.encrypted) {
    inspectorEl.append(createElement(
      "p",
      "notice error",
      "Protected DASH is inspection-only. Downs will not attempt to bypass DRM or CENC."
    ));
  }
  const downloadAction = renderDashDownloadAction(response, eligibility, normalizedSelection);
  inspectorEl.append(downloadAction);
  autoQueuePrimaryDownload(
    downloadAction,
    [response.fetch.finalUrl, normalizedSelection.videoId || "", normalizedSelection.audioId || ""].join("|")
  );
  inspectorEl.append(createElement(
    "p",
    "inspector-note",
    "MPD parsing and supported media processing stay inside the extension."
  ));
}

async function inspectUrl(url, variantLabel = "", context = {}) {
  renderLoading(url);

  try {
    const response = await ext.runtime.sendMessage({
      type: "inspect-playlist",
      url,
      inlinePlaylistId: context.inlinePlaylistId || "",
      mediaType: context.mediaType || "hls",
      requestContext: context.requestContext || {}
    });
    if (!response?.ok) {
      renderError(response, url);
      return;
    }
    if (response.dash) {
      const summary = [
        response.dash.dynamic ? "Dynamic DASH" : "Static DASH",
        countLabel(response.dash.representations.length, "representation")
      ].join(" · ");
      inspectionSummaries.set(url, summary);
      if (response.fetch.finalUrl) inspectionSummaries.set(response.fetch.finalUrl, summary);
      renderLinks();
      renderDashInspection(response);
      return;
    }
    const summary = playlistSummary(response.playlist, variantLabel);
    inspectionSummaries.set(url, summary);
    if (response.fetch.finalUrl) inspectionSummaries.set(response.fetch.finalUrl, summary);
    renderLinks();
    renderInspection(response, variantLabel, context);
  } catch (error) {
    renderError(
      { error: { code: "extension", message: error?.message || "The background worker did not respond." } },
      url
    );
  }
}

async function loadLinks() {
  refreshButton.disabled = true;
  setStatus("Looking for HLS or DASH traffic on this tab…");

  try {
    const response = await ext.runtime.sendMessage({ type: "get-links" });
    detectedLinks = response?.links || [];
    activePageTitle = String(response?.pageTitle || "").trim();

    if (selectedUrl && !detectedLinks.some((link) => link.url === selectedUrl)) {
      selectedUrl = "";
      activeInspection = null;
      parentInspection = null;
      inspectorEl.hidden = true;
    }

    renderLinks();
    if (detectedLinks.length) {
      const groupCount = globalThis.DownsLinkGroups.groupLinks(detectedLinks).length;
      setStatus(
        detectedLinks.length === groupCount
          ? `${detectedLinks.length} stream${detectedLinks.length === 1 ? "" : "s"} detected on this tab`
          : `${detectedLinks.length} playlists across ${groupCount} playback${groupCount === 1 ? "" : "s"}`
      );
    } else {
      setStatus("Waiting for HLS or DASH traffic on this tab");
    }
  } catch (error) {
    detectedLinks = [];
    renderLinks();
    setStatus(error?.message || "Could not read detected streams.");
  } finally {
    refreshButton.disabled = false;
  }
}

async function loadDownloadSummary() {
  try {
    const response = await ext.runtime.sendMessage({ type: "get-download-summary" });
    const active = Number(response?.active) || 0;
    const ready = Number(response?.ready) || 0;
    const parts = [];
    if (active) parts.push(`${active} active`);
    if (ready) parts.push(`${ready} ready to save`);
    downloadCountEl.textContent = parts.join(" · ");
    downloadsButton.setAttribute(
      "aria-label",
      parts.length ? `Downloads, ${parts.join(", ")}` : "Downloads"
    );
  } catch (_error) {
    downloadCountEl.textContent = "";
  }
}

async function loadPopupSettings() {
  try {
    const stored = await ext.storage.local.get(globalThis.DownsDownload.SETTINGS_KEY);
    const settings = stored[globalThis.DownsDownload.SETTINGS_KEY] || {};
    showFullUrls = Boolean(settings.showFullUrls);
    autoStartSimple = settings.autoStartSimple !== false;
    applyInterfaceMode(settings.interfaceMode);
  } catch (_error) {
    showFullUrls = false;
    autoStartSimple = true;
    applyInterfaceMode("detailed");
  }
}

refreshButton.addEventListener("click", loadLinks);
settingsButton.addEventListener("click", async () => {
  settingsButton.disabled = true;
  try {
    await ext.runtime.sendMessage({ type: "open-downloads-settings" });
  } finally {
    settingsButton.disabled = false;
  }
});
downloadsButton.addEventListener("click", async () => {
  downloadsButton.disabled = true;
  try {
    await ext.runtime.sendMessage({ type: "open-downloads-manager" });
  } finally {
    downloadsButton.disabled = false;
  }
});
ext.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local") {
    if (Object.hasOwn(changes, globalThis.DownsDownload.SETTINGS_KEY)) {
      const settings = changes[globalThis.DownsDownload.SETTINGS_KEY]?.newValue || {};
      showFullUrls = Boolean(settings.showFullUrls);
      autoStartSimple = settings.autoStartSimple !== false;
      applyInterfaceMode(settings.interfaceMode);
      renderLinks();
    }
    void loadDownloadSummary();
  }
});

void (async () => {
  await loadPopupSettings();
  await Promise.all([loadLinks(), loadDownloadSummary()]);
})();
