import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from '@journeyapps/sqlcipher';
import { DATA_DIR, LOGS_DIR, FIXED_USERS, USERS_FILE, SESSIONS_FILE, DEFAULT_COMMANDS } from './config/constants.js';

// Asegurar directorios
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'tokiserver.sqlite');
let dbInstance = null;

// Caché en memoria para lectura ultra-rápida síncrona en middleware/rutas
let cachedCommandMap = null;
let cachedUsers = new Map();
let cachedSessions = new Map();
let cachedAuditLogs = [];

/**
 * Inicializa y retorna la conexión oficial de SQLCipher.
 */
export function getDb() {
  if (dbInstance) return dbInstance;

  const dbPassword = process.env.DB_PASSWORD;
  if (!dbPassword) {
    console.warn('[SQLITE ALERTA] Variable DB_PASSWORD no definida en .env. Utilizando contraseña por defecto.');
  }

  const secretKey = dbPassword || 'tokiserver_db_secret_key_2026';

  dbInstance = new sqlite3.Database(DB_PATH);

  dbInstance.serialize(() => {
    dbInstance.run(`PRAGMA key = '${secretKey.replace(/'/g, "''")}'`);
    dbInstance.run('PRAGMA journal_mode = WAL');
    initTablesSync(dbInstance);
  });

  console.log('[SQLITE OK] Base de datos oficial SQLCipher 4 inicializada correctamente.');
  return dbInstance;
}

function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function generateRandomPassword(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let randStr = '';
  for (let i = 0; i < 8; i++) {
    randStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix ? `${prefix}_${randStr}` : randStr;
}

function initTablesSync(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS commands (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT,
      cmd TEXT,
      type TEXT,
      id TEXT,
      labelId TEXT,
      statusId TEXT,
      defaultStatus TEXT,
      onlyUsers TEXT,
      allUsersExcept TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      ip TEXT NOT NULL,
      username TEXT NOT NULL,
      command TEXT NOT NULL,
      success INTEGER NOT NULL,
      detail TEXT,
      createdAt TEXT NOT NULL
    );
  `);

  seedUsersSync(db);
  seedCommandsSync(db);
  migrateJsonSessionsSync(db);
  migrateFileLogsSync(db);
  reloadCacheSync(db);
}

function seedUsersSync(db) {
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) return;
    if (row && row.count > 0) {
      db.all('SELECT username FROM users', (err, rows) => {
        if (err || !rows) return;
        const existingList = rows.map(r => r.username.toLowerCase());
        const stmt = db.prepare('INSERT INTO users (username, salt, hash, createdAt) VALUES (?, ?, ?, ?)');
        FIXED_USERS.forEach(username => {
          if (!existingList.includes(username.toLowerCase())) {
            const defaultPassword = generateRandomPassword(username);
            const { salt, hash } = hashPassword(defaultPassword);
            stmt.run(username, salt, hash, new Date().toISOString());
            console.log(`[AUTH] Nuevo usuario fijo añadido a SQLCipher: ${username} | Contraseña: ${defaultPassword}`);
          }
        });
        stmt.finalize();
      });
      return;
    }

    // Migrar desde users.json si existe
    if (fs.existsSync(USERS_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        if (data && data.users) {
          const stmt = db.prepare('INSERT INTO users (username, salt, hash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)');
          const now = new Date().toISOString();
          for (const u of Object.values(data.users)) {
            stmt.run(u.username, u.salt, u.hash, u.createdAt || now, u.updatedAt || null);
          }
          stmt.finalize();
          console.log('[MIGRACIÓN SQLITE] Usuarios migrados desde users.json a SQLCipher 4');
          return;
        }
      } catch (e) {}
    }

    // Inicializar de cero
    console.log('\n==================================================');
    console.log('[AUTENTICACIÓN SQLCIPHER] Inicializando usuarios fijos...');
    const stmt = db.prepare('INSERT INTO users (username, salt, hash, createdAt) VALUES (?, ?, ?, ?)');
    const initialCredentials = {};
    const now = new Date().toISOString();

    FIXED_USERS.forEach(username => {
      const defaultPassword = generateRandomPassword(username);
      const { salt, hash } = hashPassword(defaultPassword);
      stmt.run(username, salt, hash, now);
      initialCredentials[username] = defaultPassword;
      console.log(`> Usuario: ${username} | Contraseña: ${defaultPassword}`);
    });
    stmt.finalize();

    const credPath = path.join(LOGS_DIR, 'INITIAL_CREDENTIALS.txt');
    let credContent = `TOKISERVER ADMIN - CREDENCIALES POR DEFECTO (${new Date().toLocaleString('es-MX')})\n\n`;
    for (const [u, p] of Object.entries(initialCredentials)) {
      credContent += `Usuario: ${u}\nContraseña: ${p}\n-------------------------\n`;
    }
    fs.writeFileSync(credPath, credContent, 'utf8');
    console.log(`[AUTH] Credenciales iniciales guardadas en: ${credPath}`);
    console.log('==================================================\n');
  });
}

function seedCommandsSync(db) {
  db.get('SELECT COUNT(*) as count FROM commands', (err, row) => {
    if (err || (row && row.count > 0)) return;

    console.log('[SQLCIPHER] Populando mapa de comandos en SQLCipher...');
    const stmt = db.prepare(`
      INSERT INTO commands (
        key, label, icon, cmd, type, id, labelId, statusId, defaultStatus, onlyUsers, allUsersExcept, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();

    for (const [key, cmdObj] of Object.entries(DEFAULT_COMMANDS)) {
      stmt.run(
        key,
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
        now
      );
    }
    stmt.finalize();
  });
}

function migrateJsonSessionsSync(db) {
  if (!fs.existsSync(SESSIONS_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const stmt = db.prepare('INSERT OR REPLACE INTO sessions (token, username, createdAt) VALUES (?, ?, ?)');
    const now = Date.now();
    for (const [token, session] of Object.entries(data)) {
      if (now - session.createdAt < 7 * 24 * 60 * 60 * 1000) {
        stmt.run(token, session.username, session.createdAt);
      }
    }
    stmt.finalize();
  } catch (e) {}
}

function migrateFileLogsSync(db) {
  db.get('SELECT COUNT(*) as count FROM audit_logs', (err, row) => {
    if (err || (row && row.count > 0)) return;

    try {
      if (!fs.existsSync(LOGS_DIR)) return;
      const files = fs.readdirSync(LOGS_DIR).filter(f => f.startsWith('audit-') && f.endsWith('.log'));
      files.sort();

      const stmt = db.prepare(`
        INSERT INTO audit_logs (timestamp, ip, username, command, success, detail, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      let count = 0;
      const nowIso = new Date().toISOString();

      for (const file of files) {
        const filePath = path.join(LOGS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          const match = line.match(/^\[(.*?)\]\s*\[IP:\s*(.*?)\]\s*\[USUARIO:\s*(.*?)\]\s*->\s*COMANDO:\s*"(.*?)"\s*\|\s*RESULTADO:\s*(EXITO|FALLO)(?:\s*\|\s*(.*))?$/);
          if (match) {
            const [, timestampStr, ip, username, command, resultStr, detail] = match;
            const success = resultStr === 'EXITO' ? 1 : 0;
            stmt.run(timestampStr, ip, username, command, success, detail || '', nowIso);
            count++;
          }
        }
      }
      stmt.finalize();

      if (count > 0) {
        console.log(`[MIGRACIÓN SQLCIPHER] ${count} registros de auditoría migrados a SQLCipher 4.`);
      }
    } catch (e) {}
  });
}

function reloadCacheSync(db) {
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

/**
 * Obtiene el mapa completo de comandos (síncrono desde memoria / asíncrono desde DB).
 */
export function getCommandMap() {
  if (cachedCommandMap) return cachedCommandMap;
  return DEFAULT_COMMANDS;
}

export function getCommandByKey(key) {
  const map = getCommandMap();
  return map[key] || null;
}

export function upsertCommand(cmdObj) {
  const db = getDb();
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
  ], () => {
    reloadCacheSync(db);
  });
}

export function getUser(usernameInput) {
  if (!usernameInput) return null;
  const key = usernameInput.trim().toLowerCase();
  return cachedUsers.get(key) || null;
}

export function saveUserPassword(usernameInput, salt, hash) {
  const db = getDb();
  const now = new Date().toISOString();
  const key = usernameInput.trim().toLowerCase();
  const existing = cachedUsers.get(key);

  if (existing) {
    db.run('UPDATE users SET salt = ?, hash = ?, updatedAt = ? WHERE LOWER(username) = LOWER(?)',
      [salt, hash, now, usernameInput.trim()], () => reloadCacheSync(db));
  } else {
    db.run('INSERT INTO users (username, salt, hash, createdAt) VALUES (?, ?, ?, ?)',
      [usernameInput.trim(), salt, hash, now], () => reloadCacheSync(db));
  }
}

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
  const db = getDb();
  const now = Date.now();
  const obj = { token, username, createdAt: now };
  cachedSessions.set(token, obj);
  db.run('INSERT OR REPLACE INTO sessions (token, username, createdAt) VALUES (?, ?, ?)', [token, username, now]);
}

export function deleteSession(token) {
  if (!token) return;
  cachedSessions.delete(token);
  const db = getDb();
  db.run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function cleanExpiredSessions() {
  const db = getDb();
  const maxAge = Date.now() - (7 * 24 * 60 * 60 * 1000);
  db.run('DELETE FROM sessions WHERE createdAt <= ?', [maxAge], () => reloadCacheSync(db));
}

export function insertAuditLog({ ip, username, command, success, detail, timestampStr }) {
  const db = getDb();
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
