(function initDownsDash(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsDash = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const MAX_XML_NODES = 20_000;
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

  function segmentInfo(nodes) {
    const template = [...nodes].reverse().map((node) => firstChild(node, "SegmentTemplate")).find(Boolean);
    const list = [...nodes].reverse().map((node) => firstChild(node, "SegmentList")).find(Boolean);
    const base = [...nodes].reverse().map((node) => firstChild(node, "SegmentBase")).find(Boolean);
    if (template) {
      const timeline = firstChild(template, "SegmentTimeline");
      if (timeline) {
        const points = children(timeline, "S");
        let expandedSegments = 0;
        let openEnded = false;
        for (const point of points) {
          const repeat = numberValue(attribute(point, "r")) || 0;
          if (repeat < 0) openEnded = true;
          else expandedSegments += repeat + 1;
        }
        return {
          mode: "SegmentTemplate + timeline",
          timelineEntries: points.length,
          expandedSegments: openEnded ? undefined : expandedSegments,
          timescale: numberValue(attribute(template, "timescale")) || 1
        };
      }
      return {
        mode: attribute(template, "duration") ? "SegmentTemplate + duration" : "SegmentTemplate",
        timelineEntries: 0,
        timescale: numberValue(attribute(template, "timescale")) || 1
      };
    }
    if (list) return { mode: "SegmentList", timelineEntries: 0 };
    if (base) return { mode: "SegmentBase", timelineEntries: 0 };
    return { mode: "Unspecified", timelineEntries: 0 };
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
    const protections = protectionInfo(children(root, "ContentProtection"));
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
          const segments = segmentInfo([root, period, adaptation, representation]);
          addressing.add(segments.mode);
          representations.push({
            id: attribute(representation, "id"),
            kind: contentKind(adaptation, representation),
            mimeType: attribute(representation, "mimeType") || attribute(adaptation, "mimeType"),
            codecs: attribute(representation, "codecs") || attribute(adaptation, "codecs"),
            bandwidth: numberValue(attribute(representation, "bandwidth")),
            width: numberValue(attribute(representation, "width") || attribute(adaptation, "width")),
            height: numberValue(attribute(representation, "height") || attribute(adaptation, "height")),
            frameRate: attribute(representation, "frameRate") || attribute(adaptation, "frameRate"),
            audioSamplingRate: numberValue(
              attribute(representation, "audioSamplingRate") || attribute(adaptation, "audioSamplingRate")
            ),
            language: attribute(adaptation, "lang"),
            baseUrl: resolveBase(representation, adaptationBase),
            protected: adaptationProtections.length > 0 || representationProtections.length > 0,
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

  return { isoDuration, parseMpd, parseXml };
});
