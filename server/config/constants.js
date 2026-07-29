import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(__filename)); // server root

export const PORT = process.env.PORT || 3000;
export const MC_CONTAINER = 'mc_forge_server';
export const CK_SERVICE = 'corekeeper-server.service';

export const DATA_DIR = path.join(__dirname, '.data');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Lista fija de operadores permitidos
export const FIXED_USERS = ['Yucef', 'Jesus', 'Hector', 'Inge', 'Kitzya'];

// Mapa seguro por defecto para inicializar la base de datos SQLite
export const DEFAULT_COMMANDS = {
  YUCEF_SITE_UPDATE: {
    key: 'YUCEF_SITE_UPDATE',
    label: '> YUCEF_SITE_UPDATE',
    icon: '💻',
    cmd: '~/.local/bin/updatesite',
    onlyUsers: ['Yucef']
  },

  MINECRAFT_TOGGLE: {
    key: 'MINECRAFT_TOGGLE',
    id: 'btn-minecraft',
    label: '> MINECRAFT SERVER',
    type: 'dynamic',
    labelId: 'mc-btn-label',
    statusId: 'mc-btn-status',
    defaultStatus: '[CHECKING...]',
    allUsersExcept: ['Kitzya']
  },
  COREKEEPER_TOGGLE: {
    key: 'COREKEEPER_TOGGLE',
    id: 'btn-corekeeper',
    label: '> CORE KEEPER SERVER',
    type: 'dynamic',
    labelId: 'ck-btn-label',
    statusId: 'ck-btn-status',
    defaultStatus: '[CHECKING...]',
    allUsersExcept: ['Kitzya']
  },
  PURGE_CACHE: {
    key: 'PURGE_CACHE',
    label: '> PURGE_CACHE',
    icon: '🧹',
    cmd: 'echo "[CACHE] Ejecutando sincronización de buffers (sync)..." && sync && echo "[CACHE] Sincronización completada con éxito."'
  },
  SYS_DIAGNOSTICS: {
    key: 'SYS_DIAGNOSTICS',
    label: '> SYS_DIAGNOSTICS',
    icon: '🔍',
    cmd: 'echo "=== INFORMACION DEL SISTEMA ===" && uname -sr && uptime && echo "\n=== MEMORIA RAM ===" && free -h && echo "\n=== ALMACENAMIENTO DE DISCO ===" && df -h /'
  },
  VIEW_LOGS: {
    key: 'VIEW_LOGS',
    label: '> VIEW_LOGS',
    icon: '📜',
    cmd: `echo "=== HISTORIAL DE AUDITORIA DE COMANDOS ===" && (tail -n 35 "${LOGS_DIR}"/audit-*.log 2>/dev/null || echo "[AUDIT LOG] No se han registrado comandos ejecutados el día de hoy.")`
  }
};


/**
 * Verifica si un usuario tiene permisos para ejecutar un comando según soloUsuarios / todosLosUsuariosExcepto.
 * @param {string} username - Nombre del usuario.
 * @param {object} commandDef - Objeto de comando de COMMAND_MAP.
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
