import { getAgentColor, setColorTheme, getColorTheme, refreshAgentColors, getActiveAgents, isAgentPaused } from './agent-panel.js';

// Global refs — set when discussion component is created
let msgListEl = null;
let masterInputEl = null;
let inputErrorEl = null;
let globalListenersRegistered = false;
let activeFilter = null; // { fromAgent, search } or null

// Register IPC listeners ONCE (not per component creation)
export function initGlobalMessageListeners() {
  if (globalListenersRegistered) return;
  globalListenersRegistered = true;

  window.electronAPI.onNewMessage((msg) => appendMessage(msg));
  window.electronAPI.onMenuEvent('menu:archiveDiscussion', showArchiveModal);
  window.electronAPI.onMenuEvent('menu:restoreArchived', async () => { await restoreArchivedMessages(); });

  // Theme
  window.electronAPI.getSetting('theme').then((t) => { if (t) applyTheme(t); });
  window.electronAPI.onMenuEvent('menu:toggleTheme', () => {
    const nt = getColorTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(nt); window.electronAPI.setSetting('theme', nt);
  });
}

function applyTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(`theme-${theme}`);
  setColorTheme(theme);
  refreshAgentColors();
}

export function initMessagePanel(el) {
  const list = el.querySelector('.disc-message-list');
  const portInput = el.querySelector('.disc-port-input');
  const restartBtn = el.querySelector('.disc-restart-btn');
  const archiveBtn = el.querySelector('.disc-archive-btn');
  const zoomSel = el.querySelector('.disc-zoom-select');

  msgListEl = list;

  // Archive button (DOM event, safe to re-register per component)
  archiveBtn.addEventListener('click', showArchiveModal);

  // Zoom
  const ZOOM_LEVELS = [75, 85, 100, 115, 130, 150];
  const BASE_FONT_SIZE = 14;
  let currentZoom = 100;
  function applyZoom(zoom) {
    currentZoom = zoom;
    const scale = zoom / 100;
    const fontSize = (BASE_FONT_SIZE * scale) + 'px';
    list.style.fontSize = fontSize;
    if (masterInputEl) masterInputEl.style.fontSize = fontSize;
    zoomSel.value = String(zoom);
    window.electronAPI.setSetting('messageZoom', zoom);
  }
  applyZoom(currentZoom);
  window.electronAPI.getSetting('messageZoom').then((z) => { if (z && ZOOM_LEVELS.includes(z)) applyZoom(z); });
  zoomSel.addEventListener('change', () => applyZoom(parseInt(zoomSel.value, 10)));
  // Ctrl+Wheel on the discussion content changes zoom
  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault();
    const idx = ZOOM_LEVELS.indexOf(currentZoom);
    if (e.deltaY < 0 && idx < ZOOM_LEVELS.length - 1) applyZoom(ZOOM_LEVELS[idx + 1]);
    else if (e.deltaY > 0 && idx > 0) applyZoom(ZOOM_LEVELS[idx - 1]);
  }, { passive: false });

  // Port — use direct value set, not IPC listener (to avoid stacking)
  window.electronAPI.getServerPort().then((p) => { portInput.value = p; });
  restartBtn.addEventListener('click', async () => {
    const p = parseInt(portInput.value, 10);
    if (isNaN(p) || p < 1024 || p > 65535) { portInput.style.borderColor = '#f44747'; return; }
    restartBtn.disabled = true; restartBtn.textContent = '...';
    const r = await window.electronAPI.restartServer(p);
    if (r.success) { portInput.value = r.port; portInput.style.borderColor = ''; }
    else portInput.style.borderColor = '#f44747';
    restartBtn.disabled = false; restartBtn.textContent = 'Restart';
  });

  // Load existing messages
  window.electronAPI.getMessages().then((msgs) => { if (msgs && msgs.length > 0) loadMessages(msgs); });
}

const inputHistory = [];
let historyIndex = -1;
let pendingInput = '';
let savedInputValue = ''; // Survives panel rebuilds — never lose user's draft

function resizeInput(input) {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}

export function initMasterInput(el) {
  const input = el.querySelector('.disc-master-input');
  const btn = el.querySelector('.disc-broadcast-btn');
  masterInputEl = input;
  inputErrorEl = el.querySelector('.disc-input-error');

  // Restore any in-progress text that survived a panel rebuild
  if (savedInputValue) {
    input.value = savedInputValue;
    resizeInput(input);
    savedInputValue = '';
  }

  btn.addEventListener('click', () => broadcast(input));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); broadcast(input); return; }

    // Up arrow — go back in history (only when cursor is at the start)
    if (e.key === 'ArrowUp' && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      dismissInputError();
      if (inputHistory.length === 0) return;
      if (historyIndex === -1) {
        pendingInput = input.value;
        historyIndex = inputHistory.length - 1;
      } else if (historyIndex > 0) {
        historyIndex--;
      }
      input.value = inputHistory[historyIndex];
      input.setSelectionRange(0, 0);
      resizeInput(input);
    }

    // Down arrow — go forward in history (only when cursor is at the end)
    if (e.key === 'ArrowDown' && input.selectionStart === input.value.length) {
      e.preventDefault();
      dismissInputError();
      if (historyIndex === -1) return;
      if (historyIndex < inputHistory.length - 1) {
        historyIndex++;
        input.value = inputHistory[historyIndex];
      } else {
        // Return to the pending input (what the user was typing before navigating)
        historyIndex = -1;
        input.value = pendingInput;
      }
      const len = input.value.length;
      input.setSelectionRange(len, len);
      resizeInput(input);
    }

    // If user edits while viewing a history entry, that becomes the new pending input
    // and they can't go "past" it with down arrow (handled by historyIndex === -1 guard above)
  });
  input.addEventListener('input', () => {
    resizeInput(input);
    savedInputValue = input.value;
    dismissInputError();
    // User edited text — leave history mode, current text becomes the pending input
    if (historyIndex !== -1) {
      pendingInput = input.value;
      historyIndex = -1;
    }
  });

  // Drag-and-drop from Tasks
  input.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; input.classList.add('drag-over'); });
  input.addEventListener('dragleave', () => input.classList.remove('drag-over'));
  input.addEventListener('drop', (e) => {
    e.preventDefault(); input.classList.remove('drag-over');
    const text = e.dataTransfer.getData('text/plain');
    if (text) { input.value = input.value ? input.value + '\n' + text : text; input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; input.focus(); }
  });
}

// Filter
let filterDebounce = null;
const selectedSenders = new Set();

export function initMessageFilter(el) {
  const toggle = el.querySelector('.disc-filter-toggle');
  const bar = el.querySelector('.disc-filter-bar');
  const dropdownWrapper = el.querySelector('.disc-filter-sender-dropdown');
  const dropdownLabel = dropdownWrapper.querySelector('.dropdown-label');
  const dropdownMenu = dropdownWrapper.querySelector('.dropdown-menu');
  const searchInput = el.querySelector('.disc-filter-search');
  const clearBtn = el.querySelector('.disc-filter-clear');

  let totalSenderCount = 0;

  function updateLabel() {
    if (selectedSenders.size === 0) {
      dropdownLabel.textContent = 'None selected';
    } else if (selectedSenders.size === totalSenderCount) {
      dropdownLabel.textContent = 'All senders';
    } else if (selectedSenders.size === 1) {
      dropdownLabel.textContent = [...selectedSenders][0];
    } else {
      dropdownLabel.textContent = `${selectedSenders.size} selected`;
    }
  }

  function buildMenu(senders) {
    dropdownMenu.innerHTML = '';
    totalSenderCount = senders.length;
    for (const s of senders) {
      const item = document.createElement('label');
      item.className = 'dropdown-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedSenders.has(s);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedSenders.add(s);
        else selectedSenders.delete(s);
        updateLabel();
        applyFilter();
      });
      const span = document.createElement('span');
      span.textContent = s;
      item.appendChild(cb);
      item.appendChild(span);
      dropdownMenu.appendChild(item);
    }
  }

  // Toggle dropdown open/close
  dropdownLabel.addEventListener('click', () => {
    dropdownMenu.classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('mousedown', (e) => {
    if (!dropdownWrapper.contains(e.target)) {
      dropdownMenu.classList.remove('open');
    }
  });

  toggle.addEventListener('click', async () => {
    const visible = bar.style.display !== 'none';
    if (!visible) {
      const senders = await window.electronAPI.getMessageSenders();
      const senderList = senders.includes('You') ? senders : ['You', ...senders];
      // Start with all senders selected (all checked = show everything)
      selectedSenders.clear();
      for (const s of senderList) selectedSenders.add(s);
      buildMenu(senderList);
      updateLabel();
    }
    bar.style.display = visible ? 'none' : 'flex';
    if (visible && activeFilter) {
      activeFilter = null;
      selectedSenders.clear();
      dropdownMenu.classList.remove('open');
      applyFilter();
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(() => applyFilter(), 250);
  });

  clearBtn.addEventListener('click', () => {
    selectedSenders.clear();
    dropdownMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateLabel();
    searchInput.value = '';
    activeFilter = null;
    dropdownMenu.classList.remove('open');
    applyFilter();
  });

  async function applyFilter() {
    // All selected = no sender filter; none selected = match nobody
    const allSelected = selectedSenders.size === totalSenderCount;
    const fromAgents = allSelected ? undefined : [...selectedSenders];
    const search = searchInput.value.trim() || undefined;
    // If none selected and no search, still apply filter to show nothing
    if (selectedSenders.size === 0 && !search) {
      activeFilter = { fromAgents: [], search };
    } else {
      activeFilter = (fromAgents || search) ? { fromAgents, search } : null;
    }
    const msgs = await window.electronAPI.getMessages(activeFilter || undefined);
    loadMessages(msgs);
  }
}

// Broadcast
function sendToAgent(agentId, text) {
  window.electronAPI.writeAndSubmitToAgent(agentId, text);
}

async function broadcast(input) {
  const text = input.value.trim(); if (!text) return;

  // Add to history (avoid duplicating the last entry)
  if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== text) {
    inputHistory.push(text);
  }
  historyIndex = -1;
  pendingInput = '';

  const agents = getActiveAgents();
  const hashMatch = text.match(/^#(\S+)\s+([\s\S]*)$/);
  if (hashMatch) {
    const tn = hashMatch[1], mb = hashMatch[2].trim();
    let tid = null;
    let matchedName = null;
    for (const [id, e] of agents) {
      if (e.name.toLowerCase() === tn.toLowerCase()) { tid = id; matchedName = e.name; break; }
    }
    if (tid && mb) {
      // Save to DB first, then send and display
      const saved = await window.electronAPI.saveMessage({ from: 'You', to: matchedName, content: mb });
      if (!isAgentPaused(tid)) sendToAgent(tid, mb);
      if (saved) appendMessage(saved);
      else appendAside(mb, matchedName);
    } else {
      // Agent not found — broadcast the full text as normal, warn the user
      const saved = await window.electronAPI.saveMessage({ from: 'You', to: 'All Agents', content: text });
      for (const [id] of agents) { if (!isAgentPaused(id)) sendToAgent(id, text); }
      if (saved) appendMessage(saved);
      else appendBroadcast(text);
      showInputError(`#${tn} was not recognised as a valid aside. No agent called "${tn}" was found.`);
    }
  } else {
    // Save to DB first, then send and display
    const saved = await window.electronAPI.saveMessage({ from: 'You', to: 'All Agents', content: text });
    for (const [id] of agents) { if (!isAgentPaused(id)) sendToAgent(id, text); }
    if (saved) appendMessage(saved);
    else appendBroadcast(text);
  }
  input.value = ''; input.style.height = 'auto';
  savedInputValue = '';
}

// Message rendering
const MAX_VISIBLE = 200;
let allMessages = [];

export function appendMessage(msg) {
  if (!msgListEl) return;
  // If a filter is active, only show the message if it matches
  if (activeFilter) {
    const fname = msg.fromName || msg.from_agent || msg.from;
    if (activeFilter.fromAgents && !activeFilter.fromAgents.includes(fname)) return;
    if (activeFilter.search && !(msg.content || '').toLowerCase().includes(activeFilter.search.toLowerCase())) return;
  }
  msgListEl.appendChild(createMessageElement(msg));
  msgListEl.scrollTop = msgListEl.scrollHeight;
  autoTrimMessages();
}

export function appendBroadcast(text) {
  if (!msgListEl) return;
  const e = document.createElement('div'); e.className = 'message-entry message-broadcast';
  e.innerHTML = `<span class="msg-remove" title="Remove">&times;</span><div class="message-meta"><span class="message-from broadcast-from">You</span> &rarr; <span class="message-to">All Agents</span> &middot; ${esc(new Date().toLocaleTimeString())}</div><div class="message-content">${esc(text)}</div>`;
  e.querySelector('.msg-remove').addEventListener('click', () => e.remove());
  msgListEl.appendChild(e); msgListEl.scrollTop = msgListEl.scrollHeight;
}

function showInputError(text) {
  if (!inputErrorEl) return;
  inputErrorEl.textContent = text;
  inputErrorEl.style.display = 'block';
}

function dismissInputError() {
  if (!inputErrorEl) return;
  inputErrorEl.style.display = 'none';
  inputErrorEl.textContent = '';
}

export function appendAside(text, target) {
  if (!msgListEl) return;
  const e = document.createElement('div'); e.className = 'message-entry message-aside';
  e.innerHTML = `<span class="msg-remove" title="Remove">&times;</span><div class="message-meta"><span class="message-from broadcast-from">You</span> &rarr; <span class="message-to">${esc(target)}</span> &middot; ${esc(new Date().toLocaleTimeString())}</div><div class="message-content">${esc(text)}</div>`;
  e.querySelector('.msg-remove').addEventListener('click', () => e.remove());
  msgListEl.appendChild(e); msgListEl.scrollTop = msgListEl.scrollHeight;
}

export function loadMessages(messages) {
  if (!msgListEl) return;
  msgListEl.innerHTML = ''; allMessages = messages;
  if (messages.length > MAX_VISIBLE) {
    addShowOlderButton(msgListEl, messages.length - MAX_VISIBLE);
    for (let i = messages.length - MAX_VISIBLE; i < messages.length; i++) msgListEl.appendChild(createMessageElement(messages[i]));
  } else {
    for (const m of messages) msgListEl.appendChild(createMessageElement(m));
  }
  msgListEl.scrollTop = msgListEl.scrollHeight;
}

function addShowOlderButton(list, count) {
  const ex = list.querySelector('.show-older-btn'); if (ex) ex.remove();
  const b = document.createElement('div'); b.className = 'show-older-btn';
  b.textContent = `Show ${Math.min(count, MAX_VISIBLE)} older messages (${count} hidden)`;
  b.addEventListener('click', () => { const si = Math.max(0, count - MAX_VISIBLE); const batch = allMessages.slice(si, count); b.remove(); const fc = list.firstChild; for (const m of batch) list.insertBefore(createMessageElement(m), fc); if (si > 0) addShowOlderButton(list, si); });
  list.insertBefore(b, list.firstChild);
}

function autoTrimMessages() {
  if (!msgListEl) return;
  const entries = msgListEl.querySelectorAll('.message-entry');
  if (entries.length > MAX_VISIBLE * 1.5) { const n = entries.length - MAX_VISIBLE; for (let i = 0; i < n; i++) entries[i].remove(); }
}

function createMessageElement(msg) {
  const fid = msg.from_agent || msg.from;
  const isUser = fid === 'You';
  const toAgent = msg.to_agent || msg.to || '?';
  const isAside = isUser && toAgent !== 'All Agents';
  const e = document.createElement('div');
  e.className = isUser ? (isAside ? 'message-entry message-aside' : 'message-entry message-broadcast') : 'message-entry';
  if (!isUser && fid) { const c = getAgentColor(fid); e.style.borderLeftColor = c; }
  const t = msg.timestamp ? new Date(msg.timestamp + 'Z').toLocaleTimeString() : new Date().toLocaleTimeString();
  const fn = msg.fromName || fid || '?';
  const tn = msg.toName || toAgent;
  const fromClass = isUser ? 'message-from broadcast-from' : 'message-from';
  const fc = !isUser && fid ? getAgentColor(fid) : null;
  const fs = fc ? ` style="color: ${fc}"` : '';
  e.innerHTML = `<span class="msg-remove" title="Remove">&times;</span><div class="message-meta"><span class="${fromClass}"${fs}>${esc(fn)}</span> &rarr; <span class="message-to">${esc(tn)}</span> &middot; ${esc(t)}</div><div class="message-content">${esc(msg.content || '')}</div>`;
  e.querySelector('.msg-remove').addEventListener('click', async () => { if (msg.id) await window.electronAPI.removeMessage(msg.id); e.remove(); });
  return e;
}

export async function restoreArchivedMessages() {
  const a = await window.electronAPI.getArchivedMessages(); if (!a || a.length === 0) return 0;
  await window.electronAPI.restoreAllMessages();
  loadMessages(await window.electronAPI.getMessages());
  return a.length;
}

function showArchiveModal() {
  const modal = document.getElementById('archive-modal');
  const pd = document.getElementById('archive-path-display');
  const cc = document.getElementById('archive-clear-on-save');
  const bb = document.getElementById('archive-select-dir');
  const sb = document.getElementById('archive-save');
  const cb = document.getElementById('archive-cancel');
  const clb = document.getElementById('archive-clear-only');
  pd.textContent = ''; pd.dataset.path = ''; cc.checked = true; modal.classList.remove('hidden');
  let done = false;
  function fin() { if (done) return; done = true; modal.classList.add('hidden'); document.removeEventListener('keydown', ok); bb.removeEventListener('click', ob); sb.removeEventListener('click', os); cb.removeEventListener('click', oc); clb.removeEventListener('click', ocl); }
  function ok(e) { if (e.key === 'Escape') fin(); }
  function oc() { fin(); }
  async function ocl() {
    // Hide archive modal, show confirm modal
    modal.classList.add('hidden');
    const confirmed = await showConfirmDialog('Clear Discussion', 'This will clear all messages from the discussion without saving to a file. Are you sure?');
    if (!confirmed) { modal.classList.remove('hidden'); return; }
    await window.electronAPI.clearMessages();
    if (msgListEl) msgListEl.innerHTML = '';
    fin();
  }
  async function ob() {
    const fp = await window.electronAPI.saveFileDialog({ title: 'Save Discussion Archive', defaultPath: 'discussion-archive.csv', filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'Text', extensions: ['txt'] }] });
    if (fp) { pd.textContent = fp; pd.dataset.path = fp; pd.title = fp; }
  }
  async function os() {
    const fp = pd.dataset.path; if (!fp) { pd.textContent = 'Please select a location'; pd.style.color = 'var(--danger)'; setTimeout(() => pd.style.color = '', 2000); return; }
    if (!msgListEl) { fin(); return; }
    const entries = msgListEl.querySelectorAll('.message-entry');
    const rows = ['Date,Sender,Target,Message'];
    for (const en of entries) {
      const me = en.querySelector('.message-meta'); const fr = me?.querySelector('.message-from')?.textContent?.trim() || '';
      const to = me?.querySelector('.message-to')?.textContent?.trim() || ''; const mt = me?.textContent || '';
      const tm = mt.match(/·\s*(.+)$/); const ti = tm ? tm[1].trim() : '';
      const co = en.querySelector('.message-content')?.textContent?.trim() || '';
      const cf = (s) => (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
      rows.push(`${cf(ti)},${cf(fr)},${cf(to)},${cf(co)}`);
    }
    await window.electronAPI.writeTextFile(fp, rows.join('\n'));
    if (cc.checked) { await window.electronAPI.clearMessages(); if (msgListEl) msgListEl.innerHTML = ''; }
    fin();
  }
  document.addEventListener('keydown', ok); bb.addEventListener('click', ob); sb.addEventListener('click', os); cb.addEventListener('click', oc); clb.addEventListener('click', ocl);
}

function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-dialog" style="width:380px"><h2>${esc(title)}</h2><p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">${esc(message)}</p><div class="modal-actions"><button class="modal-btn-secondary" id="confirm-no">Cancel</button><button class="modal-btn-danger" id="confirm-yes">Clear</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#confirm-yes').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.querySelector('#confirm-no').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { overlay.remove(); resolve(false); } });
    overlay.querySelector('#confirm-no').focus();
  });
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
