const { Menu, app } = require('electron');
const path = require('path');
const fs = require('fs');

function readAgentLayoutMode() {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'ClaudeSession', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.agentLayoutMode) return settings.agentLayoutMode;
    }
  } catch (e) { /* ignore */ }
  return 'tabs';
}

function getSessionsDir() {
  return path.join(app.getPath('userData'), 'ClaudeSession', 'Sessions');
}

function getRecentSessionsFile() {
  return path.join(app.getPath('userData'), 'recent-sessions.json');
}

function loadRecentSessions() {
  const filePath = getRecentSessionsFile();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return [];
}

function saveRecentSessions(entries) {
  fs.writeFileSync(getRecentSessionsFile(), JSON.stringify(entries, null, 2), 'utf-8');
}

function addRecentSession(sessionPath, displayName) {
  if (!sessionPath) return;
  let entries = loadRecentSessions();
  // Remove existing entry for same path
  entries = entries.filter(e => e.path !== sessionPath);
  // Add at front
  entries.unshift({ path: sessionPath, name: displayName || path.basename(sessionPath, '.cms'), timestamp: Date.now() });
  // Keep max 15
  entries = entries.slice(0, 15);
  saveRecentSessions(entries);
}

function getRecentSessions() {
  const entries = loadRecentSessions();
  // Filter out files that no longer exist
  return entries.filter(e => fs.existsSync(e.path));
}

// Legacy — kept for export compatibility but no longer drives menu state
function setMessagePanelState() {}
function setAgentsPanelState() {}

function isTemporarySession(sessionPath) {
  if (!sessionPath) return true;
  const sessDir = getSessionsDir();
  return sessionPath.startsWith(sessDir) && path.basename(sessionPath).startsWith('temp');
}

function buildMenu(mainWindow, sessionManager, ptyManager, messageServer) {
  const recentSessions = getRecentSessions();
  const recentItems = recentSessions.length > 0
    ? [
        ...recentSessions.map(s => ({
          label: s.name,
          click: () => mainWindow.webContents.send('menu:openRecentFile', s.path),
        })),
        { type: 'separator' },
        {
          label: 'Clear Recent Sessions',
          click: () => {
            saveRecentSessions([]);
            buildMenu(mainWindow, sessionManager, ptyManager, messageServer);
          },
        },
      ]
    : [{ label: 'No recent sessions', enabled: false }];

  const hasAgents = ptyManager.getAll().length > 0;
  const sessionIsOpen = sessionManager.isOpen();
  const sessionIsTemp = sessionIsOpen && isTemporarySession(sessionManager.getPath());

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => mainWindow.webContents.send('menu:newSession'),
        },
        {
          label: 'Open Session...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu:openSession'),
        },
        {
          label: 'Open Recent',
          submenu: recentItems,
        },
        { type: 'separator' },
        {
          label: 'Save Session',
          accelerator: 'CmdOrCtrl+S',
          enabled: sessionIsTemp,
          click: () => mainWindow.webContents.send('menu:saveSession'),
        },
        {
          label: 'Save Session As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          enabled: sessionIsOpen,
          click: () => mainWindow.webContents.send('menu:saveSessionAs'),
        },
        {
          label: 'Close Session',
          enabled: sessionIsOpen,
          click: () => mainWindow.webContents.send('menu:closeSession'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Agents',
      submenu: [
        {
          label: 'New Agent...',
          accelerator: 'CmdOrCtrl+N',
          enabled: sessionIsOpen,
          click: () => mainWindow.webContents.send('menu:newAgent'),
        },
        { type: 'separator' },
        {
          label: 'Reinitialise Agents',
          enabled: sessionIsOpen && hasAgents,
          click: () => mainWindow.webContents.send('menu:reinitialiseAgents'),
        },
        {
          label: 'Remove All Agents',
          enabled: sessionIsOpen && hasAgents,
          click: () => mainWindow.webContents.send('menu:removeAllAgents'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Agent Layout',
          enabled: sessionIsOpen,
          submenu: (() => {
            const lm = readAgentLayoutMode();
            return [
              { label: 'Side by Side', type: 'radio', checked: lm === 'side-by-side', click: () => mainWindow.webContents.send('menu:setLayout', 'side-by-side') },
              { label: 'Stacked', type: 'radio', checked: lm === 'stacked', click: () => mainWindow.webContents.send('menu:setLayout', 'stacked') },
              { label: 'Tabbed', type: 'radio', checked: lm === 'tabs', click: () => mainWindow.webContents.send('menu:setLayout', 'tabs') },
            ];
          })(),
        },
        { type: 'separator' },
        { label: 'Show Discussion', enabled: sessionIsOpen, click: () => mainWindow.webContents.send('menu:showDiscussion') },
        { label: 'Show Tasks', enabled: sessionIsOpen, click: () => mainWindow.webContents.send('menu:showTasks') },
        { type: 'separator' },
        {
          label: 'Toggle Light/Dark Theme',
          accelerator: 'CmdOrCtrl+T',
          enabled: sessionIsOpen,
          click: () => mainWindow.webContents.send('menu:toggleTheme'),
        },
      ],
    },
    {
      label: 'Actions',
      submenu: [
        {
          label: 'Archive Discussion...',
          enabled: sessionIsOpen,
          click: () => mainWindow.webContents.send('menu:archiveDiscussion'),
        },
        {
          label: 'Restore Archived Messages',
          enabled: sessionIsOpen,
          click: () => mainWindow.webContents.send('menu:restoreArchived'),
        },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Rename Session...',
          enabled: sessionIsOpen,
          click: () => mainWindow.webContents.send('menu:renameSession'),
        },
        { type: 'separator' },
        {
          label: 'Clear All Settings',
          click: () => mainWindow.webContents.send('menu:clearSettings'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `About Claude Session Manager`,
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Claude Session Manager',
              message: 'Claude Session Manager',
              detail: `Multi-agent Claude Code session manager.\n\nVersion ${app.getVersion()}`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

module.exports = { buildMenu, setMessagePanelState, setAgentsPanelState, addRecentSession };
