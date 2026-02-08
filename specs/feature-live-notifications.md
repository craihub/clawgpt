# Feature: Live Notifications (P1)

## Overview
Toast notifications for events across all OpenClaw sessions. When the user is in one chat, they should see notifications about activity in other sessions, sub-agent completions, and cron job results.

## Requirements

### Toast Notification System
1. **Toast container** — fixed position top-right, z-index above everything
2. **Toast component** — shows icon, title, message preview, timestamp
3. **Auto-dismiss** — toasts fade out after 5 seconds
4. **Click to navigate** — clicking a toast switches to that session/chat
5. **Stack** — multiple toasts stack vertically, max 5 visible
6. **Animation** — slide in from right, fade out

### Event Sources
The Gateway already sends events via WebSocket. Listen for:
1. **`chat` events** with different session keys — new messages in other sessions
2. **`cron.completed`** events — cron job finished
3. **`sessions.spawn.completed`** events — sub-agent finished

### Implementation
- Add a `showToast(title, message, options)` method to ClawGPT class
- Options: `{ type: 'info'|'success'|'warning'|'error', duration: 5000, onClick: fn, sessionKey: string }`
- Listen for Gateway events in `handleMessage()` — filter for events NOT from the current active session
- Store notification history in memory (last 50)
- Add notification bell icon in header that shows unread count badge
- Clicking bell opens a dropdown with recent notifications

### UI Design
- Toast: dark card with subtle border, icon on left, title + preview text, X close button
- Bell icon: in the header bar between the panel buttons and Connected badge
- Notification dropdown: max-height 400px, scrollable, each item clickable
- Unread count: red circle badge on bell icon

### CSS
- `.toast-container` — fixed top-right
- `.toast` — dark card with slide-in animation
- `.toast.fade-out` — opacity transition
- `.notification-bell` — header icon
- `.notification-badge` — red circle count
- `.notification-dropdown` — absolute positioned below bell

### Files to modify
- `app.js` — showToast method, event listener in handleMessage, notification bell logic
- `style.css` — toast and notification styles  
- `index.html` — notification bell icon in header

### Verification
- Toast appears when a message arrives in a different session
- Toast auto-dismisses after 5 seconds
- Bell icon shows unread count
- Clicking notification dropdown item shows the notification
- No console errors
