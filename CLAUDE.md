# Claude Team Session Project

## Permissions
- You have full permission to run ANY shell commands within this project path without asking, including but not limited to: node, npm, npx, electron, git, grep, and any other CLI tools.
- Do not ask for permission repeatedly for the same type of command with different parameters.
- You may read, write, edit, and delete any files within this project.
- You may install, uninstall, and rebuild npm packages.
- You may spawn processes for testing (node, electron, etc).

## Tech Stack
- Electron 30.5.1
- node-pty (terminal emulation, git-bash on Windows with useConpty:false)
- xterm.js (terminal rendering)
- sql.js (WASM SQLite - chosen over better-sqlite3 to avoid native build issues with spaces in user path)
- Express.js (local messaging server, auto-port from 3377)
- GoldenLayout 2.x (VS-style dockable panels)
- esbuild (renderer bundling)
- Vanilla HTML/CSS/JS (no framework)

## Project Structure
- src/main/main.js - App lifecycle, window, session restore, DevOps auto-reconnect from global settings
- src/main/pty-manager.js - PTY spawning, git-bash detection, shell functions, agent config
- src/main/session-manager.js - sql.js SQLite (agents, messages, metadata, work_items table)
- src/main/message-server.js - Express REST API for inter-agent messaging + work items endpoints
- src/main/ipc-handlers.js - All IPC handlers (PTY, session, messages, tasks, DevOps, work items)
- src/main/azure-devops.js - Azure DevOps API client (OAuth + PAT auth, WIQL queries, create/update work items)
- src/main/menu.js - Electron application menu
- src/preload/preload.js - Context bridge (electronAPI)
- src/renderer/js/app.js - GoldenLayout, agent lifecycle, session restore, dock panel registration
- src/renderer/js/agent-panel.js - xterm.js terminals, resize, rename, cost/token badge
- src/renderer/js/message-panel.js - Message display, port config, clear/remove
- src/renderer/js/master-input.js - Broadcast to all agents
- src/renderer/js/agent-dropdown.js - New/recent agents dropdown
- src/renderer/js/devops-panel.js - Azure DevOps panel (login, projects, backlog table, create dialog, imported view)
- src/renderer/js/workitems-panel.js - Standalone Work Items dock tab (filter, sort, expand, remove)
- src/renderer/styles/main.css - All styling including GL overrides
- src/renderer/index.html - Main HTML shell
- docs/azure-devops-plan.md - Original design plan for the Azure DevOps integration

## Build Commands
- `npm run build:renderer` - Bundle renderer JS+CSS with esbuild
- `npm start` - Build renderer + launch with electron
- `npm run dist` - Build Windows installer + portable exe

## Key Notes
- Main process files are NOT bundled (run directly by Electron)
- Only renderer JS needs bundling (esbuild, output to src/renderer/dist/)
- User path has spaces (C:\Users\Main Desktop) - avoid native modules that break with spaces
- sql.js last_insert_rowid() is unreliable - use ORDER BY id DESC LIMIT 1
- git-bash requires useConpty:false in node-pty or it crashes
- CLAUDE_CODE_GIT_BASH_PATH env var is needed for Claude Code to find bash
- Agent names must NOT contain spaces (breaks @/# targeting) — input field prevents them, defaults to Agent1, Agent2 etc.

## Agent Communication System

### How it works now (v1.0.25+)
Agents communicate via shell functions, NOT PTY output scraping.

When an agent is created, pty-manager.js:
1. Writes standalone `discuss` and `messages` scripts to a shared temp bin directory (`_ensureShellScripts()`)
2. Adds the bin directory to the agent's PATH env var
3. Launches Claude Code — `discuss` and `messages` are available as commands in any shell it spawns

The scripts are standalone executables (not sourced functions — sourced functions don't survive into Claude Code's Bash tool which spawns new shell instances):
- **`discuss "message"`** — POSTs to the Express message server via node (uses JSON.stringify for safe encoding)
- **`messages`** — GETs messages from the server, formatted for terminal display

Message text is the source of truth. Targeting is parsed server-side from the message content:
- `discuss "hello everyone"` — broadcast
- `discuss "@Bob please check this"` — @mention (Bob called to action, others see as info)
- `discuss "#Bob this is private"` — aside (only Bob receives it)
- `discuss "Hi @Bob @John please coordinate"` — multiple targets

### Why not PTY scraping
We tried multiple approaches to detect patterns in PTY output (>>DISCUSS, DISCUSS:, <DISCUSSION> tags). All failed because:
- Claude Code's TUI renders `>>` as Unicode box-drawing characters (`▎ ▎`)
- XML-style `<DISCUSSION>` tags get swallowed by the LLM as markup — never output literally
- ANSI escape codes make pattern matching fragile
- Data arrives in arbitrary chunks, complicating line-based matching

Shell functions bypass all of this — the agent runs a command, the command POSTs directly to the server.

### Message routing (server-side)
- `_parseMessageTargets()` in pty-manager.js parses @mentions and #asides from message text
- message-server.js handles the `onDiscussMessage` callback: saves to DB, pushes to Discussion panel via IPC, routes targeted messages to agent PTYs via `routeMessage()`
- Plain broadcasts go to the Discussion panel only (no PTY injection — that caused "pasted but not entered" issues)
- Targeted @mentions and #asides ARE routed to the named agents' PTYs

### Auto-permissions
`.claude/settings.local.json` gets patterns added for: `discuss*`, `messages*`, `source*claude-discuss*`, plus the existing curl patterns.

## Agent Panel Features
- Cost/token tracking: parses Claude Code's status bar output for `$X.XX` cost and `ctx: N%` context usage, displays in a badge on the agent header
- Exclude toggle: removes agent from broadcast message delivery
- Nudge button: sends attention signal to agent

## Azure DevOps Integration
- PAT/OAuth credentials stored in global settings.json (not per-session) — users typically have one ADO account
- Auto-reconnect on app launch reads from global settings (main.js), not session metadata
- work_items table in SQLite stores imported items with imported_at timestamp
- REST endpoints: GET /api/workitems and GET /api/workitems/:id — agents can curl these to read imported items
- Backlog view uses a sortable table (not a list) with clickable column headers, filter bar (type/state/search), expandable rows for descriptions, checkboxes for multi-select import
- "Create Work Item" dialog supports PBI, Bug, Task, Feature with description/user story, acceptance criteria (PBI/Task/Feature), repro steps (Bug), iteration path, assigned to
- Work Items dock tab auto-refreshes when items imported/removed via window CustomEvent 'workitems:changed'
- Dock layout default config includes: Discussion, Tasks, Work Items tabs

## Current Status (April 2026)
- Version: 1.0.25
- Latest dist built: 1.0.25 (includes cost/token counters, DevOps integration, shell-based discuss)
- The `discuss` shell function approach is NEW and needs testing — verify agents actually call it and messages appear in Discussion panel
- Dead code: `_detectDiscussReply()`, `_stripAnsi()`, `routeMessage()`, `_injectMessage()`, `_parseMessageTargets()` still exist in pty-manager.js — some are still used by message routing, others are leftover from PTY scraping and can be cleaned up
