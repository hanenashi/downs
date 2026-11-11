(function initDownsDash(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsDash = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const MAX_XML_NODES = 20_000;
  const MAX_MEDIA_SEGMENTS = 20_000;
  const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;

  function localName(value) {
    return String(value || "").split(":").pop();
  }

  function decodeEntities(value) {
    return String(value || "").replace(/&([^;]+);/g, (_match, entity) => {
      const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' }[entity];
      if (named !== undefined) return named;
      const numeric = entity.match(/^#(x[0-9a-f]+|[0-9]+)$/i);
      if (!numeric) throw new Error(`Unsupported XML entity: &${entity};`);
      const codePoint = numeric[1][0].toLowerCase() === "x"
        ? Number.parseInt(numeric[1].slice(1), 16)
        : Number.parseInt(numeric[1], 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw new Error("Invalid XML character reference.");
      }
      return String.fromCodePoint(codePoint);
    });
  }

  function parseOpeningTag(value) {
    let source = value.trim();
    const selfClosing = source.endsWith("/");
    if (selfClosing) source = source.slice(0, -1).trimEnd();
    const nameMatch = source.match(NAME);
    if (!nameMatch) throw new Error("Invalid XML element name.");
    const name = nameMatch[0];
    const attributes = {};
    let index = name.length;
    while (index < source.length) {
      while (/\s/.test(source[index] || "")) index += 1;
      if (index >= source.length) break;
      const attributeMatch = source.slice(index).match(NAME);
      if (!attributeMatch) throw new Error(`Invalid attribute in <${name}>.`);
      const attributeName = attributeMatch[0];
      index += attributeName.length;
      while (/\s/.test(source[index] || "")) index += 1;
      if (source[index] !== "=") throw new Error(`Attribute ${attributeName} has no value.`);
      index += 1;
      while (/\s/.test(source[index] || "")) index += 1;
      const quote = source[index];
      if (quote !== '"' && quote !== "'") throw new Error(`Attribute ${attributeName} is not quoted.`);
      const end = source.indexOf(quote, index + 1);
      if (end < 0) throw new Error(`Attribute ${attributeName} is unterminated.`);
      if (Object.hasOwn(attributes, attributeName)) throw new Error(`Duplicate attribute: ${attributeName}`);
      attributes[attributeName] = decodeEntities(source.slice(index + 1, end));
      index = end + 1;
    }
    return { name, attributes, selfClosing };
  }

  function tagEnd(source, start) {
    let quote = "";
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        return index;
      }
    }
    return -1;
  }

  function parseXml(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
      throw new Error("DOCTYPE and ENTITY declarations are not accepted in MPDs.");
    }
    const stack = [];
    let root = null;
    let index = 0;
    let nodeCount = 0;

    const appendText = (value) => {
      if (!value) return;
      if (!stack.length) {
        if (value.trim()) throw new Error("Text is not allowed outside the MPD root.");
        return;
      }
      stack[stack.length - 1].text += decodeEntities(value);
    };

    while (index < source.length) {
      if (source[index] !== "<") {
        const next = source.indexOf("<", index);
        appendText(source.slice(index, next < 0 ? source.length : next));
        index = next < 0 ? source.length : next;
        continue;
      }
      if (source.startsWith("<!--", index)) {
        const end = source.indexOf("-->", index + 4);
        if (end < 0) throw new Error("Unterminated XML comment.");
        index = end + 3;
        continue;
      }
      if (source.startsWith("<?", index)) {
        const end = source.indexOf("?>", index + 2);
        if (end < 0) throw new Error("Unterminated XML processing instruction.");
        index = end + 2;
        continue;
      }
      if (source.startsWith("<![CDATA[", index)) {
        const end = source.indexOf("]]>", index + 9);
        if (end < 0) throw new Error("Unterminated CDATA section.");
        appendText(source.slice(index + 9, end));
        index = end + 3;
        continue;
      }
      if (source.startsWith("</", index)) {
        const end = source.indexOf(">", index + 2);
        if (end < 0) throw new Error("Unterminated closing tag.");
        const name = source.slice(index + 2, end).trim();
        if (!NAME.test(name) || name.match(NAME)?.[0] !== name) throw new Error("Invalid closing tag.");
        const current = stack.pop();
        if (!current || current.name !== name) throw new Error(`Mismatched closing tag: ${name}`);
        index = end + 1;
        continue;
      }
      if (source.startsWith("<!", index)) throw new Error("Unsupported XML declaration.");

      const end = tagEnd(source, index + 1);
      if (end < 0) throw new Error("Unterminated opening tag.");
      const parsed = parseOpeningTag(source.slice(index + 1, end));
      nodeCount += 1;
      if (nodeCount > MAX_XML_NODES) throw new Error("The MPD contains too many XML elements.");
      const node = { name: parsed.name, attributes: parsed.attributes, children: [], text: "" };
      if (stack.length) {
        stack[stack.length - 1].children.push(node);
      } else if (root) {
        throw new Error("The XML contains more than one root element.");
      } else {
        root = node;
      }
      if (!parsed.selfClosing) stack.push(node);
      index = end + 1;
    }

    if (stack.length) throw new Error(`Unclosed XML element: ${stack[stack.length - 1].name}`);
    if (!root) throw new Error("The response contains no XML root element.");
    return root;
  }

  function attribute(node, wanted) {
    for (const [name, value] of Object.entries(node?.attributes || {})) {
      if (localName(name) === wanted) return value;
    }
    return "";
  }

  function children(node, wanted) {
    return (node?.children || []).filter((child) => localName(child.name) === wanted);
  }

  function firstChild(node, wanted) {
    return children(node, wanted)[0] || null;
  }

  function descendants(node, wanted, output = []) {
    for (const child of node?.children || []) {
      if (localName(child.name) === wanted) output.push(child);
      descendants(child, wanted, output);
    }
    return output;
  }

  function numberValue(value) {
    if (value === "") return undefined;
    const result = Number(value);
    return Number.isFinite(result) ? result : undefined;
  }

  function integerValue(value) {
    const result = numberValue(value);
    return Number.isSafeInteger(result) ? result : undefined;
  }

  function isoDuration(value) {
    const match = String(value || "").match(
      /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
    );
    if (!match) return undefined;
    return (Number(match[1] || 0) * 86400) +
      (Number(match[2] || 0) * 3600) +
      (Number(match[3] || 0) * 60) +
      Number(match[4] || 0);
  }

  function resolveBase(node, inheritedBase) {
    const value = firstChild(node, "BaseURL")?.text.trim();
    if (!value) return inheritedBase;
    try {
      return new URL(value, inheritedBase).toString();
    } catch (_error) {
      return inheritedBase;
    }
  }

  function contentKind(adaptation, representation) {
    const type = (attribute(representation, "contentType") || attribute(adaptation, "contentType")).toLowerCase();
    const mime = (attribute(representation, "mimeType") || attribute(adaptation, "mimeType")).toLowerCase();
    const codecs = (attribute(representation, "codecs") || attribute(adaptation, "codecs")).toLowerCase();
    if (type === "video" || mime.startsWith("video/") || /(?:^|,)(?:avc|hev|hvc|vp0?9|av01)/.test(codecs)) return "video";
    if (type === "audio" || mime.startsWith("audio/") || /(?:^|,)(?:mp4a|opus|vorbis|ac-3|ec-3)/.test(codecs)) return "audio";
    if (type === "text" || mime.startsWith("text/") || /(?:stpp|wvtt)/.test(codecs)) return "text";
    return type || "unknown";
  }

  function protectionInfo(nodes) {
    return nodes.map((node) => ({
      schemeIdUri: attribute(node, "schemeIdUri"),
      value: attribute(node, "value"),
      defaultKid: attribute(node, "default_KID")
    }));
  }

  function templateAttributes(node) {
    const output = {};
    for (const [name, value] of Object.entries(node?.attributes || {})) {
      output[localName(name)] = value;
    }
    return output;
  }

  function formatTemplateValue(value, width) {
    const text = String(value);
    if (!width) return text;
    const padding = Number(width);
    if (!Number.isSafeInteger(padding) || padding < 1 || padding > 20) {
      throw new Error("SegmentTemplate numeric formatting width is unsupported.");
    }
    return text.padStart(padding, "0");
  }

  function resolveTemplate(pattern, context, number, time) {
    const escapedDollar = "\u0000";
    let result = String(pattern || "").replace(/\$\$/g, escapedDollar);
    result = result.replace(
      /\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g,
      (_match, token, width) => {
        const value = {
          RepresentationID: context.id,
          Bandwidth: context.bandwidth,
          Number: number,
          Time: time
        }[token];
        if (value === undefined || value === "") {
          throw new Error(`SegmentTemplate requires ${token}.`);
        }
        return formatTemplateValue(value, width);
      }
    );
    if (result.includes("$")) throw new Error("SegmentTemplate contains an unsupported substitution token.");
    result = result.replaceAll(escapedDollar, "$");
    return new URL(result, context.baseUrl).toString();
  }

  function segmentInfo(nodes, context = {}) {
    const templates = nodes.map((node) => firstChild(node, "SegmentTemplate")).filter(Boolean);
    const template = templates.at(-1);
    const list = [...nodes].reverse().map((node) => firstChild(node, "SegmentList")).find(Boolean);
    const base = [...nodes].reverse().map((node) => firstChild(node, "SegmentBase")).find(Boolean);
    const nearestAddressing = [...nodes].reverse().map((node) => {
      if (firstChild(node, "SegmentTemplate")) return "template";
      if (firstChild(node, "SegmentList")) return "list";
      if (firstChild(node, "SegmentBase")) return "base";
      return "";
    }).find(Boolean);
    if (nearestAddressing === "list") {
      return { mode: "SegmentList", timelineEntries: 0, initializationUrl: "", segments: [] };
    }
    if (nearestAddressing === "base") {
      return { mode: "SegmentBase", timelineEntries: 0, initializationUrl: "", segments: [] };
    }
    if (template) {
      const attributes = templates.reduce(
        (merged, candidate) => ({ ...merged, ...templateAttributes(candidate) }),
        {}
      );
      const timeline = [...templates].reverse()
        .map((candidate) => firstChild(candidate, "SegmentTimeline"))
        .find(Boolean);
      const timescale = integerValue(attributes.timescale) || 1;
      const summary = {
        mode: timeline
          ? "SegmentTemplate + timeline"
          : attributes.duration
            ? "SegmentTemplate + duration"
            : "SegmentTemplate",
        timelineEntries: timeline ? children(timeline, "S").length : 0,
        timescale,
        initializationUrl: "",
        segments: []
      };
      const reject = (message) => ({ ...summary, downloadIssue: message });

      if (!Object.hasOwn(context, "id")) return summary;
      if (!timeline && !attributes.duration) {
        return reject("DIRECT DASH requires a finite SegmentTimeline or fixed segment duration.");
      }
      if (!attributes.initialization || !attributes.media) {
        return reject("SegmentTemplate must declare initialization and media URLs.");
      }
      if (!Number.isSafeInteger(timescale) || timescale <= 0) {
        return reject("SegmentTemplate timescale must be a positive safe integer.");
      }
      const startNumber = integerValue(attributes.startNumber) ?? 1;
      const presentationTimeOffset = integerValue(attributes.presentationTimeOffset) ?? 0;
      if (startNumber < 0 || presentationTimeOffset < 0) {
        return reject("SegmentTemplate numbering and presentation offsets must be non-negative integers.");
      }

      const segments = [];
      let currentTime = 0;
      try {
        if (!timeline) {
          const duration = integerValue(attributes.duration);
          if (!duration || duration < 1 || !Number.isFinite(context.durationSeconds) || context.durationSeconds <= 0) {
            return reject("Fixed-duration SegmentTemplate needs a positive duration and finite Period length.");
          }
          const count = Math.ceil((context.durationSeconds * timescale) / duration - 1e-9);
          if (!Number.isSafeInteger(count) || count < 1 || count > MAX_MEDIA_SEGMENTS) {
            return reject(`The DASH track exceeds the ${MAX_MEDIA_SEGMENTS.toLocaleString()} segment limit.`);
          }
          currentTime = presentationTimeOffset;
          for (let index = 0; index < count; index += 1) {
            const number = startNumber + index;
            const start = (currentTime - presentationTimeOffset) / timescale;
            segments.push({
              url: resolveTemplate(attributes.media, context, number, currentTime),
              duration: Math.min(duration / timescale, context.durationSeconds - start),
              start,
              number,
              time: currentTime
            });
            currentTime += duration;
          }
        }
        for (const point of timeline ? children(timeline, "S") : []) {
          const explicitTime = attribute(point, "t");
          if (explicitTime !== "") {
            const parsedTime = integerValue(explicitTime);
            if (parsedTime === undefined || parsedTime < 0) {
              return reject("SegmentTimeline timestamps must be safe non-negative integers.");
            }
            const expectedTime = segments.length ? currentTime : presentationTimeOffset;
            if (parsedTime !== expectedTime) {
              return reject("SegmentTimeline gaps or regressions are not supported.");
            }
            currentTime = parsedTime;
          }
          const duration = integerValue(attribute(point, "d"));
          const repeat = attribute(point, "r") === "" ? 0 : integerValue(attribute(point, "r"));
          if (!duration || duration < 1) return reject("SegmentTimeline entries need positive integer durations.");
          if (repeat === undefined || repeat < 0) {
            return reject("Open-ended or invalid SegmentTimeline repeats are not supported.");
          }
          if (segments.length + repeat + 1 > MAX_MEDIA_SEGMENTS) {
            return reject(`The DASH track exceeds the ${MAX_MEDIA_SEGMENTS.toLocaleString()} segment limit.`);
          }
          for (let repeated = 0; repeated <= repeat; repeated += 1) {
            const number = startNumber + segments.length;
            const start = (currentTime - presentationTimeOffset) / timescale;
            if (start < -0.001) return reject("SegmentTimeline starts before its presentation offset.");
            segments.push({
              url: resolveTemplate(attributes.media, context, number, currentTime),
              duration: duration / timescale,
              start: Math.max(0, start),
              number,
              time: currentTime
            });
            currentTime += duration;
          }
        }
        const initializationUrl = resolveTemplate(
          attributes.initialization,
          context,
          startNumber,
          segments[0]?.time ?? 0
        );
        return {
          ...summary,
          expandedSegments: segments.length,
          initializationUrl,
          segments,
          durationSeconds: segments.reduce((total, segment) => total + segment.duration, 0)
        };
      } catch (error) {
        return reject(error?.message || "SegmentTemplate URL expansion failed.");
      }
    }
    if (list) return { mode: "SegmentList", timelineEntries: 0, initializationUrl: "", segments: [] };
    if (base) return { mode: "SegmentBase", timelineEntries: 0, initializationUrl: "", segments: [] };
    return { mode: "Unspecified", timelineEntries: 0, initializationUrl: "", segments: [] };
  }

  function representationIssue(representation, kind) {
    if (!representation) return `No ${kind} representation was selected.`;
    if (representation.kind !== kind) return `The selected ${kind} representation has the wrong content type.`;
    if (representation.id === "") return `The selected ${kind} representation has no stable id.`;
    if (representation.periodIndex !== 0) return "DIRECT DASH supports one Period only.";
    if (representation.protected) return "Protected DASH representations are unsupported.";
    if (String(representation.mimeType || "").toLowerCase() !== `${kind}/mp4`) {
      return `The selected ${kind} representation is not ISO BMFF/fMP4.`;
    }
    if (kind === "video" && !/^(?:avc[13](?:\.|$)|av01(?:\.|$))/i.test(representation.codecs || "")) {
      return "DIRECT DASH requires H.264/AVC or AV1 video.";
    }
    if (kind === "audio" && !/^mp4a\.40\.2(?:$|[,;])/i.test(representation.codecs || "")) {
      return "DIRECT DASH currently requires AAC-LC audio (mp4a.40.2).";
    }
    if (representation.downloadIssue) return representation.downloadIssue;
    if (!representation.initializationUrl || !representation.segments?.length) {
      return `The selected ${kind} representation has no finite initialization/segment plan.`;
    }
    const urls = [representation.initializationUrl, ...representation.segments.map((segment) => segment.url)];
    if (urls.some((value) => {
      try {
        return !["http:", "https:"].includes(new URL(value).protocol);
      } catch (_error) {
        return true;
      }
    })) {
      return `The selected ${kind} representation contains a non-HTTP(S) media URL.`;
    }
    return "";
  }

  function compatibleRepresentations(dash, kind) {
    const values = kind === "video" ? dash?.videoRepresentations : dash?.audioRepresentations;
    return (values || []).filter((representation) => !representationIssue(representation, kind));
  }

  function validateDirectPair(dash, videoId = "", audioId = "") {
    if (!dash || dash.kind !== "dash") {
      return { supported: false, code: "not-dash", reason: "The response is not a DASH MPD." };
    }
    if (dash.dynamic || dash.type !== "static") {
      return { supported: false, code: "dash-live", reason: "Dynamic/live DASH is inspection-only." };
    }
    if (dash.encrypted) {
      return { supported: false, code: "protected", reason: "DRM or protected DASH cannot be downloaded." };
    }
    if (dash.periodCount !== 1) {
      return { supported: false, code: "dash-periods", reason: "DIRECT DASH requires exactly one Period." };
    }
    if (dash.periodStartSeconds !== 0) {
      return { supported: false, code: "dash-periods", reason: "DIRECT DASH requires its single Period to start at zero." };
    }
    if (!Number.isFinite(dash.durationSeconds) || dash.durationSeconds <= 0) {
      return { supported: false, code: "dash-duration", reason: "DIRECT DASH requires a finite presentation duration." };
    }

    const videos = compatibleRepresentations(dash, "video");
    const audios = compatibleRepresentations(dash, "audio");
    const video = videoId === "" ? videos[0] : videos.find((item) => String(item.id) === String(videoId));
    const audio = audioId === "" ? audios[0] : audios.find((item) => String(item.id) === String(audioId));
    const rawVideo = videoId === ""
      ? dash.videoRepresentations[0]
      : dash.videoRepresentations.find((item) => String(item.id) === String(videoId));
    const rawAudio = audioId === ""
      ? dash.audioRepresentations[0]
      : dash.audioRepresentations.find((item) => String(item.id) === String(audioId));
    const videoIssue = representationIssue(video || rawVideo, "video");
    if (videoIssue) return { supported: false, code: "dash-video", reason: videoIssue };
    const audioIssue = representationIssue(audio || rawAudio, "audio");
    if (audioIssue) return { supported: false, code: "dash-audio", reason: audioIssue };
    if (Math.abs(video.durationSeconds - audio.durationSeconds) > 2) {
      return { supported: false, code: "dash-duration", reason: "DASH video and audio durations differ by more than two seconds." };
    }
    if (Math.abs(Math.max(video.durationSeconds, audio.durationSeconds) - dash.durationSeconds) > 2) {
      return { supported: false, code: "dash-duration", reason: "DASH track timing does not match the presentation duration." };
    }
    return {
      supported: true,
      code: "direct-dash-fmp4-vod",
      reason: "Static DASH · H.264/AV1 + AAC · fMP4",
      video,
      audio,
      videos,
      audios
    };
  }

  function parseMpd(text, manifestUrl = "") {
    const root = parseXml(text);
    if (localName(root.name) !== "MPD") {
      return { kind: "not-dash", reason: "The XML root element is not MPD." };
    }

    const type = (attribute(root, "type") || "static").toLowerCase();
    const rootBase = resolveBase(root, manifestUrl);
    const periods = children(root, "Period");
    const representations = [];
    const rootProtections = protectionInfo(children(root, "ContentProtection"));
    const protections = [...rootProtections];
    const addressing = new Set();

    periods.forEach((period, periodIndex) => {
      const periodBase = resolveBase(period, rootBase);
      const periodProtections = protectionInfo(children(period, "ContentProtection"));
      protections.push(...periodProtections);
      for (const adaptation of children(period, "AdaptationSet")) {
        const adaptationBase = resolveBase(adaptation, periodBase);
        const adaptationProtections = protectionInfo(children(adaptation, "ContentProtection"));
        protections.push(...adaptationProtections);
        for (const representation of children(adaptation, "Representation")) {
          const representationProtections = protectionInfo(children(representation, "ContentProtection"));
          protections.push(...representationProtections);
          const baseUrl = resolveBase(representation, adaptationBase);
          const id = attribute(representation, "id");
          const bandwidth = numberValue(attribute(representation, "bandwidth"));
          const segments = segmentInfo([root, period, adaptation, representation], {
            id,
            bandwidth,
            baseUrl,
            durationSeconds: isoDuration(attribute(period, "duration")) ??
              isoDuration(attribute(root, "mediaPresentationDuration"))
          });
          addressing.add(segments.mode);
          representations.push({
            id,
            kind: contentKind(adaptation, representation),
            mimeType: attribute(representation, "mimeType") || attribute(adaptation, "mimeType"),
            codecs: attribute(representation, "codecs") || attribute(adaptation, "codecs"),
            bandwidth,
            width: numberValue(attribute(representation, "width") || attribute(adaptation, "width")),
            height: numberValue(attribute(representation, "height") || attribute(adaptation, "height")),
            frameRate: attribute(representation, "frameRate") || attribute(adaptation, "frameRate"),
            audioSamplingRate: numberValue(
              attribute(representation, "audioSamplingRate") || attribute(adaptation, "audioSamplingRate")
            ),
            language: attribute(adaptation, "lang"),
            baseUrl,
            protected: rootProtections.length > 0 || periodProtections.length > 0 ||
              adaptationProtections.length > 0 || representationProtections.length > 0,
            periodIndex,
            ...segments
          });
        }
      }
    });

    const warnings = [];
    if (!periods.length) warnings.push("The MPD contains no Period elements.");
    if (!representations.length) warnings.push("The MPD contains no directly inspectable representations.");
    if (type === "dynamic") warnings.push("Dynamic/live DASH is inspection-only.");
    if (periods.length > 1) warnings.push("Multiple DASH periods require timeline transition handling.");

    return {
      kind: "dash",
      url: manifestUrl,
      type,
      dynamic: type === "dynamic",
      durationSeconds: isoDuration(attribute(root, "mediaPresentationDuration")),
      minBufferTimeSeconds: isoDuration(attribute(root, "minBufferTime")),
      profiles: attribute(root, "profiles"),
      periodCount: periods.length,
      periodStartSeconds: periods.length ? (isoDuration(attribute(periods[0], "start")) ?? 0) : 0,
      representations,
      videoRepresentations: representations.filter((item) => item.kind === "video"),
      audioRepresentations: representations.filter((item) => item.kind === "audio"),
      otherRepresentations: representations.filter((item) => !["video", "audio"].includes(item.kind)),
      encrypted: protections.length > 0,
      protections,
      addressing: [...addressing],
      warnings
    };
  }

  return {
    compatibleRepresentations,
    isoDuration,
    parseMpd,
    parseXml,
    representationIssue,
    validateDirectPair
  };
});
