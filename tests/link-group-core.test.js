const test = require("node:test");
const assert = require("node:assert/strict");

const { BURST_WINDOW_MS, groupLinks, relatedLinks } = require("../extension/link-group-core.js");

function link(url, foundAt, pageUrl = "https://player.example.test/watch") {
  return { url, foundAt, lastSeenAt: foundAt, pageUrl, initiator: new URL(pageUrl).origin };
}

test("groups a master and ABR children by a distinctive shared path", () => {
  const master = link("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", 1_000);
  const child720 = link("https://test-streams.mux.dev/x36xhzz/url_2/720.m3u8", 20_000);
  const child1080 = link("https://test-streams.mux.dev/x36xhzz/url_2/1080.m3u8", 80_000);
  const groups = groupLinks([child1080, master, child720]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary, master);
  assert.deepEqual(new Set(groups[0].related), new Set([child720, child1080]));
});

test("keeps switched sources and different CDN hosts separate", () => {
  const mux = link("https://test-streams.mux.dev/x36xhzz/master.m3u8", 1_000);
  const angel = link("https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8", 2_000);
  const mirror = link("https://media.example.test/x36xhzz/720.m3u8", 3_000);

  assert.equal(groupLinks([mux, angel, mirror]).length, 3);
});

test("groups a same-page same-host startup burst even under a generic directory", () => {
  const master = link("https://cdn.example.test/live/master.m3u8", 10_000);
  const child = link("https://cdn.example.test/live/1080.m3u8", 10_000 + BURST_WINDOW_MS);
  assert.equal(relatedLinks(master, child), true);
  assert.equal(groupLinks([master, child]).length, 1);
});

test("does not merge generic paths outside the startup burst", () => {
  const first = link("https://cdn.example.test/live/first.m3u8", 1_000);
  const second = link("https://cdn.example.test/live/second.m3u8", 1_000 + BURST_WINDOW_MS + 1);
  assert.equal(relatedLinks(first, second), false);
});

test("groups token refreshes of the same playlist path", () => {
  const first = link("https://cdn.example.test/show/index.m3u8?token=one", 1_000);
  const refreshed = link("https://cdn.example.test/show/index.m3u8?token=two", 100_000);
  const groups = groupLinks([first, refreshed]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].links.length, 2);
});
