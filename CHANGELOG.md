# Changelog

## 0.2.5

- Added the page-level `ALL n` button for sequential bulk downloads of detected linked/original images.
- Bulk downloads reuse the same URL resolution and xchina Referer/download-header handling as the single `HQ` button.
- Kept the public package minimal: extension files, README, changelog, and ignore rules only.

## 0.2.4

- Restored the stable xchina.co adapter behavior.
- Rewrites xchina thumbnail URLs such as `_600x0.webp` to the original `.jpg` URL.
- Sends `Referer` directly through `chrome.downloads.download()` headers for xchina downloads.
- Falls back to a temporary exact-URL `declarativeNetRequest` Referer rule if the direct header path fails or returns HTML/XML.
