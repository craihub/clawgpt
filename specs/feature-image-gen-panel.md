# Feature: Image Generation Panel (P2)

## Overview
When the assistant generates images (via OpenAI DALL-E, etc.), display them inline in the chat and in the Artifacts panel as a gallery.

## How Images Arrive
OpenClaw agents generate images via skills (e.g., `openai-image-gen`). The generated images are saved to `~/.openclaw/media/` and referenced in assistant messages. They appear as:
1. Markdown image syntax in message content: `![description](path)` or `MEDIA:/path/to/image.png`
2. File attachments via the `filePath` field (already handled by File Attachments feature)
3. Inline base64 data URLs in message content

The Image Generation Panel should:
- Detect images in assistant messages (all 3 patterns above)
- Render them inline with proper styling (not raw markdown)
- Collect all images into a gallery in the Artifacts panel
- Allow clicking to view full-size, download, or copy URL

## Requirements

### Inline Image Rendering (in chat messages)
1. Detect `MEDIA:` prefixed paths in message content → render as `<img>` tags via `/api/file` endpoint
2. Detect markdown image syntax `![alt](url)` → render as styled image cards
3. Detect base64 data URLs in content → render inline
4. Images should be responsive (max-width: 100%, max-height: 400px)
5. Click to open full-size in a lightbox overlay

### Image Gallery (in Artifacts panel)
1. Add an "Images" sub-tab or section in the Artifacts panel
2. Scan all messages in current conversation for images
3. Display as a grid of thumbnails
4. Click thumbnail → full-size lightbox
5. Show image count badge on Artifacts tab when images exist

### Lightbox
1. Full-screen overlay with dark background
2. Centered image at max resolution
3. Close button (X), click backdrop to close, Escape key
4. Download button
5. Navigation arrows if multiple images (prev/next)

### Implementation
1. In `formatContent()` in app.js: detect MEDIA: paths and convert to img tags using getFileUrl()
2. Add `extractImages(messages)` method to scan conversation for all images
3. Add lightbox HTML to index.html (hidden by default)
4. Add `openLightbox(src, allImages, currentIndex)` method
5. In Artifacts panel, add image gallery section
6. Add CSS for image cards, gallery grid, lightbox

### Detection Patterns
```
// MEDIA: prefix (OpenClaw standard)
MEDIA:/home/molt/.openclaw/media/outbound/image.png

// Markdown images
![Generated cat](https://example.com/cat.png)

// Already-rendered img tags from file attachments
<img src="/api/file?path=..." />

// Base64 inline
data:image/png;base64,iVBOR...
```

### CSS
- `.inline-image` — responsive image in chat message
- `.image-gallery` — grid layout in Artifacts panel
- `.image-thumbnail` — gallery thumbnail
- `.lightbox-overlay` — full-screen image viewer
- `.lightbox-image` — centered full-size image
- `.lightbox-nav` — prev/next arrows
- `.lightbox-close` — close button

### Files to modify
- `app.js` — image detection in formatContent, gallery extraction, lightbox logic
- `style.css` — image styles, gallery grid, lightbox
- `index.html` — lightbox overlay markup

### Verification
- MEDIA: paths in messages render as images
- Markdown image syntax renders as styled images
- Clicking image opens lightbox
- Lightbox has close, download, navigation
- Artifacts panel shows image gallery with thumbnails
- No console errors
