# ClaudeSession Project

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
- src/main/main.js - App lifecycle, window, session restore
- src/main/pty-manager.js - PTY spawning, git-bash detection, agent comms injection
- src/main/session-manager.js - sql.js SQLite (agents, messages, metadata)
- src/main/message-server.js - Express REST API for inter-agent messaging
- src/main/ipc-handlers.js - All IPC handlers
- src/main/menu.js - Electron application menu
- src/preload/preload.js - Context bridge (electronAPI)
- src/renderer/js/app.js - GoldenLayout, agent lifecycle, session restore
- src/renderer/js/agent-panel.js - xterm.js terminals, resize, rename
- src/renderer/js/message-panel.js - Message display, port config, clear/remove
- src/renderer/js/master-input.js - Broadcast to all agents
- src/renderer/js/agent-dropdown.js - New/recent agents dropdown
- src/renderer/styles/main.css - All styling including GL overrides
- src/renderer/index.html - Main HTML shell

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
