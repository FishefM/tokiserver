import crypto from 'crypto';
import { getUser, saveUserPassword, getSession, saveSession, deleteSession } from './db.js';

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

export function loginUser(usernameInput, passwordInput) {
  if (!usernameInput || !passwordInput) {
    return { success: false, error: 'Usuario y contraseña requeridos' };
  }

  const user = getUser(usernameInput);

  if (!user) {
    return { success: false, error: 'No son adivinanzas w' };
  }

  const isValid = verifyPassword(passwordInput, user.salt, user.hash);
  if (!isValid) {
    return { success: false, error: 'No son adivinanzas w' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  saveSession(token, user.username);

  return {
    success: true,
    token,
    username: user.username
  };
}

export function verifySession(token) {
  if (!token) return null;
  return getSession(token);
}

export function logoutUser(token) {
  if (token) {
    deleteSession(token);
  }
  return { success: true };
}

export function changePassword(username, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 4) {
    return { success: false, error: 'La nueva contraseña debe tener al menos 4 caracteres' };
  }

  const user = getUser(username);

  if (!user) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const isValid = verifyPassword(currentPassword, user.salt, user.hash);
  if (!isValid) {
    return { success: false, error: 'La contraseña actual es incorrecta' };
  }

  const { salt, hash } = hashPassword(newPassword);
  saveUserPassword(user.username, salt, hash);

  return { success: true, message: 'Contraseña actualizada con éxito' };
}
