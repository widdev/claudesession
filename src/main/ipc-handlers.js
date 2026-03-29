const { dialog, app } = require('electron');
const pathMod = require('path');
const fs = require('fs');
const { restartMessageServer } = require('./message-server');

// --- Settings helpers ---
function getSettingsPath() {
  return pathMod.join(app.getPath('userData'), 'ClaudeSession', 'settings.json');
}

function readSettings() {
  const settingsPath = getSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function writeSettings(settings) {
  const settingsPath = getSettingsPath();
  const dir = pathMod.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

function getSessionsDir() {
  return pathMod.join(app.getPath('userData'), 'ClaudeSession', 'Sessions');
}

function isTemporarySession(sessionPath) {
  if (!sessionPath) return true;
  return sessionPath.startsWith(getSessionsDir()) && pathMod.basename(sessionPath).startsWith('temp');
}

function registerIpcHandlers(ipcMain, ptyManager, sessionManager, messageServer, mainWindow) {
  // --- PTY ---
  ipcMain.handle('pty:create', (event, { agentId, name, cwd, autoPermissions }) => {
    const agent = ptyManager.create(agentId, name, cwd, messageServer.port, { autoPermissions });

    // Forward PTY data to renderer
    ptyManager.onData(agent.id, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:data', agent.id, data);
      }
    });

    // Notify renderer on exit
    ptyManager.onExit(agent.id, (exitCode) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:exit', agent.id, exitCode);
      }
    });

    // Save agent to session
    if (sessionManager.isOpen()) {
      sessionManager.saveAgent(agent);
    }

    return agent;
  });

  ipcMain.on('pty:write', (event, agentId, data) => {
    ptyManager.write(agentId, data);
  });

  ipcMain.on('pty:resize', (event, agentId, cols, rows) => {
    ptyManager.resize(agentId, cols, rows);
  });

  ipcMain.handle('pty:kill', (event, agentId) => {
    ptyManager.kill(agentId);
  });

  ipcMain.handle('pty:rename', (event, agentId, newName) => {
    ptyManager.rename(agentId, newName);
    if (sessionManager.isOpen()) {
      const agent = ptyManager.get(agentId);
      if (agent) {
        sessionManager.saveAgent(agent);
      }
    }
  });

  ipcMain.handle('pty:changeCwd', async (event, agentId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    const newCwd = result.filePaths[0];
    ptyManager.changeCwd(agentId, newCwd);
    if (sessionManager.isOpen()) {
      const agent = ptyManager.get(agentId);
      if (agent) sessionManager.saveAgent(agent);
    }
    return newCwd;
  });

  // --- Dialog ---
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // --- Agents ---
  ipcMain.handle('agents:list', () => {
    return ptyManager.getAll();
  });

  ipcMain.handle('agents:listSaved', () => {
    return sessionManager.getAgents();
  });

  ipcMain.handle('agents:remove', (event, agentId) => {
    sessionManager.removeAgent(agentId);
  });

  // --- Messages ---
  ipcMain.handle('messages:getAll', () => {
    return sessionManager.getMessages();
  });

  ipcMain.handle('messages:remove', (event, messageId) => {
    sessionManager.removeMessage(messageId);
  });

  ipcMain.handle('messages:clear', () => {
    sessionManager.clearMessages();
  });

  // --- Session ---

  // Helper: create a temp session in the default folder
  async function createTempSession() {
    const sessDir = getSessionsDir();
    if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    let filePath = pathMod.join(sessDir, `temp${dateStr}_${hh}${mm}.cms`);
    let counter = 2;
    while (fs.existsSync(filePath)) {
      filePath = pathMod.join(sessDir, `temp${dateStr}_${hh}${mm}_${counter}.cms`);
      counter++;
    }
    await sessionManager.create(filePath);
    return filePath;
  }

  ipcMain.handle('session:ensureOpen', async () => {
    if (sessionManager.isOpen()) return sessionManager.getPath();
    const filePath = await createTempSession();
    return filePath;
  });

  ipcMain.handle('session:new', async () => {
    ptyManager.killAll();
    const filePath = await createTempSession();
    return filePath;
  });

  ipcMain.handle('session:open', async () => {
    const sessDir = getSessionsDir();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Session',
      defaultPath: fs.existsSync(sessDir) ? sessDir : undefined,
      filters: [{ name: 'ClaudeSession Session', extensions: ['cms'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;

    ptyManager.killAll();
    await sessionManager.open(result.filePaths[0]);

    const agents = sessionManager.getAgents();
    const messages = sessionManager.getMessages();
    return { filePath: result.filePaths[0], agents, messages };
  });

  ipcMain.handle('session:openFile', async (event, filePath) => {
    if (!fs.existsSync(filePath)) return null;
    ptyManager.killAll();
    await sessionManager.open(filePath);
    const agents = sessionManager.getAgents();
    const messages = sessionManager.getMessages();
    return { filePath, agents, messages };
  });

  ipcMain.handle('session:listRecent', () => {
    const sessDir = getSessionsDir();
    if (!fs.existsSync(sessDir)) return [];
    const files = fs.readdirSync(sessDir)
      .filter(f => f.endsWith('.cms'))
      .map(f => {
        const fullPath = pathMod.join(sessDir, f);
        const stat = fs.statSync(fullPath);
        const isTemp = f.startsWith('temp');
        // Format display name
        let displayName;
        if (isTemp) {
          // temp20260329_1430.cms -> "Unsaved Session 29.03.2026 14:30"
          const match = f.match(/^temp(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
          if (match) {
            displayName = `Unsaved Session ${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}`;
          } else {
            // Fallback for old format temp20260329.cms
            const oldMatch = f.match(/^temp(\d{4})(\d{2})(\d{2})/);
            if (oldMatch) {
              displayName = `Unsaved Session ${oldMatch[3]}.${oldMatch[2]}.${oldMatch[1]}`;
            } else {
              displayName = f.replace('.cms', '');
            }
          }
          // Add counter suffix if present (only after time, e.g. _1430_2)
          const counterMatch = f.match(/_(\d{4})_(\d+)\.cms$/);
          if (counterMatch) {
            displayName += ` (${counterMatch[2]})`;
          }
        } else {
          displayName = f.replace('.cms', '');
        }
        return {
          path: fullPath,
          name: displayName,
          isTemp,
          modified: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.modified - a.modified)
      .slice(0, 15); // Keep last 15
    return files;
  });

  ipcMain.handle('session:save', async () => {
    if (!sessionManager.isOpen()) {
      await createTempSession();
    }

    const agents = ptyManager.getAll();
    for (const agent of agents) {
      sessionManager.saveAgent(agent);
    }
    if (mainWindow) {
      const bounds = mainWindow.getBounds();
      sessionManager.saveMeta('windowBounds', JSON.stringify(bounds));
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Session As',
      defaultPath: 'MySession.cms',
      filters: [{ name: 'ClaudeSession Session', extensions: ['cms'] }],
    });
    if (result.canceled) return false;

    sessionManager.saveTo(result.filePath);
    return result.filePath;
  });

  ipcMain.handle('session:close', async (event, options = {}) => {
    if (sessionManager.isOpen()) {
      const sessionPath = sessionManager.getPath();
      const isTemp = isTemporarySession(sessionPath);

      if (isTemp) {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Save', "Don't Save", 'Cancel'],
          defaultId: 0,
          title: 'Save Session',
          message: 'Do you want to save this session?',
        });
        if (response === 2) return false;
        if (response === 0) {
          const agents = ptyManager.getAll();
          for (const agent of agents) {
            sessionManager.saveAgent(agent);
          }
          if (mainWindow) {
            sessionManager.saveMeta('windowBounds', JSON.stringify(mainWindow.getBounds()));
          }
          const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Session As',
            defaultPath: 'MySession.cms',
            filters: [{ name: 'ClaudeSession Session', extensions: ['cms'] }],
          });
          if (result.canceled) return false;
          sessionManager.saveTo(result.filePath);
        }
      } else {
        // Saved session — confirm if starting a new session
        const msg = options.forNewSession
          ? 'Are you sure you want to close the current session and start a new one?'
          : 'Are you sure you want to close this session?';
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Yes', 'Cancel'],
          defaultId: 0,
          title: 'Close Session',
          message: msg,
        });
        if (response !== 0) return false;
      }
    }
    ptyManager.killAll();
    sessionManager.close();
    return true;
  });

  ipcMain.handle('session:isOpen', () => {
    return sessionManager.isOpen();
  });

  ipcMain.handle('session:getPath', () => {
    return sessionManager.getPath();
  });

  ipcMain.handle('server:getPort', () => {
    return messageServer.port;
  });

  ipcMain.handle('server:restart', async (event, port) => {
    try {
      await restartMessageServer(messageServer, port);
      return { success: true, port: messageServer.port };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Settings ---
  ipcMain.handle('settings:get', (event, key) => {
    const settings = readSettings();
    return key ? settings[key] : settings;
  });

  ipcMain.handle('settings:set', (event, key, value) => {
    const settings = readSettings();
    settings[key] = value;
    writeSettings(settings);
  });

  ipcMain.handle('settings:clearAll', () => {
    writeSettings({});
  });

  // --- Layout ---
  ipcMain.handle('layout:save', (event, layoutConfig) => {
    if (sessionManager.isOpen()) {
      sessionManager.saveMeta('layoutConfig', JSON.stringify(layoutConfig));
    }
  });

  ipcMain.handle('layout:load', () => {
    if (sessionManager.isOpen()) {
      const config = sessionManager.getMeta('layoutConfig');
      return config ? JSON.parse(config) : null;
    }
    return null;
  });
}

module.exports = { registerIpcHandlers };
