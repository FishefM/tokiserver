import crypto from 'crypto';
import { getUser, getUserAsync, saveUserPassword, getSession, saveSession, deleteSession } from './db.js';

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

export async function loginUser(usernameInput, passwordInput) {
  if (!usernameInput || !passwordInput) {
    return { success: false, error: 'Usuario y contraseña requeridos' };
  }

  const user = await getUserAsync(usernameInput);

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

export async function changePassword(username, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 4) {
    return { success: false, error: 'La nueva contraseña debe tener al menos 4 caracteres' };
  }

  const user = await getUserAsync(username);

  if (!user) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const isValid = verifyPassword(currentPassword, user.salt, user.hash);
  if (!isValid) {
    return { success: false, error: 'La contraseña actual es incorrecta' };
  }

  const { salt, hash } = hashPassword(newPassword);
  return new Promise((resolve) => {
    saveUserPassword(user.username, salt, hash, (err) => {
      if (err) {
        return resolve({ success: false, error: 'Error al actualizar la contraseña en la base de datos' });
      }
      resolve({ success: true, message: 'Contraseña actualizada con éxito' });
    });
  });
}
