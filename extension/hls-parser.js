(function initDownsHls(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsHls = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const HLS_HEADER = "#EXTM3U";

  function normalizeText(text) {
    return String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  }

  function resolveUrl(value, baseUrl) {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, baseUrl).toString();
    } catch (_error) {
      return value;
    }
  }

  function splitAttributeList(input) {
    const parts = [];
    let current = "";
    let quoted = false;

    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (character === '"' && input[index - 1] !== "\\") {
        quoted = !quoted;
      }

      if (character === "," && !quoted) {
        parts.push(current);
        current = "";
      } else {
        current += character;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  function parseAttributeList(input) {
    const attributes = {};

    for (const part of splitAttributeList(input)) {
      const separator = part.indexOf("=");
      if (separator < 1) {
        continue;
      }

      const key = part.slice(0, separator).trim().toUpperCase();
      let value = part.slice(separator + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"');
      }
      attributes[key] = value;
    }

    return attributes;
  }

  function numberOrUndefined(value) {
    if (value === undefined || value === "") {
      return undefined;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function yesNo(value) {
    if (value === undefined) {
      return undefined;
    }
    return String(value).toUpperCase() === "YES";
  }

  function pathExtension(url) {
    try {
      const path = new URL(url).pathname.toLowerCase();
      const match = path.match(/\.([a-z0-9]+)$/);
      return match?.[1] || "";
    } catch (_error) {
      return "";
    }
  }

  function classifySegments(segments, hasMap) {
    const types = new Set();

    if (hasMap) {
      types.add("fmp4");
    }

    for (const segment of segments) {
      const extension = pathExtension(segment.url);
      if (extension === "ts" || extension === "aac") {
        types.add("ts");
      } else if (["m4s", "mp4", "cmfv", "cmfa"].includes(extension)) {
        types.add("fmp4");
      }
    }

    if (types.size > 1) {
      return "mixed";
    }
    return types.values().next().value || "unknown";
  }

  function isProtectedKey(key) {
    const method = (key.method || "").toUpperCase();
    const format = (key.keyFormat || "identity").toLowerCase();
    return method.includes("SAMPLE-AES") || format !== "identity";
  }

  function parsePlaylist(text, playlistUrl = "") {
    const normalized = normalizeText(text);
    const lines = normalized.split("\n").map((line) => line.trim());
    const firstMeaningfulLine = lines.find((line) => line.length > 0) || "";

    if (firstMeaningfulLine !== HLS_HEADER) {
      return {
        url: playlistUrl,
        kind: "not-hls",
        reason: firstMeaningfulLine.startsWith("<")
          ? "The server returned HTML instead of an HLS playlist."
          : "The response does not begin with #EXTM3U."
      };
    }

    const variants = [];
    const audioRenditions = [];
    const subtitleRenditions = [];
    const segments = [];
    const maps = [];
    const keys = [];
    const warnings = [];
    let pendingSegmentDuration;
    let pendingSegmentTitle = "";
    let pendingByteRange = "";
    let pendingDiscontinuity = false;
    let pendingGap = false;
    let targetDuration;
    let playlistType;
    let hasEndList = false;
    let iframeOnly = false;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const attributes = parseAttributeList(line.slice(line.indexOf(":") + 1));
        let uri = "";

        for (let next = index + 1; next < lines.length; next += 1) {
          if (!lines[next] || lines[next].startsWith("#")) {
            continue;
          }
          uri = lines[next];
          index = next;
          break;
        }

        if (!uri) {
          warnings.push("A variant declaration has no following playlist URI.");
          continue;
        }

        variants.push({
          url: resolveUrl(uri, playlistUrl),
          bandwidth: numberOrUndefined(attributes.BANDWIDTH),
          averageBandwidth: numberOrUndefined(attributes["AVERAGE-BANDWIDTH"]),
          resolution: attributes.RESOLUTION,
          codecs: attributes.CODECS,
          frameRate: numberOrUndefined(attributes["FRAME-RATE"]),
          audioGroup: attributes.AUDIO,
          videoGroup: attributes.VIDEO,
          subtitlesGroup: attributes.SUBTITLES
        });
        continue;
      }

      if (line.startsWith("#EXT-X-MEDIA:")) {
        const attributes = parseAttributeList(line.slice(line.indexOf(":") + 1));
        const rendition = {
          type: attributes.TYPE?.toLowerCase() || "unknown",
          groupId: attributes["GROUP-ID"],
          name: attributes.NAME,
          url: resolveUrl(attributes.URI, playlistUrl),
          language: attributes.LANGUAGE,
          default: yesNo(attributes.DEFAULT),
          autoSelect: yesNo(attributes.AUTOSELECT),
          channels: attributes.CHANNELS
        };

        if (rendition.type === "audio") {
          audioRenditions.push(rendition);
        } else if (rendition.type === "subtitles") {
          subtitleRenditions.push(rendition);
        }
        continue;
      }

      if (line.startsWith("#EXT-X-MAP:")) {
        const attributes = parseAttributeList(line.slice(line.indexOf(":") + 1));
        maps.push({
          url: resolveUrl(attributes.URI, playlistUrl),
          byteRange: attributes.BYTERANGE
        });
        continue;
      }

      if (line.startsWith("#EXT-X-KEY:")) {
        const attributes = parseAttributeList(line.slice(line.indexOf(":") + 1));
        keys.push({
          method: attributes.METHOD || "UNKNOWN",
          url: resolveUrl(attributes.URI, playlistUrl),
          iv: attributes.IV,
          keyFormat: attributes.KEYFORMAT || "identity",
          keyFormatVersions: attributes.KEYFORMATVERSIONS
        });
        continue;
      }

      if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        targetDuration = numberOrUndefined(line.slice(line.indexOf(":") + 1));
        continue;
      }

      if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
        playlistType = line.slice(line.indexOf(":") + 1).toUpperCase();
        continue;
      }

      if (line === "#EXT-X-ENDLIST") {
        hasEndList = true;
        continue;
      }

      if (line === "#EXT-X-I-FRAMES-ONLY") {
        iframeOnly = true;
        continue;
      }

      if (line.startsWith("#EXT-X-BYTERANGE:")) {
        pendingByteRange = line.slice(line.indexOf(":") + 1);
        continue;
      }

      if (line === "#EXT-X-DISCONTINUITY") {
        pendingDiscontinuity = true;
        continue;
      }

      if (line === "#EXT-X-GAP") {
        pendingGap = true;
        continue;
      }

      if (line.startsWith("#EXTINF:")) {
        const value = line.slice(line.indexOf(":") + 1);
        const comma = value.indexOf(",");
        pendingSegmentDuration = numberOrUndefined(comma >= 0 ? value.slice(0, comma) : value);
        pendingSegmentTitle = comma >= 0 ? value.slice(comma + 1) : "";
        continue;
      }

      if (line && !line.startsWith("#") && pendingSegmentDuration !== undefined) {
        segments.push({
          duration: pendingSegmentDuration,
          title: pendingSegmentTitle,
          url: resolveUrl(line, playlistUrl),
          byteRange: pendingByteRange,
          discontinuity: pendingDiscontinuity,
          gap: pendingGap
        });
        pendingSegmentDuration = undefined;
        pendingSegmentTitle = "";
        pendingByteRange = "";
        pendingDiscontinuity = false;
        pendingGap = false;
      }
    }

    const kind = variants.length > 0 || lines.some((line) => line.startsWith("#EXT-X-MEDIA:"))
      ? "master"
      : "media";
    const activeKeys = keys.filter((key) => key.method.toUpperCase() !== "NONE");
    const encrypted = activeKeys.length > 0;
    const drm = activeKeys.some(isProtectedKey);
    const segmented = classifySegments(segments, maps.length > 0);

    return {
      url: playlistUrl,
      kind,
      vod: kind === "media" ? hasEndList : null,
      live: kind === "media" ? !hasEndList : null,
      playlistType,
      encrypted,
      encryptionMethod: activeKeys[0]?.method,
      drm,
      segmented,
      mapUrl: maps[0]?.url,
      maps,
      keys,
      variants,
      audioRenditions,
      subtitleRenditions,
      segments,
      hasByteRanges: segments.some((segment) => Boolean(segment.byteRange)),
      hasDiscontinuities: segments.some((segment) => segment.discontinuity),
      hasGaps: segments.some((segment) => segment.gap),
      iframeOnly,
      targetDuration,
      warnings
    };
  }

  return {
    parseAttributeList,
    parsePlaylist,
    resolveUrl
  };
});
