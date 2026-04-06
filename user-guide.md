# Claude Team Session User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [System Requirements](#system-requirements)
3. [Installation](#installation)
4. [Getting Started](#getting-started)
5. [Sessions](#sessions)
6. [Agents](#agents)
7. [Discussion Panel](#discussion-panel)
8. [Broadcasting and Messaging](#broadcasting-and-messaging)
9. [Tasks Panel](#tasks-panel)
10. [Layout and Views](#layout-and-views)
11. [Themes and Zoom](#themes-and-zoom)
12. [Keyboard Shortcuts](#keyboard-shortcuts)
13. [Menu Reference](#menu-reference)
14. [Troubleshooting](#troubleshooting)
15. [Uninstalling](#uninstalling)

---

## Introduction

Claude Team Session is a desktop application for Windows that lets you run multiple Claude Code sessions side by side with built-in inter-agent messaging. Each session can contain multiple **agents** — independent Claude Code instances, each with their own terminal, working directory, and identity. Agents can communicate with each other through a shared messaging system, and you can broadcast instructions to all agents at once or send private asides to individual agents.

This is useful for coordinating multi-agent workflows such as:

- Having one agent write code while another reviews it
- Splitting a large task across agents working in different repositories
- Running a "supervisor" agent that delegates subtasks to worker agents
- Pair-programming with multiple AI assistants simultaneously
- Using the Tasks panel to queue up work items that agents can retrieve on demand

---

## System Requirements

- **Operating system:** Windows 10 or later (64-bit)
- **Git for Windows:** Required (includes git-bash, which Claude Team Session uses as the shell)
- **Node.js:** Required (Claude Code depends on it)
- **Claude Code:** Required (each agent launches Claude Code automatically)
- **Anthropic API key or Claude subscription:** Required for Claude Code to function
- **Disk space:** Approximately 200 MB for Claude Team Session, plus space for the prerequisites above

---

## Installation

Before installing Claude Team Session itself, you need to install its prerequisites. If you already have any of these installed, skip that step.

### Step 1: Install Git for Windows

Claude Team Session uses git-bash (included with Git for Windows) as the shell environment for all agents. Claude Code also requires git-bash on Windows.

1. Download the installer from [https://git-scm.com/download/win](https://git-scm.com/download/win). Choose the **64-bit Git for Windows Setup** option.
2. Run the installer. The default settings are fine for most users. In particular:
   - On the **"Adjusting your PATH environment"** screen, select **"Git from the command line and also from 3rd-party software"** (this is the default).
   - Accept the defaults for all other options.
3. Click **Install** and wait for it to complete.
4. To verify, open a Command Prompt or PowerShell and run:
   ```
   git --version
   ```
   You should see something like `git version 2.x.x.windows.x`.

**Non-standard install path:** If you install Git to a location other than `C:\Program Files\Git`, set the environment variable `GIT_BASH_PATH` to the full path of `bash.exe` (e.g. `D:\Tools\Git\bin\bash.exe`). Claude Team Session checks the following paths automatically:
- `C:\Program Files\Git\bin\bash.exe`
- `C:\Program Files\Installed\Git\bin\bash.exe`
- `C:\Program Files (x86)\Git\bin\bash.exe`

### Step 2: Install Node.js

Claude Code is a Node.js application, so Node.js must be installed on your system.

1. Download the LTS installer from [https://nodejs.org](https://nodejs.org). Choose the **Windows Installer (.msi)** for 64-bit.
2. Run the installer. Accept the default settings.
3. When the installer offers to **"Automatically install the necessary tools"** (native module build tools), you can skip this — it is not required for Claude Team Session.
4. To verify, open a new Command Prompt or PowerShell and run:
   ```
   node --version
   npm --version
   ```
   You should see version numbers for both.

### Step 3: Install Claude Code

Claude Code is Anthropic's CLI for Claude. Claude Team Session launches it inside each agent terminal.

1. Open a Command Prompt, PowerShell, or git-bash terminal.
2. Install Claude Code globally via npm:
   ```
   npm install -g @anthropic-ai/claude-code
   ```
3. To verify, run:
   ```
   claude --version
   ```
   You should see a version number.
4. Run `claude` once on its own to complete first-time setup. This will prompt you to sign in with your Anthropic account or configure your API key. Follow the on-screen instructions to authenticate.

For more information on Claude Code setup and authentication, see the official documentation at [https://docs.anthropic.com/en/docs/claude-code](https://docs.anthropic.com/en/docs/claude-code).

### Step 4: Install Claude Team Session

Claude Team Session is distributed in two formats. You only need one.

#### Standard Installer (recommended)

1. Run **Claude Team Session Setup x.x.x.exe**.
2. Follow the on-screen prompts. You can choose the installation directory.
3. A desktop shortcut and Start Menu entry will be created automatically.
4. Launch Claude Team Session from the desktop shortcut or Start Menu.

#### Portable Version

1. Run **Claude-Team-Session-Portable.exe** from any location (desktop, USB drive, etc.).
2. The application extracts to a temporary folder and launches immediately.
3. No installation is required and no files are written to your system permanently.

---

## Getting Started

When you first launch Claude Team Session, you will see a welcome screen with two options:

- **Create New Session** — starts a fresh session
- **Open Existing Session** — opens a previously saved `.cms` session file

### Creating your first session

1. Click **Create New Session**. The main workspace opens with an empty agent area on the left and the Discussion and Tasks dock on the right.
2. Click **+ New Agent** in the toolbar (or press **Ctrl+N**) to add your first agent.
3. In the New Agent dialog:
   - **Name** — give your agent a descriptive name (e.g. "Coder", "Reviewer", "Agent 1"). Defaults to "Agent 1", "Agent 2", etc.
   - **Colour** — pick a colour from the swatch grid to visually distinguish this agent from others. The colour is used on the agent's tab border, tab title, and messages in the Discussion panel. The next unused colour is pre-selected by default.
   - **Working Directory** — click **Select** to choose the folder this agent will work in. This is required.
   - **Auto-permissions** — leave checked (recommended) to allow agents to use the messaging API without manual approval. This writes `curl` and `printf` permissions to the agent's `.claude/settings.local.json`. Uncheck if you want full control over what each agent can execute.
4. Click **Create**. A terminal opens with Claude Code launching inside it.
5. After a few seconds, Claude Code starts and automatically reads its agent configuration file. The agent will send a message to the Discussion panel identifying itself and begin listening for instructions.

You can now type directly into the agent's terminal to interact with it, use the **broadcast input** at the bottom of the Discussion panel to send messages to all agents, or add tasks to the Tasks panel for agents to pick up.

### Adding more agents

Repeat the process above to add additional agents. Each agent gets its own terminal panel (or tab, depending on layout mode). You can have as many agents as you need running simultaneously.

---

## Sessions

A session stores all of your agents, their message history, and tasks in a single `.cms` file. Sessions allow you to save your work and pick up where you left off.

### Session lifecycle

- **New sessions** are created as temporary files. They are stored in your AppData folder and named with a timestamp (e.g. `temp20260331_1430.cms`). The toolbar shows "(unsaved)" for temporary sessions.
- **Saving a session** promotes a temporary session to a named file. Use **File > Save Session** (Ctrl+S) and enter a name in the dialog. The file is saved to the default sessions directory.
- **Save As** lets you choose a specific file location. Use **File > Save Session As...** (Ctrl+Shift+S).
- **Opening a session** restores all agents and message history. The agents are relaunched in their original working directories. Use **File > Open Session...** (Ctrl+O).
- **Closing a session** terminates all agents. If the session is unsaved (temporary), you are prompted to Save, Don't Save, or Cancel. For named sessions, you are asked to confirm.

### Renaming a session

You can rename a saved session in two ways:

- **Inline editing:** Click the pencil icon next to the session name in the toolbar. Edit the name and press Enter to confirm or Escape to cancel.
- **Menu:** Use **Settings > Rename Session...** to open a rename dialog.

The session name appears in the toolbar centre and the window title bar.

### Auto-restore

When you close Claude Team Session with a saved session open, it automatically reopens that session the next time you launch the application.

### Recent sessions

Access recently used sessions from **File > Open Recent** in the menu bar. Up to 15 recent sessions are shown. You can clear the recent sessions list using the **Clear Recent Sessions** option at the bottom of the submenu.

---

## Agents

An agent is an individual Claude Code instance running in its own terminal. Each agent has:

- **Name** — a human-readable label (e.g. "Coder", "Reviewer")
- **Colour** — a visual identifier used throughout the UI (32 colours available, with dark and light theme variants)
- **Working directory** — the folder the agent operates in
- **Unique ID** — an internal identifier used for messaging

### Agent header

Each agent panel has a compact header bar containing:

- **Attention badge** — an "!" indicator that appears when the agent needs your attention (see below)
- **Nudge button** — sends a prompt asking the agent to check for new messages
- **Working directory** path (shortened to the last folder name, with full path shown on hover)
- A **...** button to change the working directory

### Creating an agent

Click **+ New Agent** in the toolbar or use **Agents > New Agent...** (Ctrl+N) from the menu. Fill in the name, colour, and working directory in the dialog.

### Restoring a previous agent

Click the **+ New Agent** button to open the dropdown. Below the "New..." option, a **Recent Agents** section lists agents from your current session that were previously closed or from a restored session. Click one to relaunch it with the same name, ID, and working directory. You can remove individual agents from this list using the **x** button next to each entry.

### Removing an agent

- **Any layout mode:** Close the agent's tab using the **x** on the tab.
- **All agents:** Use **Agents > Remove All Agents** from the menu to terminate every running agent.

Closing an agent terminates its Claude Code process. The agent's record is preserved in the session for potential re-use via the Recent Agents dropdown.

### Changing the working directory

Click the **...** button next to the directory path in the agent header. A folder picker dialog opens. After selecting a new folder, the agent's shell changes to that directory.

### Attention indicator

When an agent is waiting for your input (e.g. Claude Code is asking a question, a prompt is waiting, or a yes/no confirmation is needed), an attention indicator appears:

- An **!** badge on the agent's header bar
- A pulsing highlight on the agent's tab (in tabbed mode)

The attention indicator clears automatically when you click on or interact with that agent's terminal. The detection works by monitoring terminal output — when output stops for 2 seconds and the last output matches common prompt patterns (such as `?`, `[Y/n]`, `Do you want to...`, or Claude Code's prompt box), the indicator activates.

### Nudge button

Each agent header contains a **Nudge** button. Clicking it sends a prompt to the agent asking it to check for new messages. This is useful when you have sent a broadcast or task and want to ensure the agent processes it promptly.

### Agent configuration

When an agent is created, Claude Team Session writes a configuration file (`claudeteamsession-XXXXXXXX.md`) to the agent's working directory. This file contains:

- The agent's name and ID
- The messaging server URL
- Instructions for how to send and receive messages via the REST API
- Rules for handling @mentions, #asides, and broadcasts
- Instructions for checking tasks
- Message monitoring guidelines

Claude Code is automatically prompted to read this file when it starts.

---

## Discussion Panel

The **Discussion** panel is located in the right-side dock area. It displays all messages exchanged between agents and shows your broadcast messages. The dock area uses a tabbed layout shared with the Tasks panel — click the tab headers to switch between them.

### Viewing messages

Each message entry shows:

- **Sender** name (coloured to match the agent)
- **Recipient** (a specific agent name, or "all" for broadcasts)
- **Timestamp**
- **Message content**

Messages are displayed in chronological order and auto-scroll to the latest entry. When there are more than 200 messages, older messages are hidden with a "Show older messages" button at the top that you can click to load more.

### Removing messages

Click the **x** button on any individual message to remove it from the Discussion.

### Archiving the discussion

Use **Actions > Archive Discussion...** from the menu or click the **Archive** button at the top of the Discussion panel. The Archive dialog offers three options:

- **Save to file:** Click **Browse** to choose a save location. Messages are exported as a CSV file with columns for Date, Sender, Target, and Message. You can optionally check **"Clear discussion after saving"** to remove messages from the panel after export.
- **Clear without saving:** Click the red **"Clear without saving"** button to remove all messages without exporting. A confirmation dialog will appear.
- **Cancel:** Close the dialog without doing anything.

### Restoring archived messages

Use **Actions > Restore Archived Messages** from the menu to bring back all previously archived (cleared) messages. Archived messages are soft-deleted and stored in the session database, so they can be restored at any time until the session file is deleted.

### Port configuration

At the top of the Discussion panel, the **Port** field shows which port the internal messaging server is running on (default: 3377, auto-incremented if busy). If you need to change it (e.g. due to a port conflict), enter a new port number (1024-65535) and click **Restart**.

### Broadcast input

The broadcast input is a text area at the bottom of the Discussion panel. Text entered here is sent directly into the terminal of **every active agent** simultaneously.

#### Sending a broadcast

1. Type your message in the broadcast input area.
2. Press **Enter** to send (or click the **Send** button).
3. Use **Shift+Enter** to insert a newline without sending.

The broadcast appears in the Discussion panel as a message from "You" to "All Agents".

#### @Mentions

When broadcasting, you can direct a message to a specific agent by including `@AgentName` in the text. All agents receive the broadcast, but each agent is configured to:

- **Act on** messages addressed to them (e.g. `@Coder please fix the bug`)
- **Ignore** messages addressed to other agents (e.g. `@Reviewer check the PR`)
- **Respond to** messages with no @mention prefix (general broadcasts)

Multiple agents can be @mentioned in a single message.

#### #Asides (private messages)

To send a message to only one agent, prefix your message with `#AgentName` followed by a space and the message body. For example:

```
#Coder Please refactor the database module
```

This sends the message text only to the agent named "Coder". No other agents receive it. The aside is shown in the Discussion panel as a message from "You" to the named agent, styled distinctly from broadcasts.

If the agent name does not match any active agent, an error message is displayed in the Discussion panel.

#### Drag-and-drop from Tasks

You can drag a task from the Tasks panel and drop it directly into the broadcast input. The task content is inserted into the input field, ready for you to edit or send.

### Showing the Discussion panel

If you close the Discussion tab, you can reopen it from **View > Show Discussion** in the menu.

---

## Tasks Panel

The **Tasks** panel provides a place to queue up work items, instructions, or notes that agents can retrieve via the REST API. It is located alongside the Discussion panel in the right-side dock.

### Adding a task

1. Type the task content in the input area at the bottom of the Tasks panel.
2. Press **Enter** to add (or click the **Add** button).
3. Use **Shift+Enter** to insert a newline without submitting.

Each task is assigned a unique 4-character ID (e.g. `AB12`, `KX07`) and a timestamp.

### Viewing tasks

Tasks are displayed in chronological order. Each task entry shows:

- **Task ID** — the unique short identifier
- **Timestamp** — when the task was created
- **Content** — the full task text

### Removing a task

Click the **x** button on any task entry to permanently delete it.

### Dragging tasks

Tasks are draggable. You can drag a task from the Tasks panel and drop it into the Discussion panel's broadcast input to populate the input with the task content. This is useful for sending a pre-written task as a broadcast to all agents.

### How agents access tasks

Agents can retrieve tasks via the REST API that Claude Team Session provides:

- **List all tasks:** `GET http://localhost:{port}/api/tasks`
- **Get a specific task:** `GET http://localhost:{port}/api/tasks/{TASK_ID}`

When you tell an agent to "check tasks" or reference a task by its ID, the agent will use these endpoints to retrieve the task content and act on it. The agents' configuration file includes instructions for task handling.

### Showing the Tasks panel

If you close the Tasks tab, you can reopen it from **View > Show Tasks** in the menu.

---

## Layout and Views

### Agent layout modes

Claude Team Session offers three layout modes for arranging agent panels. You can cycle through them using the layout toggle button in the top-right of the toolbar.

#### Side by Side

Agent terminals are arranged horizontally next to each other. Best when you want to monitor multiple agents simultaneously. The toolbar icon shows three horizontal lines.

#### Stacked

Agent terminals are arranged vertically, stacked on top of each other. Best when you want to see more horizontal terminal width per agent. The toolbar icon shows a vertical bar.

#### Tabbed

Agent terminals are arranged as tabs. Only one agent is visible at a time. Click a tab to switch between agents. This mode is best when you have many agents or limited screen space. The toolbar icon shows a grid symbol.

### Switching layout modes

- **Toolbar button:** Click the layout toggle button in the top-right corner of the toolbar to cycle through Side by Side, Stacked, and Tabbed modes.
- **Menu:** Use **View > Agent Layout** and select **Side by Side**, **Stacked**, or **Tabbed**.

### Dock panel (Discussion + Tasks)

The right side of the workspace contains a dock area with the **Discussion** and **Tasks** panels arranged as tabs. You can:

- Click tab headers to switch between Discussion and Tasks
- Drag the tab headers to rearrange them
- Close individual tabs using their close button
- Reopen closed tabs from **View > Show Discussion** or **View > Show Tasks**
- Drag tasks from the Tasks tab and drop them onto the Discussion tab header to auto-switch to Discussion before dropping into the input

### Splitter

The vertical **splitter bar** between the agent area and the dock panel can be dragged left or right to adjust the relative widths. The dock panel width is constrained between 15% and 60% of the window width.

### Resizing

- Agent panels in Side by Side and Stacked modes can be resized by dragging the GoldenLayout dividers between them.
- The window can be resized normally; all panels adjust automatically.

---

## Themes and Zoom

### Light and Dark themes

Claude Team Session supports both dark (default) and light themes. Toggle between them using:

- **Keyboard:** Press **Ctrl+T**
- **Menu:** Use **View > Toggle Light/Dark Theme**

The theme affects the entire application including terminal backgrounds, panel backgrounds, text colours, and agent colour swatches. Each agent colour has separate dark and light theme variants for optimal readability.

The selected theme is persisted across sessions.

### Terminal zoom

Adjust the font size of all agent terminals using:

- **Status bar dropdown:** Use the zoom percentage dropdown at the bottom of the agent panel area (beneath the terminals).
- **Ctrl+Mouse Wheel:** Hold Ctrl and scroll the mouse wheel over any agent terminal.

Available zoom levels: 75%, 85%, 100% (default), 115%, 130%, 150%. The base font size is 13px. All agent terminals share the same zoom level. The setting is persisted.

### Discussion zoom

Adjust the font size of the Discussion panel using:

- **Status bar dropdown:** Use the zoom percentage dropdown at the bottom of the Discussion panel.
- **Ctrl+Mouse Wheel:** Hold Ctrl and scroll the mouse wheel over the Discussion panel.

Available zoom levels: 75%, 85%, 100% (default), 115%, 130%, 150%. The base font size is 14px. The setting is persisted.

### Tasks zoom

Adjust the font size of the Tasks panel using:

- **Status bar dropdown:** Use the zoom percentage dropdown at the bottom of the Tasks panel.
- **Ctrl+Mouse Wheel:** Hold Ctrl and scroll the mouse wheel over the Tasks panel.

Available zoom levels: 75%, 85%, 100% (default), 115%, 130%, 150%. The base font size is 14px. The setting is persisted.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+N** | New Agent |
| **Ctrl+Shift+N** | New Session |
| **Ctrl+O** | Open Session |
| **Ctrl+S** | Save Session |
| **Ctrl+Shift+S** | Save Session As... |
| **Ctrl+T** | Toggle Light/Dark Theme |
| **Enter** | Send broadcast (when focused on broadcast input) or add task (when focused on task input) |
| **Shift+Enter** | New line in broadcast or task input |
| **Escape** | Close any open modal dialog |

---

## Menu Reference

### File

| Menu Item | Shortcut | Description |
|---|---|---|
| New Session | Ctrl+Shift+N | Close current session and create a new empty one |
| Open Session... | Ctrl+O | Browse for and open a `.cms` session file |
| Open Recent | | Submenu of recently accessed sessions (up to 15). Includes "Clear Recent Sessions" option |
| Save Session | Ctrl+S | Save the current session (prompts for a name if unsaved) |
| Save Session As... | Ctrl+Shift+S | Save the current session to a new file location |
| Close Session | | Close the current session (prompts to save if unsaved) |
| Quit | | Exit Claude Team Session |

### Agents

| Menu Item | Shortcut | Description |
|---|---|---|
| New Agent... | Ctrl+N | Open the New Agent dialog |
| Remove All Agents | | Terminate all running agents |

### View

| Menu Item | Shortcut | Description |
|---|---|---|
| Agent Layout > Side by Side | | Arrange agents horizontally |
| Agent Layout > Stacked | | Arrange agents vertically |
| Agent Layout > Tabbed | | Arrange agents as tabs |
| Show Discussion | | Open the Discussion panel if it was closed |
| Show Tasks | | Open the Tasks panel if it was closed |
| Toggle Light/Dark Theme | Ctrl+T | Switch between dark and light themes |

### Actions

| Menu Item | Description |
|---|---|
| Archive Discussion... | Open the archive dialog to export and/or clear discussion messages |
| Restore Archived Messages | Bring back all previously archived (cleared) messages |

### Settings

| Menu Item | Description |
|---|---|
| Rename Session... | Change the name of the current session |
| Clear All Settings | Reset all application settings (theme, zoom levels, etc.) to defaults |

### Help

| Menu Item | Description |
|---|---|
| About Claude Team Session | Show version and application information |

---

## Troubleshooting

### Claude Code does not launch in the agent terminal

- **Check that Git for Windows is installed.** Claude Team Session uses git-bash as the shell. It looks for bash.exe in standard Git installation paths (`C:\Program Files\Git\bin\bash.exe` and similar).
- **Set the GIT_BASH_PATH environment variable** if Git is installed in a non-standard location. Point it to the full path of `bash.exe`.
- **Ensure Claude Code is installed** and accessible from the command line. Open a regular terminal and type `claude` to verify.

### Agent shows "Process exited" immediately

- The agent's working directory may no longer exist. Try creating a new agent with a valid directory.
- There may be a permissions issue with the selected folder.

### Messages are not appearing in the Discussion panel

- Check the port number in the Discussion panel header. If it shows an error or a non-standard port, try clicking **Restart** to reset the messaging server.
- Ensure the "Auto-permissions" checkbox was enabled when creating agents. Without it, agents need manual permission approval in their terminal before they can send or receive messages via `curl`.

### Agents cannot communicate with each other

- All agents must be running in the same session to share the messaging server.
- Check that the messaging server port is accessible. The server runs on `localhost` only — it is not exposed to the network.
- If you unchecked "Auto-permissions" when creating an agent, you will need to manually approve `curl` commands in that agent's terminal when it tries to send or check messages.
- Try clicking the **Nudge** button on an agent's header to prompt it to check for messages.

### The application window is blank or does not load

- Try closing and relaunching the application.
- If using the portable version, ensure it has fully extracted before interacting with it.
- Check that your antivirus software is not blocking the application.

### Session file won't open

- Ensure the `.cms` file is not corrupted. Session files are SQLite databases — if the file is zero bytes or truncated, it cannot be recovered.
- Try creating a new session instead.

### Port conflict on startup

- The messaging server starts on port 3377 by default. If another application is using this port, Claude Team Session automatically finds the next available port.
- You can also manually change the port in the Discussion panel and click **Restart**.

### "Trust this folder" prompt

- When Claude Code launches in a new directory for the first time, it may ask you to trust the folder. Claude Team Session attempts to handle this automatically by sending `y` when a trust prompt is detected, but if it fails, click into the agent's terminal and type `y` followed by Enter.

### Agent not responding to broadcasts or tasks

- Click the **Nudge** button on the agent's header to ask it to check for messages.
- The agent may be busy with a long-running task. Wait for it to finish or check its terminal for a prompt.
- Verify the agent is still running (its tab should be visible and not showing "Process exited").

---

## Uninstalling

### Standard installation

1. Open **Windows Settings > Apps > Apps & Features** (or **Add or Remove Programs** on older Windows versions).
2. Find **Claude Team Session** in the list.
3. Click **Uninstall** and follow the prompts.

Session files (`.cms`) stored outside the installation directory are not removed automatically. Delete them manually if you no longer need them.

### Portable version

Simply delete the **Claude-Team-Session-Portable.exe** file. No other cleanup is needed.

### Removing application data

Claude Team Session stores settings and temporary session files in your AppData folder:

```
%APPDATA%\claude-session\
```

Delete this folder to remove all application data, settings, and unsaved sessions.
