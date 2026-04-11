const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Filter modes for message delivery
const FILTER_MODES = {
  LISTEN_ALL: 'listenAll',     // Receives all broadcasts + targeted messages
  NAMED_ONLY: 'namedOnly',    // Only receives messages targeting this agent (future)
  EXCLUDE: 'exclude',          // Receives nothing
};

class PtyManager {
  constructor() {
    this.ptys = new Map(); // agentId -> { process, name, cwd, id, filterMode, ... }
    this.dataListeners = new Map(); // agentId -> [callbacks]
    this.exitListeners = new Map();
    this.messageCallback = null; // set by message-server for >>DISCUSS: relay
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
    const entry = { process: ptyProcess, name, cwd: agentCwd, id, configFileName: null, filterMode: FILTER_MODES.LISTEN_ALL, discussBuffer: '' };
    this.ptys.set(id, entry);

    ptyProcess.onData((data) => {
      const listeners = this.dataListeners.get(id) || [];
      listeners.forEach((cb) => cb(data));
      this._detectDiscussReply(id, data);
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

You are \`${agentName}\`, an AI agent running inside Claude Team Session — a multi-agent session manager. You may be working alongside other agents. The user can communicate with you directly through this console, or broadcast messages to all agents at once.

## How Messages Work — IMPORTANT

Messages are **delivered directly to your terminal** by the session manager. You do NOT need to poll, curl, or check for messages — they will appear automatically in your terminal output, formatted like this:

**Action message (act on it):**
\`\`\`
━━━ Message from User ━━━
Fix the login bug
━━━━━━━━━━━━━━━━━━━━━━━━━
\`\`\`

**Info message (awareness only, do NOT act):**
\`\`\`
━━━ Info from User (to @OtherAgent) ━━━
Fix the login bug
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\`\`\`

When you see a **Message**, read it and act on the instructions. When you see **Info**, it is for your awareness only — do NOT act on it and do NOT relay or summarize it to the target agent. The target agent has already received it directly.

## How to Reply — IMPORTANT

To send a message to the Discussion panel, simply **include the >>DISCUSS: prefix in any output**. Any text you write to the terminal containing \`>>DISCUSS:\` will be automatically detected and sent to the Discussion panel. You can include it in your normal response text — no need for special commands.

**Broadcast to everyone:**
Just include \`>>DISCUSS: your message here\` anywhere in your response.

**Direct a message to a specific agent (all agents see it, target is called to action):**
\`>>DISCUSS @AgentName: your message here\`

**Direct to the user (only appears in Discussion panel, not sent to agents):**
\`>>DISCUSS @User: your message here\`

**Private aside to one or more agents (only they see it):**
\`>>DISCUSS #AgentName: your message here\`

**Multiple targets:**
\`>>DISCUSS @Agent1 @Agent2: coordinate on this\`
\`>>DISCUSS #Agent1 #Agent2: private coordination\`

Use \`@\` and \`#\` targeting to reduce noise. Do NOT broadcast when a targeted message will do — this saves tokens for all agents.

## Message Conventions

- **No prefix** = broadcast to all agents, everyone should read and act if relevant
- **@AgentName** = call to action for that agent; others see it as info only
- **#AgentName** = private aside; ONLY that agent receives it
- **@User** = directed to the user only; no agents receive it
- Multiple agents can be targeted: \`@Agent1 @Agent2\` or \`#Agent1 #Agent2\`

## Critical Rules for Info Messages

When you receive an **Info** message (one marked "Info from X (to @SomeoneElse)"):
1. **Do NOT act on it** — it is for your awareness only
2. **Do NOT relay or summarize it** to the target agent — they already received it directly
3. **Do NOT respond** to it unless it directly affects your current work
4. Relaying info messages wastes tokens and creates noise

## Tasks

The session manager maintains a **Tasks** panel with work items. Each task has a unique short ID (e.g. \`AB12\`). To check tasks:

\`\`\`bash
curl -s http://localhost:${serverPort}/api/tasks
\`\`\`

\`\`\`bash
curl -s http://localhost:${serverPort}/api/tasks/TASK_ID
\`\`\`

## Work Items (Azure DevOps)

The session may have imported work items. To check them:

\`\`\`bash
curl -s http://localhost:${serverPort}/api/workitems
\`\`\`

\`\`\`bash
curl -s http://localhost:${serverPort}/api/workitems/WORK_ITEM_ID
\`\`\`

## Permissions

You have full permission to:
- Include \`>>DISCUSS: ...\` in your responses to send messages to the Discussion panel
- Run \`curl\` commands to \`http://localhost:${serverPort}\`
- Read and run work items returned from the API

## Instructions
Acknowledge that you have read this configuration by sending a brief message to the Discussion panel identifying yourself. Simply include in your response:

\`>>DISCUSS: ${agentName} ready.\`

Then await further instructions from the user. Messages will be delivered to your terminal automatically.
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

  // ─── Message Relay System ──────────────────────────────────────────

  /**
   * Set a callback for when an agent sends a >>DISCUSS: message.
   * Called by message-server to wire up the relay.
   */
  onDiscussMessage(callback) {
    this.messageCallback = callback;
  }

  setFilterMode(agentId, mode) {
    const entry = this.ptys.get(agentId);
    if (entry) entry.filterMode = mode;
  }

  getFilterMode(agentId) {
    const entry = this.ptys.get(agentId);
    return entry ? entry.filterMode : null;
  }

  /**
   * Route an incoming message to all relevant agent PTYs.
   * Called by message-server after a message is saved.
   *
   * @param {object} msg - { from, to, content, fromName }
   */
  routeMessage(msg) {
    const { from, to, content, fromName } = msg;

    // Parse @ mentions and # asides from the content
    const parsed = this._parseMessageTargets(content);

    for (const [agentId, entry] of this.ptys) {
      // Never echo back to sender
      if (agentId === from) continue;

      // Excluded agents get nothing
      if (entry.filterMode === FILTER_MODES.EXCLUDE) continue;

      // @User messages go to panel only, not agents
      if (parsed.type === 'mention' && parsed.targets.length === 1 && parsed.targets[0] === 'user') continue;

      const agentNameLower = entry.name.toLowerCase();

      if (parsed.type === 'aside') {
        // # aside — only deliver to named agents
        if (!parsed.targets.includes(agentNameLower)) continue;
        this._injectMessage(entry, fromName || from, content, parsed.cleanContent, 'action');
      } else if (parsed.type === 'mention') {
        // @ mention — deliver to all, but action vs info
        const isTarget = parsed.targets.includes(agentNameLower);
        // If all targets are @User, skip agents entirely (handled above)
        const hasNonUserTargets = parsed.targets.some(t => t !== 'user');
        if (!hasNonUserTargets) continue;
        this._injectMessage(entry, fromName || from, content, parsed.cleanContent, isTarget ? 'action' : 'info', parsed.targetDisplay);
      } else {
        // Plain broadcast — action for everyone
        this._injectMessage(entry, fromName || from, content, parsed.cleanContent, 'action');
      }
    }
  }

  /**
   * Parse message content for @ mentions and # asides.
   * Returns { type: 'plain'|'mention'|'aside', targets: string[], cleanContent: string, targetDisplay: string }
   */
  _parseMessageTargets(content) {
    const trimmed = content.trim();

    // Check for # asides: #Agent1 #Agent2 or #Agent1/#Agent2 at the start
    // Match patterns like: #Name, #Name1 #Name2, #Name1/#Name2
    const asideMatch = trimmed.match(/^(?:#(\w[\w\s]*?)(?:\s*[/#]\s*#?(\w[\w\s]*?))*)\s+([\s\S]+)$/);
    if (asideMatch && trimmed.startsWith('#')) {
      // Extract all # targets from the prefix
      const prefixEnd = trimmed.indexOf(asideMatch[asideMatch.length - 1]);
      const prefix = trimmed.substring(0, prefixEnd).trim();
      const targets = prefix.split(/[/#]+/).map(t => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean);
      const cleanContent = asideMatch[asideMatch.length - 1].trim();
      return { type: 'aside', targets, cleanContent, targetDisplay: targets.map(t => '#' + t).join(' ') };
    }

    // Check for @ mentions: @Agent1 @Agent2 at the start
    const mentionRegex = /^((?:@\w[\w\s]*?\s*)+)([\s\S]+)$/;
    const mentionMatch = trimmed.match(mentionRegex);
    if (mentionMatch) {
      const prefix = mentionMatch[1].trim();
      const targets = prefix.split(/\s*@/).map(t => t.trim().toLowerCase()).filter(Boolean);
      const cleanContent = mentionMatch[2].trim();
      return { type: 'mention', targets, cleanContent, targetDisplay: targets.map(t => '@' + t).join(' ') };
    }

    // Plain broadcast
    return { type: 'plain', targets: [], cleanContent: trimmed, targetDisplay: '' };
  }

  /**
   * Inject a formatted message into an agent's PTY.
   * @param {object} entry - PTY entry
   * @param {string} fromName - sender display name
   * @param {string} rawContent - original message content
   * @param {string} cleanContent - message with prefixes stripped
   * @param {string} mode - 'action' or 'info'
   * @param {string} targetDisplay - e.g. '@Api @Client' for info headers
   */
  _injectMessage(entry, fromName, rawContent, cleanContent, mode, targetDisplay) {
    let header;
    if (mode === 'info') {
      header = `━━━ Info from ${fromName} (to ${targetDisplay}) ━━━`;
    } else {
      header = `━━━ Message from ${fromName} ━━━`;
    }
    const divider = '━'.repeat(Math.min(header.length, 50));

    // Wrap in newlines so it's clearly separated from other terminal output
    const formatted = `\r\n${header}\r\n${cleanContent}\r\n${divider}\r\n`;
    entry.process.write(formatted);
  }

  /**
   * Detect >>DISCUSS: pattern in agent PTY output and relay to message server.
   * Simple approach: strip ANSI, scan each chunk for the pattern, fire callback.
   */
  _detectDiscussReply(agentId, data) {
    const entry = this.ptys.get(agentId);
    if (!entry || !this.messageCallback) return;

    const str = typeof data === 'string' ? data : data.toString();

    // Strip ANSI codes and clean up
    const clean = this._stripAnsi(str);

    // Log raw data for debugging (temporary)
    if (clean.includes('DISCUSS') || clean.includes('discuss')) {
      console.log(`[DISCUSS-DEBUG] Agent ${entry.name} raw chunk (${str.length} chars):`);
      console.log(`[DISCUSS-DEBUG] Cleaned: ${JSON.stringify(clean)}`);
    }

    // Accumulate into line buffer
    entry.discussBuffer += clean;

    // Keep buffer manageable
    if (entry.discussBuffer.length > 4000) {
      entry.discussBuffer = entry.discussBuffer.slice(-4000);
    }

    // Normalize line endings and split
    const normalized = entry.discussBuffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    // Only process complete lines (keep last partial for next time)
    entry.discussBuffer = lines.pop() || '';

    for (const line of lines) {
      // Find >>DISCUSS anywhere in the line
      const idx = line.indexOf('>>DISCUSS');
      if (idx === -1) continue;

      // Extract everything after >>DISCUSS
      const after = line.substring(idx + 9).trim(); // 9 = '>>DISCUSS'.length

      // Skip if this looks like an echo command (the command itself, not the output)
      const before = line.substring(0, idx);
      if (/echo\s/i.test(before) && /["'`]/.test(before)) continue;

      console.log(`[DISCUSS] Found in line: "${line.trim()}"`);
      console.log(`[DISCUSS] After pattern: "${after}"`);

      if (!after) continue;

      // Parse: ">>DISCUSS: message" or ">>DISCUSS @Target: message"
      let content;
      const colonIdx = after.indexOf(':');
      if (colonIdx !== -1) {
        const beforeColon = after.substring(0, colonIdx).trim();
        const afterColon = after.substring(colonIdx + 1).trim();
        content = beforeColon.length === 0 ? afterColon : beforeColon + ' ' + afterColon;
      } else {
        content = after;
      }

      if (content) {
        console.log(`[DISCUSS relay] Agent ${entry.name}: "${content}"`);
        this.messageCallback({ from: agentId, to: 'all', content });
      }
    }
  }

  _stripAnsi(str) {
    return str
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
      .replace(/\x1b[()][0-9A-B]/g, '')
      .replace(/\x1b[#%][0-9]/g, '')
      .replace(/\x1b[NOcDEHMZ78>=]/g, '')
      .replace(/[\x00-\x08\x0e-\x1f]/g, '');
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

module.exports = { PtyManager, FILTER_MODES };
