# ClawGPT Security Guide

## Overview

ClawGPT includes multiple security features to protect your conversations, credentials, and privacy. This document describes each security feature, how to enable it, and the threat model.

## Security Features

### 1. Encrypted Chat Storage

**What it does:** Encrypts your chat history stored in IndexedDB using AES-256-GCM encryption.

**Protection level:** Protects against:
- Unauthorized access to chat data if device is accessed
- Browser extension snooping on IndexedDB
- Forensic recovery of plaintext chats

**Does NOT protect against:**
- Keyloggers capturing your encryption password
- Screen capture/recording while chats are displayed
- Memory extraction from running browser

**How to enable:**
1. Open Settings → Security
2. Check "Encrypt stored chats"
3. Enter a strong password (minimum 6 characters recommended: 12+)
4. Click "Set Encryption Password"

**Technical details:**
- Key derivation: PBKDF2 with 100,000 iterations and SHA-256
- Encryption: AES-256-GCM with random 12-byte IV per encryption
- Salt stored in localStorage (not secret)
- Only message content is encrypted; metadata (chat titles, timestamps) remain accessible

### 2. PIN/Password Lock

**What it does:** Requires a PIN to access ClawGPT, with automatic lock after inactivity.

**Protection level:** Protects against:
- Casual unauthorized access to your chats
- Brief unattended access to your device

**Does NOT protect against:**
- Determined attackers with device access
- Memory/storage forensics

**How to enable:**
1. Open Settings → Security
2. Check "Require PIN to access"
3. Enter a PIN (4-20 characters)
4. Press Enter to set
5. Configure auto-lock timeout (default: 15 minutes)

**Configuration:**
- PIN length: 4-20 characters (alphanumeric allowed)
- Auto-lock timeout: 5 min, 15 min (default), 30 min, 1 hour, or never
- PIN stored as PBKDF2 hash (100,000 iterations)

### 3. Session Timeout

**What it does:** Automatically disconnects the WebSocket after inactivity.

**Benefits:**
- Reduces attack surface when away
- Forces re-authentication if PIN enabled
- Saves server resources

**How to enable:**
1. Open Settings → Security
2. Set "Session timeout" (default: 30 minutes)

**Options:** 15 min, 30 min, 1 hour, 2 hours, or never

### 4. Secure Token Storage

**What it does:** Stores authentication tokens in IndexedDB with optional encryption, rather than localStorage or source files.

**Protection level:** Protects against:
- Token exposure in source code
- Token leakage via URL parameters
- XSS attacks accessing localStorage

**Migration:**
- Automatically migrates from `config.js` or localStorage on first run
- Old tokens are removed after migration

**Token rotation:**
- "Rotate Token" button in Settings opens gateway config
- Token age tracking warns if token is >90 days old
- Token history tracks hashed previous tokens

### 5. Encrypted File Memory

**What it does:** Optionally encrypts the JSONL memory files written to disk.

**Protection level:** Protects chat data synced to file system from:
- Unauthorized file access
- Cloud sync services seeing plaintext
- External tool access without password

**How to enable:**
1. Set up file memory storage (Settings → Persistent Backup)
2. The encryption uses the same password as chat encryption

**File format:**
- Encrypted files use `.enc.jsonl` extension
- First line is header: `{"_encrypted": true, "_version": 1}`
- Each subsequent line is individually encrypted

### 6. Content Security Policy (CSP)

**What it does:** Restricts what the browser can load and execute.

**Current policy:**
```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;
style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;
connect-src 'self' ws: wss: https:;
img-src 'self' data: blob:;
font-src 'self' data:;
form-action 'none';
frame-ancestors 'none';
base-uri 'self';
```

**Protection:**
- `connect-src`: Limits network connections to self, WebSocket, and HTTPS
- `form-action 'none'`: Prevents form submission hijacking
- `frame-ancestors 'none'`: Prevents clickjacking via iframes
- `base-uri 'self'`: Prevents base tag injection attacks

## Threat Model

### What ClawGPT Security IS Designed For

1. **Casual privacy** - Prevent family members, coworkers, or casual snoopers from reading your chats
2. **Lost device mitigation** - Encrypted chats can't be easily read if device is lost
3. **Session security** - Auto-lock and timeout reduce exposure window
4. **Token protection** - Keep auth tokens out of source code and URLs

### What ClawGPT Security is NOT Designed For

1. **Nation-state attackers** - If a sophisticated attacker has device access, assume compromise
2. **Malware on your device** - Keyloggers, screen capture, memory extraction
3. **Gateway security** - ClawGPT trusts the gateway; compromise there exposes everything
4. **Perfect forward secrecy** - Chat history is decryptable with the password

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                      YOUR DEVICE                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  ClawGPT Browser                        ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ ││
│  │  │ Chat Display│  │  Encrypted  │  │  File Memory    │ ││
│  │  │ (Decrypted) │  │  IndexedDB  │  │  (Optional Enc) │ ││
│  │  └─────────────┘  └─────────────┘  └─────────────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                    WebSocket/HTTPS
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    GATEWAY SERVER                            │
│              (Trusted - has full access)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       AI MODEL                               │
│              (Trusted - sees all prompts)                    │
└─────────────────────────────────────────────────────────────┘
```

## Best Practices

### For Personal Use

1. **Enable chat encryption** with a strong, unique password
2. **Set up PIN lock** with auto-lock after 5-15 minutes
3. **Rotate tokens** every 90 days
4. **Use file memory** with a synced folder for backup

### For Shared Computers

1. **Always use PIN lock** with short timeout
2. **Enable session timeout** (15 minutes max)
3. **Consider using private/incognito mode** (no persistent storage)

### For Maximum Security

1. Enable all security features
2. Use a long, random encryption password (store in password manager)
3. Rotate tokens monthly
4. Run ClawGPT from a trusted, malware-free device
5. Use HTTPS for gateway connections when possible
6. Regularly export encrypted backups

## Recovery

### Forgot Encryption Password

Unfortunately, there is no recovery mechanism for forgotten encryption passwords. This is by design - if we could recover it, so could attackers.

**Options:**
1. Try common passwords you might have used
2. Clear encrypted data and start fresh:
   - Open browser DevTools → Application → IndexedDB
   - Delete `clawgpt` database
   - Clear localStorage items starting with `clawgpt-`

### Forgot PIN

1. Clear `clawgpt-security` from localStorage:
   - Open browser DevTools → Application → Local Storage
   - Delete `clawgpt-security`
2. Refresh the page

### Token Expired/Invalid

1. Open Settings
2. Click "Rotate Token" to open gateway config
3. Generate a new token in the gateway
4. Update the token in ClawGPT settings

## Security Updates

Security is an ongoing process. To stay updated:

1. Pull latest ClawGPT changes regularly
2. Monitor the repository for security advisories
3. Report security issues privately to the maintainers

## Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Contact the maintainers privately
3. Allow time for a fix before public disclosure

---

*Last updated: Security hardening release*
