const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { PtyManager } = require('./pty-manager');
const { SessionManager } = require('./session-manager');
const { startMessageServer, stopMessageServer } = require('./message-server');
const { registerIpcHandlers } = require('./ipc-handlers');
const { buildMenu, setMessagePanelState, setAgentsPanelState } = require('./menu');

let mainWindow = null;
let ptyManager = null;
let sessionManager = null;
let messageServer = null;

const userDataPath = app.getPath('userData');
const lastSessionFile = path.join(userDataPath, 'last-session.json');

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
const appVersion = packageJson.version || '1.0.0';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: `ClaudeSession v${appVersion}`,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Enable right-click context menu with copy/paste
  mainWindow.webContents.on('context-menu', (event, params) => {
    const { Menu, MenuItem } = require('electron');
    const menu = new Menu();
    if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }));
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'paste' }));
      menu.append(new MenuItem({ role: 'cut' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
    }
    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  mainWindow.on('close', async (e) => {
    if (sessionManager && sessionManager.isOpen()) {
      e.preventDefault();
      await handleAppClose();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initialize() {
  ptyManager = new PtyManager();
  sessionManager = new SessionManager();
  messageServer = await startMessageServer(sessionManager, ptyManager);

  registerIpcHandlers(ipcMain, ptyManager, sessionManager, messageServer, mainWindow);

  function rebuildMenu() {
    buildMenu(mainWindow, sessionManager, ptyManager, messageServer);
  }

  rebuildMenu();

  // Update menu when panel states change
  ipcMain.on('messagePanelState', (event, isOpen) => {
    setMessagePanelState(isOpen);
    rebuildMenu();
  });

  ipcMain.on('agentsPanelState', (event, isOpen) => {
    setAgentsPanelState(isOpen);
    rebuildMenu();
  });

  // Try to restore last session
  try {
    if (fs.existsSync(lastSessionFile)) {
      const data = JSON.parse(fs.readFileSync(lastSessionFile, 'utf-8'));
      console.log('Last session file:', data.sessionPath);
      if (data.sessionPath && fs.existsSync(data.sessionPath)) {
        await sessionManager.open(data.sessionPath);
        console.log('Session restored:', sessionManager.isOpen());
      } else {
        console.log('Session file not found on disk');
      }
    } else {
      console.log('No last-session.json found');
    }
  } catch (e) {
    console.error('Failed to restore session:', e);
  }
}

function isTemporarySession(sessionPath) {
  if (!sessionPath) return true;
  const defaultDir = path.join(userDataPath, 'ClaudeSession', 'Sessions');
  return sessionPath.startsWith(defaultDir) && path.basename(sessionPath).startsWith('temp');
}

async function saveCurrentSession() {
  try {
    if (sessionManager && sessionManager.isOpen()) {
      // Save all active agents
      const agents = ptyManager.getAll();
      for (const agent of agents) {
        sessionManager.saveAgent(agent);
      }

      // Save window state
      if (mainWindow) {
        const bounds = mainWindow.getBounds();
        sessionManager.saveMeta('windowBounds', JSON.stringify(bounds));
      }
    }
  } catch (e) {
    console.error('Failed to save session:', e);
  }
}

async function handleAppClose() {
  try {
    if (sessionManager && sessionManager.isOpen()) {
      // Always save agent state to the temp/current file
      await saveCurrentSession();

      const sessionPath = sessionManager.getPath();
      const isTemp = isTemporarySession(sessionPath);

      if (isTemp) {
        // Ask if user wants to save
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Save', "Don't Save", 'Cancel'],
          defaultId: 0,
          title: 'Save Session',
          message: 'Do you want to save this session?',
        });

        if (response === 2) return; // Cancel — don't close

        if (response === 0) {
          // Save As
          const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Session As',
            defaultPath: 'MySession.cms',
            filters: [{ name: 'ClaudeSession Session', extensions: ['cms'] }],
          });
          if (result.canceled) return; // Cancel — don't close
          sessionManager.saveTo(result.filePath);
          // Saved session — remember for next launch
          fs.writeFileSync(lastSessionFile, JSON.stringify({ sessionPath: result.filePath }), 'utf-8');
        } else {
          // Don't Save — remove last-session.json so it won't auto-restore
          if (fs.existsSync(lastSessionFile)) {
            fs.unlinkSync(lastSessionFile);
          }
        }
      } else {
        // Named session — auto-save and remember
        fs.writeFileSync(lastSessionFile, JSON.stringify({ sessionPath }), 'utf-8');
      }

      ptyManager.killAll();
      sessionManager.close();
    }
  } catch (e) {
    console.error('Failed during app close:', e);
  }
  mainWindow.destroy();
}

app.whenReady().then(async () => {
  createWindow();
  await initialize();

  // Send restore data once both the window and session are ready
  function sendRestoreData() {
    if (sessionManager.isOpen()) {
      const messages = sessionManager.getMessages();
      const sessionPath = sessionManager.getPath();
      const agents = sessionManager.getAgents();
      mainWindow.webContents.send('session:restored', { agents, messages, sessionPath });
    }
    mainWindow.webContents.send('server:port', messageServer.port);
  }

  // If page already loaded during initialize(), send now; otherwise wait
  if (!mainWindow.webContents.isLoading()) {
    sendRestoreData();
  } else {
    mainWindow.webContents.on('did-finish-load', sendRestoreData);
  }
});

app.on('window-all-closed', () => {
  ptyManager.killAll();
  stopMessageServer(messageServer);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
