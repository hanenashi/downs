const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const replayModule = import(pathToFileURL(
  path.resolve(__dirname, "../tools/replay-source-bundle.mjs")
));

test("parses replay output and diagnostic options", async () => {
  const { parseArgs } = await replayModule;
  assert.deepEqual(
    parseArgs(["capture.tar", "--output", "replayed.mp4", "--ffprobe", "--force"]),
    {
      bundle: "capture.tar",
      output: "replayed.mp4",
      ffprobe: true,
      force: true,
      help: false
    }
  );
});

test("accepts bundle-relative archive paths", async () => {
  const { safeArchivePath } = await replayModule;
  assert.equal(safeArchivePath("segments/000001.ts"), "segments/000001.ts");
});

test("rejects archive paths that could escape or alias the extraction root", async () => {
  const { safeArchivePath } = await replayModule;
  for (const value of ["../secret", "/absolute", "C:/windows", "segments\\evil", "a//b"]) {
    assert.throws(() => safeArchivePath(value), /Unsafe TAR path/);
  }
});
