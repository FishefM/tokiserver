import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, LOGS_DIR, USERS_FILE, SESSIONS_FILE, FIXED_USERS } from './config/constants.js';

// Asegurar directorios
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    return new Map();
  }
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const map = new Map();
    const now = Date.now();
    for (const [token, session] of Object.entries(data)) {
      if (now - session.createdAt < 7 * 24 * 60 * 60 * 1000) {
        map.set(token, session);
      }
    }
    return map;
  } catch (err) {
    console.error('[AUTH ERROR] Error al cargar sessions.json:', err);
    return new Map();
  }
}

function saveSessions(map) {
  try {
    const obj = {};
    for (const [token, session] of map.entries()) {
      obj[token] = session;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('[AUTH ERROR] Error al guardar sessions.json:', err);
  }
}

const activeSessions = loadSessions();

function generateRandomPassword(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let randStr = '';
  for (let i = 0; i < 8; i++) {
    randStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix ? `${prefix}_${randStr}` : randStr;
}

function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return hash === expectedHash;
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    return initUsers();
  }
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[AUTH ERROR] No se pudo leer users.json, reinicializando...', err);
    return initUsers();
  }
}

function saveUsers(usersData) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2), 'utf8');
}

function initUsers() {
  const usersData = { users: {} };
  const initialCredentials = {};

  console.log('\n==================================================');
  console.log('[AUTENTICACIÓN INICIALIZADA] Generando usuarios fijos...');

  FIXED_USERS.forEach((username) => {
    const key = username.toLowerCase();
    const defaultPassword = generateRandomPassword(username);
    const { salt, hash } = hashPassword(defaultPassword);

    usersData.users[key] = {
      username,
      salt,
      hash,
      createdAt: new Date().toISOString()
    };
    initialCredentials[username] = defaultPassword;

    console.log(`> Usuario: ${username} | Contraseña por defecto: ${defaultPassword}`);
  });

  saveUsers(usersData);

  const credPath = path.join(LOGS_DIR, 'INITIAL_CREDENTIALS.txt');
  let credContent = `TOKISERVER ADMIN - CREDENCIALES POR DEFECTO (${new Date().toLocaleString('es-MX')})\n\n`;
  for (const [u, p] of Object.entries(initialCredentials)) {
    credContent += `Usuario: ${u}\nContraseña: ${p}\n-------------------------\n`;
  }
  fs.writeFileSync(credPath, credContent, 'utf8');

  console.log(`[AUTH] Credenciales iniciales guardadas en: ${credPath}`);
  console.log('==================================================\n');

  return usersData;
}

export function loginUser(usernameInput, passwordInput) {
  if (!usernameInput || !passwordInput) {
    return { success: false, error: 'Usuario y contraseña requeridos' };
  }

  const usersData = loadUsers();
  const key = usernameInput.trim().toLowerCase();
  const user = usersData.users[key];

  if (!user) {
    return { success: false, error: 'Usuario o contraseña incorrectos' };
  }

  const isValid = verifyPassword(passwordInput, user.salt, user.hash);
  if (!isValid) {
    return { success: false, error: 'Usuario o contraseña incorrectos' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    username: user.username,
    createdAt: Date.now()
  });
  saveSessions(activeSessions);

  return {
    success: true,
    token,
    username: user.username
  };
}

export function verifySession(token) {
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  return session;
}

export function logoutUser(token) {
  if (token && activeSessions.has(token)) {
    activeSessions.delete(token);
    saveSessions(activeSessions);
  }
  return { success: true };
}

export function changePassword(username, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 4) {
    return { success: false, error: 'La nueva contraseña debe tener al menos 4 caracteres' };
  }

  const usersData = loadUsers();
  const key = username.toLowerCase();
  const user = usersData.users[key];

  if (!user) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const isValid = verifyPassword(currentPassword, user.salt, user.hash);
  if (!isValid) {
    return { success: false, error: 'La contraseña actual es incorrecta' };
  }

  const { salt, hash } = hashPassword(newPassword);
  user.salt = salt;
  user.hash = hash;
  user.updatedAt = new Date().toISOString();

  usersData.users[key] = user;
  saveUsers(usersData);

  return { success: true, message: 'Contraseña actualizada con éxito' };
}

export function getInitialCredentialsIfExist() {
  const credPath = path.join(LOGS_DIR, 'INITIAL_CREDENTIALS.txt');
  if (fs.existsSync(credPath)) {
    return fs.readFileSync(credPath, 'utf8');
  }
  return null;
}

loadUsers();
