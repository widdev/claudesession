const taskList = () => document.getElementById('task-list');
const taskInput = () => document.getElementById('task-input');

export function initTaskPanel() {
  const addBtn = document.getElementById('btn-add-task');
  const input = taskInput();

  addBtn.addEventListener('click', addTask);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addTask();
    }
  });

  // Toggle panel
  document.getElementById('btn-toggle-tasks').addEventListener('click', toggleTaskPanel);
  document.getElementById('btn-close-tasks').addEventListener('click', toggleTaskPanel);
  window.electronAPI.onMenuEvent('menu:toggleTasks', toggleTaskPanel);
}

export function toggleTaskPanel() {
  const panel = document.getElementById('task-panel');
  const btn = document.getElementById('btn-toggle-tasks');
  const isHiding = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (btn) btn.classList.toggle('hidden', !isHiding);
}

async function addTask() {
  const input = taskInput();
  const content = input.value.trim();
  if (!content) return;

  const task = await window.electronAPI.addTask(content);
  if (task) {
    appendTaskEntry(task);
  }

  input.value = '';
  input.style.height = 'auto';
}

function appendTaskEntry(task) {
  const list = taskList();
  const entry = document.createElement('div');
  entry.className = 'task-entry';
  entry.dataset.taskId = task.id;
  // Make draggable
  entry.draggable = true;
  entry.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.content);
    e.dataTransfer.effectAllowed = 'copy';
  });

  const time = task.created_at
    ? new Date(task.created_at + 'Z').toLocaleTimeString()
    : new Date().toLocaleTimeString();

  entry.innerHTML = `
    <div class="task-header">
      <span class="task-id">${escapeHtml(task.id)}</span>
      <span class="task-time">${escapeHtml(time)}</span>
      <span class="task-remove" title="Delete task">&times;</span>
    </div>
    <div class="task-content">${escapeHtml(task.content)}</div>
  `;

  entry.querySelector('.task-remove').addEventListener('click', async () => {
    await window.electronAPI.removeTask(task.id);
    entry.remove();
  });

  list.appendChild(entry);
  list.scrollTop = list.scrollHeight;
}

export function loadTasks(tasks) {
  const list = taskList();
  list.innerHTML = '';
  for (const task of tasks) {
    appendTaskEntry(task);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
