// MAGATU Image Button DL - service worker

const SAVE_SUBDIR = "magatu_dl";
const MIN_FILE_SIZE = 1024;
const DNR_RULE_BASE_ID = 900000;
const pendingDownloads = new Map();
let nextDnrRuleId = DNR_RULE_BASE_ID;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "download-image") return false;

  startDownload(message, sender.tab ? sender.tab.id : null, 0)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));

  return true;
});

async function startDownload(message, tabId, attempt) {
  const filename = `${SAVE_SUBDIR}/${sanitizeFilename(message.filename || "image.jpg")}`;
  const useDownloadHeaders = attempt === 0 && message.referrer && message.useDownloadHeaders;
  const useDnrRule = !useDownloadHeaders;
  const ruleId = useDnrRule ? await addRequestHeaderRuleIfNeeded(message) : 0;
  const options = {
    url: message.url,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  };

  if (useDownloadHeaders) {
    options.headers = [
      {
        name: "Referer",
        value: message.referrer
      }
    ];
  }

  return new Promise((resolve) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        cleanupRequestHeaderRule(ruleId);
        if (useDownloadHeaders && message.useDnrReferer) {
          startDownload(message, tabId, attempt + 1).then(resolve);
        } else {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        }
        return;
      }

      pendingDownloads.set(downloadId, {
        tabId,
        ruleId,
        message,
        attempt,
        useDownloadHeaders
      });
      resolve({ ok: true, downloadId });
    });
  });
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  const info = pendingDownloads.get(delta.id);
  if (!info) return;

  if (delta.state.current === "interrupted") {
    pendingDownloads.delete(delta.id);
    cleanupRequestHeaderRule(info.ruleId);
    eraseDownload(delta.id);
    notifyTab(info.tabId, `Download failed: ${delta.error ? delta.error.current || "interrupted" : "interrupted"}`);
    return;
  }

  if (delta.state.current !== "complete") return;
  pendingDownloads.delete(delta.id);
  cleanupRequestHeaderRule(info.ruleId);

  chrome.downloads.search({ id: delta.id }, (items) => {
    const item = items && items[0];
    if (!item) return;

    const mime = (item.mime || "").toLowerCase();
    const filename = (item.filename || "").toLowerCase();
    const bytes = item.fileSize || item.totalBytes || 0;
    const looksHtml = mime.includes("text/html") || filename.endsWith(".html") || filename.endsWith(".htm");
    const looksXml = mime.includes("xml") || filename.endsWith(".xml");

    if (looksHtml || looksXml) {
      chrome.downloads.removeFile(delta.id);
      eraseDownload(delta.id);
      if (info.useDownloadHeaders && info.message && info.message.useDnrReferer) {
        startDownload(info.message, info.tabId, info.attempt + 1).catch(() => {
          notifyTab(info.tabId, "Downloaded response was HTML/XML, so it was deleted.");
        });
      } else {
        notifyTab(info.tabId, "Downloaded response was HTML/XML, so it was deleted.");
      }
      return;
    }

    if (bytes > 0 && bytes < MIN_FILE_SIZE) {
      chrome.downloads.removeFile(delta.id);
      eraseDownload(delta.id);
      notifyTab(info.tabId, `Downloaded file was too small (${bytes} bytes), so it was deleted.`);
    }
  });
});

async function addRequestHeaderRuleIfNeeded(message) {
  if (!message || !message.useDnrReferer || !message.referrer) return 0;
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) return 0;

  const ruleId = nextDnrRuleId++;
  const requestHeaders = [
    {
      header: "Referer",
      operation: "set",
      value: message.referrer
    }
  ];

  if (Array.isArray(message.requestHeaders)) {
    for (const header of message.requestHeaders) {
      if (!header || !header.header || !header.value) continue;
      requestHeaders.push({
        header: String(header.header),
        operation: "set",
        value: String(header.value)
      });
    }
  }

  const rule = {
    id: ruleId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders
    },
    condition: {
      regexFilter: message.dnrRegexFilter || `^${escapeRegExp(message.url)}$`
    }
  };

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [rule]
    });
    return ruleId;
  } catch (err) {
    console.warn("[MAGATU-IMG-DL] failed to add request header rule", err);
    return 0;
  }
}

function cleanupRequestHeaderRule(ruleId) {
  if (!ruleId || !chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) return;
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
}

function eraseDownload(downloadId) {
  if (!chrome.downloads || !chrome.downloads.erase) return;
  chrome.downloads.erase({ id: downloadId }, () => {});
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFilename(name) {
  let safe = String(name).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  if (!safe) safe = "image.jpg";
  if (!/\.[a-z0-9]{2,5}$/i.test(safe)) safe += ".jpg";
  return safe.slice(0, 180);
}

function notifyTab(tabId, message) {
  if (!tabId) return;
  chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      const notice = document.createElement("div");
      notice.className = "magatu-img-dl-notice";
      notice.textContent = text;
      notice.addEventListener("click", () => notice.remove());
      document.documentElement.appendChild(notice);
      setTimeout(() => notice.remove(), 5000);
    },
    args: [message]
  }).catch(() => {});
}
