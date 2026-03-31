const { Menu, app } = require('electron');
const path = require('path');
const fs = require('fs');

function getSessionsDir() {
  return path.join(app.getPath('userData'), 'ClaudeSession', 'Sessions');
}

function getRecentSessions() {
  const sessDir = getSessionsDir();
  if (!fs.existsSync(sessDir)) return [];
  return fs.readdirSync(sessDir)
    .filter(f => f.endsWith('.cms'))
    .map(f => {
      const fullPath = path.join(sessDir, f);
      const stat = fs.statSync(fullPath);
      const isTemp = f.startsWith('temp');
      let displayName;
      if (isTemp) {
        const match = f.match(/^temp(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
        if (match) {
          displayName = `Unsaved Session ${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}`;
        } else {
          const oldMatch = f.match(/^temp(\d{4})(\d{2})(\d{2})/);
          if (oldMatch) {
            displayName = `Unsaved Session ${oldMatch[3]}.${oldMatch[2]}.${oldMatch[1]}`;
          } else {
            displayName = f.replace('.cms', '');
          }
        }
        const counterMatch = f.match(/_(\d{4})_(\d+)\.cms$/);
        if (counterMatch) displayName += ` (${counterMatch[2]})`;
      } else {
        displayName = f.replace('.cms', '');
      }
      return { path: fullPath, name: displayName, modified: stat.mtimeMs };
    })
    .sort((a, b) => b.modified - a.modified)
    .slice(0, 15);
}

let messagePanelOpen = true;
let agentsPanelOpen = true;

function setMessagePanelState(open) {
  messagePanelOpen = open;
}

function setAgentsPanelState(open) {
  agentsPanelOpen = open;
}

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
            const sessDir = getSessionsDir();
            if (fs.existsSync(sessDir)) {
              const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.cms') && f.startsWith('temp'));
              for (const f of files) {
                try { fs.unlinkSync(path.join(sessDir, f)); } catch (e) { /* ignore */ }
              }
              buildMenu(mainWindow, sessionManager, ptyManager, messageServer);
            }
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
          label: 'Close Session',
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
          click: () => mainWindow.webContents.send('menu:newAgent'),
        },
        { type: 'separator' },
        {
          label: 'Remove All Agents',
          enabled: hasAgents,
          click: () => mainWindow.webContents.send('menu:removeAllAgents'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Agent Layout',
          submenu: [
            {
              label: 'Side by Side',
              type: 'radio',
              checked: true,
              click: () => mainWindow.webContents.send('menu:setLayout', 'side-by-side'),
            },
            {
              label: 'Stacked',
              type: 'radio',
              checked: false,
              click: () => mainWindow.webContents.send('menu:setLayout', 'stacked'),
            },
            {
              label: 'Tabbed',
              type: 'radio',
              checked: false,
              click: () => mainWindow.webContents.send('menu:setLayout', 'tabs'),
            },
          ],
        },
        { type: 'separator' },
        {
          label: agentsPanelOpen ? 'Hide Agent Consoles' : 'Show Agent Consoles',
          click: () => mainWindow.webContents.send('menu:toggleAgents'),
        },
        {
          label: 'Toggle Tasks Panel',
          click: () => mainWindow.webContents.send('menu:toggleTasks'),
        },
        {
          label: messagePanelOpen ? 'Close Discussion' : 'Show Discussion',
          accelerator: 'CmdOrCtrl+M',
          click: () => mainWindow.webContents.send('menu:toggleMessages'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Light/Dark Theme',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow.webContents.send('menu:toggleTheme'),
        },
      ],
    },
    {
      label: 'Actions',
      submenu: [
        {
          label: 'Archive Discussion...',
          click: () => mainWindow.webContents.send('menu:archiveDiscussion'),
        },
        {
          label: 'Restore Archived Messages',
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
          label: `About ClaudeSession`,
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About ClaudeSession',
              message: 'ClaudeSession',
              detail: 'Multi-agent Claude Code session manager.\n\nVersion 1.0.0',
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

module.exports = { buildMenu, setMessagePanelState, setAgentsPanelState };
