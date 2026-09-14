#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const fixtureRoot = path.resolve(__dirname, "..", "tests", "fixtures");
const modernFixtureRoot = path.resolve(__dirname, "..", "test-artifacts", "modern-fixture");
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".m3u8", "application/vnd.apple.mpegurl; charset=utf-8"],
  [".ts", "video/mp2t"],
  [".mp4", "video/mp4"],
  [".m4s", "video/iso.segment"]
]);

function fixturePath(urlValue) {
  const pathname = decodeURIComponent(new URL(urlValue, "http://127.0.0.1").pathname);
  if (pathname === "/modern" || pathname.startsWith("/modern/")) {
    const relative = pathname.replace(/^\/modern\/?/, "");
    const resolved = path.resolve(modernFixtureRoot, relative);
    if (resolved !== modernFixtureRoot && !resolved.startsWith(`${modernFixtureRoot}${path.sep}`)) return null;
    return resolved;
  }
  const relative = pathname === "/" ? "download-page.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(fixtureRoot, relative);
  if (resolved !== fixtureRoot && !resolved.startsWith(`${fixtureRoot}${path.sep}`)) return null;
  return resolved;
}

function parsePort(argv) {
  const index = argv.indexOf("--port");
  const value = index === -1 ? 8765 : Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("--port must be an integer from 1 to 65535.");
  }
  return value;
}

function parseHost(argv) {
  const index = argv.indexOf("--host");
  const value = index === -1 ? "127.0.0.1" : argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error("--host requires a bind address.");
  }
  return value;
}

function hasFixtureReferer(request) {
  try {
    const referer = new URL(request.headers.referer || "");
    return referer.origin === `http://${request.headers.host}`;
  } catch (_error) {
    return false;
  }
}

function createFixtureServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/referer-required.m3u8" && !hasFixtureReferer(request)) {
      response.writeHead(403, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end("Fixture requires its player-page Referer origin.\n");
      return;
    }

    if (pathname === "/referer-required.m3u8") {
      request.url = "/mux-short.m3u8";
    }

    let filename;
    try {
      filename = fixturePath(request.url || "/");
    } catch (_error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request\n");
      return;
    }

    if (!filename || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes.get(path.extname(filename).toLowerCase()) || "application/octet-stream"
    });
    fs.createReadStream(filename).pipe(response);
  });
}

function main(argv = process.argv.slice(2)) {
  let port;
  let host;
  try {
    port = parsePort(argv);
    host = parseHost(argv);
  } catch (error) {
    console.error(`Fixture server could not start: ${error.message}`);
    return 2;
  }

  const server = createFixtureServer();
  server.on("error", (error) => {
    console.error(`Fixture server failed: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "DEVICE-IP" : host;
    console.log(`Downs fixture page: http://${displayHost}:${port}/download-page.html`);
    console.log(`Modern fixture page: http://${displayHost}:${port}/modern-page.html`);
    console.log("Press Ctrl+C to stop.");
  });
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { createFixtureServer, fixturePath, hasFixtureReferer, parseHost, parsePort };
