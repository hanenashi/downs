const ext = globalThis.browser || globalThis.chrome;
const statusEl = document.getElementById("status");
const linksEl = document.getElementById("links");
const inspectorEl = document.getElementById("inspector");
const refreshButton = document.getElementById("refresh");
const downloadsButton = document.getElementById("open-downloads");
const downloadCountEl = document.getElementById("download-count");

let detectedLinks = [];
let selectedUrl = "";
let activeInspection = null;
let parentInspection = null;

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

function streamName(link, index) {
  try {
    const url = new URL(link.url);
    const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return filename || `HLS playlist ${index + 1}`;
  } catch (_error) {
    return `HLS playlist ${index + 1}`;
  }
}

function resolutionLabel(variant) {
  const height = variant.resolution?.split("x")[1];
  return height ? `${height}p` : "Variant";
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

function selectedLink() {
  return detectedLinks.find((link) => link.url === selectedUrl);
}

function appendDefinition(list, label, value, className = "") {
  list.append(createElement("dt", "", label));
  list.append(createElement("dd", className, value));
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

  detectedLinks.forEach((link, index) => {
    const button = createElement("button", "stream-row");
    button.type = "button";
    button.setAttribute("aria-expanded", String(link.url === selectedUrl));
    button.setAttribute("aria-controls", "inspector");

    button.append(createElement("span", "stream-chevron"));

    const copy = createElement("span", "stream-copy");
    copy.append(createElement("strong", "stream-name", streamName(link, index)));
    copy.append(createElement("span", "stream-url", link.url));
    button.append(copy);
    button.append(createElement("time", "stream-time", shortTime(link.lastSeenAt || link.foundAt)));

    button.addEventListener("click", () => {
      selectedUrl = link.url;
      parentInspection = null;
      activeInspection = null;
      renderLinks();
      inspectUrl(link.url);
    });

    linksEl.append(button);
  });
}

function renderLoading(url) {
  inspectorEl.hidden = false;
  inspectorEl.textContent = "";
  const loading = createElement("div", "loading");
  loading.append(createElement("strong", "", "Inspecting playlist…"));
  loading.append(createElement("div", "value-url", url));
  inspectorEl.append(loading);
}

function renderError(response, url) {
  inspectorEl.hidden = false;
  inspectorEl.textContent = "";

  const head = createElement("div", "inspector-head");
  head.append(createElement("h2", "", "Could not inspect playlist"));
  inspectorEl.append(head);

  const details = createElement("dl", "inspection-grid");
  appendDefinition(details, "Playlist", response?.fetch?.finalUrl || url, "value-url");
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
    response?.error?.message || "The extension could not inspect this playlist."
  );
  inspectorEl.append(notice);
  inspectorEl.append(
    createElement(
      "p",
      "inspector-note",
      "No media was downloaded. The playlist request stayed inside the extension."
    )
  );
}

function renderVariants(playlist) {
  if (!playlist.variants.length) {
    return null;
  }

  const section = createElement("section", "subsection");
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
      const hasSeparateAudio = Boolean(
        variant.audioGroup &&
        playlist.audioRenditions.some((rendition) => rendition.groupId === variant.audioGroup)
      );
      inspectUrl(variant.url, label, { hasSeparateAudio });
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

  const section = createElement("section", "subsection");
  section.append(createElement("h3", "", `Audio (${playlist.audioRenditions.length})`));
  const list = createElement("ul", "rendition-list");

  playlist.audioRenditions.forEach((rendition) => {
    const item = document.createElement("li");
    item.append(createElement("strong", "", rendition.name || "Unnamed audio"));
    item.append(
      createElement(
        "span",
        "",
        [rendition.language, rendition.channels ? `${rendition.channels} ch` : ""]
          .filter(Boolean)
          .join(" · ") || "metadata only"
      )
    );
    list.append(item);
  });

  section.append(list);
  return section;
}

function renderDownloadAction(playlist, response, variantLabel, context) {
  if (playlist.kind !== "media") {
    return null;
  }

  const eligibility = globalThis.DownsDownload.validateDirectPlaylist(playlist, context);
  const section = createElement("section", "download-action");

  if (!eligibility.supported) {
    section.append(createElement("strong", "download-label", "Direct download unavailable"));
    section.append(createElement("p", "download-reason", eligibility.reason));
    return section;
  }

  const button = createElement(
    "button",
    "download-button",
    variantLabel ? `Download ${variantLabel}` : "Download MP4"
  );
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Adding to Downloads…";
    try {
      const result = await ext.runtime.sendMessage({
        type: "start-download",
        url: response.fetch.finalUrl,
        variantLabel,
        hasSeparateAudio: Boolean(context.hasSeparateAudio)
      });
      if (!result?.ok) {
        throw new Error(result?.error?.message || "The download could not be added.");
      }
      button.textContent = "Added to Downloads";
    } catch (error) {
      button.disabled = false;
      button.textContent = variantLabel ? `Download ${variantLabel}` : "Download MP4";
      const prior = section.querySelector(".download-error");
      prior?.remove();
      section.append(
        createElement("p", "download-error", error?.message || "The download could not be added.")
      );
    }
  });
  section.append(button);
  section.append(
    createElement(
      "p",
      "download-reason",
      "Adds a job to Downs Downloads, where it remuxes locally and waits for you to save it."
    )
  );
  return section;
}

function renderInspection(response, variantLabel = "", context = {}) {
  activeInspection = { response, variantLabel, context };
  const playlist = response.playlist;
  const rootLink = selectedLink();
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

  const details = createElement("dl", "inspection-grid");
  appendDefinition(details, "Playlist", response.fetch.finalUrl, "value-url");
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
  appendDefinition(
    details,
    "Encryption",
    encryptionLabel(playlist),
    playlist.drm ? "bad" : playlist.encrypted ? "warn" : "good"
  );
  appendDefinition(details, "EXT-X-MAP", playlist.mapUrl ? "Present" : "Not present");
  appendDefinition(details, "Response", `HTTP ${response.fetch.status}`, "technical");

  if (rootLink?.requestContext?.hasCookie || rootLink?.requestContext?.hasAuthorization) {
    const observations = [
      rootLink.requestContext.hasCookie ? "cookie" : "",
      rootLink.requestContext.hasAuthorization ? "authorization" : ""
    ].filter(Boolean);
    appendDefinition(details, "Auth seen", observations.join(" + "));
  }

  inspectorEl.append(details);

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
  } else if (playlist.encrypted) {
    inspectorEl.append(
      createElement("p", "notice", `${playlist.encryptionMethod} encryption detected. Download support is not implemented yet.`)
    );
  }

  for (const warning of playlist.warnings || []) {
    inspectorEl.append(createElement("p", "notice", warning));
  }

  const downloadAction = renderDownloadAction(playlist, response, variantLabel, context);
  if (downloadAction) {
    inspectorEl.append(downloadAction);
  }

  inspectorEl.append(
    createElement(
      "p",
      "inspector-note",
      "Playlist details and supported media processing stay inside the extension."
    )
  );
}

async function inspectUrl(url, variantLabel = "", context = {}) {
  renderLoading(url);

  try {
    const response = await ext.runtime.sendMessage({ type: "inspect-playlist", url });
    if (!response?.ok) {
      renderError(response, url);
      return;
    }
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
  setStatus("Looking for HLS traffic on this tab…");

  try {
    const response = await ext.runtime.sendMessage({ type: "get-links" });
    detectedLinks = response?.links || [];

    if (selectedUrl && !detectedLinks.some((link) => link.url === selectedUrl)) {
      selectedUrl = "";
      activeInspection = null;
      parentInspection = null;
      inspectorEl.hidden = true;
    }

    renderLinks();
    if (detectedLinks.length) {
      setStatus(
        `${detectedLinks.length} stream${detectedLinks.length === 1 ? "" : "s"} detected on this tab`
      );
    } else {
      setStatus("Waiting for HLS traffic on this tab");
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
    const count = (Number(response?.active) || 0) + (Number(response?.ready) || 0);
    downloadCountEl.textContent = count ? `(${count})` : "";
    downloadsButton.setAttribute(
      "aria-label",
      count ? `Downloads, ${count} active or ready to save` : "Downloads"
    );
  } catch (_error) {
    downloadCountEl.textContent = "";
  }
}

refreshButton.addEventListener("click", loadLinks);
downloadsButton.addEventListener("click", async () => {
  downloadsButton.disabled = true;
  try {
    await ext.runtime.sendMessage({ type: "open-downloads-manager" });
  } finally {
    downloadsButton.disabled = false;
  }
});
ext.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "local") {
    void loadDownloadSummary();
  }
});

void loadLinks();
void loadDownloadSummary();
