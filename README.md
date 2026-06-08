# MAGATU Image Saver

Chrome extension that adds a small download button to the upper-left corner of visible images.

It also has a conservative foundation for linked/original-image downloads. The generic linked-image button appears on the upper-right when a normal image link can be resolved. Google, Pinterest, and Yandex are intentionally excluded from the generic path.

The current version also includes a small xchina.co adapter that restores the previous known-good behavior for that site.

When linked/original images are available, an `ALL n` button appears at the page's upper-right corner. It downloads the currently detected linked/original images sequentially.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click `Load unpacked`.
4. Select this repository folder.
5. Open or reload a target page.

Downloaded files go to Chrome's download folder under:

`magatu_dl`

## What It Handles

- Normal `img` images.
- `srcset` / `currentSrc` high-resolution candidates.
- Lazy-load attributes such as `data-src`, `data-original`, `data-full-src`.
- Inline CSS `background-image`.
- `data:image/...` URLs.
- `blob:` image URLs when the page allows the content script to fetch the blob.
- Sites that block right-click, because the extension uses its own overlay button.
- Generic linked image URLs only when the image is inside a normal `<a href>` wrapper, using direct image links or common query parameters such as `img_url`, `image_url`, `media`, and `url`.
- Bulk linked/original-image download through the page-level `ALL n` button.

## Site Adapters

### xchina.co

`adapters/xchina.js` rewrites xchina thumbnail URLs like:

`https://img.xchina.io/photos/.../0069_600x0.webp`

to:

`https://img.xchina.io/photos/.../0069.jpg`

For xchina downloads, `background.js` temporarily adds an exact-URL Referer rule through `declarativeNetRequest` so Chrome downloads the image instead of the site's HTML fallback.

The rule uses the successful backup shape: uppercase `Referer`, exact URL `regexFilter`, and no `resourceTypes` restriction.

For xchina, the extension now first passes `Referer` directly through `chrome.downloads.download()` headers, then falls back to the temporary DNR rule if the first download fails or returns HTML/XML.

This adapter intentionally does not include list UI, page-fetch, or broad URL guessing.

## Limits

- It cannot recover an original file if the site only draws pixels into a protected or tainted canvas.
- It cannot download DRM-protected media.
- It cannot access images inside closed shadow DOM controlled by the page.
- Some sites return HTML instead of an image for hotlink-protected URLs. The extension detects and deletes obvious HTML/XML downloads.

Use it only for images you are allowed to save.
