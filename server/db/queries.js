import { getDbConnection } from './connection.js';

let cachedCommandMap = null;
let cachedUsers = new Map();
let cachedSessions = new Map();
let cachedAuditLogs = [];

/**
 * Recarga la caché en memoria para lecturas ultrarrápidas y síncronas.
 */
export function reloadCache() {
  const db = getDbConnection();

  db.all('SELECT * FROM commands', (err, rows) => {
    if (!err && rows) {
      const map = {};
      for (const row of rows) {
        const item = { key: row.key, label: row.label };
        if (row.icon) item.icon = row.icon;
        if (row.cmd) item.cmd = row.cmd;
        if (row.type) item.type = row.type;
        if (row.id) item.id = row.id;
        if (row.labelId) item.labelId = row.labelId;
        if (row.statusId) item.statusId = row.statusId;
        if (row.defaultStatus) item.defaultStatus = row.defaultStatus;
        if (row.onlyUsers) { try { item.onlyUsers = JSON.parse(row.onlyUsers); } catch (e) {} }
        if (row.allUsersExcept) { try { item.allUsersExcept = JSON.parse(row.allUsersExcept); } catch (e) {} }
        map[row.key] = item;
      }
      cachedCommandMap = map;
    }
  });

  db.all('SELECT * FROM users', (err, rows) => {
    if (!err && rows) {
      cachedUsers.clear();
      for (const r of rows) {
        cachedUsers.set(r.username.toLowerCase(), r);
      }
    }
  });

  db.all('SELECT * FROM sessions', (err, rows) => {
    if (!err && rows) {
      cachedSessions.clear();
      for (const r of rows) {
        cachedSessions.set(r.token, r);
      }
    }
  });

  db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100', (err, rows) => {
    if (!err && rows) {
      cachedAuditLogs = rows;
    }
  });
}

// ==========================================
// CONSULTAS Y OPERACIONES DE COMANDOS
// ==========================================

export function getCommandMap() {
  return cachedCommandMap || {};
}

export function getCommandByKey(key) {
  const map = getCommandMap();
  return map[key] || null;
}

export function upsertCommand(cmdObj) {
  const db = getDbConnection();
  const now = new Date().toISOString();

  db.run(`
    INSERT INTO commands (
      key, label, icon, cmd, type, id, labelId, statusId, defaultStatus, onlyUsers, allUsersExcept, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      label = excluded.label,
      icon = excluded.icon,
      cmd = excluded.cmd,
      type = excluded.type,
      id = excluded.id,
      labelId = excluded.labelId,
      statusId = excluded.statusId,
      defaultStatus = excluded.defaultStatus,
      onlyUsers = excluded.onlyUsers,
      allUsersExcept = excluded.allUsersExcept,
      updatedAt = excluded.updatedAt
  `, [
    cmdObj.key,
    cmdObj.label || '',
    cmdObj.icon || null,
    cmdObj.cmd || null,
    cmdObj.type || null,
    cmdObj.id || null,
    cmdObj.labelId || null,
    cmdObj.statusId || null,
    cmdObj.defaultStatus || null,
    cmdObj.onlyUsers ? JSON.stringify(cmdObj.onlyUsers) : null,
    cmdObj.allUsersExcept ? JSON.stringify(cmdObj.allUsersExcept) : null,
    now,
    now
  ], () => reloadCache());
}

// ==========================================
// CONSULTAS Y OPERACIONES DE USUARIOS
// ==========================================

export function getUser(usernameInput) {
  if (!usernameInput) return null;
  const key = usernameInput.trim().toLowerCase();
  return cachedUsers.get(key) || null;
}

export function saveUserPassword(usernameInput, salt, hash, callback) {
  const db = getDbConnection();
  const now = new Date().toISOString();
  const lowerName = usernameInput.trim().toLowerCase();
  const existing = cachedUsers.get(lowerName);

  if (existing) {
    const updatedUser = { ...existing, salt, hash, updatedAt: now };
    cachedUsers.set(lowerName, updatedUser);
    db.run('UPDATE users SET salt = ?, hash = ?, updatedAt = ? WHERE LOWER(username) = ?',
      [salt, hash, now, lowerName], (err) => {
        reloadCache();
        if (callback) callback(err);
      });
  } else {
    const newUser = { username: usernameInput.trim(), salt, hash, createdAt: now };
    cachedUsers.set(lowerName, newUser);
    db.run('INSERT INTO users (username, salt, hash, createdAt) VALUES (?, ?, ?, ?)',
      [usernameInput.trim(), salt, hash, now], (err) => {
        reloadCache();
        if (callback) callback(err);
      });
  }
}

// ==========================================
// CONSULTAS Y OPERACIONES DE SESIONES
// ==========================================

export function getSession(token) {
  if (!token) return null;
  const session = cachedSessions.get(token);
  if (!session) return null;

  const now = Date.now();
  if (now - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
    deleteSession(token);
    return null;
  }
  return { username: session.username, createdAt: session.createdAt };
}

export function saveSession(token, username) {
  const db = getDbConnection();
  const now = Date.now();
  const obj = { token, username, createdAt: now };
  cachedSessions.set(token, obj);
  db.run('INSERT OR REPLACE INTO sessions (token, username, createdAt) VALUES (?, ?, ?)', [token, username, now]);
}

export function deleteSession(token) {
  if (!token) return;
  cachedSessions.delete(token);
  const db = getDbConnection();
  db.run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function cleanExpiredSessions() {
  const db = getDbConnection();
  const maxAge = Date.now() - (7 * 24 * 60 * 60 * 1000);
  db.run('DELETE FROM sessions WHERE createdAt <= ?', [maxAge], () => reloadCache());
}

// ==========================================
// CONSULTAS Y OPERACIONES DE AUDITORÍA
// ==========================================

export function insertAuditLog({ ip, username, command, success, detail, timestampStr }) {
  const db = getDbConnection();
  const now = new Date();
  const timestamp = timestampStr || now.toLocaleString('es-MX', { timeZoneName: 'short' });
  const createdAtIso = now.toISOString();

  const logEntry = {
    timestamp,
    ip: ip || 'DESCONOCIDO',
    username: username || 'ANONIMO',
    command: command || 'DESCONOCIDO',
    success: success ? 1 : 0,
    detail: detail || '',
    createdAt: createdAtIso
  };

  cachedAuditLogs.unshift(logEntry);
  if (cachedAuditLogs.length > 100) cachedAuditLogs.pop();

  db.run(`
    INSERT INTO audit_logs (timestamp, ip, username, command, success, detail, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    logEntry.timestamp,
    logEntry.ip,
    logEntry.username,
    logEntry.command,
    logEntry.success,
    logEntry.detail,
    logEntry.createdAt
  ]);
}

export function getRecentAuditLogs(limit = 35) {
  return cachedAuditLogs.slice(0, limit);
}

export function formatAuditLogsForTerminal(limit = 35) {
  const logs = getRecentAuditLogs(limit);
  if (!logs || logs.length === 0) {
    return '[AUDIT LOG] No se han registrado comandos ejecutados en el sistema.';
  }

  const chronological = [...logs].reverse();
  let output = `=== HISTORIAL DE AUDITORIA DE COMANDOS (SQLCIPHER 4) ===\n`;

  for (const log of chronological) {
    const statusStr = log.success ? 'EXITO' : 'FALLO';
    const detailStr = log.detail ? ` | ${log.detail}` : '';
    output += `[${log.timestamp}] [IP: ${log.ip}] [USUARIO: ${log.username}] -> COMANDO: "${log.command}" | RESULTADO: ${statusStr}${detailStr}\n`;
  }

  return output.trim();
}
