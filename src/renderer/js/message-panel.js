import { getAgentColor } from './agent-panel.js';

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

  // Clear all messages
  document.getElementById('btn-clear-messages').addEventListener('click', async () => {
    await window.electronAPI.clearMessages();
    messageList().innerHTML = '';
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

export function toggleAgentsPanel() {
  const layoutContainer = document.getElementById('layout-container');
  const splitter = document.getElementById('panel-splitter');
  const showBtn = document.getElementById('btn-show-agents');
  const isHiding = !layoutContainer.classList.contains('hidden');
  layoutContainer.classList.toggle('hidden');
  // Hide splitter when either panel is hidden
  if (splitter) {
    const msgPanel = messagePanel();
    const bothVisible = !layoutContainer.classList.contains('hidden') && !msgPanel.classList.contains('hidden');
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
  const layoutContainer = document.getElementById('layout-container');
  const isHiding = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  // Splitter only visible when both panels are visible
  if (splitter) {
    const bothVisible = !layoutContainer.classList.contains('hidden') && !panel.classList.contains('hidden');
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

export function loadMessages(messages) {
  const list = messageList();
  list.innerHTML = '';
  for (const msg of messages) {
    appendMessage(msg);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
