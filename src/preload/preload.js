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
  saveFileDialog: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('file:writeText', filePath, content),

  // Agents
  listAgents: () => ipcRenderer.invoke('agents:list'),
  listSavedAgents: () => ipcRenderer.invoke('agents:listSaved'),
  removeSavedAgent: (id) => ipcRenderer.invoke('agents:remove', id),

  // Messages
  getMessages: () => ipcRenderer.invoke('messages:getAll'),
  removeMessage: (id) => ipcRenderer.invoke('messages:remove', id),
  clearMessages: () => ipcRenderer.invoke('messages:clear'),
  getArchivedMessages: () => ipcRenderer.invoke('messages:getArchived'),
  restoreMessage: (id) => ipcRenderer.invoke('messages:restore', id),
  restoreAllMessages: () => ipcRenderer.invoke('messages:restoreAll'),
  onNewMessage: (callback) => {
    ipcRenderer.on('message:new', (event, msg) => callback(msg));
  },

  // Tasks
  getTasks: () => ipcRenderer.invoke('tasks:getAll'),
  addTask: (content) => ipcRenderer.invoke('tasks:add', content),
  removeTask: (id) => ipcRenderer.invoke('tasks:remove', id),
  getTask: (id) => ipcRenderer.invoke('tasks:get', id),

  // Session
  ensureSessionOpen: () => ipcRenderer.invoke('session:ensureOpen'),
  newSession: () => ipcRenderer.invoke('session:new'),
  openSession: () => ipcRenderer.invoke('session:open'),
  openSessionFile: (filePath) => ipcRenderer.invoke('session:openFile', filePath),
  listRecentSessions: () => ipcRenderer.invoke('session:listRecent'),
  saveSession: (name) => ipcRenderer.invoke('session:save', name),
  renameSession: (name) => ipcRenderer.invoke('session:rename', name),
  getSessionName: () => ipcRenderer.invoke('session:getName'),
  closeSession: (options) => ipcRenderer.invoke('session:close', options),
  isSessionOpen: () => ipcRenderer.invoke('session:isOpen'),
  isSessionTemp: () => ipcRenderer.invoke('session:isTemp'),
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
  rebuildMenu: () => ipcRenderer.send('menu:rebuild'),

  // Layout
  saveLayout: (config) => ipcRenderer.invoke('layout:save', config),
  loadLayout: () => ipcRenderer.invoke('layout:load'),

  // App close save prompt
  onPromptSaveName: (callback) => {
    ipcRenderer.on('app:promptSaveName', () => callback());
  },
  sendSaveNameResult: (name) => {
    ipcRenderer.send('app:saveNameResult', name);
  },

  // Menu events (passes data arguments through)
  onMenuEvent: (event, callback) => {
    ipcRenderer.on(event, (ev, ...args) => callback(...args));
  },
});
