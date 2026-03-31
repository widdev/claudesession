const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor() {
    this.db = null;
    this.filePath = null;
    this.sqlPromise = initSqlJs();
  }

  async _getSQL() {
    return this.sqlPromise;
  }

  async create(filePath) {
    this.close();
    const SQL = await this._getSQL();
    this.db = new SQL.Database();
    this.filePath = filePath;
    this._createSchema();
    this._save();
  }

  async open(filePath) {
    this.close();
    const SQL = await this._getSQL();
    const buffer = fs.readFileSync(filePath);
    this.db = new SQL.Database(buffer);
    this.filePath = filePath;
    this._createSchema(); // ensure schema exists even on old files
  }

  _createSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Untitled',
        cwd TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        deleted INTEGER NOT NULL DEFAULT 0
      )
    `);
    // Ensure deleted column exists on older DBs
    try {
      this.db.run(`ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);
    } catch (e) {
      // Column already exists — ignore
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  _save() {
    if (this.db && this.filePath) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, buffer);
    }
  }

  isOpen() {
    return this.db !== null;
  }

  getPath() {
    return this.filePath;
  }

  saveTo(newPath) {
    if (!this.db) return;
    const dir = path.dirname(newPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    fs.writeFileSync(newPath, Buffer.from(data));
    this.filePath = newPath;
  }

  close() {
    if (this.db) {
      this._save();
      this.db.close();
      this.db = null;
      this.filePath = null;
    }
  }

  saveAgent(agent) {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO agents (id, name, cwd, last_active) VALUES (?, ?, ?, datetime('now'))`,
      [agent.id, agent.name, agent.cwd]
    );
    this._save();
  }

  removeAgent(agentId) {
    if (!this.db) return;
    this.db.run(`DELETE FROM agents WHERE id = ?`, [agentId]);
    this._save();
  }

  getAgents() {
    if (!this.db) return [];
    const stmt = this.db.prepare(`SELECT * FROM agents ORDER BY last_active DESC`);
    const agents = [];
    while (stmt.step()) {
      agents.push(stmt.getAsObject());
    }
    stmt.free();
    return agents;
  }

  saveMessage(msg) {
    if (!this.db) return null;
    this.db.run(
      `INSERT INTO messages (from_agent, to_agent, content) VALUES (?, ?, ?)`,
      [msg.from, msg.to, msg.content]
    );
    this._save();
    // Retrieve the inserted row by max ID
    const stmt = this.db.prepare(`SELECT * FROM messages ORDER BY id DESC LIMIT 1`);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  getMessages(filter) {
    if (!this.db) return [];
    let sql = `SELECT * FROM messages WHERE deleted = 0`;
    const params = [];
    if (filter && filter.forAgent) {
      sql += ` AND (to_agent = ? OR to_agent = 'all' OR from_agent = ?)`;
      params.push(filter.forAgent, filter.forAgent);
    }
    sql += ` ORDER BY timestamp ASC, id ASC`;
    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    const messages = [];
    while (stmt.step()) {
      messages.push(stmt.getAsObject());
    }
    stmt.free();
    return messages;
  }

  removeMessage(messageId) {
    if (!this.db) return;
    this.db.run(`UPDATE messages SET deleted = 1 WHERE id = ?`, [messageId]);
    this._save();
  }

  clearMessages() {
    if (!this.db) return;
    this.db.run(`UPDATE messages SET deleted = 1 WHERE deleted = 0`);
    this._save();
  }

  getArchivedMessages() {
    if (!this.db) return [];
    const stmt = this.db.prepare(`SELECT * FROM messages WHERE deleted = 1 ORDER BY timestamp ASC, id ASC`);
    const messages = [];
    while (stmt.step()) {
      messages.push(stmt.getAsObject());
    }
    stmt.free();
    return messages;
  }

  restoreMessage(messageId) {
    if (!this.db) return;
    this.db.run(`UPDATE messages SET deleted = 0 WHERE id = ?`, [messageId]);
    this._save();
  }

  restoreAllMessages() {
    if (!this.db) return;
    this.db.run(`UPDATE messages SET deleted = 0 WHERE deleted = 1`);
    this._save();
  }

  // --- Tasks ---

  saveTask(task) {
    if (!this.db) return null;
    this.db.run(
      `INSERT OR REPLACE INTO tasks (id, content) VALUES (?, ?)`,
      [task.id, task.content]
    );
    this._save();
    return task;
  }

  removeTask(taskId) {
    if (!this.db) return;
    this.db.run(`DELETE FROM tasks WHERE id = ?`, [taskId]);
    this._save();
  }

  getTasks() {
    if (!this.db) return [];
    const stmt = this.db.prepare(`SELECT * FROM tasks ORDER BY created_at ASC`);
    const tasks = [];
    while (stmt.step()) {
      tasks.push(stmt.getAsObject());
    }
    stmt.free();
    return tasks;
  }

  getTask(taskId) {
    if (!this.db) return null;
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    stmt.bind([taskId]);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  saveMeta(key, value) {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO session_meta (key, value) VALUES (?, ?)`,
      [key, value]
    );
    this._save();
  }

  getMeta(key) {
    if (!this.db) return null;
    const stmt = this.db.prepare(`SELECT value FROM session_meta WHERE key = ?`);
    stmt.bind([key]);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject().value;
    }
    stmt.free();
    return result;
  }
}

module.exports = { SessionManager };
