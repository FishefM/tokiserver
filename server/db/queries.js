import { getDbConnection } from './connection.js';

let cachedCommandMap = null;
let cachedUsers = new Map();
let cachedSessions = new Map();
let cachedAuditLogs = [];

/**
 * Recarga la caché en memoria para lecturas ultrarrápidas y síncronas.
 */
export function reloadCache() {
  const db = getDbConnection();

  db.all('SELECT * FROM commands', (err, rows) => {
    if (!err && rows) {
      const map = {};
      for (const row of rows) {
        const item = { key: row.key, label: row.label };
        if (row.icon) item.icon = row.icon;
        if (row.cmd) item.cmd = row.cmd;
        if (row.type) item.type = row.type;
        if (row.id) item.id = row.id;
        if (row.labelId) item.labelId = row.labelId;
        if (row.statusId) item.statusId = row.statusId;
        if (row.defaultStatus) item.defaultStatus = row.defaultStatus;
        if (row.onlyUsers) { try { item.onlyUsers = JSON.parse(row.onlyUsers); } catch (e) {} }
        if (row.allUsersExcept) { try { item.allUsersExcept = JSON.parse(row.allUsersExcept); } catch (e) {} }
        map[row.key] = item;
      }
      cachedCommandMap = map;
    }
  });

  db.all('SELECT * FROM users', (err, rows) => {
    if (!err && rows) {
      cachedUsers.clear();
      for (const r of rows) {
        cachedUsers.set(r.username.toLowerCase(), r);
      }
    }
  });

  db.all('SELECT * FROM sessions', (err, rows) => {
    if (!err && rows) {
      cachedSessions.clear();
      for (const r of rows) {
        cachedSessions.set(r.token, r);
      }
    }
  });

  db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100', (err, rows) => {
    if (!err && rows) {
      cachedAuditLogs = rows;
    }
  });
}

// ==========================================
// CONSULTAS Y OPERACIONES DE COMANDOS
// ==========================================

export function getCommandMap() {
  return cachedCommandMap || {};
}

export function getCommandByKey(key) {
  const map = getCommandMap();
  return map[key] || null;
}

export function upsertCommand(cmdObj) {
  const db = getDbConnection();
  const now = new Date().toISOString();

  db.run(`
    INSERT INTO commands (
      key, label, icon, cmd, type, id, labelId, statusId, defaultStatus, onlyUsers, allUsersExcept, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      label = excluded.label,
      icon = excluded.icon,
      cmd = excluded.cmd,
      type = excluded.type,
      id = excluded.id,
      labelId = excluded.labelId,
      statusId = excluded.statusId,
      defaultStatus = excluded.defaultStatus,
      onlyUsers = excluded.onlyUsers,
      allUsersExcept = excluded.allUsersExcept,
      updatedAt = excluded.updatedAt
  `, [
    cmdObj.key,
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
    now,
    now
  ], () => reloadCache());
}

// ==========================================
// CONSULTAS Y OPERACIONES DE USUARIOS
// ==========================================

export function getUser(usernameInput) {
  if (!usernameInput) return null;
  const key = usernameInput.trim().toLowerCase();
  return cachedUsers.get(key) || null;
}

export function getUserAsync(usernameInput) {
  return new Promise((resolve, reject) => {
    if (!usernameInput) return resolve(null);
    const lowerName = usernameInput.trim().toLowerCase();
    const db = getDbConnection();
    db.get('SELECT * FROM users WHERE LOWER(username) = ?', [lowerName], (err, row) => {
      if (err) return reject(err);
      if (row) {
        cachedUsers.set(lowerName, row);
      }
      resolve(row || null);
    });
  });
}

export function saveUserPassword(usernameInput, salt, hash, callback) {
  const db = getDbConnection();
  const now = new Date().toISOString();
  const lowerName = usernameInput.trim().toLowerCase();
  const existing = cachedUsers.get(lowerName);

  if (existing) {
    const updatedUser = { ...existing, salt, hash, updatedAt: now };
    cachedUsers.set(lowerName, updatedUser);
    db.run('UPDATE users SET salt = ?, hash = ?, updatedAt = ? WHERE LOWER(username) = ?',
      [salt, hash, now, lowerName], (err) => {
        reloadCache();
        if (callback) callback(err);
      });
  } else {
    const newUser = { username: usernameInput.trim(), salt, hash, createdAt: now };
    cachedUsers.set(lowerName, newUser);
    db.run('INSERT INTO users (username, salt, hash, createdAt) VALUES (?, ?, ?, ?)',
      [usernameInput.trim(), salt, hash, now], (err) => {
        reloadCache();
        if (callback) callback(err);
      });
  }
}

// ==========================================
// CONSULTAS Y OPERACIONES DE SESIONES
// ==========================================

export function getSession(token) {
  if (!token) return null;
  const session = cachedSessions.get(token);
  if (!session) return null;

  const now = Date.now();
  if (now - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
    deleteSession(token);
    return null;
  }
  return { username: session.username, createdAt: session.createdAt };
}

export function saveSession(token, username) {
  const db = getDbConnection();
  const now = Date.now();
  const obj = { token, username, createdAt: now };
  cachedSessions.set(token, obj);
  db.run('INSERT OR REPLACE INTO sessions (token, username, createdAt) VALUES (?, ?, ?)', [token, username, now]);
}

export function deleteSession(token) {
  if (!token) return;
  cachedSessions.delete(token);
  const db = getDbConnection();
  db.run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function cleanExpiredSessions() {
  const db = getDbConnection();
  const maxAge = Date.now() - (7 * 24 * 60 * 60 * 1000);
  db.run('DELETE FROM sessions WHERE createdAt <= ?', [maxAge], () => reloadCache());
}

// ==========================================
// CONSULTAS Y OPERACIONES DE AUDITORÍA
// ==========================================

export function insertAuditLog({ ip, username, command, success, detail, timestampStr }) {
  const db = getDbConnection();
  const now = new Date();
  const timestamp = timestampStr || now.toLocaleString('es-MX', { timeZoneName: 'short' });
  const createdAtIso = now.toISOString();

  const logEntry = {
    timestamp,
    ip: ip || 'DESCONOCIDO',
    username: username || 'ANONIMO',
    command: command || 'DESCONOCIDO',
    success: success ? 1 : 0,
    detail: detail || '',
    createdAt: createdAtIso
  };

  cachedAuditLogs.unshift(logEntry);
  if (cachedAuditLogs.length > 100) cachedAuditLogs.pop();

  db.run(`
    INSERT INTO audit_logs (timestamp, ip, username, command, success, detail, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    logEntry.timestamp,
    logEntry.ip,
    logEntry.username,
    logEntry.command,
    logEntry.success,
    logEntry.detail,
    logEntry.createdAt
  ]);
}

export function getRecentAuditLogs(limit = 35) {
  return cachedAuditLogs.slice(0, limit);
}

export function formatAuditLogsForTerminal(limit = 35) {
  const logs = getRecentAuditLogs(limit);
  if (!logs || logs.length === 0) {
    return '[AUDIT LOG] No se han registrado comandos ejecutados en el sistema.';
  }

  const chronological = [...logs].reverse();
  let output = `=== HISTORIAL DE AUDITORIA DE COMANDOS (SQLCIPHER 4) ===\n`;

  for (const log of chronological) {
    const statusStr = log.success ? 'EXITO' : 'FALLO';
    const detailStr = log.detail ? ` | ${log.detail}` : '';
    output += `[${log.timestamp}] [IP: ${log.ip}] [USUARIO: ${log.username}] -> COMANDO: "${log.command}" | RESULTADO: ${statusStr}${detailStr}\n`;
  }

  return output.trim();
}

// ==========================================
// CONSULTAS Y OPERACIONES DE DOROCORO AUDIO
// ==========================================

/**
 * Sincroniza / Inserta un lote de metadatos de canciones indexadas por trackHash.
 * Regla Estricta: SQLite SOLO almacena pistas con enlace web o de TokiDrive (multi-dispositivo).
 * Las pistas puramente locales residen exclusivamente en el IndexedDB del cliente.
 */
export function syncDorocoroTracks(username, tracks = []) {
  return new Promise((resolve, reject) => {
    if (!tracks || tracks.length === 0) return resolve({ count: 0 });

    const remoteTracks = tracks.filter(t => Boolean(t.webUrl) || t.sourceType === 'web' || t.sourceType === 'drive');
    if (remoteTracks.length === 0) {
      return resolve({ count: 0 });
    }

    const db = getDbConnection();
    const now = new Date().toISOString();

    db.serialize(() => {
      const stmt = db.prepare(`
        INSERT INTO dorocoro_tracks (
          trackHash, username, title, artist, album, duration, format, sourceType, webUrl, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(trackHash, username) DO UPDATE SET
          title = coalesce(excluded.title, dorocoro_tracks.title),
          artist = coalesce(excluded.artist, dorocoro_tracks.artist),
          album = coalesce(excluded.album, dorocoro_tracks.album),
          duration = coalesce(excluded.duration, dorocoro_tracks.duration),
          format = coalesce(excluded.format, dorocoro_tracks.format),
          sourceType = coalesce(excluded.sourceType, dorocoro_tracks.sourceType),
          webUrl = coalesce(excluded.webUrl, dorocoro_tracks.webUrl),
          updatedAt = excluded.updatedAt
      `);

      for (const t of remoteTracks) {
        if (!t.trackHash) continue;
        stmt.run([
          t.trackHash,
          username.toLowerCase(),
          t.title || 'Pista Desconocida',
          t.artist || username.toUpperCase(),
          t.album || 'Toki Stream',
          t.duration || '--:--',
          t.format || 'AUDIO',
          t.sourceType || 'web',
          t.webUrl,
          now,
          now
        ]);
      }

      stmt.finalize((err) => {
        if (err) return reject(err);
        resolve({ count: remoteTracks.length });
      });
    });
  });
}

/**
 * Actualiza el título, artista, álbum, webUrl y sourceType de una pista por su trackHash.
 */
export function updateDorocoroTrackMeta(username, trackHash, { title, artist, album, webUrl, sourceType }) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const now = new Date().toISOString();

    db.run(`
      UPDATE dorocoro_tracks
      SET title = coalesce(?, title),
          artist = coalesce(?, artist),
          album = coalesce(?, album),
          webUrl = coalesce(?, webUrl),
          sourceType = coalesce(?, sourceType),
          updatedAt = ?
      WHERE trackHash = ? AND username = ?
    `, [title, artist, album, webUrl, sourceType, now, trackHash, username.toLowerCase()], function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

/**
 * Alterna el estado favorito de una canción.
 */
export function toggleDorocoroFavorite(username, trackHash) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const now = new Date().toISOString();

    db.run(`
      UPDATE dorocoro_tracks
      SET isFavorite = CASE WHEN isFavorite = 1 THEN 0 ELSE 1 END,
          updatedAt = ?
      WHERE trackHash = ? AND username = ?
    `, [now, trackHash, username.toLowerCase()], function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

/**
 * Obtiene toda la biblioteca de Dorocoro para un usuario (pistas remotas/Drive, playlists y canciones asociadas).
 * Limpia automáticamente cualquier pista web huérfana que no pertenezca a ninguna playlist.
 */
export function getDorocoroUserData(username) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = (username || 'admin').toLowerCase();

    // Limpiar pistas web huérfanas que no están en ninguna playlist ni son de TokiDrive
    db.run(`
      DELETE FROM dorocoro_tracks 
      WHERE username = ? 
        AND sourceType != 'drive' 
        AND webUrl NOT LIKE '%/drive%'
        AND trackHash NOT IN (SELECT trackHash FROM dorocoro_playlist_tracks WHERE username = ?)
    `, [user, user], () => {
      db.all(`SELECT * FROM dorocoro_tracks WHERE (username = ? OR ? = 'admin') AND (webUrl IS NOT NULL AND webUrl != '') ORDER BY createdAt DESC`, [user, user], (err, tracks) => {
        if (err) return reject(err);

        db.all(`SELECT * FROM dorocoro_playlists WHERE (username = ? OR ? = 'admin') ORDER BY createdAt ASC`, [user, user], (err2, playlists) => {
          if (err2) return reject(err2);

          db.all(`SELECT * FROM dorocoro_playlist_tracks WHERE (username = ? OR ? = 'admin') ORDER BY position ASC, addedAt ASC`, [user, user], (err3, playlistTracks) => {
            if (err3) return reject(err3);

            resolve({
              tracks: tracks || [],
              playlists: playlists || [],
              playlistTracks: playlistTracks || []
            });
          });
        });
      });
    });
  });
}

/**
 * Crea una nueva lista de reproducción para el usuario.
 */
export function createDorocoroPlaylist(username, id, name, sourceUrl = null) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const now = new Date().toISOString();

    db.run(`
      INSERT INTO dorocoro_playlists (id, username, name, sourceUrl, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, username.toLowerCase(), name.trim(), sourceUrl ? sourceUrl.trim() : null, now, now], function (err) {
      if (err) return reject(err);
      resolve({ id, name: name.trim(), sourceUrl: sourceUrl ? sourceUrl.trim() : null });
    });
  });
}

/**
 * Obtiene una lista de reproducción específica con sus pistas asociadas.
 */
export function getDorocoroPlaylistById(username, id) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = username.toLowerCase();

    db.get(
      `SELECT * FROM dorocoro_playlists WHERE id = ? AND (username = ? OR ? = 'admin')`,
      [id, user, user],
      (err, playlist) => {
        if (err) return reject(err);
        if (!playlist) return resolve(null);

        db.all(
          `SELECT pt.trackHash, pt.position, t.title, t.artist, t.webUrl, t.sourceType
           FROM dorocoro_playlist_tracks pt
           LEFT JOIN dorocoro_tracks t ON pt.trackHash = t.trackHash AND pt.username = t.username
           WHERE pt.playlistId = ? AND (pt.username = ? OR ? = 'admin')
           ORDER BY pt.position ASC`,
          [id, user, user],
          (err2, tracks) => {
            if (err2) return reject(err2);
            resolve({
              ...playlist,
              tracks: tracks || []
            });
          }
        );
      }
    );
  });
}

/**
 * Renombra una lista de reproducción.
 */
export function renameDorocoroPlaylist(username, id, name) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const now = new Date().toISOString();

    db.run(`
      UPDATE dorocoro_playlists
      SET name = ?, updatedAt = ?
      WHERE id = ? AND username = ?
    `, [name.trim(), now, id, username.toLowerCase()], function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

/**
 * Elimina una lista de reproducción y sus canciones asociadas.
 */
export function deleteDorocoroPlaylist(username, id) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = username.toLowerCase();

    db.serialize(() => {
      db.run(`DELETE FROM dorocoro_playlist_tracks WHERE playlistId = ? AND username = ?`, [id, user]);
      db.run(`DELETE FROM dorocoro_playlists WHERE id = ? AND username = ?`, [id, user], function (err) {
        if (err) return reject(err);
        resolve({ deleted: true });
      });
    });
  });
}

/**
 * Agrega una canción a una lista de reproducción.
 */
export function addTrackToDorocoroPlaylist(username, playlistId, trackHash) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const now = new Date().toISOString();
    const user = username.toLowerCase();

    db.run(`
      INSERT OR IGNORE INTO dorocoro_playlist_tracks (playlistId, username, trackHash, position, addedAt)
      VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM dorocoro_playlist_tracks WHERE playlistId = ? AND username = ?), ?)
    `, [playlistId, user, trackHash, playlistId, user, now], function (err) {
      if (err) return reject(err);
      resolve({ added: this.changes > 0 });
    });
  });
}

/**
 * Agrega un lote de canciones a una lista de reproducción de forma atómica.
 */
export function addTracksToDorocoroPlaylist(username, playlistId, trackHashes) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(trackHashes) || trackHashes.length === 0) {
      return resolve({ count: 0 });
    }
    const db = getDbConnection();
    const now = new Date().toISOString();
    const user = username.toLowerCase();

    db.get(
      `SELECT COALESCE(MAX(position), 0) AS maxPos FROM dorocoro_playlist_tracks WHERE playlistId = ? AND username = ?`,
      [playlistId, user],
      (err, row) => {
        if (err) return reject(err);
        let currentPos = row ? (row.maxPos || 0) : 0;

        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          const stmt = db.prepare(`
            INSERT OR IGNORE INTO dorocoro_playlist_tracks (playlistId, username, trackHash, position, addedAt)
            VALUES (?, ?, ?, ?, ?)
          `);

          for (const hash of trackHashes) {
            currentPos++;
            stmt.run([playlistId, user, hash, currentPos, now]);
          }

          stmt.finalize((finalizeErr) => {
            if (finalizeErr) {
              db.run('ROLLBACK');
              return reject(finalizeErr);
            }
            db.run('COMMIT', (commitErr) => {
              if (commitErr) return reject(commitErr);
              resolve({ count: trackHashes.length });
            });
          });
        });
      }
    );
  });
}

/**
 * Quita una canción de una lista de reproducción.
 */
export function removeTrackFromDorocoroPlaylist(username, playlistId, trackHash) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = username.toLowerCase();

    db.run(`
      DELETE FROM dorocoro_playlist_tracks
      WHERE playlistId = ? AND username = ? AND trackHash = ?
    `, [playlistId, user, trackHash], function (err) {
      if (err) return reject(err);
      resolve({ removed: this.changes > 0 });
    });
  });
}

/**
 * Elimina una canción completamente de la biblioteca y de todas las listas del usuario.
 * Permite eliminar por trackHash o por coincidencia de nombre de archivo / URL.
 */
export function deleteDorocoroTrack(username, trackHash, filename = '') {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = (username || 'admin').toLowerCase();

    db.serialize(() => {
      if (filename) {
        const filePattern = `%${filename}%`;
        db.run(`
          DELETE FROM dorocoro_playlist_tracks 
          WHERE username = ? AND trackHash IN (
            SELECT trackHash FROM dorocoro_tracks WHERE username = ? AND (trackHash = ? OR webUrl LIKE ?)
          )
        `, [user, user, trackHash, filePattern]);

        db.run(`
          DELETE FROM dorocoro_tracks 
          WHERE username = ? AND (trackHash = ? OR webUrl LIKE ?)
        `, [user, trackHash, filePattern], function (err) {
          if (err) return reject(err);
          resolve({ deleted: this.changes > 0 });
        });
      } else {
        db.run(`DELETE FROM dorocoro_playlist_tracks WHERE username = ? AND trackHash = ?`, [user, trackHash]);
        db.run(`DELETE FROM dorocoro_tracks WHERE username = ? AND trackHash = ?`, [user, trackHash], function (err) {
          if (err) return reject(err);
          resolve({ deleted: this.changes > 0 });
        });
      }
    });
  });
}

/**
 * Purga de SQLite cualquier pista de Drive cuyo archivo físico ya no exista en la carpeta del usuario.
 */
export function purgeStaleDriveTracks(username, activeFilenames = []) {
  return new Promise((resolve) => {
    const db = getDbConnection();
    const user = username.toLowerCase();

    db.all(`SELECT trackHash, webUrl FROM dorocoro_tracks WHERE username = ? AND (sourceType = 'drive' OR webUrl LIKE '%/drive%') ORDER BY CASE WHEN trackHash LIKE 'trk_drive_%' THEN 0 ELSE 1 END`, [user], (err, rows) => {
      if (err || !rows || rows.length === 0) return resolve({ purged: 0 });

      const toDelete = [];
      const seenUrls = new Set();

      for (const r of rows) {
        const url = r.webUrl || '';
        const fname = decodeURIComponent(url.split('/').pop() || '');
        if (fname && !activeFilenames.includes(fname)) {
          toDelete.push(r.trackHash);
        } else if (url) {
          if (seenUrls.has(url)) {
            toDelete.push(r.trackHash);
          } else {
            seenUrls.add(url);
          }
        }
      }

      if (toDelete.length === 0) return resolve({ purged: 0 });

      db.serialize(() => {
        const placeholders = toDelete.map(() => '?').join(',');
        db.run(`DELETE FROM dorocoro_playlist_tracks WHERE username = ? AND trackHash IN (${placeholders})`, [user, ...toDelete]);
        db.run(`DELETE FROM dorocoro_tracks WHERE username = ? AND trackHash IN (${placeholders})`, [user, ...toDelete], function () {
          resolve({ purged: toDelete.length });
        });
      });
    });
  });
}

/**
 * Vacía completamente todas las pistas, playlists y asociaciones del usuario en SQLite.
 */
export function clearAllDorocoroUserData(username) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = (username || 'admin').toLowerCase();

    db.serialize(() => {
      db.run(`DELETE FROM dorocoro_playlist_tracks WHERE username = ?`, [user]);
      db.run(`DELETE FROM dorocoro_playlists WHERE username = ?`, [user]);
      db.run(`DELETE FROM dorocoro_tracks WHERE username = ?`, [user], function (err) {
        if (err) return reject(err);
        resolve({ cleared: true, changes: this.changes });
      });
    });
  });
}

/**
 * Guarda o actualiza los tokens OAuth2 y perfil de Spotify de un usuario.
 */
export function saveUserSpotifyAccount(username, { accessToken, refreshToken, expiresAt, spotifyUserId, spotifyDisplayName, spotifyAvatar }) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = (username || 'admin').toLowerCase();
    const now = new Date().toISOString();

    db.run(`
      INSERT INTO dorocoro_spotify_accounts (username, accessToken, refreshToken, expiresAt, spotifyUserId, spotifyDisplayName, spotifyAvatar, linkedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        accessToken = excluded.accessToken,
        refreshToken = coalesce(excluded.refreshToken, dorocoro_spotify_accounts.refreshToken),
        expiresAt = excluded.expiresAt,
        spotifyUserId = coalesce(excluded.spotifyUserId, dorocoro_spotify_accounts.spotifyUserId),
        spotifyDisplayName = coalesce(excluded.spotifyDisplayName, dorocoro_spotify_accounts.spotifyDisplayName),
        spotifyAvatar = coalesce(excluded.spotifyAvatar, dorocoro_spotify_accounts.spotifyAvatar),
        linkedAt = excluded.linkedAt
    `, [user, accessToken, refreshToken || '', expiresAt, spotifyUserId || null, spotifyDisplayName || null, spotifyAvatar || null, now], function (err) {
      if (err) return reject(err);
      resolve({ saved: true });
    });
  });
}

/**
 * Obtiene la cuenta y tokens de Spotify vinculados a un usuario.
 */
export function getUserSpotifyAccount(username) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = (username || 'admin').toLowerCase();

    db.get(`SELECT * FROM dorocoro_spotify_accounts WHERE username = ?`, [user], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Elimina la vinculación de Spotify de un usuario.
 */
export function deleteUserSpotifyAccount(username) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const user = (username || 'admin').toLowerCase();

    db.run(`DELETE FROM dorocoro_spotify_accounts WHERE username = ?`, [user], function (err) {
      if (err) return reject(err);
      resolve({ unlinked: this.changes > 0 });
    });
  });
}

