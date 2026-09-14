const test = require("node:test");
const assert = require("node:assert/strict");

const RequestContext = require("../extension/request-context.js");

test("request context retains only an HTTP(S) referer origin", () => {
  assert.deepEqual(
    RequestContext.sanitize({
      referer: "https://user:secret@example.test/watch?id=private#player",
      hasCookie: true,
      hasAuthorization: true
    }),
    {
      referer: "https://example.test/",
      hasCookie: true,
      hasAuthorization: true
    }
  );
  assert.equal(RequestContext.sanitize({ referer: "file:///tmp/watch.html" }).referer, "");
  assert.equal(RequestContext.sanitize({ referer: "not a URL" }).referer, "");
});

test("referer rule is exact, extension-initiated, and request-only", () => {
  const rule = RequestContext.createRefererRule(
    880000,
    "https://cdn.example.test/master.m3u8?token=a+b",
    { referer: "https://player.example.test/watch?secret=yes" },
    "abcdefghijklmnop"
  );
  assert.deepEqual(rule.action.requestHeaders, [
    { header: "Referer", operation: "set", value: "https://player.example.test/" }
  ]);
  assert.deepEqual(rule.condition.initiatorDomains, ["abcdefghijklmnop"]);
  assert.deepEqual(rule.condition.resourceTypes, ["xmlhttprequest"]);
  assert.match("https://cdn.example.test/master.m3u8?token=a+b", new RegExp(rule.condition.regexFilter));
  assert.doesNotMatch("https://cdn.example.test/master.m3u8?token=a-b", new RegExp(rule.condition.regexFilter));
});

test("referer rule rejects invalid inputs and overlong exact URLs", () => {
  assert.equal(RequestContext.createRefererRule(1, "javascript:alert(1)", { referer: "https://a.test" }, "id"), null);
  assert.equal(RequestContext.createRefererRule(1, "https://a.test/x", { referer: "data:text/plain,x" }, "id"), null);
  assert.equal(RequestContext.exactUrlRegex(`https://a.test/${"x".repeat(2000)}`), "");
});
