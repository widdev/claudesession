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

    // Push to renderer
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      // Resolve agent names for display
      const fromAgent = ptyManager.get(from);
      const toAgent = ptyManager.get(to);
      const enriched = {
        ...saved,
        fromName: fromAgent ? fromAgent.name : from,
        toName: to === 'all' ? 'all' : (toAgent ? toAgent.name : to),
      };
      windows[0].webContents.send('message:new', enriched);
    }

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

  const port = await findFreePort(3377);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`ClaudeSession message server on port ${port}`);
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
          console.log(`ClaudeSession message server restarted on port ${port}`);
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
