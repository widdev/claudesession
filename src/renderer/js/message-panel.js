import { getAgentColor, setColorTheme, getColorTheme, refreshAgentColors, getColorHex } from './agent-panel.js';

const messageList = () => document.getElementById('message-list');
const messagePanel = () => document.getElementById('message-panel');

export function initMessagePanel() {
  // Toggle button
  document.getElementById('btn-toggle-messages').addEventListener('click', togglePanel);
  document.getElementById('btn-close-messages').addEventListener('click', togglePanel);

  // Listen for new messages from main process
  window.electronAPI.onNewMessage((msg) => {
    appendMessage(msg);
  });

  // Listen for menu toggle
  window.electronAPI.onMenuEvent('menu:toggleMessages', togglePanel);

  // Global keyboard shortcut for Ctrl+M (capture phase to beat terminal)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    }
  }, true);

  // Listen for agents panel toggle
  window.electronAPI.onMenuEvent('menu:toggleAgents', toggleAgentsPanel);

  // Archive discussion
  document.getElementById('btn-archive-messages').addEventListener('click', showArchiveModal);

  // Menu: Archive Discussion
  window.electronAPI.onMenuEvent('menu:archiveDiscussion', showArchiveModal);

  // Menu: Restore Archived Messages
  window.electronAPI.onMenuEvent('menu:restoreArchived', async () => {
    const count = await restoreArchivedMessages();
    if (count === 0) {
      // No archived messages — could show a subtle indicator but keep it quiet
    }
  });

  // ── Zoom controls ──
  const zoomSelect = document.getElementById('zoom-select');
  const msgListEl = messageList();
  const masterInput = document.getElementById('master-input');
  const ZOOM_LEVELS = [75, 85, 100, 115, 130, 150];
  const BASE_FONT_SIZE = 14; // px at 100%
  let currentZoom = 100;

  function applyZoom(zoom) {
    currentZoom = zoom;
    const scale = zoom / 100;
    msgListEl.style.fontSize = (BASE_FONT_SIZE * scale) + 'px';
    masterInput.style.fontSize = (BASE_FONT_SIZE * scale) + 'px';
    zoomSelect.value = String(zoom);
    window.electronAPI.setSetting('messageZoom', zoom);
  }

  // Apply default zoom, then override with persisted value if any
  applyZoom(currentZoom);
  window.electronAPI.getSetting('messageZoom').then((zoom) => {
    if (zoom && ZOOM_LEVELS.includes(zoom)) {
      applyZoom(zoom);
    }
  });

  zoomSelect.addEventListener('change', () => {
    applyZoom(parseInt(zoomSelect.value, 10));
  });

  // Ctrl+MouseWheel within message panel to change zoom
  const panel = messagePanel();
  panel.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const idx = ZOOM_LEVELS.indexOf(currentZoom);
    if (e.deltaY < 0 && idx < ZOOM_LEVELS.length - 1) {
      applyZoom(ZOOM_LEVELS[idx + 1]);
    } else if (e.deltaY > 0 && idx > 0) {
      applyZoom(ZOOM_LEVELS[idx - 1]);
    }
  }, { passive: false });

  // ── Theme (controlled from View menu) ──
  function applyTheme(theme) {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(`theme-${theme}`);
    setColorTheme(theme);
    refreshAgentColors();
  }

  // Load persisted theme
  window.electronAPI.getSetting('theme').then((theme) => {
    if (theme) {
      applyTheme(theme);
    }
  });

  // Listen for theme toggle from menu
  window.electronAPI.onMenuEvent('menu:toggleTheme', () => {
    const newTheme = getColorTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    window.electronAPI.setSetting('theme', newTheme);
  });

  // Port display and restart
  const portInput = document.getElementById('port-input');
  const restartBtn = document.getElementById('btn-restart-port');

  window.electronAPI.getServerPort().then((port) => {
    portInput.value = port;
  });

  window.electronAPI.onServerPort((port) => {
    portInput.value = port;
  });

  restartBtn.addEventListener('click', async () => {
    const port = parseInt(portInput.value, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      portInput.style.borderColor = '#f44747';
      return;
    }
    restartBtn.disabled = true;
    restartBtn.textContent = '...';
    const result = await window.electronAPI.restartServer(port);
    if (result.success) {
      portInput.value = result.port;
      portInput.style.borderColor = '';
    } else {
      portInput.style.borderColor = '#f44747';
    }
    restartBtn.disabled = false;
    restartBtn.textContent = 'Restart';
  });
}

function showArchiveModal() {
  const modal = document.getElementById('archive-modal');
  const pathDisplay = document.getElementById('archive-path-display');
  const clearCheckbox = document.getElementById('archive-clear-on-save');
  const browseBtn = document.getElementById('archive-select-dir');
  const saveBtn = document.getElementById('archive-save');
  const cancelBtn = document.getElementById('archive-cancel');

  pathDisplay.textContent = '';
  pathDisplay.dataset.path = '';
  clearCheckbox.checked = true;
  modal.classList.remove('hidden');

  let resolved = false;

  function finish() {
    if (resolved) return;
    resolved = true;
    modal.classList.add('hidden');
    document.removeEventListener('keydown', onKey);
    browseBtn.removeEventListener('click', onBrowse);
    saveBtn.removeEventListener('click', onSave);
    cancelBtn.removeEventListener('click', onCancel);
  }

  function onKey(e) { if (e.key === 'Escape') finish(); }
  function onCancel() { finish(); }

  async function onBrowse() {
    const filePath = await window.electronAPI.saveFileDialog({
      title: 'Save Discussion Archive',
      defaultPath: 'discussion-archive.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }, { name: 'Text Files', extensions: ['txt'] }],
    });
    if (filePath) {
      pathDisplay.textContent = filePath;
      pathDisplay.dataset.path = filePath;
      pathDisplay.title = filePath;
    }
  }

  async function onSave() {
    const filePath = pathDisplay.dataset.path;
    if (!filePath) {
      pathDisplay.textContent = 'Please select a location';
      pathDisplay.style.color = 'var(--danger)';
      setTimeout(() => { pathDisplay.style.color = ''; }, 2000);
      return;
    }

    // Build CSV content from message list
    const entries = messageList().querySelectorAll('.message-entry');
    const rows = ['Date,Sender,Target,Message'];
    for (const entry of entries) {
      const metaEl = entry.querySelector('.message-meta');
      const from = metaEl?.querySelector('.message-from')?.textContent?.trim() || '';
      const to = metaEl?.querySelector('.message-to')?.textContent?.trim() || '';
      // Extract time — it's the last text node after the middot
      const metaText = metaEl?.textContent || '';
      const timeMatch = metaText.match(/·\s*(.+)$/);
      const time = timeMatch ? timeMatch[1].trim() : '';
      const content = entry.querySelector('.message-content')?.textContent?.trim() || '';
      // Escape CSV fields (wrap in quotes if they contain commas, quotes, or newlines)
      const csvField = (s) => {
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };
      rows.push(`${csvField(time)},${csvField(from)},${csvField(to)},${csvField(content)}`);
    }

    await window.electronAPI.writeTextFile(filePath, rows.join('\n'));

    if (clearCheckbox.checked) {
      await window.electronAPI.clearMessages();
      messageList().innerHTML = '';
    }

    finish();
  }

  document.addEventListener('keydown', onKey);
  browseBtn.addEventListener('click', onBrowse);
  saveBtn.addEventListener('click', onSave);
  cancelBtn.addEventListener('click', onCancel);
}

export function toggleAgentsPanel() {
  const agentWrapper = document.getElementById('agent-panel-wrapper');
  const splitter = document.getElementById('panel-splitter');
  const showBtn = document.getElementById('btn-show-agents');
  const isHiding = !agentWrapper.classList.contains('hidden');
  agentWrapper.classList.toggle('hidden');
  // Hide splitter when either panel is hidden
  if (splitter) {
    const msgPanel = messagePanel();
    const bothVisible = !agentWrapper.classList.contains('hidden') && !msgPanel.classList.contains('hidden');
    splitter.classList.toggle('hidden', !bothVisible);
  }
  if (showBtn) {
    showBtn.classList.toggle('hidden', !isHiding);
  }
  window.electronAPI.setAgentsPanelState(!isHiding);
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 50);
}

export function togglePanel() {
  const panel = messagePanel();
  const splitter = document.getElementById('panel-splitter');
  const agentWrapper = document.getElementById('agent-panel-wrapper');
  const isHiding = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  // Splitter only visible when both panels are visible
  if (splitter) {
    const bothVisible = !agentWrapper.classList.contains('hidden') && !panel.classList.contains('hidden');
    splitter.classList.toggle('hidden', !bothVisible);
  }
  const msgBtn = document.getElementById('btn-toggle-messages');
  if (msgBtn) {
    msgBtn.classList.toggle('hidden', !isHiding);
  }
  window.electronAPI.setMessagePanelState(!isHiding);
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 50);
}

export function appendMessage(msg) {
  const list = messageList();
  const entry = document.createElement('div');
  entry.className = 'message-entry';

  // Color the border based on the sender agent
  const fromId = msg.from_agent || msg.from;
  if (fromId) {
    const color = getAgentColor(fromId);
    entry.style.borderLeftColor = color;
  }

  const time = msg.timestamp ? new Date(msg.timestamp + 'Z').toLocaleTimeString() : new Date().toLocaleTimeString();
  const fromName = msg.fromName || msg.from_agent || msg.from || '?';
  const toName = msg.toName || msg.to_agent || msg.to || '?';

  // Color the from name with the agent's assigned color
  const fromColor = fromId ? getAgentColor(fromId) : null;
  const fromStyle = fromColor ? ` style="color: ${fromColor}"` : '';

  entry.innerHTML = `
    <span class="msg-remove" title="Remove message">&times;</span>
    <div class="message-meta">
      <span class="message-from"${fromStyle}>${escapeHtml(fromName)}</span>
      &rarr; <span class="message-to">${escapeHtml(toName)}</span>
      &middot; ${escapeHtml(time)}
    </div>
    <div class="message-content">${escapeHtml(msg.content || '')}</div>
  `;

  entry.querySelector('.msg-remove').addEventListener('click', async () => {
    if (msg.id) {
      await window.electronAPI.removeMessage(msg.id);
    }
    entry.remove();
  });

  list.appendChild(entry);
  list.scrollTop = list.scrollHeight;
  autoTrimMessages();
}

export function appendBroadcast(text) {
  const list = messageList();
  const entry = document.createElement('div');
  entry.className = 'message-entry message-broadcast';

  const time = new Date().toLocaleTimeString();

  entry.innerHTML = `
    <div class="message-meta">
      <span class="message-from broadcast-from">You</span>
      &rarr; <span class="message-to">All Agents</span>
      &middot; ${escapeHtml(time)}
    </div>
    <div class="message-content">${escapeHtml(text)}</div>
  `;

  list.appendChild(entry);
  list.scrollTop = list.scrollHeight;
}

export function appendAside(text, targetName) {
  const list = messageList();
  const entry = document.createElement('div');
  entry.className = 'message-entry message-aside';

  const time = new Date().toLocaleTimeString();

  entry.innerHTML = `
    <div class="message-meta">
      <span class="message-from broadcast-from">You</span>
      &rarr; <span class="message-to">${escapeHtml(targetName)}</span>
      &middot; ${escapeHtml(time)}
    </div>
    <div class="message-content">${escapeHtml(text)}</div>
  `;

  list.appendChild(entry);
  list.scrollTop = list.scrollHeight;
}

const MAX_VISIBLE = 200;
let allMessages = []; // full message array for pagination
let visibleCount = 0;

export function loadMessages(messages) {
  const list = messageList();
  list.innerHTML = '';
  allMessages = messages;
  visibleCount = 0;

  if (messages.length > MAX_VISIBLE) {
    // Show "load older" button, then render the last MAX_VISIBLE
    addShowOlderButton(list, messages.length - MAX_VISIBLE);
    for (let i = messages.length - MAX_VISIBLE; i < messages.length; i++) {
      appendMessage(messages[i]);
    }
    visibleCount = MAX_VISIBLE;
  } else {
    for (const msg of messages) {
      appendMessage(msg);
    }
    visibleCount = messages.length;
  }
}

function addShowOlderButton(list, hiddenCount) {
  // Remove existing button if any
  const existing = list.querySelector('.show-older-btn');
  if (existing) existing.remove();

  const btn = document.createElement('div');
  btn.className = 'show-older-btn';
  btn.textContent = `Show ${Math.min(hiddenCount, MAX_VISIBLE)} older messages (${hiddenCount} hidden)`;
  btn.addEventListener('click', () => {
    const startIdx = Math.max(0, hiddenCount - MAX_VISIBLE);
    const batch = allMessages.slice(startIdx, hiddenCount);
    btn.remove();
    // Insert older messages at the top
    const firstChild = list.firstChild;
    for (const msg of batch) {
      const el = createMessageElement(msg);
      list.insertBefore(el, firstChild);
    }
    if (startIdx > 0) {
      addShowOlderButton(list, startIdx);
    }
  });
  list.insertBefore(btn, list.firstChild);
}

// Auto-trim: if too many DOM nodes accumulate from live messages, prune old ones
function autoTrimMessages() {
  const list = messageList();
  const entries = list.querySelectorAll('.message-entry');
  if (entries.length > MAX_VISIBLE * 1.5) {
    const toRemove = entries.length - MAX_VISIBLE;
    for (let i = 0; i < toRemove; i++) {
      entries[i].remove();
    }
  }
}

// Create a message DOM element without appending (for batch insert)
function createMessageElement(msg) {
  const entry = document.createElement('div');
  entry.className = 'message-entry';

  const fromId = msg.from_agent || msg.from;
  if (fromId) {
    const color = getAgentColor(fromId);
    entry.style.borderLeftColor = color;
  }

  const time = msg.timestamp ? new Date(msg.timestamp + 'Z').toLocaleTimeString() : new Date().toLocaleTimeString();
  const fromName = msg.fromName || msg.from_agent || msg.from || '?';
  const toName = msg.toName || msg.to_agent || msg.to || '?';
  const fromColor = fromId ? getAgentColor(fromId) : null;
  const fromStyle = fromColor ? ` style="color: ${fromColor}"` : '';

  entry.innerHTML = `
    <span class="msg-remove" title="Remove message">&times;</span>
    <div class="message-meta">
      <span class="message-from"${fromStyle}>${escapeHtml(fromName)}</span>
      &rarr; <span class="message-to">${escapeHtml(toName)}</span>
      &middot; ${escapeHtml(time)}
    </div>
    <div class="message-content">${escapeHtml(msg.content || '')}</div>
  `;

  entry.querySelector('.msg-remove').addEventListener('click', async () => {
    if (msg.id) {
      await window.electronAPI.removeMessage(msg.id);
    }
    entry.remove();
  });

  return entry;
}

// Restore archived messages back into the panel
export async function restoreArchivedMessages() {
  const archived = await window.electronAPI.getArchivedMessages();
  if (!archived || archived.length === 0) return 0;
  await window.electronAPI.restoreAllMessages();
  // Reload all messages from DB in date order
  const all = await window.electronAPI.getMessages();
  loadMessages(all);
  return archived.length;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
