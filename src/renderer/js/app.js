import '@xterm/xterm/css/xterm.css';
import 'golden-layout/dist/css/goldenlayout-base.css';

import { GoldenLayout, ItemType } from 'golden-layout';
import { createAgentPanel, removeAgentPanel, writeToTerminal, getActiveAgents, fitAll, assignAgentColor, resetColorIndex, getNextDefaultColor, getThemeColors, getColorHex, refreshAgentColors, initTerminalFontSize, AGENT_COLOR_DEFS } from './agent-panel.js';
import { initMessagePanel, initMasterInput, initMessageFilter, initGlobalMessageListeners, loadMessages } from './message-panel.js';
import { initTaskPanel, loadTasks } from './task-panel.js';
import { initDevOpsPanel } from './devops-panel.js';
import { initWorkItemsPanel, loadWorkItems } from './workitems-panel.js';
import { initAgentDropdown } from './agent-dropdown.js';

// Agent layout (left panel, internal GL for agent terminals)
let agentLayout = null;
let agentLayoutMode = 'tabs';
let isTogglingAgentLayout = false;

// Dock layout (right panel, GL for Discussion + Tasks)
let dockLayout = null;
let serverPort = null;

// ── Default dock config (Discussion + Tasks tabbed) ──
function getDefaultDockConfig() {
  return {
    root: {
      type: ItemType.stack,
      content: [
        { type: 'component', componentType: 'discussion', title: 'Discussion', isClosable: true },
        { type: 'component', componentType: 'tasks', title: 'Tasks', isClosable: true },
        { type: 'component', componentType: 'workitems', title: 'Work Items', isClosable: true },
      ],
    },
  };
}

// ── Session state ──
function enterSessionState() {
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('main-area').classList.remove('hidden');
  document.getElementById('agent-dropdown-container').classList.remove('hidden');
  if (dockLayout) dockLayout.loadLayout(getDefaultDockConfig());
  updateEmptyState();
}

function enterNoSessionState() {
  document.getElementById('welcome-screen').classList.remove('hidden');
  document.getElementById('main-area').classList.add('hidden');
  document.getElementById('agent-dropdown-container').classList.add('hidden');
  document.getElementById('session-label').textContent = '';
  document.getElementById('session-label').title = '';
  document.title = 'Claude Team Session';
  if (agentLayout && agentLayout.rootItem) { isTogglingAgentLayout = true; agentLayout.clear(); isTogglingAgentLayout = false; }
  if (dockLayout && dockLayout.rootItem) dockLayout.clear();
  resetColorIndex();
}

function updateEmptyState() {
  const container = document.getElementById('agent-gl-container');
  const prompt = document.getElementById('empty-agent-prompt');
  const hasAgents = getActiveAgents().size > 0;
  if (hasAgents) {
    container.classList.remove('empty');
    if (prompt) prompt.classList.add('hidden');
  } else {
    container.classList.add('empty');
    if (prompt) prompt.classList.remove('hidden');
  }
}

function updateSessionLabel(sessionPath, sessionName) {
  const label = document.getElementById('session-label');
  const editBtn = document.getElementById('btn-edit-name');
  if (sessionName) {
    label.textContent = sessionName; label.title = sessionPath || '';
    document.title = `Claude Team Session - ${sessionName}`; editBtn.classList.remove('hidden');
  } else if (sessionPath) {
    const fn = sessionPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
    if (fn.startsWith('temp')) { label.textContent = '(unsaved)'; label.title = ''; document.title = 'Claude Team Session'; editBtn.classList.add('hidden'); }
    else { const n = fn.replace(/\.cms$/i, ''); label.textContent = n; label.title = sessionPath; document.title = `Claude Team Session - ${n}`; editBtn.classList.remove('hidden'); }
  } else { label.textContent = ''; label.title = ''; document.title = 'Claude Team Session'; editBtn.classList.add('hidden'); }
}

function promptSessionName(title, defaultName) {
  return new Promise((resolve) => {
    const modal = document.getElementById('name-modal');
    const titleEl = document.getElementById('name-modal-title');
    const input = document.getElementById('modal-session-name');
    const okBtn = document.getElementById('name-modal-ok');
    const cancelBtn = document.getElementById('name-modal-cancel');
    titleEl.textContent = title || 'Save Session';
    okBtn.textContent = title === 'Rename Session' ? 'Rename' : 'Save';
    input.value = defaultName || ''; modal.classList.remove('hidden'); input.focus(); input.select();
    let resolved = false;
    function finish(r) { if (resolved) return; resolved = true; modal.classList.add('hidden'); document.removeEventListener('keydown', onKey); okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel); resolve(r); }
    function onOk() { const n = input.value.trim(); if (n) finish(n); }
    function onCancel() { finish(null); }
    function onKey(e) { if (e.key === 'Escape') finish(null); if (e.key === 'Enter') onOk(); }
    okBtn.addEventListener('click', onOk); cancelBtn.addEventListener('click', onCancel); document.addEventListener('keydown', onKey);
  });
}

// ── Agent layout (left panel) ──
function initAgentLayout() {
  const container = document.getElementById('agent-gl-container');
  agentLayout = new GoldenLayout(container);
  agentLayout.registerComponentFactoryFunction('agent', createAgentComponent);
  container.classList.add('empty');
}

function createAgentComponent(container, state) {
  const agentId = state.agentId;
  const agentColorId = state.agentColorId || 'blue';
  const agentColorHex = getColorHex(agentColorId);
  const { terminal, fitAddon } = createAgentPanel(container.element, agentId, state.agentName, state.agentCwd, container, agentColorId);
  setTimeout(() => { if (container.tab && container.tab.element) container.tab.element.style.borderTop = `2px solid ${agentColorHex}`; }, 50);
  container.on('resize', () => { setTimeout(() => { fitAddon.fit(); window.electronAPI.resizeAgent(agentId, terminal.cols, terminal.rows); }, 50); });
  container.on('destroy', () => { if (!isTogglingAgentLayout) window.electronAPI.killAgent(agentId); removeAgentPanel(agentId); setTimeout(updateEmptyState, 50); });
}

function setAgentLayoutMode(mode) {
  if (mode === agentLayoutMode || !agentLayout) return;
  const agents = getActiveAgents();
  if (agents.size === 0) { agentLayoutMode = mode; window.electronAPI.setSetting('agentLayoutMode', mode); window.electronAPI.rebuildMenu(); return; }
  const configs = [];
  for (const [id, entry] of agents) {
    configs.push({ type: 'component', componentType: 'agent', title: entry.name, isClosable: true,
      componentState: { agentId: id, agentName: entry.name, agentCwd: entry.container.querySelector('.agent-dir')?.title || '', agentColorId: entry.colorId } });
  }
  agentLayoutMode = mode;
  window.electronAPI.setSetting('agentLayoutMode', mode);
  window.electronAPI.rebuildMenu();
  isTogglingAgentLayout = true; agentLayout.clear(); isTogglingAgentLayout = false;
  const rootType = mode === 'tabs' ? ItemType.stack : mode === 'stacked' ? ItemType.column : ItemType.row;
  agentLayout.loadLayout({ root: { type: rootType, content: configs } });
}

// ── Dock layout (right panel — Discussion + Tasks) ──
function initDockLayout() {
  const container = document.getElementById('dock-container');
  dockLayout = new GoldenLayout(container);

  dockLayout.registerComponentFactoryFunction('discussion', function (glContainer) {
    const el = glContainer.element;
    el.innerHTML = `
      <div class="discussion-inner">
        <div class="disc-port-bar">
          <label>Port:</label>
          <input type="number" class="disc-port-input" min="1024" max="65535">
          <button class="disc-restart-btn">Restart</button>
          <span style="flex:1"></span>
          <button class="disc-filter-toggle" title="Filter messages">&#x1F50D;</button>
          <button class="disc-archive-btn" title="Archive discussion">Archive</button>
        </div>
        <div class="disc-filter-bar" style="display:none">
          <div class="disc-filter-sender-dropdown"><span class="dropdown-label">All senders</span><div class="dropdown-menu"></div></div>
          <input type="text" class="disc-filter-search" placeholder="Search messages...">
          <button class="disc-filter-clear" title="Clear filters">Clear</button>
        </div>
        <div class="disc-message-list"></div>
        <div class="disc-input-error" style="display:none"></div>
        <div class="disc-master-bar">
          <textarea class="disc-master-input" placeholder="Broadcast to all agents... (Enter to send, Shift+Enter for newline)" rows="6"></textarea>
          <button class="disc-broadcast-btn">Send</button>
        </div>
        <div class="panel-statusbar">
          <select class="disc-zoom-select" title="Discussion zoom">
            <option value="75">75%</option><option value="85">85%</option>
            <option value="100" selected>100%</option><option value="115">115%</option>
            <option value="130">130%</option><option value="150">150%</option>
          </select>
        </div>
      </div>`;
    initMessagePanel(el);
    initMasterInput(el);
    initMessageFilter(el);
    setupTabDragSwitch(glContainer);
  });

  dockLayout.registerComponentFactoryFunction('tasks', function (glContainer) {
    const el = glContainer.element;
    el.innerHTML = `
      <div class="tasks-inner">
        <div class="tasks-list"></div>
        <div class="tasks-input-bar">
          <textarea class="tasks-input" placeholder="Add a task... (Enter to add, Shift+Enter for newline)" rows="6"></textarea>
          <button class="tasks-add-btn">Add</button>
        </div>
        <div class="panel-statusbar">
          <select class="tasks-zoom-select" title="Tasks zoom">
            <option value="75">75%</option><option value="85">85%</option>
            <option value="100" selected>100%</option><option value="115">115%</option>
            <option value="130">130%</option><option value="150">150%</option>
          </select>
        </div>
      </div>`;
    initTaskPanel(el);
  });

  dockLayout.registerComponentFactoryFunction('devops', function (glContainer) {
    const el = glContainer.element;
    el.innerHTML = `
      <div class="devops-inner">
        <div class="devops-toolbar">
          <button class="devops-back-btn" style="display:none">&larr; Back</button>
          <span class="devops-breadcrumb"></span>
          <span style="flex:1"></span>
          <button class="devops-disconnect-btn devops-btn devops-btn-small" style="display:none">Disconnect</button>
        </div>
        <div class="devops-content"></div>
        <div class="panel-statusbar">
          <select class="devops-zoom-select" title="DevOps zoom">
            <option value="75">75%</option><option value="85">85%</option>
            <option value="100" selected>100%</option><option value="115">115%</option>
            <option value="130">130%</option><option value="150">150%</option>
          </select>
        </div>
      </div>`;
    initDevOpsPanel(el);
  });

  dockLayout.registerComponentFactoryFunction('workitems', function (glContainer) {
    const el = glContainer.element;
    el.innerHTML = `
      <div class="workitems-inner">
        <div class="workitems-toolbar">
          <span class="workitems-heading">Work Items (0)</span>
          <span class="workitems-api-info"></span>
          <span style="flex:1"></span>
          <button class="workitems-refresh-btn" title="Refresh">&#x21bb; Refresh</button>
        </div>
        <div class="workitems-filter-bar">
          <select class="workitems-filter-type workitems-select"><option value="">All Types</option></select>
          <select class="workitems-filter-state workitems-select"><option value="">All States</option></select>
          <input type="date" class="workitems-filter-date-from workitems-input" title="Imported from">
          <input type="date" class="workitems-filter-date-to workitems-input" title="Imported to">
          <input type="text" class="workitems-filter-search workitems-input" placeholder="Search...">
          <button class="workitems-filter-clear" title="Clear filters">Clear</button>
          <span style="flex:1"></span>
          <span class="workitems-sort-group">
            <span class="workitems-sort-label">Sort:</span>
            <button class="workitems-sort-btn" data-sort="type">Type</button>
            <button class="workitems-sort-btn" data-sort="state">State</button>
            <button class="workitems-sort-btn" data-sort="title">Title</button>
            <button class="workitems-sort-btn active" data-sort="imported_at" data-dir="desc">Date</button>
            <button class="workitems-sort-btn" data-sort="id">ID</button>
          </span>
        </div>
        <div class="workitems-list"></div>
        <div class="panel-statusbar">
          <select class="workitems-zoom-select" title="Work Items zoom">
            <option value="75">75%</option><option value="85">85%</option>
            <option value="100" selected>100%</option><option value="115">115%</option>
            <option value="130">130%</option><option value="150">150%</option>
          </select>
        </div>
      </div>`;
    initWorkItemsPanel(el);
  });
}

function setupTabDragSwitch(glContainer) {
  let attempts = 0;
  const trySetup = () => {
    if (glContainer.tab && glContainer.tab.element) {
      glContainer.tab.element.addEventListener('dragover', (e) => { e.preventDefault(); try { glContainer.focus(); } catch (err) {} });
    } else if (attempts < 20) { attempts++; setTimeout(trySetup, 100); }
  };
  trySetup();
}

// ── Splitter ──
function initPanelSplitter() {
  const splitter = document.getElementById('panel-splitter');
  const dockEl = document.getElementById('dock-container');
  const mainArea = document.getElementById('main-area');
  let isDragging = false;
  splitter.addEventListener('mousedown', (e) => { isDragging = true; splitter.classList.add('dragging'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault(); });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const r = mainArea.getBoundingClientRect();
    const w = Math.max(r.width * 0.15, Math.min(r.right - e.clientX, r.width * 0.6));
    dockEl.style.width = w + 'px';
    if (agentLayout) agentLayout.updateSizeFromContainer();
    if (dockLayout) dockLayout.updateSizeFromContainer();
  });
  document.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; splitter.classList.remove('dragging'); document.body.style.cursor = ''; document.body.style.userSelect = ''; fitAll(); } });
}

// ── Add agent ──
async function addAgent(agentId, agentName, agentCwd, agentColorId, autoPermissions, updateClaudeMd) {
  if (!agentLayout) return null;
  const colorId = assignAgentColor(agentColorId);
  const agent = await window.electronAPI.createAgent({ agentId, name: agentName, cwd: agentCwd, autoPermissions: autoPermissions !== false, updateClaudeMd: updateClaudeMd !== false });
  const config = { type: 'component', componentType: 'agent', title: agent.name, isClosable: true,
    componentState: { agentId: agent.id, agentName: agent.name, agentCwd: agent.cwd, agentColorId: colorId } };
  if (!agentLayout.rootItem) {
    const rootType = agentLayoutMode === 'tabs' ? ItemType.stack : agentLayoutMode === 'stacked' ? ItemType.column : ItemType.row;
    agentLayout.loadLayout({ root: { type: rootType, content: [config] } });
    // First agent: GL just created the root so dimensions aren't ready yet.
    // Force a layout recalculation after the browser has a chance to paint.
    requestAnimationFrame(() => {
      agentLayout.updateSizeFromContainer();
      setTimeout(() => { agentLayout.updateSizeFromContainer(); fitAll(); }, 200);
    });
  } else {
    if (agentLayoutMode === 'tabs') agentLayout.addComponent('agent', config.componentState, agent.name);
    else agentLayout.addItemAtLocation(config, [{ typeId: 3 }]);
  }
  updateEmptyState();
  return agent;
}

function nextAgentName() { return `Agent${getActiveAgents().size + 1}`; }

const CLAUDE_MD_INFO_TEXT = 'Unchecking this box will switch to using a separate file for the agent and tell it to use that. This should work, but if the agent doesn\'t get the prompt for any reason, you will need to reinitialise the agent using the Agents menu.';

function showNewAgentModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('new-agent-modal');
    const nameInput = document.getElementById('modal-agent-name');
    const pathDisplay = document.getElementById('modal-agent-path');
    const swatchContainer = document.getElementById('modal-color-swatches');
    const claudeMdCheckbox = document.getElementById('modal-update-claude-md');
    claudeMdCheckbox.checked = true;
    nameInput.value = nextAgentName(); pathDisplay.textContent = ''; pathDisplay.dataset.path = ''; pathDisplay.style.color = '';
    swatchContainer.innerHTML = '';
    const defaultColorId = getNextDefaultColor(); let selectedColorId = defaultColorId;
    getThemeColors().forEach(({ id, hex }) => {
      const swatch = document.createElement('div'); swatch.className = 'color-swatch'; swatch.style.backgroundColor = hex; swatch.title = id;
      if (id === defaultColorId) swatch.classList.add('selected');
      swatch.addEventListener('click', () => { swatchContainer.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected')); swatch.classList.add('selected'); selectedColorId = id; });
      swatchContainer.appendChild(swatch);
    });
    modal.classList.remove('hidden'); nameInput.focus(); nameInput.select();
    let resolved = false;
    function finish(r) { if (resolved) return; resolved = true; modal.classList.add('hidden'); document.removeEventListener('keydown', onKd); claudeMdCheckbox.removeEventListener('change', onClaudeMdChange); resolve(r); }
    function onKd(e) { if (e.key === 'Escape') finish(null); }
    document.addEventListener('keydown', onKd);
    function showClaudeMdInfo() {
      window.electronAPI.showInfoDialog('CLAUDE.md', CLAUDE_MD_INFO_TEXT);
    }
    function onClaudeMdChange() {
      if (!claudeMdCheckbox.checked) {
        showClaudeMdInfo();
      }
    }
    claudeMdCheckbox.addEventListener('change', onClaudeMdChange);
    function onModalClick(e) {
      if (e.target.id === 'modal-claude-md-info') { showClaudeMdInfo(); }
      else if (e.target.id === 'modal-select-dir') { window.electronAPI.openDirectoryDialog().then((d) => { if (d) { pathDisplay.textContent = d; pathDisplay.dataset.path = d; pathDisplay.title = d; pathDisplay.style.color = ''; } }); }
      else if (e.target.id === 'modal-create-btn') {
        const name = (nameInput.value.trim() || nextAgentName()).replace(/\s+/g, ''); const dir = pathDisplay.dataset.path;
        if (!dir) { pathDisplay.textContent = 'Please select a directory'; pathDisplay.style.color = '#f44747'; return; }
        modal.removeEventListener('click', onModalClick);
        finish({ name, dir, colorId: selectedColorId, autoPermissions: document.getElementById('modal-auto-permissions').checked, updateClaudeMd: claudeMdCheckbox.checked });
      } else if (e.target.id === 'modal-cancel-btn') { modal.removeEventListener('click', onModalClick); finish(null); }
    }
    modal.addEventListener('click', onModalClick);
  });
}

async function handleNewAgent() { const r = await showNewAgentModal(); if (!r) return; await addAgent(null, r.name, r.dir, r.colorId, r.autoPermissions, r.updateClaudeMd); }
async function handleRestoreAgent(agent) { if (!await window.electronAPI.isSessionOpen()) return; await addAgent(agent.id, agent.name, agent.cwd); }

// ── Session operations ──
async function createAndEnterSession() { const sp = await window.electronAPI.newSession(); if (sp) { resetColorIndex(); enterSessionState(); updateSessionLabel(sp); window.electronAPI.rebuildMenu(); } }

async function openSessionFromFile(fp) {
  const r = await window.electronAPI.openSessionFile(fp);
  if (r) { resetColorIndex(); enterSessionState(); const sn = await window.electronAPI.getSessionName(); updateSessionLabel(r.filePath, sn);
    if (r.agents && r.agents.length > 0) for (const a of r.agents) await addAgent(a.id, a.name, a.cwd);
    window.electronAPI.rebuildMenu(); }
}

async function openAndEnterSession() {
  const r = await window.electronAPI.openSession();
  if (r) { resetColorIndex(); enterSessionState(); const sn = await window.electronAPI.getSessionName(); updateSessionLabel(r.filePath, sn);
    if (r.agents && r.agents.length > 0) for (const a of r.agents) await addAgent(a.id, a.name, a.cwd);
    window.electronAPI.rebuildMenu(); }
}

async function removeAllAgents() { if (!agentLayout || getActiveAgents().size === 0) return; agentLayout.clear(); updateEmptyState(); }

function addDockPanelIfMissing(type, title) {
  if (!dockLayout || !dockLayout.rootItem) { dockLayout.loadLayout({ root: { type: 'component', componentType: type, title } }); return; }
  let found = false;
  function search(item) { if (item.componentType === type) found = true; if (item.contentItems) item.contentItems.forEach(search); }
  search(dockLayout.rootItem);
  if (!found) dockLayout.addComponent(type, {}, title);
}

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  initAgentLayout();
  initDockLayout();
  initGlobalMessageListeners();
  initAgentDropdown(handleNewAgent, handleRestoreAgent);
  initPanelSplitter();
  initTerminalFontSize();

  // Load persisted layout mode
  window.electronAPI.getSetting('agentLayoutMode').then((mode) => {
    if (mode && ['side-by-side', 'stacked', 'tabs'].includes(mode)) {
      agentLayoutMode = mode;
    }
  });

  enterNoSessionState();

  window.addEventListener('resize', () => { if (agentLayout) agentLayout.updateSizeFromContainer(); if (dockLayout) dockLayout.updateSizeFromContainer(); });

  window.electronAPI.onPromptSaveName(async () => { window.electronAPI.sendSaveNameResult(await promptSessionName('Save Session', '') || null); });

  document.getElementById('btn-create-session').addEventListener('click', createAndEnterSession);
  document.getElementById('btn-open-session').addEventListener('click', openAndEnterSession);

  // Inline name editing
  const nameDisplay = document.getElementById('session-name-display');
  const nameEditDiv = document.getElementById('session-name-edit');
  const nameInput = document.getElementById('session-name-input');
  document.getElementById('btn-edit-name').addEventListener('click', () => { nameInput.value = document.getElementById('session-label').textContent; nameDisplay.classList.add('hidden'); nameEditDiv.classList.remove('hidden'); nameInput.focus(); nameInput.select(); });
  async function finishNameEdit() { const n = nameInput.value.trim(); if (n) { await window.electronAPI.renameSession(n); updateSessionLabel(await window.electronAPI.getSessionPath(), n); window.electronAPI.rebuildMenu(); } nameEditDiv.classList.add('hidden'); nameDisplay.classList.remove('hidden'); }
  function cancelNameEdit() { nameEditDiv.classList.add('hidden'); nameDisplay.classList.remove('hidden'); }
  document.getElementById('btn-save-name').addEventListener('click', finishNameEdit);
  document.getElementById('btn-cancel-name').addEventListener('click', cancelNameEdit);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') finishNameEdit(); if (e.key === 'Escape') cancelNameEdit(); });

  document.getElementById('btn-empty-new-agent').addEventListener('click', handleNewAgent);

  window.electronAPI.onAgentData((id, data) => writeToTerminal(id, data));
  window.electronAPI.onAgentExit((id, code) => { const e = getActiveAgents().get(id); if (e) e.terminal.writeln(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m`); });

  window.electronAPI.onSessionRestored(async (data) => {
    if (data.sessionPath) { enterSessionState(); updateSessionLabel(data.sessionPath, await window.electronAPI.getSessionName()); }
    if (data.agents && data.agents.length > 0) for (const a of data.agents) await addAgent(a.id, a.name, a.cwd);
    updateEmptyState(); window.electronAPI.rebuildMenu();
  });

  window.electronAPI.onServerPort((p) => { serverPort = p; });

  // Menu handlers
  async function closeCurrentSession(opts) { const r = await window.electronAPI.closeSession(opts); if (r === 'needs-name') { const n = await promptSessionName('Save Session', ''); if (!n) return false; await window.electronAPI.saveSession(n); await window.electronAPI.closeSession(opts); return true; } return !!r; }
  window.electronAPI.onMenuEvent('menu:newSession', async () => { if (await window.electronAPI.isSessionOpen()) { if (!await closeCurrentSession({ forNewSession: true })) return; enterNoSessionState(); } await createAndEnterSession(); });
  window.electronAPI.onMenuEvent('menu:openSession', async () => { if (await window.electronAPI.isSessionOpen()) { if (!await closeCurrentSession()) return; enterNoSessionState(); } await openAndEnterSession(); });
  window.electronAPI.onMenuEvent('menu:openRecentFile', async (fp) => { if (await window.electronAPI.isSessionOpen()) { if (!await closeCurrentSession()) return; enterNoSessionState(); } await openSessionFromFile(fp); });
  window.electronAPI.onMenuEvent('menu:saveSession', async () => {
    if (await window.electronAPI.isSessionTemp()) { const n = await promptSessionName('Save Session', ''); if (!n) return; const r = await window.electronAPI.saveSession(n); if (r) { updateSessionLabel(r.filePath, r.sessionName); window.electronAPI.rebuildMenu(); } }
    else { const r = await window.electronAPI.saveSession(); if (r) updateSessionLabel(r.filePath, r.sessionName); }
  });
  window.electronAPI.onMenuEvent('menu:saveSessionAs', async () => {
    const r = await window.electronAPI.saveSessionAs();
    if (r) { updateSessionLabel(r.filePath, r.sessionName); window.electronAPI.rebuildMenu(); }
  });
  window.electronAPI.onMenuEvent('menu:closeSession', async () => { if (await closeCurrentSession()) { enterNoSessionState(); window.electronAPI.rebuildMenu(); } });
  window.electronAPI.onMenuEvent('menu:renameSession', async () => { const cn = await window.electronAPI.getSessionName() || ''; const n = await promptSessionName('Rename Session', cn); if (!n) return; await window.electronAPI.renameSession(n); updateSessionLabel(await window.electronAPI.getSessionPath(), n); window.electronAPI.rebuildMenu(); });
  window.electronAPI.onMenuEvent('menu:newAgent', async () => { if (!await window.electronAPI.isSessionOpen()) { const sp = await window.electronAPI.ensureSessionOpen(); if (!sp) return; enterSessionState(); updateSessionLabel(sp); } await handleNewAgent(); });
  window.electronAPI.onMenuEvent('menu:reinitialiseAgents', () => window.electronAPI.reinitialiseAgents());
  window.electronAPI.onMenuEvent('menu:removeAllAgents', removeAllAgents);
  window.electronAPI.onMenuEvent('menu:setLayout', setAgentLayoutMode);
  window.electronAPI.onMenuEvent('menu:showDiscussion', () => addDockPanelIfMissing('discussion', 'Discussion'));
  window.electronAPI.onMenuEvent('menu:showTasks', () => addDockPanelIfMissing('tasks', 'Tasks'));
  window.electronAPI.onMenuEvent('menu:showDevOps', () => addDockPanelIfMissing('devops', 'Azure DevOps'));
  window.electronAPI.onMenuEvent('menu:showWorkItems', () => { addDockPanelIfMissing('workitems', 'Work Items'); loadWorkItems(); });
  window.electronAPI.onMenuEvent('menu:clearSettings', async () => { await window.electronAPI.clearAllSettings(); });
});
