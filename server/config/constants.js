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
export const FIXED_USERS = ['Yucef', 'Jesus', 'Hector', 'Inge'];

// Mapa seguro de comandos permitidos (Command Whitelist)
export const COMMAND_MAP = {
  MINECRAFT_TOGGLE: {
    label: 'MINECRAFT_TOGGLE',
    dynamic: true
  },
  MINECRAFT_START: {
    label: 'MINECRAFT_START',
    cmd: `docker start ${MC_CONTAINER}`
  },
  MINECRAFT_STOP: {
    label: 'MINECRAFT_STOP',
    cmd: `docker stop ${MC_CONTAINER}`
  },
  COREKEEPER_TOGGLE: {
    label: 'COREKEEPER_TOGGLE',
    dynamic: true
  },
  COREKEEPER_START: {
    label: 'COREKEEPER_START',
    cmd: `sudo systemctl start ${CK_SERVICE}`
  },
  COREKEEPER_STOP: {
    label: 'COREKEEPER_STOP',
    cmd: `sudo systemctl stop ${CK_SERVICE}`
  },
  PURGE_CACHE: {
    label: 'PURGE_CACHE',
    cmd: 'echo "[CACHE] Ejecutando sincronización de buffers (sync)..." && sync && echo "[CACHE] Sincronización completada con éxito."'
  },
  SYS_DIAGNOSTICS: {
    label: 'SYS_DIAGNOSTICS',
    cmd: 'echo "=== INFORMACION DEL SISTEMA ===" && uname -sr && uptime && echo "\n=== MEMORIA RAM ===" && free -h && echo "\n=== ALMACENAMIENTO DE DISCO ===" && df -h /'
  },
  VIEW_LOGS: {
    label: 'HISTORIAL_DE_AUDITORIA_DIARIA',
    cmd: `echo "=== HISTORIAL DE AUDITORIA DE COMANDOS ===" && (tail -n 35 "${LOGS_DIR}"/audit-*.log 2>/dev/null || echo "[AUDIT LOG] No se han registrado comandos ejecutados el día de hoy.")`
  },
  LOCK_SESSION: {
    label: 'LOCK_SESSION',
    cmd: 'echo "[SECURITY] Sesión de administración bloqueada a las $(date +\'%T\')."'
  }
};
