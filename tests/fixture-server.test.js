const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createFixtureServer, fixturePath, hasFixtureReferer, parseHost, parsePort } = require("../tools/serve-fixtures.js");

test("fixture server resolves its default page and query-bearing fixture URLs", () => {
  assert.equal(path.basename(fixturePath("/")), "download-page.html");
  assert.equal(path.basename(fixturePath("/mux-short.m3u8?fixture=direct")), "mux-short.m3u8");
});

test("fixture server contains normalized and encoded traversal paths", () => {
  assert.equal(fixturePath("/../../README.md"), path.resolve(__dirname, "fixtures", "README.md"));
  assert.equal(fixturePath("/%2e%2e/%2e%2e/README.md"), path.resolve(__dirname, "fixtures", "README.md"));
  assert.equal(fixturePath("/%2e%2e%2fREADME.md"), null);
});

test("fixture server validates its optional port", () => {
  assert.equal(parsePort([]), 8765);
  assert.equal(parsePort(["--port", "9000"]), 9000);
  assert.throws(() => parsePort(["--port", "nope"]), /integer/);
  assert.throws(() => parsePort(["--port", "70000"]), /integer/);
});

test("fixture server binds locally unless remote-device access is explicit", () => {
  assert.equal(parseHost([]), "127.0.0.1");
  assert.equal(parseHost(["--host", "0.0.0.0"]), "0.0.0.0");
  assert.throws(() => parseHost(["--host"]), /bind address/);
});

test("referer fixture accepts only the serving page origin", () => {
  assert.equal(hasFixtureReferer({ headers: { host: "127.0.0.1:8765", referer: "http://127.0.0.1:8765/watch?private=1" } }), true);
  assert.equal(hasFixtureReferer({ headers: { host: "127.0.0.1:8765" } }), false);
  assert.equal(hasFixtureReferer({ headers: { host: "127.0.0.1:8765", referer: "https://elsewhere.test/" } }), false);
});

test("referer fixture returns 403 without context and 200 with context", async (t) => {
  const server = createFixtureServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/referer-required.m3u8`;

  assert.equal((await fetch(url)).status, 403);
  const allowed = await fetch(url, { headers: { Referer: `http://127.0.0.1:${port}/private/watch` } });
  assert.equal(allowed.status, 200);
  assert.match(await allowed.text(), /^#EXTM3U/);
});
