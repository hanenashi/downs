(function initDownsRequestContext(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsRequestContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function refererUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "";
      }
      url.username = "";
      url.password = "";
      url.hash = "";
      const safe = url.toString();
      return safe.length <= 2048 ? safe : "";
    } catch (_error) {
      return "";
    }
  }

  function sanitize(context = {}) {
    const referer = refererUrl(context.referer || context.refererUrl || context.refererOrigin);
    return {
      referer,
      origin: referer ? new URL(referer).origin : "",
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
    const sanitized = sanitize(context);
    const referer = sanitized.referer;
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
        requestHeaders: [
          { header: "Referer", operation: "set", value: referer },
          { header: "Origin", operation: "set", value: sanitized.origin }
        ]
      },
      condition: {
        regexFilter,
        initiatorDomains: [extensionOriginHost],
        resourceTypes: ["xmlhttprequest"]
      }
    };
  }

  return { createRefererRule, exactUrlRegex, refererUrl, sanitize };
});
