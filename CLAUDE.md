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
- src/main/pty-manager.js - PTY spawning, git-bash detection, shell scripts, agent config, message routing
- src/main/session-manager.js - sql.js SQLite (agents, messages, metadata, work_items table)
- src/main/message-server.js - Express REST API for inter-agent messaging + work items endpoints
- src/main/ipc-handlers.js - All IPC handlers (PTY, session, messages, tasks, DevOps, work items)
- src/main/azure-devops.js - Azure DevOps API client (OAuth + PAT auth, WIQL queries, create/update work items)
- src/main/menu.js - Electron application menu
- src/preload/preload.js - Context bridge (electronAPI)
- src/renderer/js/app.js - GoldenLayout, agent lifecycle, session restore, dock panel registration
- src/renderer/js/agent-panel.js - xterm.js terminals, resize, rename, cost/token badge
- src/renderer/js/message-panel.js - Message display, port config, clear/remove
- src/renderer/js/master-input.js - Broadcast to all agents, [Discussion] prefix tagging
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

### Overview
The communication loop has two directions:
1. **Outgoing (agent -> discussion):** Agent runs `discuss "message"` shell command, which POSTs to the Express message server. Message appears in the Discussion panel AND gets relayed to all other agents' PTYs.
2. **Incoming (discussion -> agent):** Messages are written directly to the agent's PTY with `\r` to auto-submit. Messages from the Discussion panel are prefixed with `[Discussion]` so agents know to reply via `discuss`. Messages typed directly in an agent's shell have no prefix.

### Shell scripts (`discuss` and `messages`)
When an agent is created, `_ensureShellScripts()` writes standalone executable scripts to a shared temp bin directory added to the agent's PATH. They must be standalone executables, NOT sourced bash functions — sourced functions don't survive into Claude Code's Bash tool which spawns new shell instances.

- **`discuss "message"`** — POSTs to the Express message server via node (uses JSON.stringify for safe encoding)
- **`messages`** — GETs messages from the server, formatted for terminal display

### Message format
Message text is the source of truth. Targeting is parsed server-side by `_parseMessageTargets()`:
- `discuss "hello everyone"` — plain broadcast to all
- `discuss "@Bob please check this"` — @mention (Bob gets action, others see as info)
- `discuss "#Bob this is private"` — aside (only Bob receives it)
- `discuss "Hi @Bob @John please coordinate"` — multiple targets

### Full message flow
1. Agent runs `discuss "message"` → POSTs `{ from: agentId, to: 'all', content: 'message' }` to `/api/messages`
2. message-server.js receives it, parses @/# targets via `ptyManager._parseMessageTargets(content)`
3. Saves to SQLite, pushes to Discussion panel via IPC (`message:new`)
4. Calls `ptyManager.routeMessage()` which delivers to all other agents' PTYs (never back to sender)
5. `routeMessage()` uses `_parseMessageTargets()` to determine delivery: plain → all agents, @mention → all (action/info), #aside → only named agents
6. `_injectMessage()` writes `[Discussion from AgentName] message\r` to the target PTY — the `\r` auto-submits it in Claude Code's TUI

### User → agent messages
- **From Discussion panel (master-input.js):** Writes directly to agent PTYs via `writeToAgent()`. Broadcasts are prefixed `[Discussion]`, asides prefixed `[Discussion aside]`. Agents are instructed to reply via `discuss` for these.
- **From agent's shell directly:** User types in the xterm terminal. No prefix. Agent replies normally in shell output.

### Agent instructions (in config file)
Agents are told:
- Use `discuss` for all Discussion panel communication
- `[Discussion]` prefix = reply via `discuss`; no prefix = reply in shell
- NEVER relay or repeat messages from the Discussion (all agents already receive them)
- Keep discussion messages short
- Don't act on messages addressed to other agents

### Why not PTY scraping
We tried detecting patterns in PTY output (>>DISCUSS, DISCUSS:, <DISCUSSION> tags). All failed:
- Claude Code's TUI renders `>>` as Unicode box-drawing characters (`▎ ▎`)
- XML-style `<DISCUSSION>` tags get swallowed by the LLM as markup — never output literally
- ANSI escape codes make pattern matching fragile
- Data arrives in arbitrary chunks, complicating line-based matching

Shell scripts bypass all of this — the agent runs a command, it POSTs directly to the server.

### Auto-permissions
`.claude/settings.local.json` gets patterns added for: `Bash(discuss*)`, `Bash(messages*)`, plus curl patterns for the server port.

## Agent Panel Features
- Cost/token tracking: parses Claude Code's status bar output for `$X.XX` cost and `ctx: N%` context usage, displays in a badge on the agent header (feedTokenParser in agent-panel.js)
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
- Communication loop is working: discuss command → Discussion panel → relay to other agents' PTYs → auto-submit
- Dead code from PTY scraping attempts still in pty-manager.js: `_detectDiscussReply()`, old `_stripAnsi()` — can be cleaned up
- Active code in pty-manager.js: `routeMessage()`, `_injectMessage()`, `_parseMessageTargets()`, `_ensureShellScripts()` — all part of the working communication system
