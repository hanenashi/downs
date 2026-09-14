const test = require("node:test");
const assert = require("node:assert/strict");

const {
  matchingRenditions,
  optionLabel,
  preferredRendition,
  renditionLabel
} = require("../extension/audio-core.js");

const renditions = [
  {
    name: "English",
    language: "en",
    groupId: "aac",
    url: "https://example.com/audio/en.m3u8",
    default: false,
    autoSelect: true,
    channels: "2"
  },
  {
    name: "Japanese",
    language: "ja",
    groupId: "aac",
    url: "https://example.com/audio/ja.m3u8",
    default: true,
    autoSelect: true,
    channels: "2"
  },
  {
    name: "Commentary",
    language: "en",
    groupId: "commentary",
    url: "https://example.com/audio/commentary.m3u8"
  }
];

test("matches and deduplicates only playable renditions in a variant audio group", () => {
  const result = matchingRenditions(
    {
      audioRenditions: [
        ...renditions,
        { ...renditions[0] },
        { name: "Metadata only", groupId: "aac", url: "" }
      ]
    },
    { audioGroup: "aac" }
  );

  assert.deepEqual(result, renditions.slice(0, 2));
  assert.deepEqual(matchingRenditions({ audioRenditions: renditions }, {}), []);
});

test("prefers default, then autoselect, then the first audio rendition", () => {
  assert.equal(preferredRendition(renditions), renditions[1]);
  assert.equal(preferredRendition([renditions[0], renditions[2]]), renditions[0]);
  assert.equal(preferredRendition([renditions[2]]), renditions[2]);
  assert.equal(preferredRendition([]), null);
});

test("builds concise stable audio labels", () => {
  assert.equal(renditionLabel(renditions[1], ["en"]), "Japanese");
  assert.equal(renditionLabel({ name: "stream_1", language: "ja" }, ["en"]), "Japanese");
  assert.equal(renditionLabel({ name: "audio_1", language: "eng" }, ["en"]), "English");
  assert.equal(renditionLabel({}, ["en"]), "Default audio");
  assert.equal(optionLabel(renditions[1], ["en"]), "Japanese · default · 2 ch");
});
