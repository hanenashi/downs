import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "extension");
const manifests = ["manifest.json", "manifest.firefox.json"];
const requiredFiles = [
  "background.js",
  "hls-parser.js",
  "popup.css",
  "popup.html",
  "popup.js"
];

for (const manifestName of manifests) {
  const raw = await readFile(path.join(extensionDir, manifestName), "utf8");
  const manifest = JSON.parse(raw);

  assert.equal(manifest.manifest_version, 3, `${manifestName} must use Manifest V3`);
  assert.equal(manifest.name, "Downs", `${manifestName} must use the Downs product name`);
  assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/, `${manifestName} has an invalid version`);
  assert.ok(manifest.permissions.includes("webRequest"), `${manifestName} needs webRequest`);
  assert.ok(manifest.permissions.includes("storage"), `${manifestName} needs storage`);
  assert.deepEqual(
    manifest.host_permissions,
    ["http://*/*", "https://*/*"],
    `${manifestName} should request only HTTP(S) host access`
  );
}

for (const filename of requiredFiles) {
  await readFile(path.join(extensionDir, filename));
}

const shippedSource = await Promise.all(
  requiredFiles.map((filename) => readFile(path.join(extensionDir, filename), "utf8"))
);
const combinedSource = shippedSource.join("\n");

assert.doesNotMatch(combinedSource, /127\.0\.0\.1|localhost/i, "extension must not use a localhost bridge");
assert.doesNotMatch(combinedSource, /send-to-downs/i, "legacy desktop feed messaging must stay removed");
assert.doesNotMatch(combinedSource, /innerHTML\s*=/, "remote playlist text must not reach innerHTML");

console.log("Extension manifests and shipped files look valid.");
