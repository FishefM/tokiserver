import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { verifySession } from '../auth.js';
import {
  syncDorocoroTracks,
  updateDorocoroTrackMeta,
  toggleDorocoroFavorite,
  getDorocoroUserData,
  createDorocoroPlaylist,
  renameDorocoroPlaylist,
  deleteDorocoroPlaylist,
  addTrackToDorocoroPlaylist,
  removeTrackFromDorocoroPlaylist,
  deleteDorocoroTrack,
  clearAllDorocoroUserData,
  purgeStaleDriveTracks
} from '../db.js';
import {
  searchWebAudio,
  downloadAudioTrack,
  getTrackAudioPath,
  extractPlaylistFromUrl
} from '../services/ytDlpService.js';
import {
  startJamSession,
  stopJamSession,
  getJamInfo,
  getActiveTokiJams,
  getJamSessionByHost,
  subscribeToJamEvents,
  addTrackToJam,
  updateJamPlayingTrack
} from '../services/jamService.js';
import { searchRateLimiter, jamQueueRateLimiter } from '../middleware/securityMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DRIVE_ROOT = path.resolve(__dirname, '..', '..', 'drive');

// Configuración de almacenamiento en TokiDrive para música del usuario (drive/<usuario>/Music/)
const driveMusicStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const user = (req.user || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const userMusicDir = path.resolve(DRIVE_ROOT, user, 'Music');
    if (!fs.existsSync(userMusicDir)) {
      fs.mkdirSync(userMusicDir, { recursive: true });
    }
    cb(null, userMusicDir);
  },
  filename: (req, file, cb) => {
    const original = file.originalname || 'track.mp3';
    let ext = path.extname(original).toLowerCase();
    const validExts = ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.aac', '.webm', '.mp4'];
    if (!ext || !validExts.includes(ext)) {
      ext = '.mp3';
    }
    const rawBase = path.basename(original, path.extname(original));
    const cleanBase = rawBase.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').trim() || 'Audio_Track';
    const safeName = `${cleanBase}${ext}`;
    cb(null, safeName);
  }
});

const uploadDriveMusic = multer({
  storage: driveMusicStorage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB máximo por pista
});

const router = express.Router();

// Middleware de identificación de usuario (admite sesión autenticada o perfil local)
function resolveDorocoroUser(req) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.slice(7)
    : req.headers['x-auth-token'];

  if (token) {
    const session = verifySession(token);
    if (session && session.username) {
      return session.username;
    }
  }

  const customUser = req.headers['x-user'];
  if (customUser && typeof customUser === 'string' && customUser.trim()) {
    return customUser.trim().toLowerCase();
  }

  return 'admin';
}

router.use((req, res, next) => {
  req.user = resolveDorocoroUser(req);
  next();
});

/**
 * Escanea la carpeta drive/<username>/Music/ e integra/vincula automáticamente las canciones encontradas a la biblioteca.
 */
async function scanDriveMusicFolder(username) {
  try {
    const user = (username || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const targetUsers = new Set([user]);

    // Si el usuario es admin o la carpeta no existe, agregar todos los usuarios con carpeta en drive/
    const userMusicDir = path.resolve(DRIVE_ROOT, user, 'Music');
    if (!fs.existsSync(userMusicDir) || user === 'admin') {
      try {
        const driveEntries = fs.readdirSync(DRIVE_ROOT, { withFileTypes: true });
        for (const entry of driveEntries) {
          if (entry.isDirectory() && !['css', 'js', 'img'].includes(entry.name)) {
            const mDir = path.resolve(DRIVE_ROOT, entry.name, 'Music');
            if (fs.existsSync(mDir)) {
              targetUsers.add(entry.name.toLowerCase());
            }
          }
        }
      } catch (e) {}
    }

    const audioExts = ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.aac', '.webm', '.mp4'];
    const driveTracks = [];

    for (const u of targetUsers) {
      const uDir = path.resolve(DRIVE_ROOT, u, 'Music');
      if (!fs.existsSync(uDir)) continue;

      const files = fs.readdirSync(uDir);
      const validAudioFiles = [];

      for (const filename of files) {
        const ext = path.extname(filename).toLowerCase();
        if (!audioExts.includes(ext)) continue;

        validAudioFiles.push(filename);
        const rawBase = path.basename(filename, path.extname(filename));
        let artist = u.toUpperCase();
        let title = rawBase.replace(/_/g, ' ').trim();

        if (title.includes(' - ')) {
          const parts = title.split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        }

        const webUrl = `/api/dorocoro/drive-stream/${encodeURIComponent(u)}/${encodeURIComponent(filename)}`;
        const trackHash = `trk_drive_${crypto.createHash('md5').update(`${u}_${filename}`).digest('hex').slice(0, 16)}`;

        driveTracks.push({
          trackHash,
          title,
          artist,
          album: 'TokiDrive Music',
          duration: '--:--',
          format: ext.replace('.', '').toUpperCase(),
          sourceType: 'drive',
          webUrl
        });
      }

      await purgeStaleDriveTracks(u, validAudioFiles);
      if (driveTracks.length > 0) {
        await syncDorocoroTracks(u, driveTracks);
      }
    }

    return driveTracks;
  } catch (err) {
    console.warn('[DRIVE MUSIC SCANNER WARNING]', err.message);
    return [];
  }
}

/**
 * GET /api/dorocoro/library
 * Obtiene todas las pistas, listas de reproducción y canciones de TokiDrive del usuario.
 */
router.get('/library', async (req, res) => {
  try {
    const driveTracks = await scanDriveMusicFolder(req.user);
    const data = await getDorocoroUserData(req.user);
    res.json({
      success: true,
      username: req.user,
      driveTracks: driveTracks || [],
      ...data
    });
  } catch (err) {
    console.error('[DOROCORO API] Error al obtener biblioteca:', err);
    res.status(500).json({ success: false, error: 'Error al consultar la biblioteca de audio.' });
  }
});

/**
 * GET /api/dorocoro/search?q=<termino>&limit=<numero>
 * Realiza una búsqueda de canciones en la web con metadatos estructurados.
 */
router.get('/search', searchRateLimiter, async (req, res) => {
  try {
    const q = req.query.q;
    const limit = parseInt(req.query.limit, 10) || 8;
    if (!q || !q.trim()) {
      return res.json({ success: true, results: [] });
    }

    const results = await searchWebAudio(q.trim(), limit);
    res.json({ success: true, results });
  } catch (err) {
    console.error('[DOROCORO SEARCH API ERROR]', err);
    res.status(500).json({ success: false, error: 'Error al realizar la búsqueda de audio en la web: ' + err.message });
  }
});

/**
 * GET /api/dorocoro/stream/:trackHash
 * Descarga y transmite el archivo de audio completo desde la caché con soporte HTTP 206
 */
router.get('/stream/:trackHash', async (req, res) => {
  try {
    const { trackHash } = req.params;
    const webUrl = req.query.url;

    let filePath = getTrackAudioPath(trackHash);

    // Si aún no está en caché en el servidor, descargarlo al 100% primero
    if (!filePath) {
      filePath = await downloadAudioTrack(trackHash, webUrl);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'No se pudo obtener el archivo de audio para reproducción.' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Soporte para HTTP 206 Partial Content (Búsqueda en la barra de progreso sin re-descargar)
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send('Rango solicitado no satisfactorio\n' + start + ' >= ' + fileSize);
        return;
      }

      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mp4'
      };

      res.writeHead(206, head);
      fileStream.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mp4',
        'Accept-Ranges': 'bytes'
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('[DOROCORO STREAM ERROR]', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Error al transmitir la pista de audio.' });
    }
  }
});

/**
 * POST /api/dorocoro/prefetch
 * Descarga anticipadamente en segundo plano la siguiente canción de la cola
 */
router.post('/prefetch', async (req, res) => {
  try {
    const { trackHash, webUrl } = req.body;
    if (!trackHash) {
      return res.status(400).json({ success: false, error: 'Se requiere trackHash para prefetch.' });
    }

    if (getTrackAudioPath(trackHash)) {
      return res.json({ success: true, cached: true });
    }

    // Iniciar descarga en disco silenciosamente
    downloadAudioTrack(trackHash, webUrl).catch(err => {
      console.warn(`[DOROCORO PREFETCH BACKGROUND ERROR ${trackHash}]`, err.message);
    });

    res.json({ success: true, prefetching: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al iniciar prefetch.' });
  }
});

/**
 * POST /api/dorocoro/tracks/sync
 * Sincroniza metadatos de pistas detectadas localmente o desde la web hacia SQLite
 */
router.post('/tracks/sync', async (req, res) => {
  try {
    const { tracks } = req.body;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return res.json({ success: true, message: 'No hay pistas para sincronizar.' });
    }

    const count = await syncDorocoroTracks(req.user, tracks);
    res.json({ success: true, syncedCount: count });
  } catch (err) {
    console.error('[DOROCORO API] Error al sincronizar pistas:', err);
    res.status(500).json({ success: false, error: 'Error al sincronizar pistas con el servidor.' });
  }
});

/**
 * PUT /api/dorocoro/tracks/:hash
 * Actualiza etiquetas (título, artista, álbum) de una canción.
 */
router.put('/tracks/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { title, artist, album } = req.body;
    const result = await updateDorocoroTrackMeta(req.user, hash, { title, artist, album });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('[DOROCORO API] Error al actualizar etiquetas:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar etiquetas.' });
  }
});

/**
 * DELETE /api/dorocoro/tracks/:hash
 * Elimina una canción completamente de la biblioteca y de todas las listas.
 */
router.delete('/tracks/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const result = await deleteDorocoroTrack(req.user, hash);
    res.json({ success: true, deleted: result.deleted });
  } catch (err) {
    console.error('[DOROCORO API] Error al eliminar canción:', err);
    res.status(500).json({ success: false, error: 'Error al eliminar la canción de la biblioteca.' });
  }
});

/**
 * DELETE /api/dorocoro/drive-track/:hash
 * Elimina la pista de SQLite y además borra físicamente el archivo de la carpeta drive/<username>/Music/.
 */
router.delete('/drive-track/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const user = (req.user || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const userMusicDir = path.resolve(DRIVE_ROOT, user, 'Music');
    const filename = req.query.filename;

    if (filename) {
      const targetPath = path.resolve(userMusicDir, path.basename(filename));
      if (fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
        } catch (fileErr) {
          console.warn('[DOROCORO DRIVE DELETE WARNING] No se pudo borrar archivo en disco:', fileErr.message);
        }
      }
    } else if (fs.existsSync(userMusicDir)) {
      const files = fs.readdirSync(userMusicDir);
      for (const f of files) {
        const expectedHash = `trk_drive_${crypto.createHash('md5').update(`${user}_${f}`).digest('hex').slice(0, 16)}`;
        if (expectedHash === hash) {
          const targetPath = path.resolve(userMusicDir, f);
          try {
            fs.unlinkSync(targetPath);
          } catch (fileErr) {}
          break;
        }
      }
    }

    const result = await deleteDorocoroTrack(req.user, hash);
    res.json({ success: true, deleted: result.deleted, fileDeleted: true });
  } catch (err) {
    console.error('[DOROCORO API] Error al eliminar pista de TokiDrive:', err);
    res.status(500).json({ success: false, error: 'Error al eliminar pista de TokiDrive.' });
  }
});

/**
 * DELETE /api/dorocoro/library
 * Vacía completamente todas las pistas y listas del usuario en SQLite.
 */
router.delete('/library', async (req, res) => {
  try {
    const result = await clearAllDorocoroUserData(req.user);
    res.json({ success: true, cleared: result.cleared });
  } catch (err) {
    console.error('[DOROCORO API] Error al vaciar biblioteca central:', err);
    res.status(500).json({ success: false, error: 'Error al vaciar biblioteca.' });
  }
});

/**
 * POST /api/dorocoro/upload-to-drive
 * Sube un archivo de audio local a la carpeta drive/<username>/Music/ y retorna su link multi-dispositivo.
 */
router.post('/upload-to-drive', uploadDriveMusic.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se recibió ningún archivo de audio para subir a Drive.' });
    }

    const user = (req.user || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filename = req.file.filename;
    const webUrl = `/api/dorocoro/drive-stream/${encodeURIComponent(user)}/${encodeURIComponent(filename)}`;

    res.json({
      success: true,
      webUrl,
      filename,
      username: user
    });
  } catch (err) {
    console.error('[DOROCORO DRIVE UPLOAD ERROR]', err);
    res.status(500).json({ success: false, error: 'Error al subir la canción a TokiDrive: ' + err.message });
  }
});

/**
 * GET /api/dorocoro/drive-stream/:username/:filename
 * Streaming HTTP 206 de archivos de TokiDrive con soporte completo de rangos (seeking)
 */
router.get('/drive-stream/:username/:filename', (req, res) => {
  try {
    const user = req.params.username.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filename = path.basename(req.params.filename);
    const filePath = path.resolve(DRIVE_ROOT, user, 'Music', filename);

    if (!filePath.startsWith(DRIVE_ROOT) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Archivo de audio no encontrado en Drive.' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/opus',
      '.webm': 'audio/webm',
      '.mp4': 'video/mp4'
    };
    const contentType = mimeTypes[ext] || 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('[DOROCORO DRIVE STREAM ERROR]', err);
    res.status(500).json({ success: false, error: 'Error al reproducir audio de TokiDrive.' });
  }
});

/**
 * POST /api/dorocoro/tracks/:hash/favorite
 * Alterna el estado favorito de una canción.
 */
router.post('/tracks/:hash/favorite', async (req, res) => {
  try {
    const { hash } = req.params;
    const result = await toggleDorocoroFavorite(req.user, hash);
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('[DOROCORO API] Error al alternar favorito:', err);
    res.status(500).json({ success: false, error: 'Error al marcar favorito.' });
  }
});

/**
 * POST /api/dorocoro/playlists
 * Crea una nueva lista de reproducción.
 */
router.post('/playlists', async (req, res) => {
  try {
    const { id, name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'El nombre de la lista es requerido.' });
    }
    const playlistId = id || `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const result = await createDorocoroPlaylist(req.user, playlistId, name.trim());
    res.json({ success: true, playlist: result });
  } catch (err) {
    console.error('[DOROCORO API] Error al crear lista:', err);
    res.status(500).json({ success: false, error: 'Error al crear lista de reproducción.' });
  }
});

/**
 * POST /api/dorocoro/playlists/import-web
 * Importa una lista de reproducción completa desde YouTube u otra URL compatible con yt-dlp.
 */
router.post('/playlists/import-web', async (req, res) => {
  try {
    const { url, name } = req.body;
    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, error: 'Se requiere una URL válida de YouTube para importar.' });
    }

    const extracted = await extractPlaylistFromUrl(url.trim());
    if (!extracted || !Array.isArray(extracted.tracks) || extracted.tracks.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontraron pistas de audio en el enlace provisto o la lista es privada.' });
    }

    const playlistName = (name && name.trim()) ? name.trim() : (extracted.playlistTitle || 'Lista Importada de YouTube');
    const playlistId = `pl_yt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Sincronizar metadatos de pistas encontradas hacia SQLite
    await syncDorocoroTracks(req.user, extracted.tracks);

    // 2. Crear la lista en SQLite
    await createDorocoroPlaylist(req.user, playlistId, playlistName);

    // 3. Asociar cada una de las canciones a la lista
    for (const trk of extracted.tracks) {
      await addTrackToDorocoroPlaylist(req.user, playlistId, trk.trackHash);
    }

    res.json({
      success: true,
      playlist: {
        id: playlistId,
        name: playlistName,
        trackHashes: extracted.tracks.map(t => t.trackHash)
      },
      tracks: extracted.tracks,
      importedCount: extracted.tracks.length
    });
  } catch (err) {
    console.error('[DOROCORO API] Error al importar playlist web:', err);
    res.status(500).json({ success: false, error: 'Error interno al procesar la lista de YouTube: ' + err.message });
  }
});

/**
 * PUT /api/dorocoro/playlists/:id
 * Renombra una lista de reproducción.
 */
router.put('/playlists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'El nuevo nombre es requerido.' });
    }
    const result = await renameDorocoroPlaylist(req.user, id, name.trim());
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('[DOROCORO API] Error al renombrar lista:', err);
    res.status(500).json({ success: false, error: 'Error al renombrar lista.' });
  }
});

/**
 * DELETE /api/dorocoro/playlists/:id
 * Elimina una lista de reproducción.
 */
router.delete('/playlists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteDorocoroPlaylist(req.user, id);
    res.json({ success: true, deleted: result.deleted });
  } catch (err) {
    console.error('[DOROCORO API] Error al eliminar lista:', err);
    res.status(500).json({ success: false, error: 'Error al eliminar lista.' });
  }
});

/**
 * POST /api/dorocoro/playlists/:id/tracks
 * Agrega una canción a una lista de reproducción.
 */
router.post('/playlists/:id/tracks', async (req, res) => {
  try {
    const { id } = req.params;
    const { trackHash } = req.body;
    if (!trackHash) {
      return res.status(400).json({ success: false, error: 'Se requiere el trackHash de la canción.' });
    }
    const result = await addTrackToDorocoroPlaylist(req.user, id, trackHash);
    res.json({ success: true, added: result.added });
  } catch (err) {
    console.error('[DOROCORO API] Error al agregar a lista:', err);
    res.status(500).json({ success: false, error: 'Error al asociar canción a la lista.' });
  }
});

/**
 * DELETE /api/dorocoro/playlists/:id/tracks/:hash
 * Quita una canción de una lista de reproducción.
 */
router.delete('/playlists/:id/tracks/:hash', async (req, res) => {
  try {
    const { id, hash } = req.params;
    const result = await removeTrackFromDorocoroPlaylist(req.user, id, hash);
    res.json({ success: true, removed: result.removed });
  } catch (err) {
    console.error('[DOROCORO API] Error al quitar de lista:', err);
    res.status(500).json({ success: false, error: 'Error al remover canción de la lista.' });
  }
});

// =============================================================================
// RUTAS DE SESIONES COLABORATIVAS JAM (TOKIJAM & JAM GENERAL)
// =============================================================================

/**
 * POST /api/tokitube/jam/start
 * Inicia una TokiJAM (privada) o Jam General (pública con Tailscale Funnel).
 */
router.post('/jam/start', async (req, res) => {
  try {
    const { type } = req.body; // 'tokijam' | 'general'
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;

    const session = await startJamSession(req.user, type || 'tokijam', baseUrl);
    res.json(session);
  } catch (err) {
    console.error('[DOROCORO JAM] Error al iniciar JAM:', err);
    res.status(500).json({ success: false, error: err.message || 'Error al iniciar sesión JAM' });
  }
});

/**
 * POST /api/tokitube/jam/stop
 * Detiene la sesión JAM activa del usuario anfitrión.
 */
router.post('/jam/stop', async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!roomId) {
      return res.status(400).json({ success: false, error: 'Se requiere roomId' });
    }
    const stopped = await stopJamSession(roomId, req.user);
    res.json({ success: true, stopped });
  } catch (err) {
    console.error('[DOROCORO JAM] Error al detener JAM:', err);
    res.status(500).json({ success: false, error: 'Error al detener sesión JAM' });
  }
});

/**
 * GET /api/tokitube/jam/status
 * Obtiene la sesión JAM que el usuario actual tiene activa como anfitrión.
 */
router.get('/jam/status', (req, res) => {
  try {
    const hostJam = getJamSessionByHost(req.user);
    res.json({ success: true, jam: hostJam });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al consultar estado de Jam' });
  }
});

/**
 * GET /api/tokitube/jam/active-tokijams
 * Lista todas las TokiJAMs activas en el servidor para usuarios autenticados.
 */
router.get('/jam/active-tokijams', (req, res) => {
  try {
    const list = getActiveTokiJams();
    res.json({ success: true, jams: list });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al consultar TokiJAMs' });
  }
});

/**
 * GET /api/tokitube/jam/info/:roomId
 * Obtiene los detalles públicos de una sala JAM.
 */
router.get('/jam/info/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const info = getJamInfo(roomId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'La sesión JAM no existe o ha finalizado.' });
    }
    res.json({ success: true, jam: info });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al consultar sala JAM' });
  }
});

/**
 * GET /api/tokitube/jam/events/:roomId
 * Suscripción SSE (Server-Sent Events) en tiempo real para anfitrión e invitados.
 */
router.get('/jam/events/:roomId', (req, res) => {
  const { roomId } = req.params;
  subscribeToJamEvents(roomId, req, res);
});

/**
 * POST /api/tokitube/jam/queue/:roomId
 * Agrega una canción a la cola de la sala JAM.
 */
router.post('/jam/queue/:roomId', jamQueueRateLimiter, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { track, senderName, position } = req.body;

    const queued = addTrackToJam(roomId, track, senderName || req.user || 'Invitado', position || 'end');
    res.json({ success: true, track: queued });
  } catch (err) {
    console.error('[DOROCORO JAM QUEUE ERROR]', err);
    res.status(400).json({ success: false, error: err.message || 'Error al agregar canción a la Jam' });
  }
});

/**
 * POST /api/tokitube/jam/sync-now-playing/:roomId
 * Sincroniza la pista que el anfitrión está reproduciendo actualmente.
 */
router.post('/jam/sync-now-playing/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const { currentPlaying } = req.body;
    updateJamPlayingTrack(roomId, currentPlaying);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error al sincronizar reproducción' });
  }
});

/**
 * GET /api/tokitube/jam/qr
 * Genera código QR vectorial SVG estándar mediante la librería qrcode
 */
router.get('/jam/qr', async (req, res) => {
  try {
    const text = req.query.text || '';
    if (!text) {
      return res.status(400).send('Falta parámetro text');
    }
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 2,
      color: {
        dark: '#00ff41',
        light: '#05070a'
      }
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).send('Error al generar QR');
  }
});

export default router;
