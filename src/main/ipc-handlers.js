const { dialog, app } = require('electron');
const pathMod = require('path');
const fs = require('fs');
const { restartMessageServer } = require('./message-server');
const { addRecentSession } = require('./menu');

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
  ipcMain.handle('pty:create', (event, { agentId, name, cwd, autoPermissions, updateClaudeMd }) => {
    const agent = ptyManager.create(agentId, name, cwd, messageServer.port, { autoPermissions, updateClaudeMd });

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
  ipcMain.handle('dialog:showInfo', async (event, title, message) => {
    await dialog.showMessageBox(mainWindow, { type: 'info', title, message, buttons: ['OK'] });
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async (event, opts) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: opts.title || 'Save File',
      defaultPath: opts.defaultPath || 'file.txt',
      filters: opts.filters || [{ name: 'Text Files', extensions: ['txt'] }],
    });
    if (result.canceled) return null;
    return result.filePath;
  });

  ipcMain.handle('file:writeText', async (event, filePath, content) => {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  });

  // --- Agents ---
  ipcMain.handle('agents:list', () => {
    return ptyManager.getAll();
  });

  ipcMain.handle('agents:reinitialise', () => {
    ptyManager.reinitialiseAll();
  });

  ipcMain.handle('agents:listSaved', () => {
    return sessionManager.getAgents();
  });

  ipcMain.handle('agents:remove', (event, agentId) => {
    sessionManager.removeAgent(agentId);
  });

  // --- Messages ---
  ipcMain.handle('messages:getAll', (event, filter) => {
    return sessionManager.getMessages(filter);
  });

  ipcMain.handle('messages:senders', () => {
    return sessionManager.getMessageSenders();
  });

  ipcMain.handle('messages:save', (event, msg) => {
    return sessionManager.saveMessage(msg);
  });

  ipcMain.handle('messages:remove', (event, messageId) => {
    sessionManager.removeMessage(messageId);
  });

  ipcMain.handle('messages:clear', () => {
    sessionManager.clearMessages();
  });

  ipcMain.handle('messages:getArchived', () => {
    return sessionManager.getArchivedMessages();
  });

  ipcMain.handle('messages:restore', (event, messageId) => {
    sessionManager.restoreMessage(messageId);
  });

  ipcMain.handle('messages:restoreAll', () => {
    sessionManager.restoreAllMessages();
  });

  // --- Tasks ---
  ipcMain.handle('tasks:getAll', () => {
    return sessionManager.getTasks();
  });

  ipcMain.handle('tasks:add', (event, content) => {
    // Generate a friendly 4-char ID (2 uppercase letters + 2 digits)
    function generateId() {
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      const digits = '0123456789';
      return letters[Math.floor(Math.random() * letters.length)]
           + letters[Math.floor(Math.random() * letters.length)]
           + digits[Math.floor(Math.random() * digits.length)]
           + digits[Math.floor(Math.random() * digits.length)];
    }
    // Ensure uniqueness
    let id;
    const existing = new Set(sessionManager.getTasks().map(t => t.id));
    do { id = generateId(); } while (existing.has(id));

    const task = sessionManager.saveTask({ id, content });
    return task;
  });

  ipcMain.handle('tasks:remove', (event, taskId) => {
    sessionManager.removeTask(taskId);
  });

  ipcMain.handle('tasks:get', (event, taskId) => {
    return sessionManager.getTask(taskId);
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
      filters: [{ name: 'Claude Session Manager Session', extensions: ['cms'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;

    ptyManager.killAll();
    await sessionManager.open(result.filePaths[0]);

    const agents = sessionManager.getAgents();
    const messages = sessionManager.getMessages();
    const name = sessionManager.getMeta('sessionName') || pathMod.basename(result.filePaths[0], '.cms');
    addRecentSession(result.filePaths[0], name);
    return { filePath: result.filePaths[0], agents, messages };
  });

  ipcMain.handle('session:openFile', async (event, filePath) => {
    if (!fs.existsSync(filePath)) return null;
    ptyManager.killAll();
    await sessionManager.open(filePath);
    const agents = sessionManager.getAgents();
    const messages = sessionManager.getMessages();
    const name = sessionManager.getMeta('sessionName') || pathMod.basename(filePath, '.cms');
    addRecentSession(filePath, name);
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

  ipcMain.handle('session:save', async (event, sessionName) => {
    if (!sessionManager.isOpen()) {
      await createTempSession();
    }

    const sessionPath = sessionManager.getPath();

    // Save agent state
    const agents = ptyManager.getAll();
    for (const agent of agents) {
      sessionManager.saveAgent(agent);
    }
    if (mainWindow) {
      sessionManager.saveMeta('windowBounds', JSON.stringify(mainWindow.getBounds()));
    }

    // If session is already saved (not temp), just save in place
    if (!isTemporarySession(sessionPath)) {
      // If a new name was provided (rename), update the metadata
      if (sessionName) {
        sessionManager.saveMeta('sessionName', sessionName);
      }
      sessionManager.saveTo(sessionPath);
      const name = sessionManager.getMeta('sessionName') || '';
      addRecentSession(sessionPath, name);
      return { filePath: sessionPath, sessionName: name };
    }

    // Temp session — needs a name and file path
    // Use the provided name or prompt will come from the renderer
    if (!sessionName) return false;

    sessionManager.saveMeta('sessionName', sessionName);

    // Save to the default sessions directory with a sanitized filename
    const sessDir = getSessionsDir();
    if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
    const safeName = sessionName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Session';
    let filePath = pathMod.join(sessDir, `${safeName}.cms`);
    let counter = 2;
    while (fs.existsSync(filePath)) {
      filePath = pathMod.join(sessDir, `${safeName} (${counter}).cms`);
      counter++;
    }

    sessionManager.saveTo(filePath);
    addRecentSession(filePath, sessionName);
    return { filePath, sessionName };
  });

  ipcMain.handle('session:saveAs', async () => {
    if (!sessionManager.isOpen()) return null;

    // Save agent state first
    const agents = ptyManager.getAll();
    for (const agent of agents) {
      sessionManager.saveAgent(agent);
    }
    if (mainWindow) {
      sessionManager.saveMeta('windowBounds', JSON.stringify(mainWindow.getBounds()));
    }

    const sessDir = getSessionsDir();
    const currentName = sessionManager.getMeta('sessionName') || 'Session';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Session As',
      defaultPath: pathMod.join(fs.existsSync(sessDir) ? sessDir : app.getPath('documents'), `${currentName}.cms`),
      filters: [{ name: 'Claude Session Manager Session', extensions: ['cms'] }],
    });
    if (result.canceled || !result.filePath) return null;

    const filePath = result.filePath;
    const name = pathMod.basename(filePath, '.cms');
    sessionManager.saveMeta('sessionName', name);
    sessionManager.saveTo(filePath);
    addRecentSession(filePath, name);
    return { filePath, sessionName: name };
  });

  ipcMain.handle('session:rename', async (event, newName) => {
    if (!sessionManager.isOpen()) return null;
    if (!newName) return null;
    sessionManager.saveMeta('sessionName', newName);
    sessionManager.saveTo(sessionManager.getPath());
    return newName;
  });

  ipcMain.handle('session:getName', () => {
    if (!sessionManager.isOpen()) return null;
    return sessionManager.getMeta('sessionName') || null;
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
          // Signal renderer to prompt for a name, then save
          return 'needs-name';
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

  ipcMain.handle('session:isTemp', () => {
    if (!sessionManager.isOpen()) return true;
    return isTemporarySession(sessionManager.getPath());
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
