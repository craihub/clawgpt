# ClawGPT Feature Roadmap
> Goal: Surpass Claude Desktop as the best chat interface for OpenClaw

---

## 🏗️ Architecture Note
ClawGPT is a pure HTML/CSS/JS app (~6300 lines) connecting to OpenClaw Gateway via WebSocket. No build tools, no framework. All features should maintain this simplicity. The Gateway provides the AI backend — features should leverage Gateway APIs where possible rather than reimplementing.

---

## P0 — Core Differentiators (Ship First)

### 1. 📝 Conversation Intelligence Panel
**"Extract & Share" button in conversation toolbar**

A button (e.g., sparkle/brain icon) in the chat header that:
1. Scans the current conversation for distinct topics/decisions/action items
2. Opens a **right-side panel** (slide-in, resizable) showing:
   - Auto-generated markdown files, one per topic cluster
   - Each file has: title, key points, decisions made, code snippets, links
   - Editable in-panel (live markdown editor)
3. Panel actions:
   - **Download** — individual or zip of all
   - **Copy to clipboard** — raw markdown
   - **Share to bot** — pick from list of connected OpenClaw agents (via `sessions_send` or file drop to their workspace)
   - **Save to workspace** — write directly to `~/workspace/memory/` or custom path

**Implementation approach:**
- Send conversation content to the Gateway with a system prompt that instructs extraction
- Use a `sessions_spawn` sub-agent for the analysis (cheaper model like Sonnet)
- Render results in a new `<aside>` panel component
- Panel state persists per-chat in IndexedDB

---

### 2. 🎙️ Talk Mode (Live Conversation)
**Gemini Live / Advanced Voice Mode style real-time voice chat**

- Full-screen or overlay mode with waveform visualization
- Continuous speech-to-text → stream to Gateway → TTS response
- **Push-to-talk** and **hands-free** modes
- Visual feedback: animated orb/waveform while AI speaks
- Interrupt mid-response by speaking

**Implementation approach:**
- Browser `SpeechRecognition` API for STT (already partially implemented)
- OpenClaw's `tts` tool or browser `SpeechSynthesis` for response audio
- WebSocket streaming already works — just need to pipe voice input as text
- New full-screen overlay component with audio visualizer (Web Audio API)
- Consider: OpenClaw voice-call plugin integration for higher quality

---

### 3. 🎨 Artifacts Panel
**Claude Desktop-style artifact rendering**

When the AI generates code, documents, HTML, SVGs, React components, or structured content:
- Detect artifact-worthy content in responses
- Render in a **right-side panel** (same slot as Intelligence Panel, tabbed)
- Artifact types:
  - **Code** — syntax highlighted, with "Run" button for HTML/JS
  - **HTML/SVG** — live preview in sandboxed iframe
  - **Markdown** — rendered preview
  - **Mermaid diagrams** — rendered chart
  - **CSV/Tables** — formatted table view
  - **React components** — live preview via in-browser transpiler
- Actions: Copy, Download, Open in new tab, Version history (per-conversation)

**Implementation approach:**
- Parse assistant messages for code blocks with language tags
- Heuristic detection: blocks >10 lines, complete files, HTML documents
- Sandboxed `<iframe srcdoc>` for HTML preview
- Mermaid.js CDN for diagrams
- Tabbed panel sharing space with Intelligence Panel

---

### 4. 📎 File Attachments from Assistant
**Download files the assistant sends — like Telegram does**

Currently when the assistant sends a file (via `message` tool with `filePath`), Telegram delivers it as a downloadable attachment. ClawGPT (hsatarian/spaceshipgpt `clawgpt_2.0` branch) has no equivalent — file paths are just ignored or shown as text.

- Detect `filePath` / `media` in assistant responses
- Render as a downloadable card: filename, size, file type icon
- Click to download or preview (images inline, text/md in panel, code highlighted)
- Support for: documents, images, audio (TTS responses), archives
- Drag-out support (drag file card to desktop to save)
- Multiple attachments per message

**Implementation approach:**
- Gateway already sends file references in message payloads
- ClawGPT needs to fetch file content via Gateway (new endpoint or exec `cat`)
- Render a `FileAttachment` component in the message bubble
- For images: inline preview with lightbox
- For audio (TTS): embedded audio player
- For documents: download button + optional in-panel preview

**Note:** This also enables the Conversation Intelligence Panel's download/share flow — extracted MD files need this to work properly.

---

## P1 — OpenClaw Integration Features

### 5. 🤖 Agent Workspace Viewer
**Browse and manage OpenClaw workspace files from ClawGPT**

- File tree panel showing `~/workspace/` contents
- Read/edit files (memory files, SOUL.md, etc.)
- Drag files into chat as context
- Uses Gateway exec tool or a dedicated file API

### 6. 📊 Session Dashboard
**Visual overview of all active OpenClaw sessions**

- Show all sessions (main, Discord channels, Telegram, sub-agents)
- Per-session: model, token usage, last message preview
- Quick-switch to any session from ClawGPT
- Uses `sessions_list` API

### 7. ⏰ Cron Job Manager
**Visual cron job management UI**

- List all scheduled jobs with next-run times
- Create/edit/delete jobs via form UI
- Run history with results
- Uses `cron` API

### 8. 🔔 Live Notifications
**Toast notifications for events across all sessions**

- New messages in other sessions
- Sub-agent completions
- Cron job results
- Email/calendar alerts from heartbeats
- Browser Notification API + in-app toast system

### 9. 🧠 Memory Browser
**Browse and manage Mem0 memories**

- Search/list all memories
- Edit/delete individual memories
- Visual timeline of memory creation
- Uses `memory_search`, `memory_list`, `memory_forget` APIs

---

## P2 — UX Enhancements

### 9. 📌 Message Bookmarks & Tags
- Bookmark important messages within conversations
- Tag messages with custom labels
- Filter/search by bookmarks and tags
- Bookmarked messages surface in Intelligence Panel extraction

### 10. 📋 Prompt Library
**Save and reuse prompt templates**

- Save frequently used prompts
- Categorize with folders/tags
- Variable substitution (`{{variable}}` syntax)
- Share prompt libraries between devices

### 11. 🖼️ Image Generation Panel
**Inline image generation with preview**

- Detect image generation requests
- Show generated images in artifact panel
- Gallery view of all generated images in conversation
- Download/share options

### 12. 🔗 Tool Call Visualization
**Rich display of tool calls and results**

- Expandable cards showing tool name, parameters, results
- Progress indicators for long-running tools
- Error state visualization
- Currently basic — needs proper UI treatment like Claude Desktop

### 13. ⚡ Exec Approval UI
**Approve/deny shell command execution**

- Modal dialog showing proposed command
- Syntax-highlighted command preview
- Approve/Deny/Edit buttons
- Auto-approve toggle for trusted commands
- Already partially implemented — needs polish

---

## P3 — Advanced / Future

### 14. 🌐 Multi-Agent Chat
**Chat with multiple agents in one conversation**

- @mention different agents (like Discord)
- Each agent responds in its own style
- Useful for brainstorming, debates, collaborative work

---

## Design Principles

1. **Gateway-first** — Leverage OpenClaw Gateway APIs, don't rebuild what exists
2. **No build step** — Keep the pure HTML/CSS/JS architecture
3. **Panel-based** — Right-side panels for artifacts, intelligence, workspace (tabbed)
4. **Mobile-native** — Every feature must work on mobile (Capacitor + PWA)
5. **Offline-capable** — Local-first data, sync when connected
6. **Fast** — No heavy frameworks, lazy-load when possible

---

## Technical Priorities

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | ~~Conversation Intelligence Panel~~ ✅ | Medium | 🔥🔥🔥 |
| P0 | Talk Mode | Medium-High | 🔥🔥🔥 |
| P0 | Artifacts Panel | Medium | 🔥🔥🔥 |
| P0 | File Attachments from Assistant | Low-Medium | 🔥🔥🔥 |
| P1 | Agent Workspace Viewer | Medium | 🔥🔥 |
| P1 | Session Dashboard | Low-Medium | 🔥🔥 |
| P1 | Cron Job Manager | Medium | 🔥 |
| P1 | Live Notifications | Low | 🔥🔥 |
| P1 | Memory Browser | Low-Medium | 🔥🔥 |
| P2 | Prompt Library | Low | 🔥 |
| P2 | Image Generation Panel | Low-Medium | 🔥🔥 |
| P2 | Tool Call Visualization | Low-Medium | 🔥🔥 |
| P2 | Exec Approval UI | Low | 🔥 |
| P3 | Multi-Agent Chat | High | 🔥🔥 |

---

*Created: 2026-02-07*
*Last Updated: 2026-02-07*
