// MAGATU Image Saver - generic content script
(function () {
  "use strict";

  const ATTACHED = "magatuImgDlAttached";
  const MIN_WIDTH = 80;
  const MIN_HEIGHT = 80;
  const SCAN_INTERVAL_MS = 1000;
  const IMAGE_EXT_RE = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
  const DISABLE_GENERIC_LINK_HOSTS = [
    /(^|\.)google\./i,
    /(^|\.)pinterest\./i,
    /(^|\.)yandex\./i
  ];
  const SITE_ADAPTERS = Array.isArray(window.MAGATU_IMAGE_SAVER_ADAPTERS)
    ? window.MAGATU_IMAGE_SAVER_ADAPTERS
    : [];

  let layer = null;
  let scanTimer = 0;
  let positionTimer = 0;

  init();

  function init() {
    ensureLayer();
    scan();
    window.addEventListener("scroll", schedulePositionUpdate, true);
    window.addEventListener("resize", schedulePositionUpdate, true);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleScan();
    });

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "style", "class"]
    });

    setInterval(scan, SCAN_INTERVAL_MS);
  }

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.className = "magatu-img-dl-layer";
    document.documentElement.appendChild(layer);
    return layer;
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 180);
  }

  function scan() {
    ensureLayer();
    const candidates = new Set();

    document.querySelectorAll("img, image, video[poster], picture source, [style]").forEach((el) => {
      if (isCandidateElement(el)) candidates.add(el);
    });

    candidates.forEach(attachButton);
    candidates.forEach(attachLinkButton);
    updateButtonPositions();
  }

  function isCandidateElement(el) {
    if (!el || el.dataset && el.dataset[ATTACHED] === "skip") return false;

    const rect = getUsefulRect(el);
    if (!rect || rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return false;

    const url = getBestImageUrl(el);
    if (!url) return false;
    if (url.startsWith("chrome-extension:")) return false;

    return true;
  }

  function attachButton(el) {
    if (el.dataset && el.dataset[ATTACHED] === "1") return;
    if (el.dataset) el.dataset[ATTACHED] = "1";

    const btn = document.createElement("button");
    btn.className = "magatu-img-dl-button";
    btn.type = "button";
    btn.textContent = "DL";
    btn.title = "Download image";
    btn.dataset.targetId = makeTargetId(el);
    btn._magatuTarget = el;

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      downloadFromElement(el, btn);
    }, true);

    layer.appendChild(btn);
  }

  function attachLinkButton(el) {
    if (!canUseLinkResolver()) return;
    if (el.dataset && el.dataset.magatuImgDlLinkAttached === "1") return;

    const request = resolveLinkedImageRequest(el);
    if (!request) return;

    if (el.dataset) el.dataset.magatuImgDlLinkAttached = "1";

    const btn = document.createElement("button");
    btn.className = "magatu-img-dl-button magatu-img-dl-link-button";
    btn.type = "button";
    btn.textContent = "HQ";
    btn.title = "Download linked image";
    btn._magatuTarget = el;
    btn._magatuKind = "link";

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const currentRequest = resolveLinkedImageRequest(el);
      if (!currentRequest) {
        flash(btn, "error", "!");
        return;
      }
      downloadUrl(currentRequest, btn);
    }, true);

    layer.appendChild(btn);
  }

  function makeTargetId(el) {
    if (!el.dataset) return Math.random().toString(36).slice(2);
    if (!el.dataset.magatuImgDlId) {
      el.dataset.magatuImgDlId = Math.random().toString(36).slice(2);
    }
    return el.dataset.magatuImgDlId;
  }

  function schedulePositionUpdate() {
    clearTimeout(positionTimer);
    positionTimer = setTimeout(updateButtonPositions, 50);
  }

  function updateButtonPositions() {
    if (!layer) return;
    const buttons = Array.from(layer.querySelectorAll(".magatu-img-dl-button"));
    for (const btn of buttons) {
      const el = btn._magatuTarget;
      if (!el || !el.isConnected || !isCandidateElement(el)) {
        removeButton(btn, el);
        continue;
      }

      if (btn._magatuKind === "link" && !resolveLinkedImageRequest(el)) {
        removeButton(btn, el);
        continue;
      }

      const rect = getUsefulRect(el);
      if (btn._magatuKind === "link") {
        btn.style.left = `${Math.max(0, rect.right - 38)}px`;
      } else {
        btn.style.left = `${Math.max(0, rect.left + 8)}px`;
      }
      btn.style.top = `${Math.max(0, rect.top + 8)}px`;
      btn.style.display = rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth ? "none" : "";
    }
  }

  function removeButton(btn, el) {
    const isLinkButton = btn && btn._magatuKind === "link";
    btn.remove();
    if (!el || !el.dataset) return;
    if (isLinkButton) {
      delete el.dataset.magatuImgDlLinkAttached;
    } else {
      delete el.dataset[ATTACHED];
    }
  }

  async function downloadFromElement(el, btn) {
    const request = resolveVisibleImageRequest(el);
    if (!request) {
      flash(btn, "error", "!");
      return;
    }
    downloadUrl(request, btn);
  }

  async function downloadUrl(request, btn) {
    flash(btn, "busy", "...");

    try {
      const resolved = await resolveDownloadUrl(request);
      const filename = resolved.filename || deriveFilename(resolved.sourceUrl || resolved.url, resolved.mime);
      chrome.runtime.sendMessage({
        type: "download-image",
        url: resolved.downloadUrl,
        filename,
        referrer: resolved.referrer || "",
        useDnrReferer: !!resolved.useDnrReferer,
        useDownloadHeaders: !!resolved.useDownloadHeaders,
        requestHeaders: Array.isArray(resolved.requestHeaders) ? resolved.requestHeaders : [],
        dnrRegexFilter: resolved.dnrRegexFilter || ""
      }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          flash(btn, "error", "!");
        } else {
          flash(btn, "ok", "OK");
        }
      });
    } catch (err) {
      console.warn("[MAGATU-IMG-DL] download failed", err);
      flash(btn, "error", "!");
    }
  }

  function resolveVisibleImageRequest(el) {
    const adapterRequest = resolveByAdapter("resolveVisible", el);
    if (adapterRequest) return adapterRequest;

    const url = getBestImageUrl(el);
    return url ? { url } : null;
  }

  function resolveLinkedImageRequest(el) {
    const adapterRequest = resolveByAdapter("resolveLinked", el) || resolveByAdapter("resolve", el);
    if (adapterRequest) return adapterRequest;

    if (!canUseGenericLinkResolver()) return null;
    const url = resolveLinkedImageUrl(el);
    return url ? { url } : null;
  }

  function resolveByAdapter(method, el) {
    for (const adapter of enabledAdapters()) {
      const fn = adapter && adapter[method];
      if (typeof fn !== "function") continue;

      try {
        const request = normalizeDownloadRequest(fn.call(adapter, el, adapterHelpers()));
        if (request) return request;
      } catch (err) {
        console.warn("[MAGATU-IMG-DL] adapter failed", adapter.name || "unknown", err);
      }
    }
    return null;
  }

  function adapterHelpers() {
    return {
      backgroundImageUrl,
      findUsefulAnchor,
      getBestImageUrl,
      looksLikeImageUrl,
      looksUsableUrl,
      normalizePossiblyNestedUrl,
      normalizeUrl
    };
  }

  function enabledAdapters() {
    return SITE_ADAPTERS.filter(adapterMatches);
  }

  function adapterMatches(adapter) {
    if (!adapter || !adapter.matches) return false;
    const matches = adapter.matches;

    if (typeof matches === "function") {
      return !!matches(location);
    }

    if (matches instanceof RegExp) {
      return matches.test(location.hostname) || matches.test(location.href);
    }

    if (Array.isArray(matches)) {
      return matches.some((item) => {
        if (typeof item === "string") return item === location.hostname || location.hostname.endsWith(`.${item}`);
        if (item instanceof RegExp) return item.test(location.hostname) || item.test(location.href);
        return false;
      });
    }

    return false;
  }

  function canUseLinkResolver() {
    return enabledAdapters().some((adapter) => typeof adapter.resolve === "function" || typeof adapter.resolveLinked === "function") ||
      canUseGenericLinkResolver();
  }

  function canUseGenericLinkResolver() {
    return !DISABLE_GENERIC_LINK_HOSTS.some((re) => re.test(location.hostname));
  }

  function resolveLinkedImageUrl(el) {
    const anchor = findUsefulAnchor(el);
    if (!anchor || !anchor.href) return "";

    const urls = [];
    urls.push(anchor.href);

    try {
      const parsed = new URL(anchor.href, location.href);
      for (const key of [
        "img_url",
        "image_url",
        "image",
        "img",
        "media",
        "url",
        "u",
        "src",
        "source"
      ]) {
        const value = parsed.searchParams.get(key);
        if (value) urls.push(value);
      }
    } catch {}

    for (const raw of urls) {
      const normalized = normalizePossiblyNestedUrl(raw);
      if (normalized && looksLikeImageUrl(normalized) && looksUsableUrl(normalized)) {
        return normalized;
      }
    }

    return "";
  }

  function findUsefulAnchor(el) {
    let cur = el;
    for (let depth = 0; depth < 5 && cur; depth++) {
      if (cur.tagName === "A" && cur.href) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function normalizePossiblyNestedUrl(value) {
    let current = String(value || "").trim();
    if (!current) return "";

    for (let i = 0; i < 3; i++) {
      try {
        current = decodeURIComponent(current);
      } catch {
        break;
      }
    }

    return normalizeUrl(current);
  }

  async function resolveDownloadUrl(request) {
    const normalized = normalizeDownloadRequest(request);
    if (!normalized) throw new Error("No image URL");

    const url = normalized.url;

    if (url.startsWith("data:")) {
      return {
        ...normalized,
        downloadUrl: url,
        sourceUrl: url,
        mime: getMimeFromDataUrl(url)
      };
    }

    if (url.startsWith("blob:")) {
      const response = await fetch(url);
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      return {
        ...normalized,
        downloadUrl: dataUrl,
        sourceUrl: url,
        mime: blob.type
      };
    }

    return {
      ...normalized,
      downloadUrl: url,
      sourceUrl: url,
      mime: ""
    };
  }

  function normalizeDownloadRequest(value) {
    if (!value) return null;

    if (typeof value === "string") {
      const url = normalizeUrl(value);
      return url && looksUsableUrl(url) ? { url } : null;
    }

    if (typeof value !== "object") return null;

    const url = normalizeUrl(value.url || value.downloadUrl || "");
    if (!url || !looksUsableUrl(url)) return null;

    return {
      ...value,
      url,
      referrer: value.referrer ? normalizeUrl(value.referrer) || String(value.referrer) : "",
      useDnrReferer: !!value.useDnrReferer,
      useDownloadHeaders: !!value.useDownloadHeaders,
      requestHeaders: Array.isArray(value.requestHeaders) ? value.requestHeaders : [],
      dnrRegexFilter: value.dnrRegexFilter || ""
    };
  }

  function getBestImageUrl(el) {
    const urls = [];

    if (el.currentSrc) urls.push(el.currentSrc);
    if (el.src) urls.push(el.src);
    if (el.href && el.href.baseVal) urls.push(el.href.baseVal);

    for (const attr of ["srcset", "data-srcset"]) {
      const srcset = el.getAttribute && el.getAttribute(attr);
      const best = bestFromSrcset(srcset);
      if (best) urls.push(best);
    }

    for (const attr of [
      "data-src",
      "data-original",
      "data-full",
      "data-full-src",
      "data-image",
      "data-url",
      "poster"
    ]) {
      const value = el.getAttribute && el.getAttribute(attr);
      if (value) urls.push(value);
    }

    const bg = backgroundImageUrl(el);
    if (bg) urls.push(bg);

    const link = el.closest && el.closest("a[href]");
    if (link && looksLikeImageUrl(link.href)) urls.push(link.href);

    const picked = urls.map(normalizeUrl).filter(Boolean).find((u) => looksUsableUrl(u));
    return picked || "";
  }

  function bestFromSrcset(srcset) {
    if (!srcset) return "";
    let best = "";
    let bestScore = 0;
    for (const rawPart of srcset.split(",")) {
      const part = rawPart.trim();
      if (!part) continue;
      const bits = part.split(/\s+/);
      const url = bits[0];
      const descriptor = bits[1] || "";
      const score = descriptor.endsWith("w") ? parseInt(descriptor, 10) || 0 :
        descriptor.endsWith("x") ? (parseFloat(descriptor) || 1) * 1000 : 1;
      if (score >= bestScore) {
        bestScore = score;
        best = url;
      }
    }
    return best;
  }

  function backgroundImageUrl(el) {
    const style = getComputedStyle(el);
    const bg = style.backgroundImage || "";
    const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
    return match ? match[1] : "";
  }

  function normalizeUrl(value) {
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  }

  function looksUsableUrl(url) {
    return url.startsWith("http:") || url.startsWith("https:") || url.startsWith("blob:") || url.startsWith("data:image/");
  }

  function looksLikeImageUrl(url) {
    return IMAGE_EXT_RE.test(url) || /^data:image\//i.test(url) || /^blob:/i.test(url);
  }

  function getUsefulRect(el) {
    const rects = Array.from(el.getClientRects ? el.getClientRects() : []);
    const rect = rects.find((r) => r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT) || el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  function deriveFilename(url, mime) {
    try {
      if (url.startsWith("data:") || url.startsWith("blob:")) {
        return `image_${timestamp()}${extensionFromMime(mime)}`;
      }
      const parsed = new URL(url);
      const raw = parsed.pathname.split("/").filter(Boolean).pop() || "";
      const decoded = decodeURIComponent(raw).replace(/[\\/:*?"<>|]+/g, "_");
      if (/\.[a-z0-9]{2,5}$/i.test(decoded)) return decoded;
      return `${decoded || "image"}_${timestamp()}${extensionFromMime(mime)}`;
    } catch {
      return `image_${timestamp()}${extensionFromMime(mime)}`;
    }
  }

  function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  }

  function extensionFromMime(mime) {
    const clean = (mime || "").split(";")[0].toLowerCase();
    if (clean === "image/png") return ".png";
    if (clean === "image/webp") return ".webp";
    if (clean === "image/gif") return ".gif";
    if (clean === "image/svg+xml") return ".svg";
    if (clean === "image/avif") return ".avif";
    return ".jpg";
  }

  function getMimeFromDataUrl(url) {
    const match = url.match(/^data:([^;,]+)/);
    return match ? match[1] : "";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function flash(btn, state, text) {
    const original = btn.dataset.originalText || btn.textContent;
    btn.dataset.originalText = original;
    btn.dataset.state = state;
    btn.textContent = text;
    setTimeout(() => {
      btn.dataset.state = "";
      btn.textContent = original;
    }, 1200);
  }
})();
