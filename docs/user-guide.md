# ClaudeSession User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [System Requirements](#system-requirements)
3. [Installation](#installation)
4. [Getting Started](#getting-started)
5. [Sessions](#sessions)
6. [Agents](#agents)
7. [Session Comms](#session-comms)
8. [Broadcast Input](#broadcast-input)
9. [Layout and Views](#layout-and-views)
10. [Keyboard Shortcuts](#keyboard-shortcuts)
11. [Menu Reference](#menu-reference)
12. [Troubleshooting](#troubleshooting)
13. [Uninstalling](#uninstalling)

---

## Introduction

ClaudeSession is a desktop application for Windows that lets you run multiple Claude Code sessions side by side with built-in inter-agent messaging. Each session can contain multiple **agents** — independent Claude Code instances, each with their own terminal, working directory, and identity. Agents can communicate with each other through a shared messaging system called **Session Comms**, and you can broadcast instructions to all agents at once.

This is useful for coordinating multi-agent workflows such as:

- Having one agent write code while another reviews it
- Splitting a large task across agents working in different repositories
- Running a "supervisor" agent that delegates subtasks to worker agents
- Pair-programming with multiple AI assistants simultaneously

---

## System Requirements

- **Operating system:** Windows 10 or later (64-bit)
- **Git for Windows:** Required (includes git-bash, which ClaudeSession uses as the shell)
- **Node.js:** Required (Claude Code depends on it)
- **Claude Code:** Required (each agent launches Claude Code automatically)
- **Anthropic API key or Claude subscription:** Required for Claude Code to function
- **Disk space:** Approximately 200 MB for ClaudeSession, plus space for the prerequisites above

---

## Installation

Before installing ClaudeSession itself, you need to install its prerequisites. If you already have any of these installed, skip that step.

### Step 1: Install Git for Windows

ClaudeSession uses git-bash (included with Git for Windows) as the shell environment for all agents. Claude Code also requires git-bash on Windows.

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

**Non-standard install path:** If you install Git to a location other than `C:\Program Files\Git`, set the environment variable `GIT_BASH_PATH` to the full path of `bash.exe` (e.g. `D:\Tools\Git\bin\bash.exe`). ClaudeSession checks the following paths automatically:
- `C:\Program Files\Git\bin\bash.exe`
- `C:\Program Files\Installed\Git\bin\bash.exe`
- `C:\Program Files (x86)\Git\bin\bash.exe`

### Step 2: Install Node.js

Claude Code is a Node.js application, so Node.js must be installed on your system.

1. Download the LTS installer from [https://nodejs.org](https://nodejs.org). Choose the **Windows Installer (.msi)** for 64-bit.
2. Run the installer. Accept the default settings.
3. When the installer offers to **"Automatically install the necessary tools"** (native module build tools), you can skip this — it is not required for ClaudeSession.
4. To verify, open a new Command Prompt or PowerShell and run:
   ```
   node --version
   npm --version
   ```
   You should see version numbers for both.

### Step 3: Install Claude Code

Claude Code is Anthropic's CLI for Claude. ClaudeSession launches it inside each agent terminal.

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

### Step 4: Install ClaudeSession

ClaudeSession is distributed in two formats. You only need one.

#### Standard Installer (recommended)

1. Run **ClaudeSession Setup x.x.x.exe**.
2. Follow the on-screen prompts. You can choose the installation directory.
3. A desktop shortcut and Start Menu entry will be created automatically.
4. Launch ClaudeSession from the desktop shortcut or Start Menu.

#### Portable Version

1. Run **ClaudeSession-Portable.exe** from any location (desktop, USB drive, etc.).
2. The application extracts to a temporary folder and launches immediately.
3. No installation is required and no files are written to your system permanently.

---

## Getting Started

When you first launch ClaudeSession, you will see a welcome screen with two options:

- **Create New Session** — starts a fresh session
- **Open Existing Session** — opens a previously saved `.cms` session file

### Creating your first session

1. Click **Create New Session**. The main workspace opens with an empty agent area.
2. Click **+ New Agent** in the toolbar (or press **Ctrl+N**) to add your first agent.
3. In the New Agent dialog:
   - **Name** — give your agent a descriptive name (e.g. "Coder", "Reviewer", "Agent 1"). Defaults to "Agent 1", "Agent 2", etc.
   - **Colour** — pick a colour to visually distinguish this agent from others. The colour is used on the agent header, tab border, and messages.
   - **Working Directory** — click **Select** to choose the folder this agent will work in. This is required.
   - **Auto-permissions** — leave checked (recommended) to allow agents to use the messaging API without manual approval. Uncheck if you want full control over what each agent can execute.
4. Click **Create**. A terminal opens with Claude Code launching inside it.
5. After a few seconds, Claude Code starts and automatically reads its agent configuration. The agent will identify itself and begin listening for instructions.

You can now type directly into the agent's terminal to interact with it, or use the **Broadcast Input** at the bottom of the Session Comms panel to send messages to all agents at once.

### Adding more agents

Repeat the process above to add additional agents. Each agent gets its own terminal panel. You can have as many agents as you need running simultaneously.

---

## Sessions

A session stores all of your agents and their message history in a single `.cms` file. Sessions allow you to save your work and pick up where you left off.

### Session lifecycle

- **New sessions** are created as temporary files. They are stored in your AppData folder and named with a timestamp (e.g. `temp20260331_1430.cms`).
- **Saving a session** promotes a temporary session to a named file at a location you choose. Use **File > Save Session** (Ctrl+S) to save.
- **Opening a session** restores all agents and message history. The agents are relaunched in their original working directories. Use **File > Open Session** (Ctrl+O).
- **Closing a session** terminates all agents. If the session is unsaved, you are prompted to save, discard, or cancel.

### Auto-restore

When you close ClaudeSession with a saved session open, it automatically reopens that session the next time you launch the application.

### Recent sessions

Access recently used sessions from **File > Open Recent** in the menu bar. Up to 15 recent sessions are shown. You can clear temporary (unsaved) sessions from this list using the **Clear Recent Sessions** option.

---

## Agents

An agent is an individual Claude Code instance running in its own terminal. Each agent has:

- **Name** — a human-readable label (e.g. "Coder", "Reviewer")
- **Colour** — a visual identifier used throughout the UI
- **Working directory** — the folder the agent operates in
- **Unique ID** — an internal identifier used for messaging

### Agent header

Each agent panel has a header bar showing:

- The agent's **name** in its assigned colour
- The **working directory** path
- A **...** button to change the working directory
- A **x** button to close (terminate) the agent

### Creating an agent

Click **+ New Agent** in the toolbar or use **Agents > New Agent** (Ctrl+N) from the menu. Fill in the name, colour, and working directory in the dialog.

### Restoring a previous agent

When you click the **+ New Agent** dropdown arrow, a list of **Recent Agents** appears below the "New..." option. These are agents from your current session that were previously closed or from a restored session. Click one to relaunch it with the same name, ID, and working directory.

### Removing an agent

- **Side-by-side mode:** Click the **x** button on the agent's header bar.
- **Tabbed mode:** Click the **x** on the agent's tab, or use the header close button.
- **All agents:** Use **Agents > Remove All Agents** from the menu to terminate every running agent.

Closing an agent terminates its Claude Code process. The agent's message history is preserved in the session.

### Changing the working directory

Click the **...** button next to the directory path in the agent header. A folder picker dialog opens. After selecting a new folder, the agent's shell changes to that directory.

### Attention indicator

When an agent is waiting for your input (e.g. Claude Code is asking a question, a prompt is waiting, or a yes/no confirmation is needed), an attention indicator appears:

- An **!** badge on the agent's header
- A flashing indicator on the agent's tab (in tabbed mode)

The attention indicator clears automatically when you click on or interact with that agent.

---

## Session Comms

The **Session Comms** panel is a sidebar on the right side of the window. It displays all messages exchanged between agents and shows your broadcast messages.

### Viewing messages

Each message entry shows:

- **Sender** name (coloured to match the agent)
- **Recipient** (a specific agent name, or "all" for broadcasts)
- **Timestamp**
- **Message content**

Messages are displayed in chronological order and auto-scroll to the latest entry.

### Removing messages

Click the **x** button on any individual message to remove it from the log. Use the **Clear** button in the panel header to remove all messages.

### Port configuration

At the top of the Session Comms panel, the **Port** field shows which port the internal messaging server is running on (default: 3377). If you need to change it (e.g. due to a port conflict), enter a new port number and click **Restart**. Valid ports range from 1024 to 65535.

### Showing and hiding

- Click the **Show Comms** button in the toolbar, or press **Ctrl+M**
- Use **View > Close Session Comms / Show Session Comms** from the menu
- Click the **x** button in the Session Comms panel header

The panel is resizable — drag the splitter bar between the agent area and the comms panel to adjust the width.

---

## Broadcast Input

The broadcast input is a text area at the bottom of the Session Comms panel. Text entered here is sent directly into the terminal of **every active agent** simultaneously.

### Sending a broadcast

1. Type your message in the broadcast input area.
2. Press **Enter** to send (or click the **Send** button).
3. Use **Shift+Enter** to insert a newline without sending.

The broadcast appears in the Session Comms panel as a message from "You" to "All Agents".

### @Mentions

When broadcasting, you can direct a message to a specific agent by prefixing it with `@AgentName`. All agents receive the broadcast, but each agent is configured to:

- **Act on** messages addressed to them (e.g. `@Coder please fix the bug`)
- **Ignore** messages addressed to other agents (e.g. `@Reviewer check the PR`)
- **Respond to** messages with no @mention prefix (general broadcasts)

### Input history

The broadcast input supports command history:

- **Up arrow** (when cursor is at the start) — recall the previous broadcast
- **Down arrow** (when cursor is at the end) — move forward through history

---

## Layout and Views

ClaudeSession offers two layout modes for arranging agent panels:

### Side-by-side mode (default)

Agent terminals are arranged horizontally next to each other. Each agent has its own visible panel with a header and close button. This mode is best when you want to monitor multiple agents simultaneously.

### Tabbed mode

Agent terminals are arranged as tabs, similar to browser tabs. Only one agent is visible at a time. Click a tab to switch between agents. A **+** button appears after the last tab to quickly add a new agent. This mode is best when you have many agents or limited screen space.

### Switching modes

- Click the layout toggle button in the toolbar (between the session label and the Show Comms button)
- Use **View > Agent Layout > Side by Side** or **View > Agent Layout > Tabbed** from the menu

### Showing/hiding panels

- **Agent consoles:** Use **View > Hide Agent Consoles / Show Agent Consoles** from the menu. When hidden, a "Show Agents" button appears in the toolbar.
- **Session Comms:** Use the **Show Comms** button, **Ctrl+M**, or the View menu.

### Resizing

- Drag the **splitter bar** between the agent area and Session Comms panel to adjust panel widths.
- Agent panels in side-by-side mode can be resized by dragging the dividers between them (GoldenLayout drag handles).
- The window can be resized normally; all panels adjust automatically.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+N** | New Agent |
| **Ctrl+Shift+N** | New Session |
| **Ctrl+O** | Open Session |
| **Ctrl+S** | Save Session |
| **Ctrl+M** | Toggle Session Comms panel |
| **Enter** | Send broadcast (when focused on broadcast input) |
| **Shift+Enter** | New line in broadcast input |
| **Up/Down arrows** | Navigate broadcast history (in broadcast input) |
| **Escape** | Close the New Agent dialog |

---

## Menu Reference

### File

| Menu Item | Description |
|---|---|
| New Session | Close current session and create a new empty one |
| Open Session... | Browse for and open a `.cms` session file |
| Open Recent | Submenu of recently accessed sessions |
| Save Session | Save the current session to a named `.cms` file |
| Close Session | Close the current session (prompts to save if unsaved) |
| Quit | Exit ClaudeSession |

### Agents

| Menu Item | Description |
|---|---|
| New Agent... | Open the New Agent dialog |
| Remove All Agents | Terminate all running agents |

### View

| Menu Item | Description |
|---|---|
| Agent Layout > Side by Side | Arrange agents horizontally |
| Agent Layout > Tabbed | Arrange agents as tabs |
| Hide/Show Agent Consoles | Toggle visibility of the agent panel area |
| Close/Show Session Comms | Toggle visibility of the messaging sidebar |

### Settings

| Menu Item | Description |
|---|---|
| Clear All Settings | Reset all application settings to defaults |

### Help

| Menu Item | Description |
|---|---|
| About ClaudeSession | Show version and application information |

---

## Troubleshooting

### Claude Code does not launch in the agent terminal

- **Check that Git for Windows is installed.** ClaudeSession uses git-bash as the shell. It looks for bash.exe in standard Git installation paths (`C:\Program Files\Git\bin\bash.exe` and similar).
- **Set the GIT_BASH_PATH environment variable** if Git is installed in a non-standard location. Point it to the full path of `bash.exe`.
- **Ensure Claude Code is installed** and accessible from the command line. Open a regular terminal and type `claude` to verify.

### Agent shows "Process exited" immediately

- The agent's working directory may no longer exist. Try creating a new agent with a valid directory.
- There may be a permissions issue with the selected folder.

### Messages are not appearing in Session Comms

- Check the port number in the Session Comms panel. If it shows an error or a non-standard port, try clicking **Restart** to reset the messaging server.
- Ensure the "Auto-permissions" checkbox was enabled when creating agents. Without it, agents need manual permission approval in their terminal before they can send or receive messages via `curl`.

### Agents cannot communicate with each other

- All agents must be running in the same session to share the messaging server.
- Check that the messaging server port is accessible. The server runs on `localhost` only — it is not exposed to the network.
- If you unchecked "Auto-permissions" when creating an agent, you will need to manually approve `curl` commands in that agent's terminal when it tries to send or check messages.

### The application window is blank or does not load

- Try closing and relaunching the application.
- If using the portable version, ensure it has fully extracted before interacting with it.
- Check that your antivirus software is not blocking the application.

### Session file won't open

- Ensure the `.cms` file is not corrupted. Session files are SQLite databases — if the file is zero bytes or truncated, it cannot be recovered.
- Try creating a new session instead.

### Port conflict on startup

- The messaging server starts on port 3377 by default. If another application is using this port, ClaudeSession automatically finds the next available port.
- You can also manually change the port in the Session Comms panel and click **Restart**.

### "Trust this folder" prompt

- When Claude Code launches in a new directory for the first time, it may ask you to trust the folder. ClaudeSession attempts to handle this automatically, but if it fails, click into the agent's terminal and type `y` followed by Enter.

---

## Uninstalling

### Standard installation

1. Open **Windows Settings > Apps > Apps & Features** (or **Add or Remove Programs** on older Windows versions).
2. Find **ClaudeSession** in the list.
3. Click **Uninstall** and follow the prompts.

Session files (`.cms`) stored outside the installation directory are not removed automatically. Delete them manually if you no longer need them.

### Portable version

Simply delete the **ClaudeSession-Portable.exe** file. No other cleanup is needed.

### Removing application data

ClaudeSession stores settings and temporary session files in your AppData folder:

```
%APPDATA%\claude-session\
```

Delete this folder to remove all application data, settings, and unsaved sessions.
