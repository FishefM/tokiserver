import { insertAuditLog } from '../db.js';

/**
 * Registrar acciones de auditoría exclusivamente en la base de datos cifrada SQLite.
 */
export function logAudit(ip, command, success, detail = '', username = 'ANONIMO') {
  const timestamp = new Date().toLocaleString('es-MX', { timeZoneName: 'short' });

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
    console.error('[ERROR AUDITORIA SQLITE] Fallo al insertar registro en la base de datos:', err.message);
  }
}
