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
  assert.equal(
    dash.videoRepresentations[1].initializationUrl,
    "https://media.example.test/manifests/video/720/init-720.mp4"
  );
  assert.deepEqual(
    dash.videoRepresentations[1].segments.map((segment) => segment.url),
    [
      "https://media.example.test/manifests/video/720/720-0.m4s",
      "https://media.example.test/manifests/video/720/720-4000.m4s",
      "https://media.example.test/manifests/video/720/720-8000.m4s"
    ]
  );
  const direct = Dash.validateDirectPair(dash, "720", "audio-en");
  assert.equal(direct.supported, true);
  assert.equal(direct.code, "direct-dash-fmp4-vod");
  assert.equal(direct.video.durationSeconds, 12);
  assert.equal(direct.audio.durationSeconds, 12);
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
  assert.equal(Dash.validateDirectPair(dash).code, "dash-live");
});

test("expands formatted Number templates and rejects open-ended timelines", () => {
  const dash = Dash.parseMpd(`
    <MPD type="static" mediaPresentationDuration="PT4S">
      <Period>
        <AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.4d401f">
          <Representation id="v" bandwidth="500000">
            <SegmentTemplate timescale="1000" initialization="init-$RepresentationID$.mp4" media="chunk-$RepresentationID$-$Number%05d$.m4s">
              <SegmentTimeline><S t="0" d="2000" r="1"/></SegmentTimeline>
            </SegmentTemplate>
          </Representation>
        </AdaptationSet>
        <AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">
          <Representation id="a" bandwidth="96000">
            <SegmentTemplate timescale="1000" initialization="init-$RepresentationID$.mp4" media="chunk-$RepresentationID$-$Number%05d$.m4s">
              <SegmentTimeline><S t="0" d="2000" r="-1"/></SegmentTimeline>
            </SegmentTemplate>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>
  `, "https://cdn.example.test/manifest.mpd");

  assert.deepEqual(dash.videoRepresentations[0].segments.map((segment) => segment.url), [
    "https://cdn.example.test/chunk-v-00001.m4s",
    "https://cdn.example.test/chunk-v-00002.m4s"
  ]);
  assert.match(dash.audioRepresentations[0].downloadIssue, /Open-ended/);
  assert.equal(Dash.validateDirectPair(dash).code, "dash-audio");
});

test("representation addressing overrides an inherited SegmentTemplate", () => {
  const dash = Dash.parseMpd(`
    <MPD type="static" mediaPresentationDuration="PT6S">
      <Period>
        <SegmentTemplate initialization="init-$RepresentationID$.mp4" media="$Number$.m4s"
          duration="2" timescale="1" />
        <AdaptationSet mimeType="video/mp4" codecs="avc1.4d401e">
          <Representation id="video" bandwidth="500000">
            <SegmentList><Initialization sourceURL="video-init.mp4" /></SegmentList>
          </Representation>
        </AdaptationSet>
        <AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2">
          <Representation id="audio" bandwidth="96000" />
        </AdaptationSet>
      </Period>
    </MPD>
  `, "https://example.test/manifest.mpd");

  assert.equal(dash.videoRepresentations[0].mode, "SegmentList");
  assert.match(Dash.validateDirectPair(dash).reason, /finite initialization\/segment plan/i);
});

test("rejects an initial SegmentTimeline gap", () => {
  const dash = Dash.parseMpd(`
    <MPD type="static" mediaPresentationDuration="PT4S">
      <Period>
        <AdaptationSet mimeType="video/mp4" codecs="avc1.4d401e">
          <Representation id="video" bandwidth="500000">
            <SegmentTemplate initialization="init.mp4" media="$Time$.m4s" timescale="1">
              <SegmentTimeline><S t="1" d="2" r="1" /></SegmentTimeline>
            </SegmentTemplate>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>
  `, "https://example.test/manifest.mpd");

  assert.match(dash.videoRepresentations[0].downloadIssue, /gaps or regressions/i);
});

test("keeps HE-AAC outside the first DIRECT DASH milestone", () => {
  const dash = Dash.parseMpd(fixture.replace('codecs="mp4a.40.2"', 'codecs="mp4a.40.5"'), "https://media.example.test/manifest.mpd");
  const result = Dash.validateDirectPair(dash);
  assert.equal(result.code, "dash-audio");
  assert.match(result.reason, /AAC-LC/);
});

test("accepts AV1 video in the bounded DIRECT DASH layout", () => {
  const dash = Dash.parseMpd(
    fixture.replace('codecs="avc1.4d401f"', 'codecs="av01.0.04M.08"'),
    "https://media.example.test/manifest.mpd"
  );
  const result = Dash.validateDirectPair(dash, "360", "audio-en");
  assert.equal(result.supported, true);
  assert.match(result.reason, /AV1/);
});

test("materializes finite fixed-duration Number templates", () => {
  const dash = Dash.parseMpd(`
    <MPD type="static" mediaPresentationDuration="PT5S">
      <Period duration="PT5S">
        <AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.4d401f">
          <SegmentTemplate timescale="1000" duration="2000" startNumber="7" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number$.m4s"/>
          <Representation id="v" bandwidth="500000"/>
        </AdaptationSet>
        <AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">
          <SegmentTemplate timescale="48000" duration="96000" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number$.m4s"/>
          <Representation id="a" bandwidth="96000"/>
        </AdaptationSet>
      </Period>
    </MPD>
  `, "https://cdn.example.test/manifest.mpd");
  assert.deepEqual(dash.videoRepresentations[0].segments.map((segment) => segment.url), [
    "https://cdn.example.test/v/7.m4s",
    "https://cdn.example.test/v/8.m4s",
    "https://cdn.example.test/v/9.m4s"
  ]);
  assert.deepEqual(dash.videoRepresentations[0].segments.map((segment) => segment.duration), [2, 2, 1]);
  assert.equal(Dash.validateDirectPair(dash).supported, true);
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
