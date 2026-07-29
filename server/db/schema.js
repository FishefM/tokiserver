/**
 * Inicializa la estructura de tablas de la base de datos SQLCipher.
 */
export function initSchema(db) {
  db.serialize(() => {
    // Tabla de usuarios
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT
      );
    `);
    db.run('ALTER TABLE users ADD COLUMN updatedAt TEXT', () => {});

    // Tabla de mapa de comandos
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

    // Tabla de sesiones activas
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
    `);

    // Tabla de historial de auditoría
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
  });
}
