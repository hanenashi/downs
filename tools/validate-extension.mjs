import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "extension");
const manifests = ["manifest.json", "manifest.firefox.json"];
const requiredFiles = [
  "audio-core.js",
  "background.js",
  "download-core.js",
  "download-worker.js",
  "fmp4-core.js",
  "mp4-finalizer.js",
  "downloads.css",
  "downloads.html",
  "downloads.js",
  "hls-parser.js",
  "job-core.js",
  "link-group-core.js",
  "request-context.js",
  "tar-core.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "vendor/LICENSE.mux.js",
  "vendor/mux-mp4.min.js"
];
const iconFiles = [
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png"
];
const manifestIcons = {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
};
const actionIcons = {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png"
};

for (const manifestName of manifests) {
  const raw = await readFile(path.join(extensionDir, manifestName), "utf8");
  const manifest = JSON.parse(raw);

  assert.equal(manifest.manifest_version, 3, `${manifestName} must use Manifest V3`);
  assert.equal(manifest.name, "Downs", `${manifestName} must use the Downs product name`);
  assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/, `${manifestName} has an invalid version`);
  assert.deepEqual(manifest.icons, manifestIcons, `${manifestName} must declare every extension icon size`);
  assert.deepEqual(manifest.action?.default_icon, actionIcons, `${manifestName} must declare toolbar icons`);
  assert.ok(manifest.permissions.includes("webRequest"), `${manifestName} needs webRequest`);
  assert.ok(manifest.permissions.includes("storage"), `${manifestName} needs storage`);
  assert.ok(manifest.permissions.includes("downloads"), `${manifestName} needs downloads`);
  assert.ok(
    manifest.permissions.some((permission) => permission.startsWith("declarativeNetRequest")),
    `${manifestName} needs temporary request-header rules`
  );
  assert.deepEqual(
    manifest.host_permissions,
    ["http://*/*", "https://*/*"],
    `${manifestName} should request only HTTP(S) host access`
  );
}

for (const filename of [...requiredFiles, ...iconFiles]) {
  await readFile(path.join(extensionDir, filename));
}

const shippedSource = await Promise.all(
  requiredFiles.map((filename) => readFile(path.join(extensionDir, filename), "utf8"))
);
const combinedSource = shippedSource.join("\n");
const popupCss = await readFile(path.join(extensionDir, "popup.css"), "utf8");
const popupHtml = await readFile(path.join(extensionDir, "popup.html"), "utf8");

assert.doesNotMatch(combinedSource, /127\.0\.0\.1|localhost/i, "extension must not use a localhost bridge");
assert.doesNotMatch(combinedSource, /send-to-downs/i, "legacy desktop feed messaging must stay removed");
assert.doesNotMatch(combinedSource, /innerHTML\s*=/, "remote playlist text must not reach innerHTML");
assert.match(
  popupCss,
  /body\s*{[^}]*width:\s*420px;[^}]*min-width:\s*320px;/s,
  "popup body needs an intrinsic Firefox-safe width"
);
assert.doesNotMatch(
  popupCss,
  /min-width:\s*min\([^;]*100vw/i,
  "popup minimum width must not collapse with Firefox's initial viewport"
);
assert.match(
  popupHtml,
  /<script src="link-group-core\.js"><\/script>[\s\S]*<script src="audio-core\.js"><\/script>[\s\S]*<script src="popup\.js"><\/script>/,
  "popup must load grouping and audio helpers before its controller"
);

console.log("Extension manifests and shipped files look valid.");
