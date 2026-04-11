let panelEl = null;
let currentView = 'login'; // login | projects | backlog | imported
let navStack = []; // for back button
let connectedOrg = null;
let selectedProject = null;
let selectedTeam = null;
let currentIteration = null;
let importedItems = new Map(); // id -> work item

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

export function initDevOpsPanel(el) {
  panelEl = el;
  const backBtn = el.querySelector('.devops-back-btn');
  const disconnectBtn = el.querySelector('.devops-disconnect-btn');
  const breadcrumb = el.querySelector('.devops-breadcrumb');
  const content = el.querySelector('.devops-content');

  backBtn.addEventListener('click', () => {
    if (navStack.length > 0) {
      const prev = navStack.pop();
      showView(prev.view, prev.data, false);
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    await window.electronAPI.devopsDisconnect();
    connectedOrg = null;
    selectedProject = null;
    selectedTeam = null;
    currentIteration = null;
    navStack = [];
    showView('login');
  });

  // Zoom
  const zoomSel = el.querySelector('.devops-zoom-select');
  const ZOOM_LEVELS = [75, 85, 100, 115, 130, 150];
  const BASE_FONT_SIZE = 14;
  let currentZoom = 100;
  function applyZoom(zoom) {
    currentZoom = zoom;
    const fontSize = (BASE_FONT_SIZE * zoom / 100) + 'px';
    content.style.fontSize = fontSize;
    zoomSel.value = String(zoom);
    window.electronAPI.setSetting('devopsZoom', zoom);
  }
  applyZoom(currentZoom);
  window.electronAPI.getSetting('devopsZoom').then((z) => { if (z && ZOOM_LEVELS.includes(z)) applyZoom(z); });
  zoomSel.addEventListener('change', () => applyZoom(parseInt(zoomSel.value, 10)));
  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault();
    const idx = ZOOM_LEVELS.indexOf(currentZoom);
    if (e.deltaY < 0 && idx < ZOOM_LEVELS.length - 1) applyZoom(ZOOM_LEVELS[idx + 1]);
    else if (e.deltaY > 0 && idx > 0) applyZoom(ZOOM_LEVELS[idx - 1]);
  }, { passive: false });

  // Load persisted work items from DB
  window.electronAPI.getWorkItems().then((items) => {
    if (items) {
      for (const item of items) {
        importedItems.set(item.id, {
          id: item.id,
          title: item.title,
          type: item.type,
          state: item.state,
          assignedTo: item.assigned_to,
          description: item.description,
          project: item.project,
          url: item.url,
        });
      }
    }
  });

  // Check if already connected
  window.electronAPI.devopsIsConnected().then((connected) => {
    if (connected) {
      window.electronAPI.devopsGetCredentials().then((creds) => {
        connectedOrg = creds.org;
        showView('projects');
      });
    } else {
      showView('login');
    }
  });

  function showView(view, data, pushNav = true) {
    if (pushNav && currentView !== view) {
      navStack.push({ view: currentView, data: null });
    }
    currentView = view;
    backBtn.style.display = navStack.length > 0 ? '' : 'none';
    disconnectBtn.style.display = view !== 'login' ? '' : 'none';

    switch (view) {
      case 'login': renderLogin(content, breadcrumb); break;
      case 'projects': renderProjects(content, breadcrumb); break;
      case 'backlog': renderBacklog(content, breadcrumb, data); break;
      case 'imported': renderImported(content, breadcrumb); break;
    }
  }

  function renderLogin(container, breadcrumb) {
    breadcrumb.textContent = 'Connect to Azure DevOps';
    container.innerHTML = `
      <div class="devops-login-view">
        <div class="devops-login-form">
          <h3>Connect to Azure DevOps</h3>
          <label>Organization name</label>
          <input type="text" class="devops-input devops-org" placeholder="e.g. mycompany" />
          <p class="devops-help-text" style="margin-top:4px">
            This is the name in your Azure DevOps URL: <code>dev.azure.com/<strong>mycompany</strong></code>
          </p>
          <button class="devops-btn devops-connect-btn" disabled>Sign In with Microsoft</button>
          <p class="devops-help-text" style="margin-top:4px">For work/school Microsoft accounts.</p>
          <div class="devops-pat-toggle">
            <span class="devops-link devops-show-pat-link devops-disabled">Using a personal Microsoft account? Sign in with a Personal Access Token instead</span>
          </div>
          <div class="devops-pat-section" style="display:none">
            <label>Personal Access Token</label>
            <input type="password" class="devops-input devops-pat-input" placeholder="Paste your token here" />
            <p class="devops-help-text" style="margin-top:4px">
              Enter your organization name above, then click <span class="devops-link devops-pat-link">here to open your token page</span>.
              Create a token with <strong>Work Items: Read &amp; Write</strong> scope, then paste it above.
            </p>
            <button class="devops-btn devops-connect-pat-btn">Connect with Token</button>
          </div>
          <div class="devops-status"></div>
        </div>
      </div>`;

    const connectBtn = container.querySelector('.devops-connect-btn');
    const connectPatBtn = container.querySelector('.devops-connect-pat-btn');
    const statusEl = container.querySelector('.devops-status');
    const patSection = container.querySelector('.devops-pat-section');
    const showPatLink = container.querySelector('.devops-show-pat-link');
    const patLink = container.querySelector('.devops-pat-link');

    // Enable/disable controls based on org input
    const orgInput = container.querySelector('.devops-org');
    function updateOrgState() {
      const hasOrg = orgInput.value.trim().length > 0;
      connectBtn.disabled = !hasOrg;
      if (hasOrg) {
        showPatLink.classList.remove('devops-disabled');
      } else {
        showPatLink.classList.add('devops-disabled');
        patSection.style.display = 'none';
        showPatLink.textContent = 'Using a personal Microsoft account? Sign in with a Personal Access Token instead';
      }
    }
    orgInput.addEventListener('input', updateOrgState);

    // Toggle PAT section
    showPatLink.addEventListener('click', () => {
      if (showPatLink.classList.contains('devops-disabled')) return;
      const visible = patSection.style.display !== 'none';
      patSection.style.display = visible ? 'none' : '';
      showPatLink.textContent = visible
        ? 'Using a personal Microsoft account? Sign in with a Personal Access Token instead'
        : 'Hide token sign-in';
    });

    // Update PAT link when org changes
    function updatePatLink() {
      const org = container.querySelector('.devops-org').value.trim();
      if (org) {
        patLink.dataset.url = `https://dev.azure.com/${org}/_usersSettings/tokens`;
        patLink.textContent = `dev.azure.com/${org}`;
      } else {
        patLink.dataset.url = '';
        patLink.textContent = 'dev.azure.com';
      }
    }
    container.querySelector('.devops-org').addEventListener('input', updatePatLink);
    updatePatLink();

    patLink.addEventListener('click', () => {
      const org = container.querySelector('.devops-org').value.trim();
      if (org) window.electronAPI.openExternal(`https://dev.azure.com/${org}/_usersSettings/tokens`);
    });

    // OAuth sign-in
    connectBtn.addEventListener('click', async () => {
      const org = container.querySelector('.devops-org').value.trim();
      if (!org) {
        statusEl.textContent = 'Please enter your organization name.';
        statusEl.className = 'devops-status devops-error';
        return;
      }

      connectBtn.disabled = true;
      statusEl.textContent = 'Opening browser for sign-in...';
      statusEl.className = 'devops-status devops-info';

      try {
        await window.electronAPI.devopsConnect(org);
        connectedOrg = org;
        statusEl.textContent = 'Connected!';
        statusEl.className = 'devops-status devops-success';
        setTimeout(() => showView('projects'), 500);
      } catch (err) {
        statusEl.textContent = `Error: ${err.message || err}`;
        statusEl.className = 'devops-status devops-error';
        connectBtn.disabled = false;
      }
    });

    // PAT sign-in
    connectPatBtn.addEventListener('click', async () => {
      const org = container.querySelector('.devops-org').value.trim();
      const pat = container.querySelector('.devops-pat-input').value.trim();
      if (!org) {
        statusEl.textContent = 'Please enter your organization name.';
        statusEl.className = 'devops-status devops-error';
        return;
      }
      if (!pat) {
        statusEl.textContent = 'Please enter your Personal Access Token.';
        statusEl.className = 'devops-status devops-error';
        return;
      }

      connectPatBtn.disabled = true;
      statusEl.textContent = 'Connecting...';
      statusEl.className = 'devops-status devops-info';

      try {
        await window.electronAPI.devopsConnectPat(org, pat);
        connectedOrg = org;
        statusEl.textContent = 'Connected!';
        statusEl.className = 'devops-status devops-success';
        setTimeout(() => showView('projects'), 500);
      } catch (err) {
        statusEl.textContent = `Error: ${err.message || err}`;
        statusEl.className = 'devops-status devops-error';
        connectPatBtn.disabled = false;
      }
    });
  }

  function renderProjects(container, breadcrumb) {
    breadcrumb.textContent = connectedOrg || 'Azure DevOps';
    container.innerHTML = `
      <div class="devops-view-header">
        <span>Select a project</span>
        <button class="devops-btn devops-btn-small devops-show-imported-btn">Imported Items</button>
      </div>
      <div class="devops-list devops-project-list">
        <div class="devops-loading">Loading projects...</div>
      </div>`;

    container.querySelector('.devops-show-imported-btn').addEventListener('click', () => showView('imported'));

    window.electronAPI.devopsGetProjects().then((projects) => {
      const list = container.querySelector('.devops-project-list');
      if (!projects || projects.length === 0) {
        list.innerHTML = '<div class="devops-empty">No projects found.</div>';
        return;
      }
      list.innerHTML = '';
      for (const proj of projects) {
        const row = document.createElement('div');
        row.className = 'devops-list-item devops-project-item';
        row.innerHTML = `<span class="devops-item-name">${esc(proj.name)}</span><span class="devops-item-desc">${esc(proj.description || '')}</span>`;
        row.addEventListener('click', () => {
          selectedProject = proj.name;
          loadTeamsAndBacklog(proj.name);
        });
        list.appendChild(row);
      }
    }).catch((err) => {
      container.querySelector('.devops-project-list').innerHTML = `<div class="devops-error">Error: ${esc(err.message || String(err))}</div>`;
    });
  }

  async function loadTeamsAndBacklog(project) {
    try {
      const teams = await window.electronAPI.devopsGetTeams(project);
      if (teams && teams.length > 0) {
        selectedTeam = teams[0].name;
        const iteration = await window.electronAPI.devopsGetCurrentIteration(project, selectedTeam);
        currentIteration = iteration;
        showView('backlog', { project, team: selectedTeam, iteration, teams });
      } else {
        showView('backlog', { project, team: null, iteration: null, teams: [] });
      }
    } catch (err) {
      showView('backlog', { project, team: null, iteration: null, teams: [], error: err.message });
    }
  }

  function renderBacklog(container, breadcrumb, data) {
    const { project, team, iteration, teams, error } = data || {};
    breadcrumb.textContent = `${connectedOrg} / ${project}`;

    const teamOptions = (teams || []).map((t) =>
      `<option value="${esc(t.name)}" ${t.name === team ? 'selected' : ''}>${esc(t.name)}</option>`
    ).join('');

    const iterName = iteration ? iteration.name : 'No current sprint';

    container.innerHTML = `
      <div class="devops-backlog-header">
        <div class="devops-backlog-controls">
          <label>Team:</label>
          <select class="devops-input devops-team-select">${teamOptions}</select>
          <span class="devops-sprint-label">${esc(iterName)}</span>
          <button class="devops-btn devops-btn-small devops-refresh-btn">Refresh</button>
          <button class="devops-btn devops-btn-small devops-new-item-btn">+ New Item</button>
          <span style="flex:1"></span>
          <button class="devops-btn devops-btn-small devops-import-selected-btn" style="display:none">Import Selected (0)</button>
          <button class="devops-btn devops-btn-small devops-show-imported-btn">Imported Items</button>
        </div>
        <div class="devops-backlog-filter-bar">
          <select class="devops-input devops-filter-type"><option value="">All Types</option></select>
          <select class="devops-input devops-filter-state"><option value="">All States</option></select>
          <input type="text" class="devops-input devops-filter-search" placeholder="Search...">
          <button class="devops-btn devops-btn-small devops-filter-clear">Clear</button>
        </div>
      </div>
      <div class="devops-backlog-table-wrap">
        <table class="devops-backlog-table">
          <thead>
            <tr>
              <th class="devops-th-cb"><input type="checkbox" class="devops-select-all-cb"></th>
              <th class="devops-th-expand"></th>
              <th class="devops-th-sortable" data-sort="type">Type</th>
              <th class="devops-th-sortable" data-sort="id">ID</th>
              <th class="devops-th-sortable" data-sort="title">Title</th>
              <th class="devops-th-sortable" data-sort="state">State</th>
              <th class="devops-th-sortable" data-sort="assignedTo">Assigned To</th>
              <th class="devops-th-action"></th>
            </tr>
          </thead>
          <tbody class="devops-backlog-tbody"></tbody>
        </table>
        ${error ? `<div class="devops-error">${esc(error)}</div>` : '<div class="devops-loading devops-backlog-loading">Loading backlog...</div>'}
      </div>`;

    container.querySelector('.devops-show-imported-btn').addEventListener('click', () => showView('imported'));

    const teamSelect = container.querySelector('.devops-team-select');
    const refreshBtn = container.querySelector('.devops-refresh-btn');
    const importSelectedBtn = container.querySelector('.devops-import-selected-btn');
    const selectAllCb = container.querySelector('.devops-select-all-cb');
    const typeFilter = container.querySelector('.devops-filter-type');
    const stateFilter = container.querySelector('.devops-filter-state');
    const searchInput = container.querySelector('.devops-filter-search');
    const clearFilterBtn = container.querySelector('.devops-filter-clear');
    const tbody = container.querySelector('.devops-backlog-tbody');

    const selectedIds = new Set();
    let backlogItems = [];
    let currentSort = { field: null, dir: 'asc' };

    // --- Selection ---
    function updateImportSelectedBtn() {
      const count = selectedIds.size;
      if (count > 0) {
        importSelectedBtn.style.display = '';
        importSelectedBtn.textContent = `Import Selected (${count})`;
      } else {
        importSelectedBtn.style.display = 'none';
      }
    }

    selectAllCb.addEventListener('change', () => {
      const cbs = tbody.querySelectorAll('.devops-select-cb:not(:disabled)');
      cbs.forEach((cb) => { cb.checked = selectAllCb.checked; cb.dispatchEvent(new Event('change')); });
    });

    importSelectedBtn.addEventListener('click', async () => {
      importSelectedBtn.disabled = true;
      importSelectedBtn.textContent = 'Importing...';
      for (const id of selectedIds) {
        if (importedItems.has(id)) continue;
        const item = backlogItems.find((i) => i.id === id);
        if (!item) continue;
        const workItem = { ...item, project };
        importedItems.set(id, workItem);
        await window.electronAPI.importWorkItem(workItem);
      }
      selectedIds.clear();
      updateImportSelectedBtn();
      importSelectedBtn.disabled = false;
      window.dispatchEvent(new CustomEvent('workitems:changed'));
      renderRows();
    });

    // --- Filtering ---
    function populateFilterDropdowns() {
      const types = new Set();
      const states = new Set();
      for (const item of backlogItems) {
        if (item.type) types.add(abbreviateType(item.type));
        if (item.state) states.add(item.state);
      }
      const prevType = typeFilter.value;
      const prevState = stateFilter.value;
      typeFilter.innerHTML = '<option value="">All Types</option>';
      for (const t of [...types].sort()) typeFilter.innerHTML += `<option value="${esc(t)}">${esc(t)}</option>`;
      typeFilter.value = prevType;
      stateFilter.innerHTML = '<option value="">All States</option>';
      for (const s of [...states].sort()) stateFilter.innerHTML += `<option value="${esc(s)}">${esc(s)}</option>`;
      stateFilter.value = prevState;
    }

    function getFilteredSorted() {
      const typeVal = typeFilter.value;
      const stateVal = stateFilter.value;
      const searchVal = searchInput.value.toLowerCase().trim();

      let items = backlogItems.filter((item) => {
        if (typeVal && abbreviateType(item.type) !== typeVal) return false;
        if (stateVal && item.state !== stateVal) return false;
        if (searchVal) {
          const haystack = `#${item.id} ${item.title || ''} ${item.assignedTo || ''} ${item.description ? stripHtml(item.description) : ''}`.toLowerCase();
          if (!haystack.includes(searchVal)) return false;
        }
        return true;
      });

      if (currentSort.field) {
        items.sort((a, b) => {
          let va, vb;
          switch (currentSort.field) {
            case 'type': va = abbreviateType(a.type); vb = abbreviateType(b.type); break;
            case 'state': va = a.state || ''; vb = b.state || ''; break;
            case 'title': va = a.title || ''; vb = b.title || ''; break;
            case 'assignedTo': va = a.assignedTo || ''; vb = b.assignedTo || ''; break;
            case 'id': return currentSort.dir === 'asc' ? a.id - b.id : b.id - a.id;
            default: va = ''; vb = '';
          }
          const cmp = va.localeCompare(vb);
          return currentSort.dir === 'asc' ? cmp : -cmp;
        });
      }
      return items;
    }

    typeFilter.addEventListener('change', renderRows);
    stateFilter.addEventListener('change', renderRows);
    searchInput.addEventListener('input', renderRows);
    clearFilterBtn.addEventListener('click', () => {
      typeFilter.value = '';
      stateFilter.value = '';
      searchInput.value = '';
      renderRows();
    });

    // --- Sorting (column headers) ---
    container.querySelectorAll('.devops-th-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (currentSort.field === field) {
          currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort = { field, dir: 'asc' };
        }
        // Update header indicators
        container.querySelectorAll('.devops-th-sortable').forEach((h) => {
          h.classList.remove('sorted-asc', 'sorted-desc');
        });
        th.classList.add(currentSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        renderRows();
      });
    });

    // --- Render rows ---
    function renderRows() {
      const items = getFilteredSorted();
      tbody.innerHTML = '';
      const loadingEl = container.querySelector('.devops-backlog-loading');
      if (loadingEl) loadingEl.style.display = 'none';

      if (items.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="8" class="devops-empty">${backlogItems.length === 0 ? 'No items in current sprint.' : 'No items match the current filters.'}</td>`;
        tbody.appendChild(tr);
        return;
      }

      for (const item of items) {
        const isImported = importedItems.has(item.id);
        const typeClass = getTypeClass(item.type);

        // Main row
        const tr = document.createElement('tr');
        tr.className = 'devops-backlog-row';
        tr.dataset.id = item.id;
        tr.innerHTML = `
          <td class="devops-td-cb"><input type="checkbox" class="devops-select-cb" ${isImported ? 'disabled' : ''} ${selectedIds.has(item.id) ? 'checked' : ''}></td>
          <td class="devops-td-expand"><span class="devops-row-toggle">&#9654;</span></td>
          <td><span class="devops-wi-type ${typeClass}">${esc(abbreviateType(item.type))}</span></td>
          <td class="devops-td-id">#${item.id}</td>
          <td class="devops-td-title">${esc(item.title)}</td>
          <td class="devops-td-state">${esc(item.state)}</td>
          <td class="devops-td-assigned">${esc(item.assignedTo || '')}</td>
          <td class="devops-td-action">${isImported
            ? '<span class="devops-wi-imported" title="Imported">&#10003;</span>'
            : '<button class="devops-btn devops-btn-small devops-import-btn">Import</button>'
          }</td>`;

        // Detail row (hidden by default)
        const detailTr = document.createElement('tr');
        detailTr.className = 'devops-backlog-detail-row';
        detailTr.style.display = 'none';
        const rawDesc = item.description || '';
        const descText = rawDesc ? stripHtml(rawDesc) : '';
        detailTr.innerHTML = `<td colspan="8"><div class="devops-detail-content">${descText ? esc(descText) : '<em>No description</em>'}</div></td>`;

        // Toggle expand
        const toggleEl = tr.querySelector('.devops-row-toggle');
        function toggleDetail() {
          const expanded = detailTr.style.display !== 'none';
          detailTr.style.display = expanded ? 'none' : '';
          toggleEl.classList.toggle('expanded', !expanded);
        }
        toggleEl.addEventListener('click', (e) => { e.stopPropagation(); toggleDetail(); });
        // Click on title also expands
        tr.querySelector('.devops-td-title').addEventListener('click', toggleDetail);

        // Checkbox
        const cb = tr.querySelector('.devops-select-cb');
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          if (cb.checked) selectedIds.add(item.id);
          else selectedIds.delete(item.id);
          updateImportSelectedBtn();
        });

        // Import button
        if (!isImported) {
          tr.querySelector('.devops-import-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            const workItem = { ...item, project };
            importedItems.set(item.id, workItem);
            await window.electronAPI.importWorkItem(workItem);
            window.dispatchEvent(new CustomEvent('workitems:changed'));
            const btn = tr.querySelector('.devops-import-btn');
            const check = document.createElement('span');
            check.className = 'devops-wi-imported';
            check.title = 'Imported';
            check.innerHTML = '&#10003;';
            btn.replaceWith(check);
            cb.checked = false; cb.disabled = true;
            selectedIds.delete(item.id);
            updateImportSelectedBtn();
          });
        }

        tbody.appendChild(tr);
        tbody.appendChild(detailTr);
      }
    }

    // --- New Item ---
    const newItemBtn = container.querySelector('.devops-new-item-btn');
    newItemBtn.addEventListener('click', () => {
      showCreateDialog(container, project, currentIteration, () => loadItems());
    });

    // --- Load items ---
    async function loadItems() {
      const teamName = teamSelect.value;
      selectedTeam = teamName;
      selectedIds.clear();
      selectAllCb.checked = false;
      updateImportSelectedBtn();
      tbody.innerHTML = '';
      const loadingEl = container.querySelector('.devops-backlog-loading');
      if (loadingEl) { loadingEl.style.display = ''; loadingEl.textContent = 'Loading backlog...'; }

      try {
        const iter = await window.electronAPI.devopsGetCurrentIteration(project, teamName);
        currentIteration = iter;
        container.querySelector('.devops-sprint-label').textContent = iter ? iter.name : 'No current sprint';

        if (!iter) {
          backlogItems = [];
          if (loadingEl) loadingEl.textContent = 'No current sprint found for this team.';
          return;
        }

        const items = await window.electronAPI.devopsGetSprintItems(project, iter.attributes.path || iter.path);
        backlogItems = items || [];
        populateFilterDropdowns();
        renderRows();
      } catch (err) {
        if (loadingEl) { loadingEl.style.display = ''; loadingEl.textContent = `Error: ${err.message || String(err)}`; loadingEl.className = 'devops-error'; }
      }
    }

    teamSelect.addEventListener('change', loadItems);
    refreshBtn.addEventListener('click', loadItems);

    if (!error && iteration) loadItems();
  }

  function renderImported(container, breadcrumb) {
    breadcrumb.textContent = `${connectedOrg || 'Azure DevOps'} / Imported Items`;
    container.innerHTML = `
      <div class="devops-view-header">
        <span>Imported Work Items (${importedItems.size})</span>
      </div>
      <div class="devops-list devops-imported-list"></div>`;

    const list = container.querySelector('.devops-imported-list');

    if (importedItems.size === 0) {
      list.innerHTML = '<div class="devops-empty">No items imported yet. Browse a project backlog to import items.</div>';
      return;
    }

    for (const [id, item] of importedItems) {
      const row = document.createElement('div');
      row.className = 'devops-list-item devops-imported-item';

      const typeClass = getTypeClass(item.type);

      row.innerHTML = `
        <div class="devops-imported-main">
          <span class="devops-wi-type ${typeClass}">${esc(abbreviateType(item.type))}</span>
          <span class="devops-wi-id">#${item.id}</span>
          <span class="devops-wi-title">${esc(item.title)}</span>
          <span class="devops-wi-state devops-state-${item.state === 'Done' || item.state === 'Closed' ? 'done' : 'active'}">${esc(item.state)}</span>
        </div>
        <div class="devops-imported-actions">
          <button class="devops-btn devops-btn-small devops-btn-export" title="Export discussion as comment on this work item">Export Discussion</button>
          <button class="devops-btn devops-btn-small devops-btn-done" title="Mark as Done on Azure DevOps">Mark Done</button>
          <button class="devops-btn devops-btn-small devops-btn-remove" title="Remove from imported list">Remove</button>
        </div>
        ${item.description ? `<div class="devops-imported-desc">${esc(stripHtml(item.description))}</div>` : ''}`;

      row.querySelector('.devops-btn-export').addEventListener('click', async () => {
        const btn = row.querySelector('.devops-btn-export');
        btn.disabled = true;
        btn.textContent = 'Exporting...';
        try {
          const messages = await window.electronAPI.getMessages();
          const formatted = formatDiscussionForExport(messages, item);
          await window.electronAPI.devopsAddComment(item.project, item.id, formatted);
          btn.textContent = 'Exported!';
          btn.className += ' devops-btn-success';
          setTimeout(() => { btn.textContent = 'Export Discussion'; btn.disabled = false; btn.classList.remove('devops-btn-success'); }, 3000);
        } catch (err) {
          btn.textContent = `Error: ${err.message || err}`;
          btn.disabled = false;
          setTimeout(() => { btn.textContent = 'Export Discussion'; }, 3000);
        }
      });

      row.querySelector('.devops-btn-done').addEventListener('click', async () => {
        const btn = row.querySelector('.devops-btn-done');
        btn.disabled = true;
        btn.textContent = 'Updating...';
        try {
          await window.electronAPI.devopsUpdateState(item.id, 'Done');
          item.state = 'Done';
          await window.electronAPI.updateWorkItemState(item.id, 'Done');
          const stateEl = row.querySelector('.devops-wi-state');
          stateEl.textContent = 'Done';
          stateEl.className = 'devops-wi-state devops-state-done';
          btn.textContent = 'Done!';
          btn.className += ' devops-btn-success';
        } catch (err) {
          btn.textContent = `Error: ${err.message || err}`;
          btn.disabled = false;
          setTimeout(() => { btn.textContent = 'Mark Done'; }, 3000);
        }
      });

      row.querySelector('.devops-btn-remove').addEventListener('click', async () => {
        importedItems.delete(id);
        await window.electronAPI.removeWorkItem(id);
        window.dispatchEvent(new CustomEvent('workitems:changed'));
        row.remove();
        if (importedItems.size === 0) {
          list.innerHTML = '<div class="devops-empty">No items imported yet.</div>';
        }
        // Update header count
        const header = container.querySelector('.devops-view-header span');
        if (header) header.textContent = `Imported Work Items (${importedItems.size})`;
      });

      list.appendChild(row);
    }
  }
}

function showCreateDialog(container, project, iteration, onCreated) {
  // Remove any existing dialog
  const existing = container.querySelector('.devops-create-overlay');
  if (existing) existing.remove();

  const iterPath = iteration ? (iteration.attributes?.path || iteration.path || iteration.name) : '';

  const overlay = document.createElement('div');
  overlay.className = 'devops-create-overlay';
  overlay.innerHTML = `
    <div class="devops-create-dialog">
      <div class="devops-create-header">
        <span>Create Work Item</span>
        <span class="devops-create-close">&times;</span>
      </div>
      <div class="devops-create-body">
        <div class="devops-create-row">
          <label>Type</label>
          <select class="devops-input devops-create-type">
            <option value="Product Backlog Item">Product Backlog Item</option>
            <option value="Bug">Bug</option>
            <option value="Task">Task</option>
            <option value="Feature">Feature</option>
          </select>
        </div>
        <div class="devops-create-row">
          <label>Title *</label>
          <input type="text" class="devops-input devops-create-title" placeholder="Enter a title">
        </div>
        <div class="devops-create-row">
          <label>Assigned To</label>
          <input type="text" class="devops-input devops-create-assigned" placeholder="e.g. user@company.com">
        </div>
        <div class="devops-create-row">
          <label>Iteration</label>
          <input type="text" class="devops-input devops-create-iteration" value="${esc(iterPath)}">
        </div>
        <div class="devops-create-row devops-create-desc-row">
          <label class="devops-create-desc-label">Description / User Story</label>
          <textarea class="devops-input devops-create-desc" rows="6" placeholder="As a [user], I want [feature] so that [benefit]..."></textarea>
        </div>
        <div class="devops-create-row devops-create-acceptance-row">
          <label>Acceptance Criteria</label>
          <textarea class="devops-input devops-create-acceptance" rows="4" placeholder="Given... When... Then..."></textarea>
        </div>
        <div class="devops-create-row devops-create-repro-row" style="display:none">
          <label>Repro Steps</label>
          <textarea class="devops-input devops-create-repro" rows="4" placeholder="Steps to reproduce the issue..."></textarea>
        </div>
        <div class="devops-create-row devops-create-actions">
          <button class="devops-btn devops-create-submit">Create</button>
          <button class="devops-btn devops-btn-small devops-create-cancel">Cancel</button>
          <span class="devops-create-status"></span>
        </div>
      </div>
    </div>`;

  container.appendChild(overlay);

  const typeSelect = overlay.querySelector('.devops-create-type');
  const titleInput = overlay.querySelector('.devops-create-title');
  const assignedInput = overlay.querySelector('.devops-create-assigned');
  const iterInput = overlay.querySelector('.devops-create-iteration');
  const descInput = overlay.querySelector('.devops-create-desc');
  const acceptanceInput = overlay.querySelector('.devops-create-acceptance');
  const reproInput = overlay.querySelector('.devops-create-repro');
  const acceptanceRow = overlay.querySelector('.devops-create-acceptance-row');
  const reproRow = overlay.querySelector('.devops-create-repro-row');
  const submitBtn = overlay.querySelector('.devops-create-submit');
  const cancelBtn = overlay.querySelector('.devops-create-cancel');
  const closeBtn = overlay.querySelector('.devops-create-close');
  const statusEl = overlay.querySelector('.devops-create-status');

  // Toggle repro steps vs acceptance criteria based on type
  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'Bug') {
      reproRow.style.display = '';
      acceptanceRow.style.display = 'none';
    } else {
      reproRow.style.display = 'none';
      acceptanceRow.style.display = '';
    }
  });

  function close() { overlay.remove(); }
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  titleInput.focus();

  submitBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      statusEl.textContent = 'Title is required.';
      statusEl.className = 'devops-create-status devops-error';
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = 'Creating...';
    statusEl.className = 'devops-create-status devops-info';

    try {
      const fields = {
        title,
        description: descInput.value.trim() || undefined,
        iterationPath: iterInput.value.trim() || undefined,
        assignedTo: assignedInput.value.trim() || undefined,
        acceptanceCriteria: typeSelect.value !== 'Bug' ? (acceptanceInput.value.trim() || undefined) : undefined,
        reproSteps: typeSelect.value === 'Bug' ? (reproInput.value.trim() || undefined) : undefined,
      };

      const created = await window.electronAPI.devopsCreateWorkItem(project, typeSelect.value, fields);
      statusEl.textContent = `Created #${created.id} successfully!`;
      statusEl.className = 'devops-create-status devops-success';

      setTimeout(() => {
        close();
        if (onCreated) onCreated();
      }, 1000);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message || err}`;
      statusEl.className = 'devops-create-status devops-error';
      submitBtn.disabled = false;
    }
  });
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

function formatDiscussionForExport(messages, workItem) {
  let text = `<h3>Claude Team Session Discussion</h3>`;
  text += `<p><strong>Work Item:</strong> #${workItem.id} - ${workItem.title}</p>`;
  text += `<p><strong>Exported:</strong> ${new Date().toLocaleString()}</p><hr/>`;

  if (!messages || messages.length === 0) {
    text += '<p><em>No messages in discussion.</em></p>';
    return text;
  }

  for (const msg of messages) {
    const time = msg.timestamp ? new Date(msg.timestamp + 'Z').toLocaleString() : '';
    const from = msg.fromName || msg.from_agent || 'Unknown';
    const to = msg.toName || msg.to_agent || 'All';
    text += `<p><strong>${esc(from)}</strong> &rarr; ${esc(to)} <em>(${time})</em></p>`;
    text += `<blockquote>${esc(msg.content)}</blockquote>`;
  }

  return text;
}
