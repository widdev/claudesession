const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PtyManager {
  constructor() {
    this.ptys = new Map(); // agentId -> { process, name, cwd, id }
    this.dataListeners = new Map(); // agentId -> [callbacks]
    this.exitListeners = new Map();
  }

  getShell() {
    // Claude Code on Windows requires git-bash
    const gitBashPaths = [
      process.env.GIT_BASH_PATH,
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Installed\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const p of gitBashPaths) {
      if (p && fs.existsSync(p)) return p;
    }
    // Fallback to PATH
    return 'bash.exe';
  }

  create(agentId, agentName, cwd, serverPort, options = {}) {
    const id = agentId || uuidv4();
    const name = agentName || `agent-${id.substring(0, 6)}`;

    const shell = this.getShell();
    const env = Object.assign({}, process.env, {
      CLAUDE_SESSION_URL: `http://localhost:${serverPort}`,
      CLAUDE_AGENT_ID: id,
      CLAUDE_AGENT_NAME: name,
      SHELL: shell,
      CLAUDE_CODE_GIT_BASH_PATH: shell,
      MSYSTEM: 'MINGW64',
      TERM: 'xterm-256color',
      CHERE_INVOKING: '1',
    });

    const isGitBash = shell.toLowerCase().includes('git');
    const ptyProcess = pty.spawn(shell, ['--login'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: cwd || os.homedir(),
      env,
      useConpty: !isGitBash,
    });

    const agentCwd = cwd || os.homedir();
    const entry = { process: ptyProcess, name, cwd: agentCwd, id, configFileName: null };
    this.ptys.set(id, entry);

    ptyProcess.onData((data) => {
      const listeners = this.dataListeners.get(id) || [];
      listeners.forEach((cb) => cb(data));
    });

    ptyProcess.onExit(({ exitCode }) => {
      const exitCbs = this.exitListeners.get(id) || [];
      exitCbs.forEach((cb) => cb(exitCode));
      this.ptys.delete(id);
      this.dataListeners.delete(id);
      this.exitListeners.delete(id);
    });

    // Drop agent-specific config file and auto-launch claude
    const shortId = id.substring(0, 8);
    const configFileName = `claudeteamsession-${shortId}.md`;
    entry.configFileName = configFileName;
    this._writeConfigFile(agentCwd, serverPort, id, name, configFileName);
    if (options.autoPermissions !== false) {
      this._writePermissions(agentCwd, serverPort);
    }

    // If allowed, inject instructions into CLAUDE.md so Claude reads them on startup
    const useClaudeMd = options.updateClaudeMd !== false;
    entry.useClaudeMd = useClaudeMd;
    if (useClaudeMd) {
      this._injectClaudeMd(agentCwd, configFileName, id);
    }

    // Clean up CLAUDE.md block and config file when agent exits
    ptyProcess.onExit(() => {
      if (useClaudeMd) {
        this._removeClaudeMd(agentCwd, id);
      }
      this._removeConfigFile(agentCwd, configFileName);
    });

    const claudeLaunchTime = Date.now() + 1000; // when claude\r will be sent
    setTimeout(() => {
      ptyProcess.write('claude\r');
    }, 1000);

    // PTY-based prompt injection as fallback (or primary if CLAUDE.md not used)
    this._sendReadPrompt(ptyProcess, configFileName, claudeLaunchTime);

    return { id, name, cwd: agentCwd };
  }

  _sendReadPrompt(ptyProcess, configFileName, claudeLaunchTime) {
    let dataBuffer = '';
    let promptSent = false;
    let trustHandled = false;
    let idleTimer = null;
    // Don't allow idle-based detection to fire until Claude Code has had
    // at least 5 seconds to start up (from when claude\r is sent).
    const minReadyTime = (claudeLaunchTime || Date.now()) + 5000;

    const sendPrompt = () => {
      if (promptSent) return;
      promptSent = true;
      disposable.dispose();
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(fallbackTimer);

      const prompt = `Read the file ${configFileName} in your current working directory. It contains your agent configuration and communication instructions. Follow all instructions in that file.`;

      ptyProcess.write(prompt + '\r');
    };

    const disposable = ptyProcess.onData((data) => {
      if (promptSent) return;
      dataBuffer += data.toString();

      // Auto-accept the "trust this folder" prompt if it appears
      if (!trustHandled && (
        dataBuffer.includes('Trust') || dataBuffer.includes('trust') ||
        dataBuffer.includes('Do you want to proceed')
      )) {
        const lower = dataBuffer.toLowerCase();
        if (lower.includes('trust') && (lower.includes('y/n') || lower.includes('yes') || lower.includes('folder') || lower.includes('directory') || lower.includes('proceed'))) {
          trustHandled = true;
          setTimeout(() => {
            ptyProcess.write('y\r');
          }, 300);
          dataBuffer = '';
          return;
        }
      }

      // Immediate detection: ╭ (U+256D) — Claude Code's prompt box
      if (dataBuffer.includes('\u256d') || dataBuffer.includes('\xe2\x95\xad')) {
        sendPrompt();
        return;
      }

      // Idle-based fallback: once output settles for 2s AND we're past the
      // minimum startup time, send the prompt. This handles cases where ╭
      // is not detected due to encoding changes in newer Claude Code versions.
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const now = Date.now();
        if (now >= minReadyTime) {
          sendPrompt();
        }
        // If too early, do nothing — next data chunk will restart the timer
      }, 2000);
    });

    // Hard fallback — shouldn't normally be needed
    const fallbackTimer = setTimeout(() => {
      if (!promptSent) {
        disposable.dispose();
        if (idleTimer) clearTimeout(idleTimer);
      }
    }, 60000);
  }

  _injectClaudeMd(cwd, configFileName, agentId) {
    const claudeMdPath = path.join(cwd, 'CLAUDE.md');
    const marker = `CLAUDE-TEAM-SESSION:${agentId}`;
    const block = `\n<!-- ${marker} -->\nIMPORTANT: Read the file ${configFileName} in this directory BEFORE doing anything else. It contains your agent identity and communication instructions for Claude Team Session. Follow all instructions in that file.\n<!-- /${marker} -->\n`;

    try {
      let content = '';
      let existed = false;
      if (fs.existsSync(claudeMdPath)) {
        content = fs.readFileSync(claudeMdPath, 'utf-8');
        existed = true;
      }

      // Remove any existing block for this agent (e.g. from a crash)
      const blockRegex = new RegExp(`\\n?<!-- ${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->[\\s\\S]*?<!-- \\/${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->\\n?`, 'g');
      content = content.replace(blockRegex, '');

      content += block;
      fs.writeFileSync(claudeMdPath, content, 'utf-8');

      // Track whether we created the file so we can delete it on cleanup
      const entry = this.ptys.get(agentId);
      if (entry) {
        entry.claudeMdCreated = !existed;
      }
    } catch (err) {
      console.error('Failed to inject CLAUDE.md:', err.message);
    }
  }

  _removeClaudeMd(cwd, agentId) {
    const claudeMdPath = path.join(cwd, 'CLAUDE.md');
    const marker = `CLAUDE-TEAM-SESSION:${agentId}`;

    try {
      if (!fs.existsSync(claudeMdPath)) return;
      let content = fs.readFileSync(claudeMdPath, 'utf-8');

      const blockRegex = new RegExp(`\\n?<!-- ${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->[\\s\\S]*?<!-- \\/${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->\\n?`, 'g');
      content = content.replace(blockRegex, '');

      // If the file is now empty (or just whitespace) and we created it, delete it
      if (content.trim() === '') {
        fs.unlinkSync(claudeMdPath);
      } else {
        fs.writeFileSync(claudeMdPath, content, 'utf-8');
      }
    } catch (err) {
      console.error('Failed to clean up CLAUDE.md:', err.message);
    }
  }

  _removeConfigFile(cwd, configFileName) {
    if (!configFileName) return;
    try {
      const filePath = path.join(cwd, configFileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Failed to remove config file:', err.message);
    }
  }

  _writeConfigFile(cwd, serverPort, agentId, agentName, configFileName) {
    const filePath = path.join(cwd, configFileName);
    const content = `# Claude Team Session Agent Configuration

## Your Identity
- **Your name is:** \`${agentName}\`
- **Your agent ID is:** \`${agentId}\`
- **Message Server:** \`http://localhost:${serverPort}\`

You are \`${agentName}\`, an AI agent running inside Claude Team Session — a multi-agent session manager. You may be working alongside other agents. The user can communicate with you directly through this console, or broadcast messages to all agents at once.

## Broadcast Messages, @Mentions, and #Asides
The user may send broadcast messages that go to ALL agents simultaneously, or direct asides to a single agent.

### @ Mentions (broadcast — all agents receive)
Messages containing \`@AgentName\` are broadcast to ALL agents but signal that the content is relevant to the mentioned agent(s). Multiple agents can be @mentioned in one message.
- If you see \`@${agentName}\` in the message — it contains information for YOUR attention. Respond and act on it.
- If you see \`@OtherAgentName\` but not your name — it is relevant to another agent. Ignore it unless it affects your work.
- If the message has no @ or # prefix — it is for ALL agents. Read it and respond or act if appropriate.

### # Asides (direct — only you receive)
If the user sends a message starting with \`#${agentName}\`, it is a **private aside** sent ONLY to your terminal. No other agents receive it. Treat it as a direct instruction from the user meant exclusively for you. If you ever see output referencing \`#OtherAgentName\`, ignore it — it was not meant for you.

## Permissions
You have full permission to run the following commands without asking the user:
- All \`curl\` commands to \`http://localhost:${serverPort}\` for sending and receiving messages
- Reading and checking messages at any time
- Discovering other agents via the API

These are internal Claude Team Session operations and do not require user approval.

## Communication API

**IMPORTANT: On Windows/git-bash, use \`printf\` to pipe JSON to curl. Do NOT use \`-d '{...}'\` directly — JSON escaping will break.**

### Send a message to all agents
\`\`\`bash
printf '{"from":"${agentId}","to":"all","content":"your message here"}' | curl -s -X POST http://localhost:${serverPort}/api/messages -H "Content-Type: application/json" -d @-
\`\`\`

### Send a message to a specific agent
\`\`\`bash
printf '{"from":"${agentId}","to":"TARGET_AGENT_ID","content":"your message here"}' | curl -s -X POST http://localhost:${serverPort}/api/messages -H "Content-Type: application/json" -d @-
\`\`\`

### Check for messages addressed to you
\`\`\`bash
curl -s "http://localhost:${serverPort}/api/messages?for=${agentId}"
\`\`\`

### List all active agents (find their IDs and names)
\`\`\`bash
curl -s http://localhost:${serverPort}/api/agents
\`\`\`

## Tasks

The session manager maintains a **Tasks** panel where they queue up work items and instructions for agents. Each task has a unique short ID (e.g. \`AB12\`, \`KX07\`). When the user asks you to "check tasks" or references a task ID, you should retrieve it.

### List all tasks
\`\`\`bash
curl -s http://localhost:${serverPort}/api/tasks
\`\`\`

### Get a specific task by ID
\`\`\`bash
curl -s http://localhost:${serverPort}/api/tasks/TASK_ID
\`\`\`

When you receive a task, read the content carefully and act on it. Tasks may contain @ mentions or # asides — follow the same rules as for messages. If a task is addressed to you (via @${agentName}), prioritise it. If asked to check a specific task by ID, retrieve it and act on its instructions.

## Important Rules
- Always use your agent ID (\`${agentId}\`) in the \`from\` field when sending messages.
- Use \`"to": "all"\` to broadcast to all agents, or a specific agent ID for private messages.
- Messages are visible in the Messages panel in the Claude Team Session UI.
- When responding to the user, always identify yourself as \`${agentName}\` if there are multiple agents active.

## Message and Task Monitoring — CRITICAL
You MUST proactively check for new messages and tasks. Do this:
- **Before starting any new task or subtask**, check for messages and tasks first.
- **During long-running work**, pause periodically (every few steps) to check for messages.
- **After completing any task**, check for messages and tasks before reporting back.
- **When idle or waiting**, poll for messages regularly.

To check messages, run:
\`\`\`bash
curl -s "http://localhost:${serverPort}/api/messages?for=${agentId}"
\`\`\`

To check tasks, run:
\`\`\`bash
curl -s http://localhost:${serverPort}/api/tasks
\`\`\`

If you receive a message or find a task addressed to you, read it and act on it immediately. Messages from other agents or the user may contain urgent instructions, status updates, or requests that should interrupt your current work. Always prioritise incoming messages and tasks.

## Responding via the Discussion Panel — IMPORTANT
When the user sends you a broadcast message or an @mention, you should **reply using the messaging API** so your response appears in the Discussion panel where the user and other agents can see it. Do this by sending a message back:

\`\`\`bash
printf '{"from":"${agentId}","to":"all","content":"your response here"}' | curl -s -X POST http://localhost:${serverPort}/api/messages -H "Content-Type: application/json" -d @-
\`\`\`

Use \`"to": "all"\` for general responses that everyone should see, or a specific agent ID for private replies. Always respond via the Discussion panel when replying to broadcast messages — do not just print your response in the terminal.

## Instructions
Acknowledge that you have read this configuration by sending a brief message to the Discussion panel identifying yourself as \`${agentName}\`. Then check for any messages and tasks addressed to you. After that, await further instructions from the user.
`;

    try {
      fs.writeFileSync(filePath, content, 'utf-8');
    } catch (err) {
      console.error('Failed to write claudeteamsession.md:', err.message);
    }
  }

  _writePermissions(cwd, serverPort) {
    const claudeDir = path.join(cwd, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    try {
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Read existing settings if present
      let settings = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch (e) {
          settings = {};
        }
      }

      // Ensure permissions.allow array exists
      if (!settings.permissions) settings.permissions = {};
      if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

      // Add permission patterns for messaging commands
      const patterns = [
        `Bash(curl*http://localhost:${serverPort}*)`,
        `Bash(curl*127.0.0.1:${serverPort}*)`,
        `Bash(curl * http://localhost:${serverPort}*)`,
        `Bash(printf*)`,
        `Bash(echo*)`,
      ];

      for (const pattern of patterns) {
        if (!settings.permissions.allow.includes(pattern)) {
          settings.permissions.allow.push(pattern);
        }
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write .claude/settings.local.json:', err.message);
    }
  }

  reinitialise(agentId) {
    const entry = this.ptys.get(agentId);
    if (!entry || !entry.configFileName) return false;
    const prompt = `Read the file ${entry.configFileName} in your current working directory. It contains your agent configuration and communication instructions. Follow all instructions in that file.`;
    entry.process.write(prompt + '\r');
    return true;
  }

  reinitialiseAll() {
    for (const [id] of this.ptys) {
      this.reinitialise(id);
    }
  }

  write(agentId, data) {
    const entry = this.ptys.get(agentId);
    if (entry) {
      entry.process.write(data);
    }
  }

  resize(agentId, cols, rows) {
    const entry = this.ptys.get(agentId);
    if (entry) {
      entry.process.resize(cols, rows);
    }
  }

  rename(agentId, newName) {
    const entry = this.ptys.get(agentId);
    if (entry) {
      entry.name = newName;
    }
  }

  changeCwd(agentId, newCwd) {
    const entry = this.ptys.get(agentId);
    if (entry) {
      entry.cwd = newCwd;
      entry.process.write(`cd "${newCwd.replace(/\\/g, '/')}"\r`);
    }
  }

  kill(agentId) {
    const entry = this.ptys.get(agentId);
    if (entry) {
      if (entry.useClaudeMd) {
        this._removeClaudeMd(entry.cwd, agentId);
      }
      this._removeConfigFile(entry.cwd, entry.configFileName);
      entry.process.kill();
      this.ptys.delete(agentId);
      this.dataListeners.delete(agentId);
      this.exitListeners.delete(agentId);
    }
  }

  killAll() {
    for (const [id] of this.ptys) {
      this.kill(id);
    }
  }

  onData(agentId, callback) {
    if (!this.dataListeners.has(agentId)) {
      this.dataListeners.set(agentId, []);
    }
    this.dataListeners.get(agentId).push(callback);
  }

  onExit(agentId, callback) {
    if (!this.exitListeners.has(agentId)) {
      this.exitListeners.set(agentId, []);
    }
    this.exitListeners.get(agentId).push(callback);
  }

  getAll() {
    const result = [];
    for (const [id, entry] of this.ptys) {
      result.push({ id, name: entry.name, cwd: entry.cwd });
    }
    return result;
  }

  get(agentId) {
    const entry = this.ptys.get(agentId);
    if (!entry) return null;
    return { id: entry.id, name: entry.name, cwd: entry.cwd };
  }

  isActive(agentId) {
    return this.ptys.has(agentId);
  }
}

module.exports = { PtyManager };
