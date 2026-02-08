# Bug Fix Round 2 — 2026-02-08

## Bug 4: File Attachments from Assistant — Not Working

**Symptom:** When the assistant sends a file (via `message` tool with `filePath`), the file path is stored in the message but cannot be downloaded or previewed because the browser can't access absolute filesystem paths.

**Root Cause:** `extractFileAttachments()` (line ~5116) correctly extracts `filePath`/`media` from Gateway payloads. `renderFileAttachments()` (line ~6811) correctly renders download cards, images, and audio players. But `downloadAttachment()` (line ~6870) tries `fetch(attachment.path)` where `path` is an absolute filesystem path like `/home/molt/.openclaw/media/inbound/file.png` — not accessible via HTTP.

Similarly, image previews use absolute paths in `<img src>` which won't render.

**Fix:** Add a file serving endpoint to server.js:
- `GET /api/file?path=/absolute/path` — serves any file from the filesystem (with security: restrict to `~/.openclaw/media/` directory)
- In app.js, when rendering attachments, rewrite absolute paths to use this endpoint:
  - `/home/molt/.openclaw/media/foo.png` → `/api/file?path=/home/molt/.openclaw/media/foo.png`
- Apply the same rewriting in `downloadAttachment()` fetch call
- Also handle TTS audio files from `~/.openclaw/media/`

**Security:** Only serve files from `~/.openclaw/media/` directory (inbound + outbound media). Block everything else.

**Files:** `server.js` (new endpoint), `app.js` (renderFileAttachments, downloadAttachment, extractFileAttachments)

---

## Bug 5: Workspace Tree — Shows Absolute Path Nesting

**Symptom:** Workspace panel shows a single "home" folder at the root, because `buildFileTree()` builds the tree from absolute paths and strips the base path incorrectly.

**Root Cause:** The REST API returns absolute paths in `files[].path`. The `buildFileTree()` method (line ~9735) tries to strip the base path but ends up creating nested entries for each path component (`home` → `molt` → `.openclaw` → `workspace`).

**Fix:** In `loadWorkspaceFiles()`, strip the workspace root path from each file entry before passing to `buildFileTree()`. Or fix `buildFileTree()` to properly compute relative paths from the workspace root. The API returns `{ files: [{ path: "/home/molt/.openclaw/workspace/SOUL.md", type: "file" }] }` — the workspace root (`/home/molt/.openclaw/workspace`) should be stripped to get relative paths like `SOUL.md`.

**Files:** `app.js` (loadWorkspaceFiles, buildFileTree — around line 9709-9790)

---

## Priority
1. Bug 5 (workspace tree) — easy fix, just path stripping
2. Bug 4 (file attachments) — needs new server endpoint + path rewriting
