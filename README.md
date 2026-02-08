# ClawGPT

A custom chat interface for [OpenClaw](https://github.com/openclaw/openclaw) Gateway with power-user features that go beyond standard AI chat UIs.

![ClawGPT Screenshot](docs/screenshot-clawgpt.png)

## What is this?

ClawGPT connects directly to your OpenClaw Gateway via WebSocket, giving you a rich, responsive chat experience with features designed for power users who live in their AI assistant all day.

**Pure HTML/CSS/JS** — no build tools, no framework, no dependencies. Just open `index.html` and go.

## Features

### Core (P0)
- **💬 Real-time Chat** — WebSocket connection to OpenClaw Gateway with streaming responses
- **🔍 Conversation Search** — Search across all chat history
- **✏️ Message Editing & Branching** — Edit any message and fork the conversation
- **🎨 Code Highlighting** — Syntax highlighting for code blocks
- **📱 Cross-Device Sync** — Conversations sync via Gateway

### Power Features (P1)
- **🧠 Intelligence Panel** — Extract topics, decisions, and action items from conversations, export as Markdown
- **🎙️ Talk Mode V2** — Voice conversations with ElevenLabs streaming TTS, VAD, model switching
- **📦 Artifacts Panel** — Live preview of code, HTML, SVG, and Mermaid diagrams
- **📎 File Attachments** — Send and receive files, image preview, audio player, download cards
- **📁 Workspace Viewer** — Browse and edit OpenClaw workspace files directly
- **📊 Session Dashboard** — View and switch between all OpenClaw sessions
- **⏰ Cron Job Manager** — Create, edit, and run scheduled jobs

### Advanced Features (P2)
- **🔔 Live Notifications** — Toast system with bell icon and notification dropdown
- **📋 Prompt Library** — Save, search, and reuse prompt templates with `{{variable}}` substitution
- **🔧 Tool Call Visualization** — Expandable cards showing tool usage with color-coded status
- **⚡ Exec Approval UI** — Modal for approving/denying shell commands with 60s countdown timer
- **🖼️ Image Generation Panel** — Inline image rendering from `MEDIA:` paths, full-screen lightbox with navigation, image gallery in Artifacts panel

## Architecture

### Response Control
- [x] **Regenerate responses** — Get a new answer with one click
- [x] **Model selection** — Choose different AI models per regeneration
- [x] **Per-chat model display** — See which model is being used
- [x] **Token counter** — Track estimated token usage per conversation

### Voice
- [x] **Voice input** — Speech-to-text via browser or native (Android) speech recognition
- [x] **Read aloud** — Text-to-speech on any AI response
- [x] **Push-to-talk** — Hold the mic button to record (mobile)
- [x] **Conversation mode** — Double-tap mic for hands-free back-and-forth (mobile)

### Files & Media
- [x] **Image attachments** — Attach and preview images inline
- [x] **File attachments** — Send text files, code, PDFs, spreadsheets
- [x] **Code highlighting** — Syntax highlighting for 100+ languages via Prism.js
- [x] **Code copy buttons** — One-click copy for any code block

### Data & Storage
- [x] **IndexedDB storage** — Virtually unlimited local storage (no 5MB limit)
- [x] **Export chats** — Download all conversations as JSON backup
- [x] **Import chats** — Restore or merge chats from backup file
- [x] **Auto-migration** — Seamlessly migrates from localStorage if upgrading

### Cross-Device Memory (clawgpt-memory)
- [x] **Automatic sync** — Messages sync between desktop and mobile in real-time
- [x] **File-based storage** — Conversations saved to `clawgpt-memory/` folder
- [x] **AI-accessible** — Your OpenClaw agent can read your ClawGPT history
- [x] **Works offline** — Syncs when devices reconnect via relay
- [x] **JSONL format** — Human-readable, easy to search and backup

## 🔒 Security

### Local Mode
When running on the same network as your computer, ClawGPT connects directly to your local OpenClaw gateway. Your data never leaves your network.

### Remote Access (Relay Mode)
Need to use ClawGPT from your phone when you're away from home? Enable Relay Mode for secure remote access.

| Security Feature | Description |
|-----------------|-------------|
| **End-to-End Encryption** | XSalsa20-Poly1305 — your messages are encrypted before leaving your device |
| **Zero-Knowledge Relay** | The relay server only sees encrypted blobs, never your actual messages |
| **Perfect Forward Secrecy** | New encryption keys generated for each session |
| **Visual Verification** | Matching words on both devices confirms no man-in-the-middle |
| **No Token Exposure** | Your auth token is never sent through the relay |
| **Chat History Sync** | Your chats sync automatically between desktop and phone |

**Crypto details:** X25519 key exchange, XSalsa20-Poly1305 authenticated encryption, powered by [TweetNaCl.js](https://tweetnacl.js.org/).

> Don't trust our relay? [Self-host your own](https://github.com/craihub/clawgpt-relay) — it's just a simple Node.js server.

## 🚀 Quick Start

### Step 1: Install OpenClaw

1. Install [Node.js](https://nodejs.org/) (LTS version)

2. Open a terminal and run:
   ```bash
   npm install -g openclaw
   openclaw wizard
   ```

3. When asked how to authenticate, choose **OAuth** to use your existing Claude.ai subscription (no extra cost!)

4. Start the gateway:
   ```bash
   openclaw gateway
   ```

You're now talking to Claude through OpenClaw.

---

### Step 2: Set up ClawGPT

Just tell OpenClaw:

> **Set up ClawGPT for me: https://github.com/craihub/clawgpt**

That's it. OpenClaw will handle the rest.

---

### Manual setup (if you prefer)

<details>
<summary>Click to expand manual instructions</summary>

1. [Download ClawGPT ZIP](https://github.com/craihub/clawgpt/archive/refs/heads/main.zip)

2. Extract to your **home folder** as `clawgpt`:
   - **Mac/Linux:** `~/clawgpt/`
   - **Windows:** `C:\Users\YourName\clawgpt\`

3. Allow ClawGPT to connect to your gateway:
   ```bash
   openclaw config set gateway.controlUi.allowedOrigins '["http://localhost:8080"]'
   ```

4. Start the web server (in the clawgpt folder):
   ```bash
   python3 -m http.server 8080
   ```

5. Open http://localhost:8080

6. The setup wizard will ask for your token. Ask OpenClaw:
   > *"What's my gateway token?"*

> **Can't find your home folder?** Ask OpenClaw: *"open my clawgpt folder"*

</details>

---

### For developers

```bash
git clone https://github.com/craihub/clawgpt.git ~/clawgpt
cd ~/clawgpt
python3 -m http.server 8080
```
Browser (ClawGPT)
    ↕ WebSocket
OpenClaw Gateway
    ↕ API
AI Models (Claude, etc.)
```

- `index.html` — Page structure, modals, overlays (~1K lines)
- `app.js` — All application logic, WebSocket handling, UI components (~11K lines)
- `style.css` — Dark theme styling (~6K lines)
- `server.js` — Simple Node.js static file server with workspace API (~150 lines)

## Setup

### Prerequisites
- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- Node.js (for the server)

### Running

```bash
# Clone the repo
git clone https://github.com/hsatarian/spaceshipgpt.git
cd spaceshipgpt
git checkout jarvis

# Start the server
node server.js
# → http://localhost:8080

# Or run as a systemd service
systemctl --user start clawgpt
```

### Configuration

ClawGPT auto-connects to `ws://localhost:3777` (default OpenClaw Gateway WebSocket). Configure the Gateway URL in Settings if your setup differs.

## Screenshots

### Inline Image Rendering & Artifacts Gallery
![Image rendering with Artifacts panel](docs/screenshot-clawgpt.png)

*Images from MEDIA: paths render inline in chat. The Artifacts panel shows an image gallery with thumbnails.*

## Contributing

This is a collaborative project. The `jarvis` branch contains all power-user features. PRs welcome.

## Credits

- **SpaceshipGPT** — Original project by [Houman Satarian](https://github.com/hsatarian)
- **ClawGPT / Jarvis branch** — Power features by Kamil Gronowski & Jarvis (AI)
- **OpenClaw** — The AI assistant platform that powers everything

## License

See upstream repository for license information.
