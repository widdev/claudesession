import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const activeAgents = new Map(); // agentId -> { terminal, fitAddon, container, name, color, glContainer, ... }

const AGENT_COLORS = [
  '#569cd6', // blue
  '#6a9955', // green
  '#d7ba7d', // gold
  '#c586c0', // purple
  '#ce9178', // orange
  '#4ec9b0', // teal
  '#d16969', // red
  '#dcdcaa', // yellow
  '#9cdcfe', // light blue
  '#b5cea8', // light green
  '#f48771', // salmon
  '#e07070', // coral
  '#d4a0e0', // lavender
  '#e06c75', // rose
  '#56b6c2', // cyan
  '#e5c07b', // amber
  '#98c379', // emerald
  '#61afef', // sky blue
  '#be5046', // brick red
  '#d19a66', // peach
  '#c678dd', // violet
  '#e8e89c', // lemon
  '#7cc6a0', // mint
  '#e090a0', // pink
  '#78d0d0', // aqua
  '#c8b86e', // mustard
  '#a8c8e8', // powder blue
  '#e8a870', // tangerine
  '#b0d090', // sage
  '#d0a0d0', // orchid
  '#80c8c8', // seafoam
  '#e0c890', // wheat
];
let nextColorIndex = 0;

// Track which agent the user is currently interacting with
let focusedAgentId = null;

// Attention state tracked separately so it survives layout toggles
const attentionState = new Map(); // agentId -> boolean

export function assignAgentColor(color) {
  if (color) return color;
  const c = AGENT_COLORS[nextColorIndex % AGENT_COLORS.length];
  nextColorIndex++;
  return c;
}

export function getNextDefaultColor() {
  // Return the next color not currently used by an active agent
  const usedColors = new Set();
  for (const [, entry] of activeAgents) {
    usedColors.add(entry.color);
  }
  for (let i = 0; i < AGENT_COLORS.length; i++) {
    if (!usedColors.has(AGENT_COLORS[i])) {
      return AGENT_COLORS[i];
    }
  }
  // All used, fall back to sequential
  return AGENT_COLORS[nextColorIndex % AGENT_COLORS.length];
}

export { AGENT_COLORS };

export function getAgentColor(agentId) {
  const entry = activeAgents.get(agentId);
  return entry ? entry.color : null;
}

export function resetColorIndex() {
  nextColorIndex = 0;
  attentionState.clear();
}

export function getActiveAgents() {
  return activeAgents;
}

export function createAgentPanel(container, agentId, agentName, agentCwd, glContainer, color) {
  const panel = document.createElement('div');
  panel.className = 'agent-panel';
  panel.dataset.agentId = agentId;

  // Header
  const header = document.createElement('div');
  header.className = 'agent-header';
  header.style.borderLeft = `3px solid ${color}`;

  // Attention badge (hidden by default)
  const attentionBadge = document.createElement('span');
  attentionBadge.className = 'attention-badge hidden';
  attentionBadge.textContent = '!';

  // Agent name label (read-only)
  const nameLabel = document.createElement('span');
  nameLabel.className = 'agent-name-label';
  nameLabel.textContent = agentName;
  nameLabel.style.color = color;

  // Working path section — right aligned
  const cwdSection = document.createElement('div');
  cwdSection.className = 'agent-cwd-section';

  const cwdPath = document.createElement('span');
  cwdPath.className = 'agent-dir';
  cwdPath.textContent = agentCwd;
  cwdPath.title = agentCwd;

  const cwdBtn = document.createElement('button');
  cwdBtn.className = 'btn-change-cwd';
  cwdBtn.textContent = '...';
  cwdBtn.title = 'Change working directory';
  cwdBtn.addEventListener('click', async () => {
    const newCwd = await window.electronAPI.changeAgentCwd(agentId);
    if (newCwd) {
      cwdPath.textContent = newCwd;
      cwdPath.title = newCwd;
    }
  });

  cwdSection.appendChild(cwdPath);
  cwdSection.appendChild(cwdBtn);

  // Close button (visible in side-by-side mode)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-close-agent';
  closeBtn.textContent = '\u00d7';
  closeBtn.title = 'Close agent';
  closeBtn.addEventListener('click', () => {
    if (glContainer) {
      glContainer.close();
    }
  });

  header.appendChild(attentionBadge);
  header.appendChild(nameLabel);
  header.appendChild(cwdSection);
  header.appendChild(closeBtn);

  // Terminal container
  const termContainer = document.createElement('div');
  termContainer.className = 'agent-terminal';

  panel.appendChild(header);
  panel.appendChild(termContainer);
  container.appendChild(panel);

  // Create xterm.js terminal
  const terminal = new Terminal({
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#264f78',
    },
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(termContainer);

  requestAnimationFrame(() => {
    fitAddon.fit();
    window.electronAPI.resizeAgent(agentId, terminal.cols, terminal.rows);
  });

  // Forward keystrokes to PTY — and mark as focused
  terminal.onData((data) => {
    window.electronAPI.writeToAgent(agentId, data);
    setFocused(agentId);
  });

  // Track focus via the terminal's textarea
  const textareaEl = terminal.textarea;
  if (textareaEl) {
    textareaEl.addEventListener('focus', () => {
      setFocused(agentId);
    });
  }

  // Also track clicks on the panel
  panel.addEventListener('mousedown', () => {
    setFocused(agentId);
  });

  // ResizeObserver for auto-fitting
  let resizeTimeout;
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (termContainer.offsetWidth > 0 && termContainer.offsetHeight > 0) {
        fitAddon.fit();
        window.electronAPI.resizeAgent(agentId, terminal.cols, terminal.rows);
      }
    }, 100);
  });
  resizeObserver.observe(termContainer);

  const agentEntry = {
    terminal,
    fitAddon,
    container: panel,
    header,
    attentionBadge,
    name: agentName,
    color,
    glContainer,
    resizeObserver,
    idleTimer: null,
    outputBuffer: '',
  };

  activeAgents.set(agentId, agentEntry);

  // Apply tab color after a short delay (tab may not exist immediately)
  applyTabColor(glContainer, color);

  // If this agent had attention before (e.g. layout toggle), restore it
  if (attentionState.get(agentId)) {
    showAttention(agentId);
  }

  // Clear attention when tab becomes visible (GL event)
  if (glContainer) {
    glContainer.on('show', () => {
      setFocused(agentId);
    });
  }

  return { terminal, fitAddon, panel };
}

function applyTabColor(glContainer, color) {
  let attempts = 0;
  const tryApply = () => {
    if (!glContainer) return;
    const tab = glContainer.tab;
    if (tab && tab.element) {
      tab.element.style.borderTopColor = color;
      const titleEl = tab.element.querySelector('.lm_title');
      if (titleEl) {
        titleEl.style.color = color;
      }
    } else if (attempts < 10) {
      attempts++;
      setTimeout(tryApply, 100);
    }
  };
  setTimeout(tryApply, 50);
}

export function removeAgentPanel(agentId) {
  const entry = activeAgents.get(agentId);
  if (entry) {
    entry.resizeObserver.disconnect();
    entry.terminal.dispose();
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    activeAgents.delete(agentId);
  }
}

export function writeToTerminal(agentId, data) {
  const entry = activeAgents.get(agentId);
  if (entry) {
    entry.terminal.write(data);
    feedAttentionDetector(agentId, data);
  }
}

// ─── Attention Detection ────────────────────────────────────────────
//
// Strategy: idle-timer based.
// When output arrives, buffer the raw chars and reset a 2s timer.
// When the timer fires (output stopped for 2s), strip ANSI codes
// and check for patterns that indicate Claude is waiting for input.
// Only shows attention for agents the user is NOT currently interacting with.
//

const IDLE_TIMEOUT_MS = 2000;

// Comprehensive ANSI/escape code stripper
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')       // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')      // DCS, SOS, PM, APC sequences
    .replace(/\x1b[()][0-9A-B]/g, '')               // Character set selection
    .replace(/\x1b[#%][0-9]/g, '')                   // Line attr / char set
    .replace(/\x1b[NOcDEHMZ78>=]/g, '')             // Single-char ESC sequences
    .replace(/[\x00-\x08\x0e-\x1f]/g, '');          // Control characters (keep \t \n \r)
}

// Patterns that indicate "waiting for user input"
const ATTENTION_PATTERNS = [
  /\u256d/,                     // ╭ — Claude Code's prompt box top border
  /\?\s*\([Yy]\/[Nn]\)/,       // ? (Y/n) or (y/N) questions
  /\?\s*\(yes\/no\)/i,         // ? (yes/no)
  /\?\s*$/m,                    // line ending with ?
  /\[Y\/n\]/,                   // [Y/n] style prompts
  /\[yes\/no\]/i,               // [yes/no] style prompts
  /\$ $/,                       // bash prompt at end
  /Enter a value/i,             // form-style prompts
  /Press Enter/i,               // press enter prompts
  /Do you want to/i,            // "Do you want to proceed?"
  /Would you like to/i,         // "Would you like to..."
];

function feedAttentionDetector(agentId, data) {
  const entry = activeAgents.get(agentId);
  if (!entry) return;

  const str = typeof data === 'string' ? data : data.toString();

  // Append to rolling buffer (keep last 4000 chars for generous matching)
  entry.outputBuffer += str;
  if (entry.outputBuffer.length > 4000) {
    entry.outputBuffer = entry.outputBuffer.slice(-4000);
  }

  // Reset idle timer — output is still flowing
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    checkAttention(agentId);
  }, IDLE_TIMEOUT_MS);
}

function checkAttention(agentId) {
  const entry = activeAgents.get(agentId);
  if (!entry) return;

  // Don't show attention for the currently focused agent
  if (agentId === focusedAgentId) return;

  // Strip ANSI codes and check the tail for patterns
  const clean = stripAnsi(entry.outputBuffer).slice(-2000);

  for (const pattern of ATTENTION_PATTERNS) {
    if (pattern.test(clean)) {
      showAttention(agentId);
      return;
    }
  }
}

function showAttention(agentId) {
  if (attentionState.get(agentId)) return; // Already showing
  attentionState.set(agentId, true);
  const entry = activeAgents.get(agentId);
  if (!entry) return;

  // Flash the agent header badge
  entry.attentionBadge.classList.remove('hidden');
  entry.header.classList.add('attention');

  // Flash the GL tab (with retry since tab DOM may not exist yet)
  applyAttentionToTab(entry, true);
}

function applyAttentionToTab(entry, add) {
  let attempts = 0;
  const tryApply = () => {
    if (!entry.glContainer) return;
    const tab = entry.glContainer.tab;
    if (tab && tab.element) {
      if (add) {
        tab.element.classList.add('attention');
      } else {
        tab.element.classList.remove('attention');
      }
    } else if (attempts < 10) {
      attempts++;
      setTimeout(tryApply, 100);
    }
  };
  tryApply();
}

function clearAttention(agentId) {
  if (!attentionState.get(agentId)) return; // Not showing
  attentionState.set(agentId, false);
  const entry = activeAgents.get(agentId);
  if (!entry) return;

  entry.attentionBadge.classList.add('hidden');
  entry.header.classList.remove('attention');

  applyAttentionToTab(entry, false);
}

function setFocused(agentId) {
  focusedAgentId = agentId;
  clearAttention(agentId);
  // Clear the buffer so old patterns don't re-trigger when focus leaves
  const entry = activeAgents.get(agentId);
  if (entry) entry.outputBuffer = '';
}

export function fitAll() {
  for (const [, entry] of activeAgents) {
    entry.fitAddon.fit();
  }
}
