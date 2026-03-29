let onNewAgentCallback = null;
let onRestoreAgentCallback = null;

export function initAgentDropdown(onNew, onRestore) {
  onNewAgentCallback = onNew;
  onRestoreAgentCallback = onRestore;

  const btn = document.getElementById('btn-new-agent');
  const dropdown = document.getElementById('agent-dropdown');
  const newItem = document.getElementById('dropdown-new');

  btn.addEventListener('click', async () => {
    await refreshDropdown();
    dropdown.classList.toggle('hidden');
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  newItem.addEventListener('click', async () => {
    dropdown.classList.add('hidden');
    if (onNewAgentCallback) {
      await onNewAgentCallback();
    }
  });
}

async function refreshDropdown() {
  const list = document.getElementById('dropdown-recent-list');
  list.innerHTML = '';

  let savedAgents = [];
  try {
    savedAgents = await window.electronAPI.listSavedAgents();
  } catch (e) {
    // No session open
  }

  // Get currently active agent IDs
  const activeAgents = await window.electronAPI.listAgents();
  const activeIds = new Set(activeAgents.map((a) => a.id));

  // Show saved agents that aren't currently active
  const inactive = savedAgents.filter((a) => !activeIds.has(a.id));

  if (inactive.length > 0) {
    const divider = document.createElement('div');
    divider.style.cssText = 'padding: 4px 12px; font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px;';
    divider.textContent = 'Recent Agents';
    list.appendChild(divider);

    for (const agent of inactive) {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.style.position = 'relative';
      item.style.paddingRight = '28px';
      item.innerHTML = `
        <div>${escapeHtml(agent.name)}</div>
        <div class="agent-dir">${escapeHtml(agent.cwd)}</div>
        <span class="dropdown-remove" title="Remove from recents">&times;</span>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('dropdown-remove')) return;
        document.getElementById('agent-dropdown').classList.add('hidden');
        if (onRestoreAgentCallback) {
          onRestoreAgentCallback(agent);
        }
      });
      item.querySelector('.dropdown-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.electronAPI.removeSavedAgent(agent.id);
        item.remove();
      });
      list.appendChild(item);
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
