# ClawGPT

> **A free, self-hosted ChatGPT alternative** — Clean web interface for [OpenClaw](https://github.com/openclaw/openclaw) with **Claude Opus 4.6 support**

![ClawGPT Screenshot](screenshot.png)

**Already use ChatGPT? Have a Claude.ai subscription?** ClawGPT gives you the same familiar chat experience — no learning curve, just a better interface for the AI you're already paying for.

### Why ClawGPT?

| Feature | ChatGPT | Claude.ai | OpenClaw | ClawGPT |
|---------|:-------:|:---------:|:--------:|:-------:|
| **Claude Opus 4.6** | ❌ | ✅ | ❌ | ✅ |
| Edit any message | ✅ | ❌ | ❌ | ✅ |
| Conversation branching | ✅ | ❌ | ❌ | ✅ |
| Regenerate responses | ✅ | ✅ | ❌ | ✅ |
| Choose model per-message | ❌ | ❌ | ✅ | ✅ |
| Voice input & read aloud | ✅ | ❌ | ❌ | ✅ |
| File & image attachments | ✅ | ✅ | ❌ | ✅ |
| Search all chats | ✅ | ❌ | ❌ | ✅ |
| AI-powered semantic search | ❌ | ❌ | ❌ | ✅ |
| Export all chats (JSON) | ❌ | ❌ | ❌ | ✅ |
| Import/restore chats | ❌ | ❌ | ❌ | ✅ |
| Cross-device sync | ❌ | ❌ | ❌ | ✅ |
| Unlimited local history | ❌ | ❌ | ✅ | ✅ |
| Data stays on your machine | ❌ | ❌ | ✅ | ✅ |
| Pin favorite chats | ❌ | ❌ | ❌ | ✅ |
| Code syntax highlighting | ✅ | ✅ | ❌ | ✅ |
| Open source | ❌ | ❌ | ✅ | ✅ |

**Use your existing Claude.ai subscription** — no extra API costs, no new accounts, just a better interface.

## ✨ Features

### Core Chat
- [x] **Chat history** — Saved locally via IndexedDB, never leaves your machine
- [x] **Multiple conversations** — Sidebar with all your chats
- [x] **Streaming responses** — See answers as they're generated in real-time
- [x] **Stop generation** — Red stop button to halt mid-response
- [x] **Dark/Light mode** — Easy on the eyes, system preference supported
- [x] **Mobile friendly** — Fully responsive design with native Android app
- [x] **No build tools** — Pure HTML/CSS/JS, just open and go

### Organization
- [x] **Pin favorite chats** — Drag-and-drop reordering, pinned chats stay at top
- [x] **Rename chats** — Custom titles instead of auto-generated ones
- [x] **Collapsible sidebar** — More screen space when you need it
- [x] **Search chat history** — Find any conversation instantly with smart search
- [x] **Semantic search** — Optional AI-powered search for better results

### Editing & Branching
- [x] **Edit previous messages** — Modify any message in the conversation
- [x] **Chat branching** — Edits create branches, preserving original conversation
- [x] **Branch visualization** — Branches grouped under parent chats in sidebar
- [x] **Copy messages** — One-click copy for any message

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

## ⚙️ Configuration

Click the **Settings** button (gear icon) to configure:

| Setting | Description | Default |
|---------|-------------|---------|
| Gateway URL | OpenClaw WebSocket endpoint | `ws://localhost:18789` |
| Auth Token | Gateway authentication token | (from URL or manual) |
| Session Key | OpenClaw session to use | `main` |
| Dark Mode | Toggle dark/light theme | On |
| Smart Search | AI-generated summaries for search | On |
| Semantic Search | Find related chats by meaning | Off |
| Show Tokens | Display estimated token count | Off |
| Export/Import | Backup and restore all chats | — |

### Auto-Connect (Optional)

For multi-browser or incognito use, create a `config.js` file:

```bash
cp config.example.js config.js
# Edit config.js with your token
```

```javascript
window.CLAWGPT_CONFIG = {
  gatewayUrl: 'ws://localhost:18789',
  authToken: 'your-token-here',
  sessionKey: 'main'
};
```

Any browser opening ClawGPT will auto-connect using this config. The file is gitignored so your token won't be committed.

> **Security**: Only use config.js on localhost. If exposed to a network, anyone can view your token in the source.

## 🔄 Cross-Device Sync

When you connect your phone via the relay QR code, your chat history syncs automatically:

- **Initial sync**: Phone receives all chats from desktop on connect
- **Real-time sync**: New messages appear on both devices instantly
- **Conflict resolution**: Newer changes win (by timestamp)
- **Offline support**: Each device keeps its own local copy

No cloud storage, no accounts — sync happens directly through the encrypted relay connection while both devices are connected.

## 🧠 Cross-Device Memory

ClawGPT's killer feature: **clawgpt-memory** — a file-based conversation store that syncs across all your devices and is readable by your OpenClaw agent.

### How It Works

```
┌─────────────┐                        ┌─────────────┐
│   Mobile    │◄──── Relay Sync ──────►│   Desktop   │
│  (Android)  │    (E2E Encrypted)     │   (Web)     │
└─────────────┘                        └──────┬──────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ clawgpt-memory/ │
                                    │  2026-02-04.jsonl│
                                    │  2026-02-05.jsonl│
                                    └────────┬────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │  OpenClaw Agent │
                                    │  (can read all  │
                                    │   your chats!)  │
                                    └─────────────────┘
```

### Setup

On first run, ClawGPT will ask you to select a folder for `clawgpt-memory`.

**Recommended:** Create a folder called `clawgpt-memory` in your ClawGPT directory:
```
clawgpt/
├── clawgpt-memory/    <- Your synced conversations
│   ├── 2026-02-04.jsonl
│   └── 2026-02-05.jsonl
├── index.html
├── app.js
└── ...
```

You can also set this up later in **Settings**.

### File Format

Messages are stored as JSONL (one JSON object per line):

```json
{"id":"abc-0","chatId":"abc","chatTitle":"Hello","role":"user","content":"Hi!","timestamp":1707012345678}
{"id":"abc-1","chatId":"abc","chatTitle":"Hello","role":"assistant","content":"Hello!","timestamp":1707012346000}
```

### Why This Matters

1. **Your OpenClaw agent can read your history** — Ask "what did we talk about last week?" and your agent can search your ClawGPT conversations
2. **True cross-device sync** — Start a chat on your phone, continue on desktop
3. **Your data, your files** — Plain text files you can backup, search, or process however you want
4. **Works offline** — Syncs when devices reconnect

### For OpenClaw Agents

Add this to your agent's memory search paths to access ClawGPT conversations:
```yaml
memorySearch:
  extraPaths:
    - ~/clawgpt/clawgpt-memory/
```

Now your agent can search across both OpenClaw memory AND your ClawGPT chat history.

## 🔧 How It Works

ClawGPT connects directly to OpenClaw's Gateway WebSocket API:

1. Establishes WebSocket connection to your local gateway
2. Authenticates with your token
3. Sends messages via `chat.send`
4. Receives streaming responses via `chat` events
5. Stores chat history in browser IndexedDB (with localStorage fallback)

**No server needed** — It's pure client-side JavaScript.

## 📁 Files

```
clawgpt/
├── index.html            # Main HTML structure
├── style.css             # ChatGPT-like styling (dark/light themes)
├── app.js                # WebSocket + UI logic + chat management
├── chat-storage.js       # IndexedDB storage with localStorage fallback
├── memory-storage.js     # Per-message indexing for search
├── file-memory-storage.js # File System Access API for cross-device sync
├── error-handler.js      # Error capture and debug logging
├── config.example.js     # Example config (copy to config.js)
├── lib/
│   ├── relay-crypto.js   # E2E encryption for relay mode
│   ├── nacl.min.js       # TweetNaCl.js crypto library
│   ├── nacl-util.min.js  # TweetNaCl utilities
│   └── purify.min.js     # DOMPurify for HTML sanitization
├── screenshot.png
└── README.md
```

## 🔍 Why ClawGPT?

| | ChatGPT | ClawGPT |
|---|---------|---------|
| **Cost** | $20/month | Free (use your Claude.ai sub via OAuth) |
| **Privacy** | Data sent to OpenAI | Stays on your machine |
| **Model choice** | GPT-4 only | Any model via OpenClaw (including Opus 4.6) |
| **Edit messages** | ✅ | ✅ |
| **Branching** | ✅ | ✅ |
| **Regenerate** | ✅ | ✅ + model selection |
| **Voice input** | ✅ | ✅ + push-to-talk |
| **Search history** | ✅ | ✅ + semantic search |
| **Export/Import** | Limited | Full JSON backup |
| **Cross-device** | Cloud only | E2E encrypted sync |
| **Storage limit** | Cloud-based | Unlimited (IndexedDB) |
| **Data ownership** | OpenAI owns it | You own it |
| **Customization** | Limited | Full control (open source) |

## 🛠️ Troubleshooting

**Can't find the clawgpt folder?**
- Ask OpenClaw: *"open my clawgpt folder"* — it'll open the folder for you
- Default location: `~/clawgpt/` (home folder)

**Can't connect?**
- Make sure OpenClaw gateway is running (`openclaw gateway status`)
- Check the Gateway URL (default port is 18789)
- Verify your auth token — ask OpenClaw: *"what's my gateway token?"*

**Messages not sending?**
- Check browser console (F12) for errors
- Status should show "Connected" (green)

**Chat history missing?**
- Chats are stored in browser IndexedDB (per browser/profile)
- Use Settings → Export to back up your chats
- Use Settings → Import to restore from backup

**Moving to a new browser?**
1. In old browser: Settings → Export Chats
2. In new browser: Settings → Import Chats

**Mobile not connecting?**
- Install the [ClawGPT Android app](https://github.com/craihub/clawgpt-app) for the best experience
- Alternatively, use **Chrome** on mobile — Brave/Firefox may block local WebSocket connections
- Make sure your phone is on the same WiFi network as your computer

## 🤝 Contributing

PRs welcome! Ideas for contribution:
- Chat folders/tags
- PWA/offline support
- More voice languages
- Custom themes

## 📱 Mobile Apps

### Android

Native Android wrapper available: [ClawGPT for Android](https://github.com/craihub/clawgpt-app)

- Install the APK directly (no Play Store needed)
- Scan QR code from desktop to connect
- End-to-end encrypted relay connection
- Push-to-talk and conversation mode voice input
- Chat history syncs automatically between devices
- Swipe gestures for sidebar navigation

### iOS

Coming soon. For now, use Safari and "Add to Home Screen" for a PWA-like experience.

## 📄 License

MIT — do whatever you want with it.

---

## 🔑 Keywords

ChatGPT alternative, self-hosted AI chat, Claude Opus 4.6, OpenClaw UI, free ChatGPT, private AI assistant, open source ChatGPT clone, Claude.ai alternative UI, edit AI messages, regenerate AI responses, chat history search, self-hosted Claude interface, conversation branching, voice input AI chat, speech to text AI, cross-device chat sync, E2E encrypted AI chat, export chat history, import chat backup, IndexedDB chat storage, unlimited chat history, semantic search AI chat, code syntax highlighting, file attachments AI chat
