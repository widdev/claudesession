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
        last_active TEXT NOT NULL DEFAULT (datetime('now')),
        active INTEGER NOT NULL DEFAULT 1,
        short_code TEXT
      )
    `);
    // Ensure columns exist on older DBs
    try { this.db.run(`ALTER TABLE agents ADD COLUMN active INTEGER NOT NULL DEFAULT 1`); } catch (e) {}
    try { this.db.run(`ALTER TABLE agents ADD COLUMN short_code TEXT`); } catch (e) {}
    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        deleted INTEGER NOT NULL DEFAULT 0,
        msg_seq INTEGER,
        readable_id TEXT
      )
    `);
    // Ensure columns exist on older DBs
    try { this.db.run(`ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`); } catch (e) {}
    try { this.db.run(`ALTER TABLE messages ADD COLUMN msg_seq INTEGER`); } catch (e) {}
    try { this.db.run(`ALTER TABLE messages ADD COLUMN readable_id TEXT`); } catch (e) {}
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
    this.db.run(`
      CREATE TABLE IF NOT EXISTS work_items (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        state TEXT NOT NULL,
        assigned_to TEXT,
        description TEXT,
        project TEXT NOT NULL,
        url TEXT,
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    // Preserve existing short_code on re-save; generate one if missing
    let shortCode = null;
    const existing = this.db.prepare(`SELECT short_code FROM agents WHERE id = ?`);
    existing.bind([agent.id]);
    if (existing.step()) {
      shortCode = existing.getAsObject().short_code;
    }
    existing.free();

    if (!shortCode) {
      const usedCodes = this.getExistingShortCodes();
      shortCode = SessionManager.generateShortCode(agent.name, usedCodes);
    }

    this.db.run(
      `INSERT OR REPLACE INTO agents (id, name, cwd, last_active, active, short_code) VALUES (?, ?, ?, datetime('now'), 1, ?)`,
      [agent.id, agent.name, agent.cwd, shortCode]
    );
    this._save();
    return shortCode;
  }

  getAgentShortCode(agentId) {
    if (!this.db) return null;
    const stmt = this.db.prepare(`SELECT short_code FROM agents WHERE id = ?`);
    stmt.bind([agentId]);
    let code = null;
    if (stmt.step()) {
      code = stmt.getAsObject().short_code;
    }
    stmt.free();
    return code;
  }

  getExistingShortCodes() {
    if (!this.db) return new Set();
    const stmt = this.db.prepare(`SELECT short_code FROM agents WHERE short_code IS NOT NULL`);
    const codes = new Set();
    while (stmt.step()) {
      codes.add(stmt.getAsObject().short_code);
    }
    stmt.free();
    return codes;
  }

  static generateShortCode(name, existingCodes) {
    const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!upper) return SessionManager._ensureUnique('AGT', existingCodes);

    if (upper.length <= 3) {
      const code = upper.padEnd(3, 'X');
      return SessionManager._ensureUnique(code, existingCodes);
    }

    // Extract consonants (keep first char regardless)
    const vowels = new Set(['A', 'E', 'I', 'O', 'U']);
    let consonants = upper[0];
    for (let i = 1; i < upper.length && consonants.length < 3; i++) {
      if (!vowels.has(upper[i])) consonants += upper[i];
    }

    // If still short, fill with remaining characters
    if (consonants.length < 3) {
      for (let i = 1; i < upper.length && consonants.length < 3; i++) {
        if (!consonants.includes(upper[i])) consonants += upper[i];
      }
    }

    const code = consonants.substring(0, 3).padEnd(3, upper[upper.length - 1]);
    return SessionManager._ensureUnique(code, existingCodes);
  }

  static _ensureUnique(code, existingCodes) {
    if (!existingCodes.has(code)) return code;
    for (let i = 2; i <= 9; i++) {
      const candidate = code.substring(0, 2) + i;
      if (!existingCodes.has(candidate)) return candidate;
    }
    // Extreme fallback
    for (let i = 10; i < 100; i++) {
      const candidate = code[0] + String(i);
      if (!existingCodes.has(candidate)) return candidate;
    }
    return code;
  }

  deactivateAgent(agentId) {
    if (!this.db) return;
    this.db.run(`UPDATE agents SET active = 0 WHERE id = ?`, [agentId]);
    this._save();
  }

  removeAgent(agentId) {
    if (!this.db) return;
    this.db.run(`DELETE FROM agents WHERE id = ?`, [agentId]);
    this._save();
  }

  getAgents() {
    if (!this.db) return [];
    const stmt = this.db.prepare(`SELECT * FROM agents WHERE active = 1 ORDER BY last_active DESC`);
    const agents = [];
    while (stmt.step()) {
      agents.push(stmt.getAsObject());
    }
    stmt.free();
    return agents;
  }

  getSavedAgents() {
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

    // Compute per-sender sequence number
    const seqStmt = this.db.prepare(`SELECT COALESCE(MAX(msg_seq), 0) + 1 AS next_seq FROM messages WHERE from_agent = ?`);
    seqStmt.bind([msg.from]);
    let msgSeq = 1;
    if (seqStmt.step()) {
      msgSeq = seqStmt.getAsObject().next_seq;
    }
    seqStmt.free();

    // Build readable_id: sender short code + sequence
    let senderCode = 'USR';
    if (msg.from !== 'You') {
      senderCode = this.getAgentShortCode(msg.from) || 'UNK';
    }
    const readableId = `${senderCode}-${msgSeq}`;

    this.db.run(
      `INSERT INTO messages (from_agent, to_agent, content, msg_seq, readable_id) VALUES (?, ?, ?, ?, ?)`,
      [msg.from, msg.to, msg.content, msgSeq, readableId]
    );
    this._save();
    // Retrieve the inserted row by max ID, with resolved names
    const stmt = this.db.prepare(`SELECT m.*, a_from.name AS fromName, a_to.name AS toName, a_from.short_code AS fromShortCode
      FROM messages m
      LEFT JOIN agents a_from ON m.from_agent = a_from.id
      LEFT JOIN agents a_to ON m.to_agent = a_to.id
      ORDER BY m.id DESC LIMIT 1`);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  getMessages(filter) {
    if (!this.db) return [];
    let sql = `SELECT m.*, a_from.name AS fromName, a_to.name AS toName, a_from.short_code AS fromShortCode
      FROM messages m
      LEFT JOIN agents a_from ON m.from_agent = a_from.id
      LEFT JOIN agents a_to ON m.to_agent = a_to.id
      WHERE m.deleted = 0`;
    const params = [];
    if (filter && filter.forAgent) {
      sql += ` AND (m.to_agent = ? OR m.to_agent = 'all' OR m.from_agent = ?)`;
      params.push(filter.forAgent, filter.forAgent);
    }
    if (filter && filter.fromAgents && filter.fromAgents.length === 0) {
      // Empty array = no senders selected = match nothing
      sql += ` AND 0`;
    } else if (filter && filter.fromAgents && filter.fromAgents.length > 0) {
      const placeholders = filter.fromAgents.map(() => '?').join(', ');
      sql += ` AND COALESCE(a_from.name, m.from_agent) IN (${placeholders})`;
      params.push(...filter.fromAgents);
    } else if (filter && filter.fromAgent) {
      sql += ` AND COALESCE(a_from.name, m.from_agent) = ?`;
      params.push(filter.fromAgent);
    }
    if (filter && filter.search) {
      sql += ` AND m.content LIKE ?`;
      params.push(`%${filter.search}%`);
    }
    sql += ` ORDER BY m.timestamp ASC, m.id ASC`;
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

  getMessageSenders() {
    if (!this.db) return [];
    const stmt = this.db.prepare(`SELECT DISTINCT COALESCE(a.name, m.from_agent) AS sender_name
      FROM messages m
      LEFT JOIN agents a ON m.from_agent = a.id
      WHERE m.deleted = 0
      ORDER BY sender_name`);
    const senders = [];
    while (stmt.step()) { senders.push(stmt.getAsObject().sender_name); }
    stmt.free();
    return senders;
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

  // --- Work Items ---

  saveWorkItem(item) {
    if (!this.db) return null;
    this.db.run(
      `INSERT OR REPLACE INTO work_items (id, title, type, state, assigned_to, description, project, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.title, item.type, item.state, item.assignedTo || null, item.description || '', item.project, item.url || '']
    );
    this._save();
    return item;
  }

  removeWorkItem(id) {
    if (!this.db) return;
    this.db.run(`DELETE FROM work_items WHERE id = ?`, [id]);
    this._save();
  }

  getWorkItems() {
    if (!this.db) return [];
    const stmt = this.db.prepare(`SELECT * FROM work_items ORDER BY imported_at ASC`);
    const items = [];
    while (stmt.step()) {
      items.push(stmt.getAsObject());
    }
    stmt.free();
    return items;
  }

  getWorkItem(id) {
    if (!this.db) return null;
    const stmt = this.db.prepare(`SELECT * FROM work_items WHERE id = ?`);
    stmt.bind([id]);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  updateWorkItemState(id, state) {
    if (!this.db) return;
    this.db.run(`UPDATE work_items SET state = ? WHERE id = ?`, [state, id]);
    this._save();
  }

  clearWorkItems() {
    if (!this.db) return;
    this.db.run(`DELETE FROM work_items`);
    this._save();
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
