const express = require('express');
const { BrowserWindow } = require('electron');

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

async function startMessageServer(sessionManager, ptyManager) {
  const app = express();
  app.use(express.json());

  // Handle JSON parse errors gracefully
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next(err);
  });

  // POST /api/messages - send a message
  app.post('/api/messages', (req, res) => {
    const { from, to, content } = req.body;
    if (!from || !to || !content) {
      return res.status(400).json({ error: 'from, to, and content are required' });
    }
    let saved = sessionManager.saveMessage({ from, to, content });
    if (!saved) {
      // Session not open — still accept the message for display, just don't persist
      saved = {
        id: Date.now(),
        from_agent: from,
        to_agent: to,
        content,
        timestamp: new Date().toISOString(),
      };
    }

    // Parse @/# targets from the message content
    const parsed = ptyManager._parseMessageTargets(content);
    const resolvedTo = parsed.type === 'aside' ? parsed.targets.join(',') : to;

    // Resolve agent names for display
    const fromAgent = ptyManager.get(from);
    const enriched = {
      ...saved,
      fromName: fromAgent ? fromAgent.name : from,
      toName: resolvedTo === 'all' ? 'all' : parsed.targetDisplay || resolvedTo,
      targetType: parsed.type,
      targets: parsed.targets,
    };

    // Push to renderer (Discussion panel)
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send('message:new', enriched);
    }

    // Route to agent PTYs (all messages, not just targeted — agents need the feedback loop)
    ptyManager.routeMessage({
      from,
      to: resolvedTo,
      content,
      fromName: enriched.fromName,
    });

    res.json(saved);
  });

  // GET /api/messages - get messages, optionally filtered
  app.get('/api/messages', (req, res) => {
    const forAgent = req.query.for;
    const messages = sessionManager.getMessages(forAgent ? { forAgent } : null);
    res.json(messages);
  });

  // GET /api/agents - list active agents
  app.get('/api/agents', (req, res) => {
    const agents = ptyManager.getAll();
    res.json(agents);
  });

  // GET /api/tasks - list all tasks
  app.get('/api/tasks', (req, res) => {
    const tasks = sessionManager.getTasks();
    res.json(tasks);
  });

  // GET /api/tasks/:id - get a specific task
  app.get('/api/tasks/:id', (req, res) => {
    const task = sessionManager.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  // GET /api/workitems - list imported work items
  app.get('/api/workitems', (req, res) => {
    const items = sessionManager.getWorkItems();
    res.json(items);
  });

  // GET /api/workitems/:id - get a specific work item
  app.get('/api/workitems/:id', (req, res) => {
    const item = sessionManager.getWorkItem(parseInt(req.params.id, 10));
    if (!item) return res.status(404).json({ error: 'Work item not found' });
    res.json(item);
  });

  // Wire up DISCUSS: relay — pty-manager detects the pattern and calls back here.
  // Content may include @/# targets already parsed or plain text.
  ptyManager.onDiscussMessage((msg) => {
    const { from, content } = msg;

    // Parse @targets and #asides from the content
    const parsed = ptyManager._parseMessageTargets(content);
    const to = parsed.type === 'aside' ? parsed.targets.join(',') : 'all';

    let saved = sessionManager.saveMessage({ from, to, content: parsed.cleanContent });
    if (!saved) {
      saved = {
        id: Date.now(),
        from_agent: from,
        to_agent: to,
        content: parsed.cleanContent,
        timestamp: new Date().toISOString(),
      };
    }

    const fromAgent = ptyManager.get(from);
    const enriched = {
      ...saved,
      fromName: fromAgent ? fromAgent.name : from,
      toName: to === 'all' ? 'all' : parsed.targetDisplay,
      targetType: parsed.type,
      targets: parsed.targets,
    };

    // Push to Discussion panel
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send('message:new', enriched);
    }

    // Route targeted messages to agent PTYs
    if (parsed.type !== 'plain') {
      ptyManager.routeMessage({
        from,
        to,
        content: parsed.cleanContent,
        fromName: enriched.fromName,
      });
    }
  });

  const port = await findFreePort(3377);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Claude Team Session message server on port ${port}`);
  });

  return { app, server, port };
}

function stopMessageServer(messageServer) {
  if (messageServer && messageServer.server) {
    messageServer.server.close();
  }
}

async function restartMessageServer(messageServer, port) {
  return new Promise((resolve, reject) => {
    if (messageServer.server) {
      messageServer.server.close(() => {
        messageServer.server = messageServer.app.listen(port, '127.0.0.1', () => {
          messageServer.port = port;
          console.log(`Claude Team Session message server restarted on port ${port}`);
          resolve(messageServer);
        });
        messageServer.server.on('error', (err) => {
          reject(err);
        });
      });
    } else {
      reject(new Error('No server to restart'));
    }
  });
}

module.exports = { startMessageServer, stopMessageServer, restartMessageServer };
