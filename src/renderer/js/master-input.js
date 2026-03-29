import { getActiveAgents } from './agent-panel.js';
import { appendBroadcast } from './message-panel.js';

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
}

function resizeInput(input) {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
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
  for (const [agentId] of agents) {
    window.electronAPI.writeToAgent(agentId, text + '\r');
  }

  appendBroadcast(text);

  input.value = '';
  input.style.height = 'auto';
}
