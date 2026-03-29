const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // PTY
  createAgent: (opts) => ipcRenderer.invoke('pty:create', opts),
  killAgent: (id) => ipcRenderer.invoke('pty:kill', id),
  writeToAgent: (id, data) => ipcRenderer.send('pty:write', id, data),
  resizeAgent: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  renameAgent: (id, name) => ipcRenderer.invoke('pty:rename', id, name),
  changeAgentCwd: (id) => ipcRenderer.invoke('pty:changeCwd', id),
  onAgentData: (callback) => {
    ipcRenderer.on('pty:data', (event, agentId, data) => callback(agentId, data));
  },
  onAgentExit: (callback) => {
    ipcRenderer.on('pty:exit', (event, agentId, exitCode) => callback(agentId, exitCode));
  },

  // Dialog
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),

  // Agents
  listAgents: () => ipcRenderer.invoke('agents:list'),
  listSavedAgents: () => ipcRenderer.invoke('agents:listSaved'),
  removeSavedAgent: (id) => ipcRenderer.invoke('agents:remove', id),

  // Messages
  getMessages: () => ipcRenderer.invoke('messages:getAll'),
  removeMessage: (id) => ipcRenderer.invoke('messages:remove', id),
  clearMessages: () => ipcRenderer.invoke('messages:clear'),
  onNewMessage: (callback) => {
    ipcRenderer.on('message:new', (event, msg) => callback(msg));
  },

  // Session
  ensureSessionOpen: () => ipcRenderer.invoke('session:ensureOpen'),
  newSession: () => ipcRenderer.invoke('session:new'),
  openSession: () => ipcRenderer.invoke('session:open'),
  openSessionFile: (filePath) => ipcRenderer.invoke('session:openFile', filePath),
  listRecentSessions: () => ipcRenderer.invoke('session:listRecent'),
  saveSession: () => ipcRenderer.invoke('session:save'),
  closeSession: (options) => ipcRenderer.invoke('session:close', options),
  isSessionOpen: () => ipcRenderer.invoke('session:isOpen'),
  getSessionPath: () => ipcRenderer.invoke('session:getPath'),
  onSessionRestored: (callback) => {
    ipcRenderer.on('session:restored', (event, data) => callback(data));
  },

  // Server
  getServerPort: () => ipcRenderer.invoke('server:getPort'),
  restartServer: (port) => ipcRenderer.invoke('server:restart', port),
  onServerPort: (callback) => {
    ipcRenderer.on('server:port', (event, port) => callback(port));
  },

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  clearAllSettings: () => ipcRenderer.invoke('settings:clearAll'),

  // Panel state (for menu label sync)
  setMessagePanelState: (isOpen) => ipcRenderer.send('messagePanelState', isOpen),
  setAgentsPanelState: (isOpen) => ipcRenderer.send('agentsPanelState', isOpen),

  // Layout
  saveLayout: (config) => ipcRenderer.invoke('layout:save', config),
  loadLayout: () => ipcRenderer.invoke('layout:load'),

  // Menu events (passes data arguments through)
  onMenuEvent: (event, callback) => {
    ipcRenderer.on(event, (ev, ...args) => callback(...args));
  },
});
