import { getActiveAgents, isAgentPaused } from './agent-panel.js';
import { appendBroadcast, appendAside } from './message-panel.js';

const history = [];
let historyIndex = -1;
let pendingInput = ''; // Stash current input when navigating history

export function initMasterInput() {
  const input = document.getElementById('master-input');
  const btn = document.getElementById('btn-broadcast');

  btn.addEventListener('click', broadcast);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      broadcast();
      return;
    }

    // Up arrow — go back in history (only when cursor is at the start)
    if (e.key === 'ArrowUp' && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndex === -1) {
        pendingInput = input.value;
        historyIndex = history.length - 1;
      } else if (historyIndex > 0) {
        historyIndex--;
      }
      input.value = history[historyIndex];
      input.setSelectionRange(0, 0);
      resizeInput(input);
    }

    // Down arrow — go forward in history (only when cursor is at the end)
    if (e.key === 'ArrowDown' && input.selectionStart === input.value.length) {
      e.preventDefault();
      if (historyIndex === -1) return;
      if (historyIndex < history.length - 1) {
        historyIndex++;
        input.value = history[historyIndex];
      } else {
        historyIndex = -1;
        input.value = pendingInput;
      }
      const len = input.value.length;
      input.setSelectionRange(len, len);
      resizeInput(input);
    }
  });

  input.addEventListener('input', () => resizeInput(input));

  // Accept drag-and-drop from Tasks panel
  input.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    input.classList.add('drag-over');
  });
  input.addEventListener('dragleave', () => {
    input.classList.remove('drag-over');
  });
  input.addEventListener('drop', (e) => {
    e.preventDefault();
    input.classList.remove('drag-over');
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      input.value = input.value ? input.value + '\n' + text : text;
      resizeInput(input);
      input.focus();
    }
  });
}

function resizeInput(input) {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}

function sendToAgent(agentId, text) {
  window.electronAPI.writeAndSubmitToAgent(agentId, text);
}

function broadcast() {
  const input = document.getElementById('master-input');
  const text = input.value.trim();
  if (!text) return;

  // Add to history (avoid duplicating the last entry)
  if (history.length === 0 || history[history.length - 1] !== text) {
    history.push(text);
  }
  historyIndex = -1;
  pendingInput = '';

  const agents = getActiveAgents();

  // Check for #AGENTNAME prefix — direct aside to a single agent
  const hashMatch = text.match(/^#(\S+)\s+([\s\S]*)$/);
  if (hashMatch) {
    const targetName = hashMatch[1];
    const messageBody = hashMatch[2].trim();
    // Find agent by name (case-insensitive)
    let targetId = null;
    for (const [agentId, entry] of agents) {
      if (entry.name.toLowerCase() === targetName.toLowerCase()) {
        targetId = agentId;
        break;
      }
    }
    if (targetId && messageBody) {
      sendToAgent(targetId, `[Discussion aside] ${messageBody}`);
      appendAside(messageBody, targetName);
    } else if (!targetId) {
      // No matching agent — show error inline
      appendAside(`Agent "${targetName}" not found`, targetName);
    }
  } else {
    // Normal broadcast to all agents (skip paused ones)
    // Prefix with [Discussion] so agents know to reply via discuss, not in their shell
    for (const [agentId] of agents) {
      if (isAgentPaused(agentId)) continue;
      sendToAgent(agentId, `[Discussion] ${text}`);
    }
    appendBroadcast(text);
  }

  input.value = '';
  input.style.height = 'auto';
}
