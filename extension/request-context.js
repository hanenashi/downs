(function initDownsRequestContext(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsRequestContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function refererOrigin(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "";
      }
      return `${url.origin}/`;
    } catch (_error) {
      return "";
    }
  }

  function sanitize(context = {}) {
    const referer = refererOrigin(context.referer || context.refererOrigin);
    return {
      referer,
      hasCookie: Boolean(context.hasCookie),
      hasAuthorization: Boolean(context.hasAuthorization)
    };
  }

  function exactUrlRegex(value) {
    let url;
    try {
      url = new URL(String(value || ""));
    } catch (_error) {
      return "";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    const escaped = url.toString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.length <= 1900 ? `^${escaped}$` : "";
  }

  function createRefererRule(id, targetUrl, context, extensionOriginHost) {
    const referer = sanitize(context).referer;
    const regexFilter = exactUrlRegex(targetUrl);
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      !referer ||
      !regexFilter ||
      !/^[a-z0-9.-]+$/i.test(extensionOriginHost || "")
    ) {
      return null;
    }
    return {
      id,
      priority: 100,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Referer", operation: "set", value: referer }]
      },
      condition: {
        regexFilter,
        initiatorDomains: [extensionOriginHost],
        resourceTypes: ["xmlhttprequest"]
      }
    };
  }

  return { createRefererRule, exactUrlRegex, refererOrigin, sanitize };
});
