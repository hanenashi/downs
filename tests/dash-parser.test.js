const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Dash = require("../extension/dash-parser.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures/sample.mpd"), "utf8");

test("parses a static split video/audio MPD with inherited SegmentTimeline metadata", () => {
  const dash = Dash.parseMpd(fixture, "https://media.example.test/manifests/sample.mpd");

  assert.equal(dash.kind, "dash");
  assert.equal(dash.dynamic, false);
  assert.equal(dash.durationSeconds, 12);
  assert.equal(dash.periodCount, 1);
  assert.equal(dash.videoRepresentations.length, 2);
  assert.equal(dash.audioRepresentations.length, 1);
  assert.equal(dash.encrypted, false);
  assert.deepEqual(dash.addressing, ["SegmentTemplate + timeline"]);
  assert.equal(dash.videoRepresentations[0].expandedSegments, 3);
  assert.equal(
    dash.videoRepresentations[0].baseUrl,
    "https://media.example.test/manifests/video/360/"
  );
});

test("classifies dynamic and protected MPDs without treating them as downloadable", () => {
  const dash = Dash.parseMpd(`
    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" minBufferTime="PT2S">
      <Period>
        <AdaptationSet contentType="video" mimeType="video/mp4">
          <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>
          <Representation id="protected" bandwidth="1000000" codecs="avc1.4d401f">
            <SegmentList><SegmentURL media="one.m4s"/></SegmentList>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>
  `, "https://media.example.test/live.mpd");

  assert.equal(dash.dynamic, true);
  assert.equal(dash.encrypted, true);
  assert.equal(dash.protections[0].value, "cenc");
  assert.equal(dash.representations[0].mode, "SegmentList");
  assert.match(dash.warnings.join(" "), /Dynamic\/live/);
});

test("rejects XML entities, mismatched tags, and non-MPD roots", () => {
  assert.throws(
    () => Dash.parseMpd('<!DOCTYPE MPD [<!ENTITY x "secret">]><MPD>&x;</MPD>'),
    /DOCTYPE and ENTITY/
  );
  assert.throws(() => Dash.parseMpd("<MPD><Period></MPD>"), /Mismatched closing tag/);
  assert.deepEqual(
    Dash.parseMpd("<html><body>not dash</body></html>"),
    { kind: "not-dash", reason: "The XML root element is not MPD." }
  );
});

test("parses DASH day-time durations", () => {
  assert.equal(Dash.isoDuration("P1DT2H3M4.5S"), 93784.5);
  assert.equal(Dash.isoDuration("PT12S"), 12);
  assert.equal(Dash.isoDuration("not-a-duration"), undefined);
});
