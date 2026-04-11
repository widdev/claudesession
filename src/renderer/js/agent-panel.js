import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const activeAgents = new Map(); // agentId -> { terminal, fitAddon, container, name, color, glContainer, ... }

// Each color has an ID, a dark-theme variant, and a light-theme variant.
// The active variant is selected based on the current theme.
const AGENT_COLOR_DEFS = [
  { id: 'blue',        dark: '#569cd6', light: '#1a6fb5' },
  { id: 'green',       dark: '#6a9955', light: '#2d7a1e' },
  { id: 'gold',        dark: '#d7ba7d', light: '#937324' },
  { id: 'purple',      dark: '#c586c0', light: '#9b3d95' },
  { id: 'orange',      dark: '#ce9178', light: '#b05a30' },
  { id: 'teal',        dark: '#4ec9b0', light: '#1a8a6e' },
  { id: 'red',         dark: '#d16969', light: '#b52828' },
  { id: 'yellow',      dark: '#dcdcaa', light: '#7a7a10' },
  { id: 'light-blue',  dark: '#9cdcfe', light: '#1874a8' },
  { id: 'light-green', dark: '#b5cea8', light: '#3a7a1e' },
  { id: 'salmon',      dark: '#f48771', light: '#c44030' },
  { id: 'coral',       dark: '#e07070', light: '#b83030' },
  { id: 'lavender',    dark: '#d4a0e0', light: '#8a40a8' },
  { id: 'rose',        dark: '#e06c75', light: '#b82835' },
  { id: 'cyan',        dark: '#56b6c2', light: '#1a7a88' },
  { id: 'amber',       dark: '#e5c07b', light: '#8a6a10' },
  { id: 'emerald',     dark: '#98c379', light: '#2e7018' },
  { id: 'sky-blue',    dark: '#61afef', light: '#1468b0' },
  { id: 'brick-red',   dark: '#be5046', light: '#9a2a1a' },
  { id: 'peach',       dark: '#d19a66', light: '#9a5a18' },
  { id: 'violet',      dark: '#c678dd', light: '#8a30b8' },
  { id: 'lemon',       dark: '#e8e89c', light: '#6a6a10' },
  { id: 'mint',        dark: '#7cc6a0', light: '#1a7a4a' },
  { id: 'pink',        dark: '#e090a0', light: '#b83858' },
  { id: 'aqua',        dark: '#78d0d0', light: '#1a7a7a' },
  { id: 'mustard',     dark: '#c8b86e', light: '#7a6a10' },
  { id: 'powder-blue', dark: '#a8c8e8', light: '#2a5a8a' },
  { id: 'tangerine',   dark: '#e8a870', light: '#a85a18' },
  { id: 'sage',        dark: '#b0d090', light: '#4a7a18' },
  { id: 'orchid',      dark: '#d0a0d0', light: '#8a3a8a' },
  { id: 'seafoam',     dark: '#80c8c8', light: '#1a6a6a' },
  { id: 'wheat',       dark: '#e0c890', light: '#8a6a18' },
];

let currentTheme = 'dark';

// Get the hex color for a given color ID in the current theme
export function getColorHex(colorId) {
  const def = AGENT_COLOR_DEFS.find(c => c.id === colorId);
  if (!def) return colorId; // fallback: treat as raw hex
  return def[currentTheme];
}

// Get all color hex values for current theme (for palette display)
export function getThemeColors() {
  return AGENT_COLOR_DEFS.map(c => ({ id: c.id, hex: c[currentTheme] }));
}

// Set theme and return list of active agents so callers can update UI
export function setColorTheme(theme) {
  currentTheme = theme;
}

export function getColorTheme() {
  return currentTheme;
}

// Legacy flat array — dynamically computed from current theme
const AGENT_COLORS = AGENT_COLOR_DEFS.map(c => c.dark);
let nextColorIndex = 0;

// Track which agent the user is currently interacting with
let focusedAgentId = null;

// Attention state tracked separately so it survives layout toggles
const attentionState = new Map(); // agentId -> boolean

// Shared terminal zoom (percentage-based, 13px base)
const TERMINAL_BASE_FONT = 13;
const TERMINAL_ZOOM_LEVELS = [75, 85, 100, 115, 130, 150];
let terminalZoom = 100;
let terminalFontSize = TERMINAL_BASE_FONT;

function applyTerminalZoom(zoom) {
  terminalZoom = zoom;
  terminalFontSize = Math.round(TERMINAL_BASE_FONT * zoom / 100);
  for (const [agentId, entry] of activeAgents) {
    entry.terminal.options.fontSize = terminalFontSize;
    entry.fitAddon.fit();
    window.electronAPI.resizeAgent(agentId, entry.terminal.cols, entry.terminal.rows);
  }
  const sel = document.getElementById('terminal-zoom-select');
  if (sel) sel.value = String(zoom);
  window.electronAPI.setSetting('terminalZoom', zoom);
}

// Call once at startup to load persisted zoom and bind the picklist
export function initTerminalFontSize() {
  const sel = document.getElementById('terminal-zoom-select');

  if (sel) {
    sel.addEventListener('change', () => {
      applyTerminalZoom(parseInt(sel.value, 10));
    });
  }

  window.electronAPI.getSetting('terminalZoom').then((zoom) => {
    if (zoom && TERMINAL_ZOOM_LEVELS.includes(zoom)) {
      terminalZoom = zoom;
      terminalFontSize = Math.round(TERMINAL_BASE_FONT * zoom / 100);
      if (sel) sel.value = String(zoom);
      for (const [agentId, entry] of activeAgents) {
        entry.terminal.options.fontSize = terminalFontSize;
        entry.fitAddon.fit();
        window.electronAPI.resizeAgent(agentId, entry.terminal.cols, entry.terminal.rows);
      }
    }
  });
}

// Assign a color ID to an agent. Accepts an ID or raw hex (for backwards compat).
export function assignAgentColor(colorIdOrHex) {
  if (colorIdOrHex) {
    // If it's already a known ID, return it
    if (AGENT_COLOR_DEFS.find(c => c.id === colorIdOrHex)) return colorIdOrHex;
    // If it's a hex that matches a known color, return the ID
    const match = AGENT_COLOR_DEFS.find(c => c.dark === colorIdOrHex || c.light === colorIdOrHex);
    if (match) return match.id;
    // Unknown hex — return as-is (fallback)
    return colorIdOrHex;
  }
  const def = AGENT_COLOR_DEFS[nextColorIndex % AGENT_COLOR_DEFS.length];
  nextColorIndex++;
  return def.id;
}

export function getNextDefaultColor() {
  // Return the next color ID not currently used by an active agent
  const usedIds = new Set();
  for (const [, entry] of activeAgents) {
    usedIds.add(entry.colorId);
  }
  for (let i = 0; i < AGENT_COLOR_DEFS.length; i++) {
    if (!usedIds.has(AGENT_COLOR_DEFS[i].id)) {
      return AGENT_COLOR_DEFS[i].id;
    }
  }
  // All used, fall back to sequential
  return AGENT_COLOR_DEFS[nextColorIndex % AGENT_COLOR_DEFS.length].id;
}

export { AGENT_COLORS, AGENT_COLOR_DEFS };

export function getAgentColor(agentId) {
  const entry = activeAgents.get(agentId);
  if (!entry) return null;
  return getColorHex(entry.colorId);
}

export function getAgentColorId(agentId) {
  const entry = activeAgents.get(agentId);
  return entry ? entry.colorId : null;
}

export function resetColorIndex() {
  nextColorIndex = 0;
  attentionState.clear();
}

export function getActiveAgents() {
  return activeAgents;
}

export function isAgentPaused(agentId) {
  const entry = activeAgents.get(agentId);
  return entry ? entry.paused : false;
}

// Shorten a full path to "...\lastFolder" for display
function shortenPath(fullPath) {
  if (!fullPath) return '';
  const parts = fullPath.replace(/[\\/]+$/, '').split(/[\\/]/);
  if (parts.length <= 2) return fullPath;
  return '...' + (fullPath.includes('/') ? '/' : '\\') + parts[parts.length - 1];
}

export function createAgentPanel(container, agentId, agentName, agentCwd, glContainer, colorId) {
  const color = getColorHex(colorId);
  const panel = document.createElement('div');
  panel.className = 'agent-panel';
  panel.dataset.agentId = agentId;

  // Compact toolbar (no name or colored border — those are in the tab)
  const header = document.createElement('div');
  header.className = 'agent-header';

  // Attention badge (hidden by default)
  const attentionBadge = document.createElement('span');
  attentionBadge.className = 'attention-badge hidden';
  attentionBadge.textContent = '!';

  // Hidden name label — kept for refreshAgentColors and internal reference
  const nameLabel = document.createElement('span');
  nameLabel.className = 'agent-name-label hidden';
  nameLabel.textContent = agentName;

  // Exclude/Include toggle button
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'btn-pause-agent';
  pauseBtn.textContent = 'Exclude';
  pauseBtn.title = 'Exclude from receiving broadcast messages';
  pauseBtn.addEventListener('click', () => {
    const entry = activeAgents.get(agentId);
    if (!entry) return;
    entry.paused = !entry.paused;
    pauseBtn.textContent = entry.paused ? 'Excluded' : 'Exclude';
    pauseBtn.classList.toggle('active', entry.paused);
    // Sync filter mode to main process so message routing respects it
    window.electronAPI.setAgentFilterMode(agentId, entry.paused ? 'exclude' : 'listenAll');
  });

  // Nudge button
  const nudgeBtn = document.createElement('button');
  nudgeBtn.className = 'btn-nudge-agent';
  nudgeBtn.textContent = 'Nudge';
  nudgeBtn.title = 'Ask agent to check messages';
  nudgeBtn.addEventListener('click', () => {
    window.electronAPI.writeToAgent(agentId, 'Please check for new messages addressed to you now and act on any you find.\r');
  });

  // Working path — right aligned
  const cwdSection = document.createElement('div');
  cwdSection.className = 'agent-cwd-section';

  const cwdPath = document.createElement('span');
  cwdPath.className = 'agent-dir';
  cwdPath.textContent = shortenPath(agentCwd);
  cwdPath.title = agentCwd;

  const cwdBtn = document.createElement('button');
  cwdBtn.className = 'btn-change-cwd';
  cwdBtn.textContent = '...';
  cwdBtn.title = 'Change working directory';
  cwdBtn.addEventListener('click', async () => {
    const newCwd = await window.electronAPI.changeAgentCwd(agentId);
    if (newCwd) {
      cwdPath.textContent = shortenPath(newCwd);
      cwdPath.title = newCwd;
    }
  });

  cwdSection.appendChild(cwdPath);
  cwdSection.appendChild(cwdBtn);

  // Token/cost badge
  const tokenBadge = document.createElement('span');
  tokenBadge.className = 'agent-token-badge';
  tokenBadge.textContent = '';
  tokenBadge.title = 'Session cost (parsed from Claude Code output)';

  header.appendChild(attentionBadge);
  header.appendChild(nameLabel);
  header.appendChild(pauseBtn);
  header.appendChild(nudgeBtn);
  header.appendChild(tokenBadge);
  header.appendChild(cwdSection);

  // Terminal container
  const termContainer = document.createElement('div');
  termContainer.className = 'agent-terminal';

  panel.appendChild(header);
  panel.appendChild(termContainer);
  container.appendChild(panel);

  // Create xterm.js terminal
  const termTheme = currentTheme === 'light'
    ? { background: '#f5f5f5', foreground: '#1e1e1e', cursor: '#1e1e1e', selectionBackground: '#add6ff' }
    : { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#264f78' };

  const terminal = new Terminal({
    theme: termTheme,
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: terminalFontSize,
    cursorBlink: true,
    scrollback: 5000,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(termContainer);

  // Fit immediately, then again after GL finishes layout.
  // The first agent has no GL root yet, so its container may have 0 dimensions
  // on the initial requestAnimationFrame — the delayed fit catches that.
  requestAnimationFrame(() => {
    fitAddon.fit();
    window.electronAPI.resizeAgent(agentId, terminal.cols, terminal.rows);
  });
  setTimeout(() => {
    fitAddon.fit();
    window.electronAPI.resizeAgent(agentId, terminal.cols, terminal.rows);
    terminal.refresh(0, terminal.rows - 1);
  }, 300);

  // Ctrl+MouseWheel to change terminal zoom (all agents share the same level)
  termContainer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const idx = TERMINAL_ZOOM_LEVELS.indexOf(terminalZoom);
    if (e.deltaY < 0 && idx < TERMINAL_ZOOM_LEVELS.length - 1) {
      applyTerminalZoom(TERMINAL_ZOOM_LEVELS[idx + 1]);
    } else if (e.deltaY > 0 && idx > 0) {
      applyTerminalZoom(TERMINAL_ZOOM_LEVELS[idx - 1]);
    }
  }, { passive: false });

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
    nameLabel,
    attentionBadge,
    tokenBadge,
    name: agentName,
    colorId,
    glContainer,
    resizeObserver,
    idleTimer: null,
    outputBuffer: '',
    tokenBuffer: '',
    lastCost: 0,
    lastCtx: 0,
    paused: false,
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
    feedTokenParser(agentId, data);
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

// ─── Token / Cost Parsing ───────────────────────────────────────────
//
// Claude Code's interactive TUI renders a status bar with cost info.
// The ANSI-stripped PTY output contains dollar amounts like "$0.04".
// We scan a rolling buffer for these patterns and display the highest
// value seen (cost only increases within a session).
//

// Match dollar amounts: $0.04, $1.23, $12.50, etc.
const COST_REGEX = /\$(\d+\.\d{2,4})/g;

function feedTokenParser(agentId, data) {
  const entry = activeAgents.get(agentId);
  if (!entry) return;

  const str = typeof data === 'string' ? data : data.toString();
  entry.tokenBuffer += str;

  // Keep a rolling window
  if (entry.tokenBuffer.length > 8000) {
    entry.tokenBuffer = entry.tokenBuffer.slice(-8000);
  }

  // Strip ANSI and scan for the status bar pattern:
  // "ctx: 2% | $0.0789"
  const clean = stripAnsi(entry.tokenBuffer);

  // Context percentage
  const ctxMatch = clean.match(/ctx:\s*(\d+)%/g);
  if (ctxMatch) {
    const last = ctxMatch[ctxMatch.length - 1];
    const m = last.match(/ctx:\s*(\d+)%/);
    if (m) entry.lastCtx = parseInt(m[1], 10);
  }

  // Cost — take the highest seen (cost only goes up)
  let highest = entry.lastCost;
  COST_REGEX.lastIndex = 0;
  let match;
  while ((match = COST_REGEX.exec(clean)) !== null) {
    const val = parseFloat(match[1]);
    if (val > highest) highest = val;
  }

  if (highest > entry.lastCost) {
    entry.lastCost = highest;
  }

  // Update badge if we have any data
  if (entry.lastCost > 0 || entry.lastCtx > 0) {
    const parts = [];
    if (entry.lastCtx > 0) parts.push(`ctx ${entry.lastCtx}%`);
    if (entry.lastCost > 0) parts.push(`$${entry.lastCost.toFixed(2)}`);
    entry.tokenBadge.textContent = parts.join(' | ');
    entry.tokenBadge.classList.add('visible');
  }
}

export function fitAll() {
  for (const [, entry] of activeAgents) {
    entry.fitAddon.fit();
  }
}

// Re-apply agent colors and terminal themes after a theme change
export function refreshAgentColors() {
  const termTheme = currentTheme === 'light'
    ? { background: '#f5f5f5', foreground: '#1e1e1e', cursor: '#1e1e1e', selectionBackground: '#add6ff' }
    : { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#264f78' };

  for (const [, entry] of activeAgents) {
    const hex = getColorHex(entry.colorId);
    entry.header.style.borderLeft = `3px solid ${hex}`;
    entry.nameLabel.style.color = hex;
    applyTabColor(entry.glContainer, hex);
    entry.terminal.options.theme = termTheme;
  }
}
