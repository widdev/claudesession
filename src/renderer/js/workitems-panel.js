let listEl = null;
let filterBarEl = null;
let serverPort = null;
let allItems = []; // cached items from DB
let currentSort = { field: 'imported_at', dir: 'desc' };

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

export function initWorkItemsPanel(el) {
  const list = el.querySelector('.workitems-list');
  const refreshBtn = el.querySelector('.workitems-refresh-btn');
  listEl = list;
  filterBarEl = el.querySelector('.workitems-filter-bar');

  refreshBtn.addEventListener('click', () => loadWorkItems());

  // Filter controls
  const typeFilter = el.querySelector('.workitems-filter-type');
  const stateFilter = el.querySelector('.workitems-filter-state');
  const searchInput = el.querySelector('.workitems-filter-search');
  const dateFrom = el.querySelector('.workitems-filter-date-from');
  const dateTo = el.querySelector('.workitems-filter-date-to');
  const clearBtn = el.querySelector('.workitems-filter-clear');

  typeFilter.addEventListener('change', () => renderFiltered());
  stateFilter.addEventListener('change', () => renderFiltered());
  searchInput.addEventListener('input', () => renderFiltered());
  dateFrom.addEventListener('change', () => renderFiltered());
  dateTo.addEventListener('change', () => renderFiltered());
  clearBtn.addEventListener('click', () => {
    typeFilter.value = '';
    stateFilter.value = '';
    searchInput.value = '';
    dateFrom.value = '';
    dateTo.value = '';
    renderFiltered();
  });

  // Sort controls
  el.querySelectorAll('.workitems-sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.sort;
      if (currentSort.field === field) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { field, dir: 'asc' };
      }
      updateSortIndicators(el);
      renderFiltered();
    });
  });

  // Zoom
  const zoomSel = el.querySelector('.workitems-zoom-select');
  const ZOOM_LEVELS = [75, 85, 100, 115, 130, 150];
  const BASE_FONT_SIZE = 14;
  let currentZoom = 100;
  function applyZoom(zoom) {
    currentZoom = zoom;
    list.style.fontSize = (BASE_FONT_SIZE * zoom / 100) + 'px';
    zoomSel.value = String(zoom);
    window.electronAPI.setSetting('workitemsZoom', zoom);
  }
  applyZoom(currentZoom);
  window.electronAPI.getSetting('workitemsZoom').then((z) => { if (z && ZOOM_LEVELS.includes(z)) applyZoom(z); });
  zoomSel.addEventListener('change', () => applyZoom(parseInt(zoomSel.value, 10)));
  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault();
    const idx = ZOOM_LEVELS.indexOf(currentZoom);
    if (e.deltaY < 0 && idx < ZOOM_LEVELS.length - 1) applyZoom(ZOOM_LEVELS[idx + 1]);
    else if (e.deltaY > 0 && idx > 0) applyZoom(ZOOM_LEVELS[idx - 1]);
  }, { passive: false });

  // Get server port for API info
  window.electronAPI.getServerPort().then((p) => { serverPort = p; updateApiInfo(el); });
  window.electronAPI.onServerPort((p) => { serverPort = p; updateApiInfo(el); });

  // Auto-refresh when items are imported/removed from DevOps panel
  window.addEventListener('workitems:changed', () => loadWorkItems());

  loadWorkItems();
}

function updateApiInfo(el) {
  const apiEl = el.querySelector('.workitems-api-info');
  if (apiEl && serverPort) {
    apiEl.textContent = `curl http://127.0.0.1:${serverPort}/api/workitems`;
  }
}

function updateSortIndicators(el) {
  el.querySelectorAll('.workitems-sort-btn').forEach((btn) => {
    const field = btn.dataset.sort;
    if (field === currentSort.field) {
      btn.classList.add('active');
      btn.dataset.dir = currentSort.dir;
    } else {
      btn.classList.remove('active');
      delete btn.dataset.dir;
    }
  });
}

function populateFilterOptions() {
  if (!filterBarEl) return;
  const typeFilter = filterBarEl.querySelector('.workitems-filter-type');
  const stateFilter = filterBarEl.querySelector('.workitems-filter-state');

  const types = new Set();
  const states = new Set();
  for (const item of allItems) {
    if (item.type) types.add(abbreviateType(item.type));
    if (item.state) states.add(item.state);
  }

  const prevType = typeFilter.value;
  const prevState = stateFilter.value;

  typeFilter.innerHTML = '<option value="">All Types</option>';
  for (const t of [...types].sort()) {
    typeFilter.innerHTML += `<option value="${esc(t)}">${esc(t)}</option>`;
  }
  typeFilter.value = prevType;

  stateFilter.innerHTML = '<option value="">All States</option>';
  for (const s of [...states].sort()) {
    stateFilter.innerHTML += `<option value="${esc(s)}">${esc(s)}</option>`;
  }
  stateFilter.value = prevState;
}

function getFilteredAndSorted() {
  if (!filterBarEl) return allItems;

  const typeVal = filterBarEl.querySelector('.workitems-filter-type').value;
  const stateVal = filterBarEl.querySelector('.workitems-filter-state').value;
  const searchVal = filterBarEl.querySelector('.workitems-filter-search').value.toLowerCase().trim();
  const dateFrom = filterBarEl.querySelector('.workitems-filter-date-from').value;
  const dateTo = filterBarEl.querySelector('.workitems-filter-date-to').value;

  let items = allItems.filter((item) => {
    if (typeVal && abbreviateType(item.type) !== typeVal) return false;
    if (stateVal && item.state !== stateVal) return false;
    if (searchVal) {
      const haystack = `#${item.id} ${item.title || ''} ${item.description ? stripHtml(item.description) : ''} ${item.project || ''}`.toLowerCase();
      if (!haystack.includes(searchVal)) return false;
    }
    if (dateFrom || dateTo) {
      const itemDate = item.imported_at ? item.imported_at.split('T')[0].split(' ')[0] : '';
      if (dateFrom && itemDate < dateFrom) return false;
      if (dateTo && itemDate > dateTo) return false;
    }
    return true;
  });

  // Sort
  items.sort((a, b) => {
    let va, vb;
    switch (currentSort.field) {
      case 'type': va = abbreviateType(a.type); vb = abbreviateType(b.type); break;
      case 'state': va = a.state || ''; vb = b.state || ''; break;
      case 'title': va = a.title || ''; vb = b.title || ''; break;
      case 'imported_at': va = a.imported_at || ''; vb = b.imported_at || ''; break;
      case 'id': va = a.id; vb = b.id; break;
      default: va = a.imported_at || ''; vb = b.imported_at || '';
    }
    if (typeof va === 'string') {
      const cmp = va.localeCompare(vb);
      return currentSort.dir === 'asc' ? cmp : -cmp;
    }
    return currentSort.dir === 'asc' ? va - vb : vb - va;
  });

  return items;
}

function renderFiltered() {
  if (!listEl) return;
  const items = getFilteredAndSorted();
  listEl.innerHTML = '';

  // Update count in heading
  const heading = listEl.closest('.workitems-inner')?.querySelector('.workitems-heading');
  if (heading) {
    const total = allItems.length;
    const shown = items.length;
    heading.textContent = shown === total ? `Work Items (${total})` : `Work Items (${shown}/${total})`;
  }

  if (items.length === 0) {
    listEl.innerHTML = allItems.length === 0
      ? '<div class="workitems-empty">No imported work items. Use the Azure DevOps panel to import items from your backlog.</div>'
      : '<div class="workitems-empty">No items match the current filters.</div>';
    return;
  }

  for (const item of items) {
    appendWorkItem(listEl, item);
  }
}

export async function loadWorkItems() {
  if (!listEl) return;
  const items = await window.electronAPI.getWorkItems();
  allItems = items || [];
  populateFilterOptions();
  renderFiltered();
}

function getTypeClass(type) {
  if (!type) return 'devops-type-other';
  const t = type.toLowerCase();
  if (t.includes('product backlog') || t.includes('user story')) return 'devops-type-pbi';
  if (t.includes('bug')) return 'devops-type-bug';
  if (t.includes('task')) return 'devops-type-task';
  if (t.includes('feature')) return 'devops-type-feature';
  return 'devops-type-other';
}

function abbreviateType(type) {
  if (!type) return '?';
  const t = type.toLowerCase();
  if (t.includes('product backlog')) return 'PBI';
  if (t.includes('user story')) return 'Story';
  if (t.includes('bug')) return 'Bug';
  if (t.includes('task')) return 'Task';
  if (t.includes('feature')) return 'Feature';
  return type;
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function appendWorkItem(list, item) {
  const row = document.createElement('div');
  row.className = 'workitems-entry';
  row.dataset.id = item.id;
  row.draggable = true;

  row.addEventListener('dragstart', (ev) => {
    const text = `#${item.id} [${item.type || ''}] ${item.title}${item.description ? '\n' + stripHtml(item.description) : ''}`;
    ev.dataTransfer.setData('text/plain', text);
    ev.dataTransfer.effectAllowed = 'copy';
  });

  const typeClass = getTypeClass(item.type);
  const stateClass = (item.state === 'Done' || item.state === 'Closed') ? 'wi-state-done' : 'wi-state-active';
  const desc = item.description ? stripHtml(item.description) : '';
  const importedDate = item.imported_at ? new Date(item.imported_at + (item.imported_at.includes('Z') ? '' : 'Z')).toLocaleDateString() : '';

  row.innerHTML = `
    <div class="workitems-row-main">
      <span class="workitems-expand-toggle" title="Expand/collapse">&#9654;</span>
      <span class="devops-wi-type ${typeClass}">${esc(abbreviateType(item.type))}</span>
      <span class="workitems-id">#${item.id}</span>
      <span class="workitems-title">${esc(item.title)}</span>
      <span class="workitems-state ${stateClass}">${esc(item.state || '')}</span>
      <span class="workitems-date">${esc(importedDate)}</span>
      <span class="workitems-project">${esc(item.project || '')}</span>
      <span class="workitems-remove" title="Remove">&times;</span>
    </div>
    <div class="workitems-detail" style="display:none">
      <div class="workitems-detail-content">${desc ? esc(desc) : '<em>No description</em>'}</div>
    </div>`;

  // Expand/collapse
  const toggle = row.querySelector('.workitems-expand-toggle');
  const detail = row.querySelector('.workitems-detail');
  toggle.addEventListener('click', () => {
    const expanded = detail.style.display !== 'none';
    detail.style.display = expanded ? 'none' : '';
    toggle.classList.toggle('expanded', !expanded);
  });
  // Also toggle on row click (but not on remove or toggle itself)
  row.querySelector('.workitems-row-main').addEventListener('click', (e) => {
    if (e.target.classList.contains('workitems-remove') || e.target.classList.contains('workitems-expand-toggle')) return;
    const expanded = detail.style.display !== 'none';
    detail.style.display = expanded ? 'none' : '';
    toggle.classList.toggle('expanded', !expanded);
  });

  row.querySelector('.workitems-remove').addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.electronAPI.removeWorkItem(item.id);
    allItems = allItems.filter((i) => i.id !== item.id);
    populateFilterOptions();
    renderFiltered();
  });

  list.appendChild(row);
}
