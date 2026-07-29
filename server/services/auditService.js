import fs from 'fs';
import path from 'path';
import { LOGS_DIR } from '../config/constants.js';
import { insertAuditLog } from '../db.js';

// Asegurar existencia del directorio de logs
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Obtener la ruta del archivo de log del día actual (Formato: audit-YYYY-MM-DD.log)
export function getTodayLogPath() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `audit-${year}-${month}-${day}.log`);
}

// Registrar acciones de auditoría en la base de datos SQLite y en archivo log plano
export function logAudit(ip, command, success, detail = '', username = 'ANONIMO') {
  const timestamp = new Date().toLocaleString('es-MX', { timeZoneName: 'short' });

  // 1. Guardar registro en la base de datos SQLite cifrada
  try {
    insertAuditLog({
      ip,
      username,
      command,
      success,
      detail,
      timestampStr: timestamp
    });
  } catch (err) {
    console.error('[ERROR AUDITORIA SQLITE] Fallo al insertar log en SQLite:', err.message);
  }

  // 2. Guardar copia en archivo plano diario (auditoría persistente en disco)
  const logFile = getTodayLogPath();
  const statusStr = success ? 'EXITO' : 'FALLO';
  const entry = `[${timestamp}] [IP: ${ip}] [USUARIO: ${username}] -> COMANDO: "${command}" | RESULTADO: ${statusStr} ${detail ? '| ' + detail : ''}\n`;

  fs.appendFile(logFile, entry, (err) => {
    if (err) console.error('[ERROR AUDITORIA ARCHIVO] No se pudo escribir en el archivo de logs:', err);
  });
}
