# Feature: Prompt Library (P2)

## Overview
Save and reuse prompt templates. Accessible from the message input area.

## Requirements

### Prompt Storage
- Store prompts in localStorage under `clawgpt-prompts` key
- Each prompt: `{ id, title, content, category, variables: string[], createdAt, updatedAt }`
- Variables detected automatically via `{{variable}}` syntax in content
- Default categories: "General", "Coding", "Writing", "Analysis"

### UI Components

#### 1. Prompt Library Button
- Small book/template icon button next to the attach file button (left of message input)
- Tooltip: "Prompt Library"
- Click opens a modal overlay (not a side panel — keep it simple)

#### 2. Prompt Library Modal
```
┌─────────────────────────────────────────┐
│ 📋 Prompt Library                    ✕  │
├─────────────────────────────────────────┤
│ [Search prompts...]  [+ New Prompt]     │
│                                         │
│ Category: [All ▼]                       │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 📝 Code Review                      │ │
│ │ Review this {{language}} code for...│ │
│ │ [Use] [Edit] [Delete]              │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 📝 Summarize Document              │ │
│ │ Summarize the following document...│ │
│ │ [Use] [Edit] [Delete]              │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

#### 3. New/Edit Prompt Form
- Title input
- Category dropdown (with option to type custom)
- Content textarea (large, with placeholder showing {{variable}} syntax)
- Save/Cancel buttons

#### 4. Variable Substitution Dialog
When "Use" is clicked on a prompt with variables:
- Shows a small dialog with input fields for each `{{variable}}`
- Fill in values → inserts completed prompt into message input
- If no variables, inserts directly

### Implementation
1. Add prompt library button next to attach button in index.html
2. Add modal HTML structure (hidden by default)
3. In app.js:
   - `loadPrompts()` / `savePrompts()` — localStorage CRUD
   - `openPromptLibrary()` — show modal, render prompts
   - `createPrompt(data)` / `updatePrompt(id, data)` / `deletePrompt(id)`
   - `usePrompt(id)` — handle variable substitution and insert into input
   - `renderPromptList(filter?)` — render prompt cards
   - `extractVariables(content)` — find {{var}} patterns
4. In style.css: modal, prompt card, form styles

### Starter Prompts (pre-loaded on first use)
Include 3-4 starter prompts:
- "Code Review": "Review this {{language}} code for bugs, performance issues, and best practices:\n\n{{code}}"
- "Summarize": "Summarize the following text in {{format}} format:\n\n{{text}}"
- "Explain": "Explain {{topic}} as if I'm a {{audience}} level learner"

### Files to modify
- `app.js` — prompt library logic
- `style.css` — modal and card styles
- `index.html` — button and modal markup

### Verification
- Library button visible next to attach button
- Modal opens with starter prompts
- Can create, edit, delete prompts
- Search filters prompts
- Category filter works
- Variable substitution works (shows dialog, fills in, inserts to input)
- No console errors
