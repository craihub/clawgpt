# AGENTS.md - Setup Instructions for OpenClaw

When a user asks you to set up ClawGPT, follow these steps:

## 1. Clone/Download ClawGPT

```bash
git clone https://github.com/craihub/clawgpt.git ~/clawgpt
```

Or if git isn't available, download and extract the ZIP to `~/clawgpt/`.

## 2. Create config.js with the gateway token

Get the gateway token from the config, then create `~/clawgpt/config.js`:

**For desktop-only use:**
```javascript
window.CLAWGPT_CONFIG = {
  gatewayUrl: 'ws://127.0.0.1:18789',
  authToken: '<GATEWAY_TOKEN>',
  sessionKey: 'main',
  darkMode: true
};
```

**For desktop + mobile use (recommended):**
```javascript
window.CLAWGPT_CONFIG = {
  gatewayUrl: 'ws://<LAN_IP>:18789',
  authToken: '<GATEWAY_TOKEN>',
  sessionKey: 'main',
  darkMode: true
};
```

Replace:
- `<GATEWAY_TOKEN>` with the actual token from `gateway.auth.token` in the OpenClaw config
- `<LAN_IP>` with the computer's local IP (get it with `hostname -I | awk '{print $1}'` on Linux or `ipconfig getifaddr en0` on macOS)

**Note:** Using LAN IP allows mobile access. Also requires `gateway.bind: "lan"` in OpenClaw config.

## 3. Start the web server

```bash
cd ~/clawgpt && python3 -m http.server 8080
```

Run this in the background so it persists.

## 4. Add heartbeat check (keeps server running)

Add this to the user's `HEARTBEAT.md` so the server auto-restarts if it dies:

```markdown
## ClawGPT Server
- Check if ClawGPT server is running (curl http://localhost:8080)
- If not running, start it: `cd ~/clawgpt && python3 -m http.server 8080 &`
```

## 5. Open ClawGPT in the browser

```bash
xdg-open http://localhost:8080  # Linux
open http://localhost:8080      # macOS
start http://localhost:8080     # Windows
```

## 6. Confirm success

Tell the user:
> "ClawGPT is set up and running at http://localhost:8080 - I've bookmarked it and it will auto-restart if it ever stops."

---

## Mobile Access Setup

When the user asks for mobile access to ClawGPT:

### Same network (at home)

1. **Get the local IP first:**
   ```bash
   hostname -I | awk '{print $1}'  # Linux
   ipconfig getifaddr en0          # macOS
   ```

2. **Update gateway config to allow local network:**
   ```javascript
   // Use gateway config.patch to change bind from "loopback" to "lan"
   gateway.bind = "lan"
   ```

3. **Update config.js to use LAN IP (CRITICAL!):**
   Edit `~/clawgpt/config.js` and change the gatewayUrl to use the LAN IP:
   ```javascript
   window.CLAWGPT_CONFIG = {
     gatewayUrl: 'ws://[LOCAL_IP]:18789',  // Use LAN IP, not 127.0.0.1!
     authToken: '<existing-token>',
     sessionKey: 'main',
     darkMode: true
   };
   ```
   Without this change, mobile devices won't be able to connect to the gateway.

4. **Restart ClawGPT server with network binding:**
   ```bash
   pkill -f "python3 -m http.server 8080"
   cd ~/clawgpt && nohup python3 -m http.server 8080 --bind 0.0.0.0 &
   ```

5. **Tell the user:**
   > "Mobile access is ready! Open ClawGPT in your desktop browser, go to Settings → Mobile Access → Show QR Code, then scan it with your phone camera."
   
   ⚠️ Remind them: "Don't share the QR code — it contains your auth token."

   **Browser compatibility:** Chrome mobile works best. Brave/Firefox may block local WebSocket connections for security reasons. If it doesn't connect, try Chrome.

### Remote access (away from home)

1. **Check if Tailscale is installed:**
   ```bash
   which tailscale
   ```

2. **If Tailscale is installed, enable it:**
   ```javascript
   // Use gateway config.patch:
   gateway.tailscale.mode = "serve"
   ```

3. **Get Tailscale IP:**
   ```bash
   tailscale ip -4
   ```

4. **Tell the user:**
   > "ClawGPT is now accessible from anywhere via Tailscale at http://[TAILSCALE_IP]:8080. Make sure Tailscale is installed on your phone too."

5. **If Tailscale is NOT installed:**
   > "For remote access, I recommend installing Tailscale (free):
   > 1. Go to https://tailscale.com/download
   > 2. Install on this computer and your phone
   > 3. Log in with the same account on both
   > 4. Then ask me to 'enable Tailscale for ClawGPT'"

---

## Troubleshooting

**Port 8080 already in use?**
Try port 8888: `python3 -m http.server 8888`

**Python not installed?**
- macOS: `brew install python3`
- Linux: `sudo apt install python3`
- Windows: Download from python.org

**Server stops when terminal closes?**
The heartbeat check will restart it, or use `nohup python3 -m http.server 8080 &`
