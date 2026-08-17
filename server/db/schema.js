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

    // ==========================================
    // TABLAS DE DOROCORO AUDIO STATION
    // ==========================================

    // Tabla de pistas y metadatos de audio por usuario (Indexado por Content Hash SHA-256)
    db.run(`
      CREATE TABLE IF NOT EXISTS dorocoro_tracks (
        trackHash TEXT NOT NULL,
        username TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        duration TEXT,
        format TEXT,
        sourceType TEXT DEFAULT 'web',
        webUrl TEXT,
        isFavorite INTEGER DEFAULT 0,
        playCount INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT,
        PRIMARY KEY (trackHash, username)
      );
    `);

    // Purgar cualquier pista puramente local de la base de datos central SQLite (la música local se queda solo en local)
    db.run(`DELETE FROM dorocoro_tracks WHERE (sourceType = 'local' OR sourceType IS NULL) AND (webUrl IS NULL OR webUrl = '');`);

    // Tabla de listas de reproducción por usuario
    db.run(`
      CREATE TABLE IF NOT EXISTS dorocoro_playlists (
        id TEXT NOT NULL,
        username TEXT NOT NULL,
        name TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT,
        PRIMARY KEY (id, username)
      );
    `);

    // Tabla intermedia para canciones dentro de listas de reproducción
    db.run(`
      CREATE TABLE IF NOT EXISTS dorocoro_playlist_tracks (
        playlistId TEXT NOT NULL,
        username TEXT NOT NULL,
        trackHash TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        addedAt TEXT NOT NULL,
        PRIMARY KEY (playlistId, username, trackHash)
      );
    `);
  });
}
