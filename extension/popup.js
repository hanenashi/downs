const ext = globalThis.browser || globalThis.chrome;
const statusEl = document.getElementById("status");
const linksEl = document.getElementById("links");
const refreshButton = document.getElementById("refresh");

function shortTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function setStatus(message) {
  statusEl.textContent = message;
}

async function sendToDowns(url, button) {
  button.disabled = true;
  button.textContent = "Sending…";

  const response = await ext.runtime.sendMessage({ type: "send-to-downs", url });
  if (response?.ok) {
    button.textContent = "Sent";
    setStatus(`Download started as ${response.filename}.`);
    return;
  }

  button.disabled = false;
  button.textContent = "Download";
  setStatus(response?.error || "Could not reach Downs. Is the app running?");
}

function renderLinks(links) {
  linksEl.textContent = "";

  if (!links.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No M3U8 links found yet. Start playback on the page, then open this popup again.";
    linksEl.append(empty);
    setStatus("Waiting for HLS traffic on this tab.");
    return;
  }

  setStatus(`${links.length} M3U8 link${links.length === 1 ? "" : "s"} found.`);

  for (const link of links) {
    const row = document.createElement("div");
    row.className = "link-row";

    const details = document.createElement("div");
    const url = document.createElement("div");
    url.className = "url";
    url.textContent = link.url;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `found ${shortTime(link.foundAt)}`;

    details.append(url, meta);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Download";
    button.addEventListener("click", () => sendToDowns(link.url, button));

    row.append(details, button);
    linksEl.append(row);
  }
}

async function loadLinks() {
  setStatus("Looking for M3U8 links on this tab…");
  const response = await ext.runtime.sendMessage({ type: "get-links" });
  renderLinks(response?.links || []);
}

refreshButton.addEventListener("click", loadLinks);
loadLinks();
