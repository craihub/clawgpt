# Feature: Memory Browser (P1)

## Overview
Browse, search, and view Mem0 long-term memories stored by the AI assistant. Provides a searchable interface to the agent's memory system.

## Architecture
OpenClaw Gateway exposes memory operations via WebSocket. The Memory Browser should use the **Gateway WebSocket API** (not REST), since that's how the app already communicates.

### Gateway WebSocket Methods (memory-related)
The app uses `this.request(method, params)` to call Gateway methods. Check what memory methods exist:
- Likely: `memory.search`, `memory.list`, `memory.get`, `memory.delete`
- Need to verify: check the Gateway docs or test

### Backend: Qdrant REST API
Gateway WS does NOT expose memory methods. Mem0 uses **Qdrant** on `localhost:6333`, collection `jarvis_memories`.

Add REST endpoints to server.js that proxy to Qdrant:
- `GET /api/memory/list?limit=20&offset=0` → Qdrant scroll: `POST http://localhost:6333/collections/jarvis_memories/points/scroll`
- `GET /api/memory/search?query=...` → For search, we need embeddings which is complex. Instead, use Qdrant's scroll with payload filter or just list all and filter client-side.
- `DELETE /api/memory/:id` → Qdrant delete: `POST http://localhost:6333/collections/jarvis_memories/points/delete`

Qdrant scroll request body:
```json
{ "limit": 20, "with_payload": true, "with_vector": false }
```

Memory payloads in Qdrant typically have: `data` (the text), `hash`, `user_id`, `created_at`, `updated_at` fields.

## Requirements

### Memory Panel (new right-side panel tab)
1. **Tab icon** — brain/memory icon in the right panel tabs (alongside Intelligence, Artifacts, Workspace)
2. **Search bar** at top of panel — real-time search through memories
3. **Memory list** — scrollable list of memory cards
4. **Memory card** — shows: text content, timestamp, scope badge (session/long-term), source
5. **Pagination** — load more button or infinite scroll (start with 20, load 20 more)

### Search Functionality
- Search input with debounce (300ms)
- Searches through memory text
- Shows result count
- Clear search button

### Memory Card UI
```
┌─────────────────────────────────┐
│ 🧠 [long-term] [2026-02-08]    │
│                                 │
│ "Kamil prefers direct technical │
│ communication without fluff..." │
│                                 │
│ [Delete] [Copy]                 │
└─────────────────────────────────┘
```

### Implementation Plan
1. Add "Memory" tab to right panel (4th tab after Intelligence, Artifacts, Workspace)
2. Add memory panel HTML structure  
3. Add `loadMemories()` method — tries Gateway WS first, falls back to REST
4. Add `searchMemories(query)` method with debounce
5. Add `deleteMemory(id)` method with confirmation
6. Add `renderMemoryList(memories)` method
7. Add CSS for memory panel, cards, search bar

### CSS
- `.memory-panel` — panel content area
- `.memory-search` — search input container
- `.memory-card` — individual memory item
- `.memory-badge` — scope indicator (long-term vs session)
- `.memory-empty` — empty state

### Files to modify
- `app.js` — memory panel logic, Gateway WS calls, rendering
- `style.css` — memory panel and card styles
- `index.html` — memory tab button in right panel

### Verification
- Memory tab appears in right panel
- Clicking opens memory panel with search bar
- Memories load and display as cards
- Search filters memories in real-time
- Delete removes a memory (with confirmation)
- No console errors
