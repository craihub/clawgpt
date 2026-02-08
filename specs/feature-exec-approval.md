# Feature: Exec Approval UI (P2)

## Overview
When the OpenClaw agent wants to execute a shell command and needs approval, show a modal dialog in ClawGPT where the user can approve, deny, or edit the command before execution.

## How Exec Approval Works in OpenClaw Gateway
Per the official Gateway protocol docs (https://docs.openclaw.ai/gateway/protocol):

**Events:**
- Gateway → Client: `{ type: "event", event: "exec.approval.requested", payload: { ... } }`
- The payload likely includes: command, workDir, sessionKey, approvalId

**Resolution:**
- Client → Gateway: `{ type: "req", method: "exec.approval.resolve", params: { approvalId, decision: "approve"|"deny", editedCommand?: string } }`
- Requires `operator.approvals` scope (already added to ClawGPT connect params)

**Note:** The exact payload fields need to be discovered by handling the event and logging it. The common fields based on OpenClaw patterns are approvalId, command, args, workDir, sessionKey.

## Requirements

### Approval Modal
```
┌─────────────────────────────────────────┐
│ ⚡ Command Approval                  ✕  │
├─────────────────────────────────────────┤
│ The agent wants to run:                 │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ $ ls -la /home/molt/projects        │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Working directory: ~/projects           │
│ Session: main                           │
│                                         │
│ [Deny]  [Edit & Approve]  [✅ Approve]  │
└─────────────────────────────────────────┘
```

### Implementation
1. Listen for `exec.approval` (or similar) events in the WebSocket handler
2. Show approval modal with syntax-highlighted command preview
3. Approve → send approval response via WebSocket
4. Deny → send denial response
5. Edit & Approve → show editable textarea, then approve the edited command
6. Auto-approve toggle for trusted patterns (optional)
7. Sound/notification when approval needed (attention-getting)

### Key Considerations
- First check the actual Gateway WebSocket protocol for exec approval events
- The event name might be different — check Gateway docs/source
- Modal should be prominent (maybe with a pulsing border or shake animation)
- Timeout: if not responded in 60s, auto-deny
- History of recent approvals (last 10) in a collapsible section

### CSS
- `.exec-approval-modal` — high z-index modal with attention-getting style
- `.exec-command-preview` — monospace command display
- `.exec-approval-actions` — button row

### Files to modify
- `app.js` — WebSocket event listener, modal logic, approval response
- `style.css` — modal styles
- `index.html` — modal markup

### Verification
- Modal appears when exec approval event received
- Approve sends approval, command executes
- Deny blocks the command
- Edit mode works
- No console errors

### NOTE FOR IMPLEMENTER
Before building, you MUST check the actual Gateway WebSocket protocol for exec approval. Look at:
1. The existing handleMessage() method in app.js for all event types handled
2. The OpenClaw docs (if available in the repo)
3. The Gateway source if accessible
The feature only works if we know the exact event format.
