import '@xterm/xterm/css/xterm.css';
import 'golden-layout/dist/css/goldenlayout-base.css';

import { GoldenLayout, ItemType } from 'golden-layout';
import { createAgentPanel, removeAgentPanel, writeToTerminal, getActiveAgents, fitAll, assignAgentColor, resetColorIndex, getNextDefaultColor, getThemeColors, getColorHex, setColorTheme, getColorTheme, refreshAgentColors, initTerminalFontSize, AGENT_COLOR_DEFS } from './agent-panel.js';
import { initMessagePanel, loadMessages, toggleAgentsPanel } from './message-panel.js';
import { initMasterInput } from './master-input.js';
import { initAgentDropdown } from './agent-dropdown.js';
import { initTaskPanel, loadTasks } from './task-panel.js';

let goldenLayout = null;
let serverPort = null;
let layoutMode = 'side-by-side'; // 'side-by-side', 'stacked', or 'tabs'
let isTogglingLayout = false;

function enterSessionState() {
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('main-area').classList.remove('hidden');
  document.getElementById('agent-dropdown-container').classList.remove('hidden');
  document.getElementById('session-label').textContent = '';
  document.getElementById('session-label').title = '';
  updateEmptyState();
}

function enterNoSessionState() {
  document.getElementById('welcome-screen').classList.remove('hidden');
  document.getElementById('main-area').classList.add('hidden');
  document.getElementById('agent-dropdown-container').classList.add('hidden');
  document.getElementById('session-label').textContent = '';
  document.getElementById('session-label').title = '';
  document.title = 'Claude Session Manager';
  clearLayout();
  resetColorIndex();
}

function clearLayout() {
  if (goldenLayout && goldenLayout.rootItem) {
    isTogglingLayout = true;
    goldenLayout.clear();
    isTogglingLayout = false;
  }
  document.getElementById('layout-container').classList.add('empty');
  document.getElementById('message-list').innerHTML = '';
  updateEmptyState();
}

function updateEmptyState() {
  const container = document.getElementById('layout-container');
  const emptyPrompt = document.getElementById('empty-agent-prompt');
  const hasAgents = getActiveAgents().size > 0;
  if (hasAgents) {
    container.classList.remove('empty');
    if (emptyPrompt) emptyPrompt.classList.add('hidden');
  } else {
    container.classList.add('empty');
    if (emptyPrompt) emptyPrompt.classList.remove('hidden');
  }
}

function updateSessionLabel(sessionPath, sessionName) {
  const label = document.getElementById('session-label');
  const editBtn = document.getElementById('btn-edit-name');
  if (sessionName) {
    label.textContent = sessionName;
    label.title = sessionPath || '';
    document.title = `Claude Session Manager - ${sessionName}`;
    editBtn.classList.remove('hidden');
  } else if (sessionPath) {
    const fileName = sessionPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
    if (fileName.startsWith('temp')) {
      label.textContent = '(unsaved)';
      label.title = '';
      document.title = 'Claude Session Manager';
      editBtn.classList.add('hidden');
    } else {
      const name = fileName.replace(/\.cms$/i, '');
      label.textContent = name;
      label.title = sessionPath;
      document.title = `Claude Session Manager - ${name}`;
      editBtn.classList.remove('hidden');
    }
  } else {
    label.textContent = '';
    label.title = '';
    document.title = 'Claude Session Manager';
    editBtn.classList.add('hidden');
  }
}

// Prompt user for a session name via modal. Returns the name or null if cancelled.
function promptSessionName(title, defaultName) {
  return new Promise((resolve) => {
    const modal = document.getElementById('name-modal');
    const titleEl = document.getElementById('name-modal-title');
    const input = document.getElementById('modal-session-name');
    const okBtn = document.getElementById('name-modal-ok');
    const cancelBtn = document.getElementById('name-modal-cancel');

    titleEl.textContent = title || 'Save Session';
    okBtn.textContent = title === 'Rename Session' ? 'Rename' : 'Save';
    input.value = defaultName || '';
    modal.classList.remove('hidden');
    input.focus();
    input.select();

    let resolved = false;
    function finish(result) {
      if (resolved) return;
      resolved = true;
      modal.classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() {
      const name = input.value.trim();
      if (name) finish(name);
    }
    function onCancel() { finish(null); }
    function onKey(e) {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter') onOk();
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

function updateLayoutToggleIcon() {
  const btn = document.getElementById('btn-toggle-layout');
  if (btn) {
    const icons = { 'side-by-side': '\u2630', 'stacked': '\u2503', 'tabs': '\u2637' };
    const titles = { 'side-by-side': 'Switch to stacked view', 'stacked': 'Switch to tab view', 'tabs': 'Switch to side-by-side view' };
    btn.textContent = icons[layoutMode] || '\u2630';
    btn.title = titles[layoutMode] || '';
  }
  // Set body class for CSS (hide tab headers in non-tab modes)
  document.body.classList.toggle('layout-side-by-side', layoutMode === 'side-by-side');
  document.body.classList.toggle('layout-stacked', layoutMode === 'stacked');
  document.body.classList.toggle('layout-tabs', layoutMode === 'tabs');
}

function setLayoutMode(mode) {
  if (mode === layoutMode) return;
  const agents = getActiveAgents();
  if (agents.size === 0) {
    layoutMode = mode;
    updateLayoutToggleIcon();
    return;
  }

  // Collect all agent component states
  const componentConfigs = [];
  for (const [agentId, entry] of agents) {
    componentConfigs.push({
      type: 'component',
      componentType: 'agent',
      title: entry.name,
      isClosable: true,
      componentState: {
        agentId,
        agentName: entry.name,
        agentCwd: entry.container.querySelector('.agent-dir')?.textContent || '',
        agentColorId: entry.colorId,
      },
    });
  }

  layoutMode = mode;
  updateLayoutToggleIcon();

  // Rebuild layout without killing agents
  isTogglingLayout = true;
  goldenLayout.clear();
  isTogglingLayout = false;

  const rootType = layoutMode === 'tabs' ? ItemType.stack : layoutMode === 'stacked' ? ItemType.column : ItemType.row;
  goldenLayout.loadLayout({
    root: {
      type: rootType,
      content: componentConfigs,
    },
  });

  setTimeout(updateTabAddButton, 100);
}

function toggleLayout() {
  const cycle = { 'side-by-side': 'stacked', 'stacked': 'tabs', 'tabs': 'side-by-side' };
  setLayoutMode(cycle[layoutMode] || 'side-by-side');
}

function updateTabAddButton() {
  // Remove any existing tab add buttons — no longer needed
  document.querySelectorAll('.tab-add-btn').forEach(b => b.remove());
}

function initPanelSplitter() {
  const splitter = document.getElementById('panel-splitter');
  const messagePanel = document.getElementById('message-panel');
  const mainArea = document.getElementById('main-area');
  let isDragging = false;

  splitter.addEventListener('mousedown', (e) => {
    isDragging = true;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const mainRect = mainArea.getBoundingClientRect();
    const newWidth = mainRect.right - e.clientX;
    const minWidth = mainRect.width * 0.2;
    const maxWidth = mainRect.width * 0.8;
    const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
    messagePanel.style.width = clampedWidth + 'px';
    if (goldenLayout) {
      goldenLayout.updateSizeFromContainer();
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      splitter.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      fitAll();
    }
  });
}

function initGoldenLayout() {
  const container = document.getElementById('layout-container');

  goldenLayout = new GoldenLayout(container);

  goldenLayout.registerComponentFactoryFunction('agent', function (container, state) {
    const agentId = state.agentId;
    const agentName = state.agentName;
    const agentCwd = state.agentCwd;
    const agentColorId = state.agentColorId || state.agentColor || 'blue';
    const agentColorHex = getColorHex(agentColorId);

    const { terminal, fitAddon } = createAgentPanel(
      container.element,
      agentId,
      agentName,
      agentCwd,
      container,
      agentColorId
    );

    setTimeout(() => {
      if (container.tab && container.tab.element) {
        container.tab.element.style.borderTop = `2px solid ${agentColorHex}`;
      }
    }, 50);

    container.on('resize', () => {
      setTimeout(() => {
        fitAddon.fit();
        window.electronAPI.resizeAgent(agentId, terminal.cols, terminal.rows);
      }, 50);
    });

    container.on('destroy', () => {
      if (!isTogglingLayout) {
        window.electronAPI.killAgent(agentId);
      }
      removeAgentPanel(agentId);
      // Update empty state and tab button after a tick (GL needs to finish cleanup)
      setTimeout(() => { updateEmptyState(); updateTabAddButton(); }, 50);
    });
  });

  container.classList.add('empty');
}

async function addAgent(agentId, agentName, agentCwd, agentColorId, autoPermissions) {
  const container = document.getElementById('layout-container');
  container.classList.remove('empty');
  const emptyPrompt = document.getElementById('empty-agent-prompt');
  if (emptyPrompt) emptyPrompt.classList.add('hidden');

  const colorId = assignAgentColor(agentColorId);

  const agent = await window.electronAPI.createAgent({
    agentId,
    name: agentName,
    cwd: agentCwd,
    autoPermissions: autoPermissions !== false, // default true for restored agents
  });

  const componentConfig = {
    type: 'component',
    componentType: 'agent',
    title: agent.name,
    isClosable: true,
    componentState: {
      agentId: agent.id,
      agentName: agent.name,
      agentCwd: agent.cwd,
      agentColorId: colorId,
    },
  };

  if (!goldenLayout.rootItem) {
    const rootType = layoutMode === 'tabs' ? ItemType.stack : layoutMode === 'stacked' ? ItemType.column : ItemType.row;
    goldenLayout.loadLayout({
      root: {
        type: rootType,
        content: [componentConfig],
      },
    });
  } else {
    if (layoutMode === 'side-by-side' || layoutMode === 'stacked') {
      goldenLayout.addItemAtLocation(componentConfig, [
        { typeId: 3 /* FirstRowOrColumn */, index: undefined },
      ]);
    } else {
      goldenLayout.addComponent('agent', componentConfig.componentState, agent.name);
    }
  }

  // Update tab add button after layout settles
  setTimeout(updateTabAddButton, 100);

  return agent;
}

function nextAgentName() {
  const count = getActiveAgents().size;
  return `Agent ${count + 1}`;
}

function showNewAgentModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('new-agent-modal');
    const nameInput = document.getElementById('modal-agent-name');
    const pathDisplay = document.getElementById('modal-agent-path');
    const swatchContainer = document.getElementById('modal-color-swatches');

    // Set defaults
    nameInput.value = nextAgentName();
    pathDisplay.textContent = '';
    pathDisplay.dataset.path = '';
    pathDisplay.style.color = '';

    // Build color swatches
    swatchContainer.innerHTML = '';
    const defaultColorId = getNextDefaultColor();
    let selectedColorId = defaultColorId;

    const themeColors = getThemeColors();
    themeColors.forEach(({ id, hex }) => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = hex;
      swatch.title = id;
      swatch.dataset.colorId = id;
      if (id === defaultColorId) swatch.classList.add('selected');
      swatch.addEventListener('click', () => {
        swatchContainer.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedColorId = id;
      });
      swatchContainer.appendChild(swatch);
    });

    // Show modal
    modal.classList.remove('hidden');
    nameInput.focus();
    nameInput.select();

    let resolved = false;

    function finish(result) {
      if (resolved) return;
      resolved = true;
      modal.classList.add('hidden');
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') finish(null);
    }
    document.addEventListener('keydown', onKeydown);

    // Use event delegation on the modal to avoid stale listener issues
    function onModalClick(e) {
      const target = e.target;
      if (target.id === 'modal-select-dir') {
        window.electronAPI.openDirectoryDialog().then((dir) => {
          if (dir) {
            pathDisplay.textContent = dir;
            pathDisplay.dataset.path = dir;
            pathDisplay.title = dir;
            pathDisplay.style.color = '';
          }
        });
      } else if (target.id === 'modal-create-btn') {
        const name = nameInput.value.trim() || nextAgentName();
        const dir = pathDisplay.dataset.path;
        if (!dir) {
          pathDisplay.textContent = 'Please select a directory';
          pathDisplay.style.color = '#f44747';
          setTimeout(() => { if (!pathDisplay.dataset.path) pathDisplay.style.color = ''; }, 2000);
          return;
        }
        const autoPerms = document.getElementById('modal-auto-permissions').checked;
        modal.removeEventListener('click', onModalClick);
        finish({ name, dir, colorId: selectedColorId, autoPermissions: autoPerms });
      } else if (target.id === 'modal-cancel-btn') {
        modal.removeEventListener('click', onModalClick);
        finish(null);
      }
    }
    modal.addEventListener('click', onModalClick);
  });
}

async function handleNewAgent() {
  const result = await showNewAgentModal();
  if (!result) return;

  await addAgent(null, result.name, result.dir, result.colorId, result.autoPermissions);
  await window.electronAPI.setSetting('hasCreatedAgent', true);
}

async function handleRestoreAgent(agent) {
  const isOpen = await window.electronAPI.isSessionOpen();
  if (!isOpen) return;

  await addAgent(agent.id, agent.name, agent.cwd);
}

async function createAndEnterSession() {
  const sessionPath = await window.electronAPI.newSession();
  if (sessionPath) {
    clearLayout();
    resetColorIndex();
    enterSessionState();
    updateSessionLabel(sessionPath);
    updateEmptyState();
    window.electronAPI.rebuildMenu();
  }
}

async function openSessionFromFile(filePath) {
  const result = await window.electronAPI.openSessionFile(filePath);
  if (result) {
    clearLayout();
    resetColorIndex();
    enterSessionState();
    const sessionName = await window.electronAPI.getSessionName();
    updateSessionLabel(result.filePath, sessionName);
    if (result.messages) {
      loadMessages(result.messages);
    }
    const tasks1 = await window.electronAPI.getTasks();
    if (tasks1 && tasks1.length > 0) loadTasks(tasks1);
    if (result.agents && result.agents.length > 0) {
      for (const agent of result.agents) {
        await addAgent(agent.id, agent.name, agent.cwd);
      }
    }
    updateEmptyState();
  }
}

async function openAndEnterSession() {
  const result = await window.electronAPI.openSession();
  if (result) {
    clearLayout();
    resetColorIndex();
    enterSessionState();
    const sessionName = await window.electronAPI.getSessionName();
    updateSessionLabel(result.filePath, sessionName);
    if (result.messages) {
      loadMessages(result.messages);
    }
    const tasks2 = await window.electronAPI.getTasks();
    if (tasks2 && tasks2.length > 0) loadTasks(tasks2);
    if (result.agents && result.agents.length > 0) {
      for (const agent of result.agents) {
        await addAgent(agent.id, agent.name, agent.cwd);
      }
    }
    updateEmptyState();
  }
}

async function removeAllAgents() {
  const agents = getActiveAgents();
  if (agents.size === 0) return;

  // Kill all agents via GL destroy (which triggers pty:kill)
  isTogglingLayout = false; // Ensure kills happen
  if (goldenLayout && goldenLayout.rootItem) {
    goldenLayout.clear();
  }
  updateEmptyState();
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  initGoldenLayout();
  initMessagePanel();
  initMasterInput();
  initAgentDropdown(handleNewAgent, handleRestoreAgent);
  initPanelSplitter();
  initTerminalFontSize();
  initTaskPanel();

  // Start in no-session state
  enterNoSessionState();

  // Handle window resize — update GL layout
  window.addEventListener('resize', () => {
    if (goldenLayout) {
      goldenLayout.updateSizeFromContainer();
    }
  });

  // App close save prompt — main process asks us to prompt for a name
  window.electronAPI.onPromptSaveName(async () => {
    const name = await promptSessionName('Save Session', '');
    window.electronAPI.sendSaveNameResult(name || null);
  });

  // Welcome screen buttons
  document.getElementById('btn-create-session').addEventListener('click', createAndEnterSession);
  document.getElementById('btn-open-session').addEventListener('click', openAndEnterSession);

  // Inline session name editing
  const nameDisplay = document.getElementById('session-name-display');
  const nameEditDiv = document.getElementById('session-name-edit');
  const nameInput = document.getElementById('session-name-input');
  const editBtn = document.getElementById('btn-edit-name');
  const saveNameBtn = document.getElementById('btn-save-name');
  const cancelNameBtn = document.getElementById('btn-cancel-name');

  function startNameEdit() {
    const current = document.getElementById('session-label').textContent;
    nameInput.value = current;
    nameDisplay.classList.add('hidden');
    nameEditDiv.classList.remove('hidden');
    nameInput.focus();
    nameInput.select();
  }

  async function finishNameEdit() {
    const newName = nameInput.value.trim();
    if (newName) {
      await window.electronAPI.renameSession(newName);
      const sessionPath = await window.electronAPI.getSessionPath();
      updateSessionLabel(sessionPath, newName);
      window.electronAPI.rebuildMenu();
    }
    nameEditDiv.classList.add('hidden');
    nameDisplay.classList.remove('hidden');
  }

  function cancelNameEdit() {
    nameEditDiv.classList.add('hidden');
    nameDisplay.classList.remove('hidden');
  }

  editBtn.addEventListener('click', startNameEdit);
  saveNameBtn.addEventListener('click', finishNameEdit);
  cancelNameBtn.addEventListener('click', cancelNameEdit);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finishNameEdit();
    if (e.key === 'Escape') cancelNameEdit();
  });

  // Layout toggle icon button
  document.getElementById('btn-toggle-layout').addEventListener('click', toggleLayout);
  updateLayoutToggleIcon();

  // Empty state "Create new agent" button
  document.getElementById('btn-empty-new-agent').addEventListener('click', handleNewAgent);

  // Show Agents button (visible when agents panel is hidden)
  document.getElementById('btn-show-agents').addEventListener('click', toggleAgentsPanel);

  // Receive PTY data
  window.electronAPI.onAgentData((agentId, data) => {
    writeToTerminal(agentId, data);
  });

  // Handle agent exit
  window.electronAPI.onAgentExit((agentId, exitCode) => {
    const entry = getActiveAgents().get(agentId);
    if (entry) {
      entry.terminal.writeln(`\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m`);
    }
  });

  // Session restored
  window.electronAPI.onSessionRestored(async (data) => {
    if (data.sessionPath) {
      enterSessionState();
      const sessionName = await window.electronAPI.getSessionName();
      updateSessionLabel(data.sessionPath, sessionName);
    }
    if (data.messages && data.messages.length > 0) {
      loadMessages(data.messages);
    }
    // Load tasks
    const tasks = await window.electronAPI.getTasks();
    if (tasks && tasks.length > 0) {
      loadTasks(tasks);
    }
    if (data.agents && data.agents.length > 0) {
      for (const agent of data.agents) {
        await addAgent(agent.id, agent.name, agent.cwd);
      }
    }
    updateEmptyState();
    window.electronAPI.rebuildMenu();
  });

  // Server port
  window.electronAPI.onServerPort((port) => {
    serverPort = port;
  });

  // --- Menu handlers ---

  // Helper: close session, handling the 'needs-name' save prompt
  async function closeCurrentSession(options) {
    const result = await window.electronAPI.closeSession(options);
    if (result === 'needs-name') {
      const name = await promptSessionName('Save Session', '');
      if (!name) return false; // Cancelled
      await window.electronAPI.saveSession(name);
      await window.electronAPI.closeSession(options);
      return true;
    }
    return !!result;
  }

  window.electronAPI.onMenuEvent('menu:newSession', async () => {
    const isOpen = await window.electronAPI.isSessionOpen();
    if (isOpen) {
      const closed = await closeCurrentSession({ forNewSession: true });
      if (!closed) return;
    }
    await createAndEnterSession();
    window.electronAPI.rebuildMenu();
  });

  window.electronAPI.onMenuEvent('menu:openSession', async () => {
    const isOpen = await window.electronAPI.isSessionOpen();
    if (isOpen) {
      const closed = await closeCurrentSession();
      if (!closed) return;
    }
    await openAndEnterSession();
    window.electronAPI.rebuildMenu();
  });

  window.electronAPI.onMenuEvent('menu:openRecentFile', async (filePath) => {
    const isOpen = await window.electronAPI.isSessionOpen();
    if (isOpen) {
      const closed = await closeCurrentSession();
      if (!closed) return;
    }
    await openSessionFromFile(filePath);
    window.electronAPI.rebuildMenu();
  });

  window.electronAPI.onMenuEvent('menu:saveSession', async () => {
    const isTemp = await window.electronAPI.isSessionTemp();
    if (isTemp) {
      // Prompt for a session name
      const name = await promptSessionName('Save Session', '');
      if (!name) return;
      const result = await window.electronAPI.saveSession(name);
      if (result) {
        updateSessionLabel(result.filePath, result.sessionName);
        window.electronAPI.rebuildMenu();
      }
    } else {
      // Already saved — just save in place
      const result = await window.electronAPI.saveSession();
      if (result) {
        updateSessionLabel(result.filePath, result.sessionName);
      }
    }
  });

  window.electronAPI.onMenuEvent('menu:closeSession', async () => {
    const closed = await closeCurrentSession();
    if (closed) {
      enterNoSessionState();
    }
  });

  // Rename session
  window.electronAPI.onMenuEvent('menu:renameSession', async () => {
    const currentName = await window.electronAPI.getSessionName() || '';
    const name = await promptSessionName('Rename Session', currentName);
    if (!name) return;
    await window.electronAPI.renameSession(name);
    const sessionPath = await window.electronAPI.getSessionPath();
    updateSessionLabel(sessionPath, name);
    window.electronAPI.rebuildMenu();
  });

  // Agents menu
  window.electronAPI.onMenuEvent('menu:newAgent', async () => {
    const isOpen = await window.electronAPI.isSessionOpen();
    if (!isOpen) {
      const sessionPath = await window.electronAPI.ensureSessionOpen();
      if (!sessionPath) return;
      enterSessionState();
      updateSessionLabel(sessionPath);
    }
    await handleNewAgent();
  });

  window.electronAPI.onMenuEvent('menu:removeAllAgents', removeAllAgents);

  // View menu layout toggle
  window.electronAPI.onMenuEvent('menu:setLayout', (mode) => {
    setLayoutMode(mode);
  });

  // Settings menu
  window.electronAPI.onMenuEvent('menu:clearSettings', async () => {
    await window.electronAPI.clearAllSettings();
  });
});
