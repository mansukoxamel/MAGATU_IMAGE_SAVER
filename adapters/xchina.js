// MAGATU Image Saver site adapter for xchina.co.
(function () {
  "use strict";

  const adapters = window.MAGATU_IMAGE_SAVER_ADAPTERS = window.MAGATU_IMAGE_SAVER_ADAPTERS || [];

  adapters.push({
    name: "xchina",
    matches: /(^|\.)xchina\.co$/i,
    resolve(el, helpers) {
      return this.resolveLinked(el, helpers);
    },
    resolveLinked(el, helpers) {
      const thumbnailUrl = getThumbnailUrl(el, helpers);
      const originalUrl = rewriteThumbnailUrl(thumbnailUrl, helpers);
      return originalUrl ? pageFetchRequest(originalUrl) : "";
    },
    resolveVisible(el, helpers) {
      const originalUrl = getOriginalUrl(el, helpers);
      return originalUrl ? pageFetchRequest(originalUrl) : "";
    }
  });

  function pageFetchRequest(url) {
    return {
      url,
      referrer: location.href,
      useDnrReferer: true,
      useDownloadHeaders: true
    };
  }

  function getThumbnailUrl(el, helpers) {
    for (const raw of getElementImageUrls(el, helpers)) {
      const rewritten = rewriteThumbnailUrl(raw, helpers);
      if (rewritten) return raw;
    }

    return "";
  }

  function getOriginalUrl(el, helpers) {
    for (const raw of getElementImageUrls(el, helpers)) {
      const normalized = normalizeWithHelpers(raw, helpers);
      if (isOriginalImageUrl(normalized)) return normalized;
    }

    return "";
  }

  function getElementImageUrls(el, helpers) {
    const urls = [];

    if (el.currentSrc) urls.push(el.currentSrc);
    if (el.src) urls.push(el.src);

    for (const attr of [
      "src",
      "data-src",
      "data-original",
      "data-full",
      "data-full-src",
      "data-image",
      "data-url",
      "data-bg",
      "data-background",
      "data-background-image"
    ]) {
      const value = el.getAttribute && el.getAttribute(attr);
      if (value) urls.push(value);
    }

    const bg = helpers.backgroundImageUrl && helpers.backgroundImageUrl(el);
    if (bg) urls.push(bg);

    return urls;
  }

  function rewriteThumbnailUrl(value, helpers) {
    const normalized = normalizeWithHelpers(value, helpers);
    if (!normalized) return "";

    const match = normalized.match(
      /^(https:\/\/img\.xchina\.io\/photos[^/?#]*\/[^/?#]+\/[^/?#]+?)_(?:\d+x\d+|x\d+|\d+x)\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i
    );
    if (!match) return "";

    return `${match[1]}.jpg`;
  }

  function isOriginalImageUrl(value) {
    return /^https:\/\/img\.xchina\.io\/photos[^/?#]*\/[^/?#]+\/[^/?#]+\.jpe?g(?:[?#].*)?$/i.test(value || "");
  }

  function normalizeWithHelpers(value, helpers) {
    return helpers.normalizeUrl ? helpers.normalizeUrl(value) : normalizeUrl(value);
  }

  function normalizeUrl(value) {
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  }
})();
