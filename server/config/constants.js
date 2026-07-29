import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(__filename)); // server root

export const PORT = process.env.PORT || 3000;
export const MC_CONTAINER = 'mc_forge_server';
export const CK_SERVICE = 'corekeeper-server.service';

export const DATA_DIR = path.join(__dirname, '.data');

// Lista fija de operadores permitidos
export const FIXED_USERS = ['Yucef', 'Jesus', 'Hector', 'Inge', 'Kitzya'];

/**
 * Verifica si un usuario tiene permisos para ejecutar un comando según soloUsuarios / todosLosUsuariosExcepto.
 * @param {string} username - Nombre del usuario.
 * @param {object} commandDef - Objeto de comando.
 * @returns {boolean}
 */
export function isUserAllowed(username, commandDef) {
  if (!commandDef || !username) return false;

  const userLower = username.toLowerCase();

  // Si onlyUsers está definido y tiene elementos, solo los usuarios especificados pueden ejecutarlo
  if (Array.isArray(commandDef.onlyUsers) && commandDef.onlyUsers.length > 0) {
    const allowedList = commandDef.onlyUsers.map(u => u.toLowerCase());
    if (!allowedList.includes(userLower)) {
      return false;
    }
  }

  // Si allUsersExcept está definido y tiene elementos, los usuarios especificados son excluidos
  if (Array.isArray(commandDef.allUsersExcept) && commandDef.allUsersExcept.length > 0) {
    const restrictedList = commandDef.allUsersExcept.map(u => u.toLowerCase());
    if (restrictedList.includes(userLower)) {
      return false;
    }
  }

  return true;
}
