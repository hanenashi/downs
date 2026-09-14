(function initDownsAudio(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsAudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function matchingRenditions(playlist, variant) {
    const seen = new Set();
    return (playlist?.audioRenditions || []).filter((rendition) => {
      if (!variant?.audioGroup || rendition.groupId !== variant.audioGroup || !rendition.url) {
        return false;
      }
      if (seen.has(rendition.url)) {
        return false;
      }
      seen.add(rendition.url);
      return true;
    });
  }

  function preferredRendition(renditions) {
    return (renditions || []).find((rendition) => rendition.default) ||
      (renditions || []).find((rendition) => rendition.autoSelect) ||
      (renditions || [])[0] ||
      null;
  }

  function renditionLabel(rendition, languages = []) {
    const name = String(rendition?.name || "").trim();
    if (name && !/^(?:audio|stream)[_ -]?\d+$/i.test(name)) {
      return name;
    }
    const language = String(rendition?.language || "").trim();
    if (language && typeof Intl.DisplayNames === "function") {
      try {
        return new Intl.DisplayNames(languages, { type: "language" }).of(language) || language;
      } catch (_error) {
        // Fall through to stable playlist metadata.
      }
    }
    return language || name || "Default audio";
  }

  function optionLabel(rendition, languages = []) {
    const parts = [renditionLabel(rendition, languages)];
    if (rendition?.default) {
      parts.push("default");
    }
    if (rendition?.channels) {
      parts.push(`${rendition.channels} ch`);
    }
    return parts.join(" · ");
  }

  return {
    matchingRenditions,
    optionLabel,
    preferredRendition,
    renditionLabel
  };
});
