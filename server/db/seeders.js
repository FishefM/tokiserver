import crypto from 'crypto';
import { FIXED_USERS } from '../config/constants.js';

// Plantilla inicial ejecutada únicamente cuando la base de datos se crea por primera vez (COUNT = 0)
const INITIAL_SEED_COMMANDS = {
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
    cmd: 'VIEW_LOGS_SQLITE'
  }
};

function hashPassword(password, salt = null) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
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

/**
 * Ejecuta el sembrado de usuarios y comandos predeterminados si la base de datos está vacía.
 */
export function runInitialSeed(db) {
  db.serialize(() => {
    // Sembrado de usuarios iniciales
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
      if (err || (row && row.count > 0)) return;

      console.log('\n==================================================');
      console.log('[AUTENTICACIÓN SQLCIPHER] Inicializando usuarios fijos...');
      const stmt = db.prepare('INSERT INTO users (username, salt, hash, createdAt) VALUES (?, ?, ?, ?)');
      const now = new Date().toISOString();

      FIXED_USERS.forEach(username => {
        const defaultPassword = generateRandomPassword(username);
        const { salt, hash } = hashPassword(defaultPassword);
        stmt.run(username, salt, hash, now);
        console.log(`> Usuario: ${username} | Contraseña: ${defaultPassword}`);
      });
      stmt.finalize();
      console.log('[AUTH] Credenciales iniciales guardadas en la base de datos cifrada.');
      console.log('==================================================\n');
    });

    // Sembrado de comandos iniciales
    db.get('SELECT COUNT(*) as count FROM commands', (err, row) => {
      if (err || (row && row.count > 0)) return;

      console.log('[SQLCIPHER] Populando mapa de comandos inicial en SQLCipher...');
      const stmt = db.prepare(`
        INSERT INTO commands (
          key, label, icon, cmd, type, id, labelId, statusId, defaultStatus, onlyUsers, allUsersExcept, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();

      for (const [key, cmdObj] of Object.entries(INITIAL_SEED_COMMANDS)) {
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
  });
}
