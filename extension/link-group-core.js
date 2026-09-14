(function initDownsLinkGroups(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsLinkGroups = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const BURST_WINDOW_MS = 8_000;
  const GENERIC_DIRECTORIES = new Set([
    "content", "dash", "hls", "live", "media", "playlist", "stream", "video", "vod",
    "v1", "v2", "v3"
  ]);

  function urlParts(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }
      const path = url.pathname.split("/").filter(Boolean);
      return {
        host: url.host.toLowerCase(),
        pathname: url.pathname,
        directories: path.slice(0, -1).map((part) => part.toLowerCase())
      };
    } catch (_error) {
      return null;
    }
  }

  function pageOrigin(link) {
    for (const value of [link?.pageUrl, link?.initiator]) {
      try {
        const url = new URL(String(value || ""));
        if (url.protocol === "http:" || url.protocol === "https:") {
          return url.origin;
        }
      } catch (_error) {
        // Try the next available page marker.
      }
    }
    return "";
  }

  function observedAt(link) {
    return Number(link?.foundAt || link?.lastSeenAt) || 0;
  }

  function sharedDirectoryDepth(left, right) {
    const count = Math.min(left.length, right.length);
    let depth = 0;
    while (depth < count && left[depth] === right[depth]) {
      depth += 1;
    }
    return depth;
  }

  function relatedLinks(leftLink, rightLink) {
    const left = urlParts(leftLink?.url);
    const right = urlParts(rightLink?.url);
    if (!left || !right || left.host !== right.host) {
      return false;
    }
    if (left.pathname === right.pathname) {
      return true;
    }

    const sharedDepth = sharedDirectoryDepth(left.directories, right.directories);
    if (sharedDepth >= 2) {
      return true;
    }
    if (
      sharedDepth === 1 &&
      !GENERIC_DIRECTORIES.has(left.directories[0])
    ) {
      return true;
    }

    const timeGap = Math.abs(observedAt(leftLink) - observedAt(rightLink));
    const leftPage = pageOrigin(leftLink);
    return timeGap <= BURST_WINDOW_MS && Boolean(leftPage) && leftPage === pageOrigin(rightLink);
  }

  function primaryScore(link) {
    const parts = urlParts(link?.url);
    const filename = parts?.pathname.split("/").pop()?.toLowerCase() || "";
    let score = 0;
    if (/(?:^|[-_.])(master|manifest|index)(?:[-_.]|$)/.test(filename)) {
      score += 100;
    }
    score -= (parts?.directories.length || 0) * 5;
    score -= observedAt(link) / 1e15;
    return score;
  }

  function pickPrimary(links) {
    return [...links].sort((left, right) => {
      return primaryScore(right) - primaryScore(left) || observedAt(left) - observedAt(right);
    })[0];
  }

  function groupLinks(links) {
    const groups = [];
    const chronological = [...(links || [])].sort(
      (left, right) => observedAt(left) - observedAt(right)
    );

    for (const link of chronological) {
      const group = groups.find((candidate) =>
        candidate.links.some((existing) => relatedLinks(existing, link))
      );
      if (group) {
        group.links.push(link);
      } else {
        groups.push({ links: [link] });
      }
    }

    return groups
      .map((group) => {
        const primary = pickPrimary(group.links);
        const related = group.links
          .filter((link) => link !== primary)
          .sort((left, right) => (Number(right.lastSeenAt) || 0) - (Number(left.lastSeenAt) || 0));
        return {
          id: primary.url,
          primary,
          related,
          links: [primary, ...related],
          lastSeenAt: Math.max(...group.links.map((link) => Number(link.lastSeenAt || link.foundAt) || 0))
        };
      })
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
  }

  return { BURST_WINDOW_MS, groupLinks, relatedLinks };
});
