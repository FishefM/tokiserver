import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  syncDorocoroTracks,
  updateDorocoroTrackMeta,
  toggleDorocoroFavorite,
  getDorocoroUserData,
  createDorocoroPlaylist,
  renameDorocoroPlaylist,
  deleteDorocoroPlaylist,
  addTrackToDorocoroPlaylist,
  removeTrackFromDorocoroPlaylist
} from '../db.js';

const router = express.Router();

// Todas las rutas de Dorocoro requieren token de sesión activo del usuario
router.use(requireAuth);

/**
 * GET /api/dorocoro/library
 * Obtiene todas las pistas, listas de reproducción y asociaciones del usuario autenticado.
 */
router.get('/library', async (req, res) => {
  try {
    const data = await getDorocoroUserData(req.user);
    res.json({
      success: true,
      username: req.user,
      ...data
    });
  } catch (err) {
    console.error('[DOROCORO API] Error al obtener biblioteca:', err);
    res.status(500).json({ success: false, error: 'Error al consultar la biblioteca de audio.' });
  }
});

/**
 * POST /api/dorocoro/tracks/sync
 * Sincroniza un lote de pistas de audio (metadatos e indexación por trackHash).
 */
router.post('/tracks/sync', async (req, res) => {
  try {
    const { tracks } = req.body;
    if (!Array.isArray(tracks)) {
      return res.status(400).json({ success: false, error: 'Se esperaba un arreglo de pistas.' });
    }
    const result = await syncDorocoroTracks(req.user, tracks);
    res.json({ success: true, count: result.count });
  } catch (err) {
    console.error('[DOROCORO API] Error al sincronizar pistas:', err);
    res.status(500).json({ success: false, error: 'Error al guardar metadatos de pistas.' });
  }
});

/**
 * PUT /api/dorocoro/tracks/:hash
 * Actualiza el título y/o artista de una pista por su trackHash.
 */
router.put('/tracks/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { title, artist, album } = req.body;
    if (!title && !artist && !album) {
      return res.status(400).json({ success: false, error: 'Debe especificar al menos un campo a modificar.' });
    }
    const result = await updateDorocoroTrackMeta(req.user, hash, { title, artist, album });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    console.error('[DOROCORO API] Error al actualizar metadatos:', err);
    res.status(500).json({ success: false, error: 'Error al actualizar pista.' });
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

export default router;
