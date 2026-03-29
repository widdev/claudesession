import '@xterm/xterm/css/xterm.css';
import 'golden-layout/dist/css/goldenlayout-base.css';

import { GoldenLayout, ItemType } from 'golden-layout';
import { createAgentPanel, removeAgentPanel, writeToTerminal, getActiveAgents, fitAll, assignAgentColor, resetColorIndex, getNextDefaultColor, AGENT_COLORS } from './agent-panel.js';
import { initMessagePanel, loadMessages, toggleAgentsPanel } from './message-panel.js';
import { initMasterInput } from './master-input.js';
import { initAgentDropdown } from './agent-dropdown.js';

let goldenLayout = null;
let serverPort = null;
let layoutMode = 'side-by-side'; // 'side-by-side' or 'tabs'
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

function updateSessionLabel(sessionPath) {
  const label = document.getElementById('session-label');
  if (!sessionPath) {
    label.textContent = '';
    label.title = '';
    return;
  }
  const fileName = sessionPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  if (fileName.startsWith('temp')) {
    label.textContent = '';
    label.title = '';
  } else {
    label.textContent = fileName.replace(/\.cms$/i, '');
    label.title = sessionPath;
  }
}

function updateLayoutToggleIcon() {
  const btn = document.getElementById('btn-toggle-layout');
  if (btn) {
    btn.textContent = layoutMode === 'side-by-side' ? '\u2630' : '\u2637';
    btn.title = layoutMode === 'side-by-side' ? 'Switch to tab view' : 'Switch to side-by-side view';
  }
  // Set body class for CSS (hide tab headers in side-by-side)
  document.body.classList.toggle('layout-side-by-side', layoutMode === 'side-by-side');
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
        agentColor: entry.color,
      },
    });
  }

  layoutMode = mode;
  updateLayoutToggleIcon();

  // Rebuild layout without killing agents
  isTogglingLayout = true;
  goldenLayout.clear();
  isTogglingLayout = false;

  const rootType = layoutMode === 'tabs' ? ItemType.stack : ItemType.row;
  goldenLayout.loadLayout({
    root: {
      type: rootType,
      content: componentConfigs,
    },
  });

  setTimeout(updateTabAddButton, 100);
}

function toggleLayout() {
  setLayoutMode(layoutMode === 'side-by-side' ? 'tabs' : 'side-by-side');
}

function updateTabAddButton() {
  // Remove any existing tab add buttons
  document.querySelectorAll('.tab-add-btn').forEach(b => b.remove());

  if (layoutMode !== 'tabs') return;
  if (getActiveAgents().size === 0) return;

  // Find the GL tabs container and append a + button inline after the last tab
  const tabsContainers = document.querySelectorAll('.lm_tabs');
  for (const tabsContainer of tabsContainers) {
    const btn = document.createElement('div');
    btn.className = 'tab-add-btn';
    btn.title = 'Add new agent';
    btn.textContent = '+';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleNewAgent();
    });
    tabsContainer.appendChild(btn);
    break; // Only add to first tabs container
  }
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
    const clampedWidth = Math.max(200, Math.min(newWidth, mainRect.width * 0.5));
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
    const agentColor = state.agentColor || '#569cd6';

    const { terminal, fitAddon } = createAgentPanel(
      container.element,
      agentId,
      agentName,
      agentCwd,
      container,
      agentColor
    );

    setTimeout(() => {
      if (container.tab && container.tab.element) {
        container.tab.element.style.borderTop = `2px solid ${agentColor}`;
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

async function addAgent(agentId, agentName, agentCwd, agentColor, autoPermissions) {
  const container = document.getElementById('layout-container');
  container.classList.remove('empty');
  const emptyPrompt = document.getElementById('empty-agent-prompt');
  if (emptyPrompt) emptyPrompt.classList.add('hidden');

  const color = assignAgentColor(agentColor);

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
      agentColor: color,
    },
  };

  if (!goldenLayout.rootItem) {
    const rootType = layoutMode === 'tabs' ? ItemType.stack : ItemType.row;
    goldenLayout.loadLayout({
      root: {
        type: rootType,
        content: [componentConfig],
      },
    });
  } else {
    if (layoutMode === 'side-by-side') {
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
    const defaultColor = getNextDefaultColor();
    let selectedColor = defaultColor;

    AGENT_COLORS.forEach((color) => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = color;
      if (color === defaultColor) swatch.classList.add('selected');
      swatch.addEventListener('click', () => {
        swatchContainer.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedColor = color;
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
        finish({ name, dir, color: selectedColor, autoPermissions: autoPerms });
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

  await addAgent(null, result.name, result.dir, result.color, result.autoPermissions);
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
  }
}

async function openSessionFromFile(filePath) {
  const result = await window.electronAPI.openSessionFile(filePath);
  if (result) {
    clearLayout();
    resetColorIndex();
    enterSessionState();
    updateSessionLabel(result.filePath);
    if (result.messages) {
      loadMessages(result.messages);
    }
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
    updateSessionLabel(result.filePath);
    if (result.messages) {
      loadMessages(result.messages);
    }
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

  // Start in no-session state
  enterNoSessionState();

  // Handle window resize — update GL layout
  window.addEventListener('resize', () => {
    if (goldenLayout) {
      goldenLayout.updateSizeFromContainer();
    }
  });

  // Welcome screen buttons
  document.getElementById('btn-create-session').addEventListener('click', createAndEnterSession);
  document.getElementById('btn-open-session').addEventListener('click', openAndEnterSession);

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
      updateSessionLabel(data.sessionPath);
    }
    if (data.messages && data.messages.length > 0) {
      loadMessages(data.messages);
    }
    if (data.agents && data.agents.length > 0) {
      for (const agent of data.agents) {
        await addAgent(agent.id, agent.name, agent.cwd);
      }
    }
    updateEmptyState();
  });

  // Server port
  window.electronAPI.onServerPort((port) => {
    serverPort = port;
  });

  // --- Menu handlers ---

  window.electronAPI.onMenuEvent('menu:newSession', async () => {
    const isOpen = await window.electronAPI.isSessionOpen();
    if (isOpen) {
      const closed = await window.electronAPI.closeSession({ forNewSession: true });
      if (!closed) return;
    }
    await createAndEnterSession();
  });

  window.electronAPI.onMenuEvent('menu:openSession', async () => {
    const isOpen = await window.electronAPI.isSessionOpen();
    if (isOpen) {
      const closed = await window.electronAPI.closeSession();
      if (!closed) return;
    }
    await openAndEnterSession();
  });

  window.electronAPI.onMenuEvent('menu:openRecentFile', async (filePath) => {
    const isOpen = await window.electronAPI.isSessionOpen();
    if (isOpen) {
      const closed = await window.electronAPI.closeSession();
      if (!closed) return;
    }
    await openSessionFromFile(filePath);
  });

  window.electronAPI.onMenuEvent('menu:saveSession', async () => {
    const result = await window.electronAPI.saveSession();
    if (result) {
      updateSessionLabel(result);
    }
  });

  window.electronAPI.onMenuEvent('menu:closeSession', async () => {
    const closed = await window.electronAPI.closeSession();
    if (closed) {
      enterNoSessionState();
    }
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
