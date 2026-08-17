import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.resolve(SERVER_ROOT, '.data/audio_cache');
const YTDLP_BIN = path.resolve(SERVER_ROOT, 'bin/yt-dlp');

// Mapa de promesas de descarga en curso para evitar descargas concurrentes duplicadas
const activeDownloads = new Map();

/**
 * Asegura que el directorio de caché de audio exista
 */
export function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Formatea segundos a MM:SS
 */
function formatSeconds(secs) {
  if (typeof secs !== 'number' || isNaN(secs) || secs < 0) return '--:--';
  const mins = Math.floor(secs / 60);
  const rem = Math.floor(secs % 60);
  return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

/**
 * Limpia y normaliza términos de búsqueda eliminando palabras de relleno,
 * etiquetas de video oficial, extensiones de archivo y puntuación conflictiva.
 */
export function sanitizeSearchQuery(query) {
  if (!query || typeof query !== 'string') return '';
  let str = query.trim();

  // Si es URL directa, no modificar
  if (str.startsWith('http://') || str.startsWith('https://')) {
    return str;
  }

  // 1. Quitar extensiones de archivo comunes (ej: .mp3, .flac)
  str = str.replace(/\.(mp3|wav|flac|ogg|m4a|aac|opus|webm|wma)$/i, '');

  // 2. Normalizar colaboraciones (Ft., Feat., Featuring, x, vs)
  str = str.replace(/\b(feat|featuring|ft)\.?\s*/gi, 'ft ');

  // 3. Eliminar etiquetas comunes de YouTube y metadatos ruidosos
  const noisePatterns = [
    /\b(video\s*oficial|official\s*video|official\s*audio|audio\s*oficial)\b/gi,
    /\b(videoclip|video\s*clip|clip\s*oficial|official\s*music\s*video)\b/gi,
    /\b(letra|lyrics|lyric\s*video|con\s*letra|subtitulado|sub\s*español|video\s*con\s*letra)\b/gi,
    /\b(en\s*vivo|live|live\s*session|acustico|acoustic)\b/gi,
    /\b(remastered|remaster|hd|4k|hq|extended|radio\s*edit|full\s*track)\b/gi,
    /\b(original\s*mix|extended\s*mix|audio)\b/gi
  ];

  for (const pattern of noisePatterns) {
    str = str.replace(pattern, ' ');
  }

  // 4. Limpiar caracteres especiales que confunden a yt-dlp / YouTube search
  str = str.replace(/[()[\]{}"'’“”«»!¡?¿#$~|\\/^;:+=_-]/g, ' ');

  // 5. Eliminar emojis y caracteres especiales
  str = str.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, ' ');

  // 6. Colapsar espacios múltiples
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Ejecución interna de una búsqueda en yt-dlp
 */
function runSingleYtSearch(searchQuery, limit) {
  return new Promise((resolve) => {
    const searchTarget = searchQuery.startsWith('http://') || searchQuery.startsWith('https://')
      ? searchQuery
      : `ytsearch${limit * 2}:${searchQuery}`;

    const args = [
      searchTarget,
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--ignore-errors',
      '--extractor-args', 'youtube:player_client=android,web,ios',
      '--match-filter', '!is_live & !live_status'
    ];

    const child = spawn(YTDLP_BIN, args);
    let stdoutData = '';

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
      resolve([]);
    }, 20000);

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });

    child.on('close', () => {
      clearTimeout(timeout);
      if (!stdoutData) return resolve([]);

      try {
        const json = JSON.parse(stdoutData);
        const rawEntries = Array.isArray(json.entries) ? json.entries : [json];
        const validEntries = rawEntries.filter(e => {
          if (!e || (!e.id && !e.url)) return false;
          if (e.is_live || e.live_status === 'is_live' || e.live_status === 'post_live') return false;
          return true;
        });

        const results = validEntries.map((e) => {
          const videoId = e.id || e.url;
          const artist = e.uploader || e.channel || e.artist || 'WEB ARTIST';
          const title = e.title || 'Pista de Audio Web';
          const durationStr = formatSeconds(e.duration);
          const thumb = Array.isArray(e.thumbnails) && e.thumbnails.length > 0
            ? (e.thumbnails[e.thumbnails.length - 1]?.url || e.thumbnails[0]?.url || '')
            : (e.thumbnail || '');

          return {
            trackHash: `trk_yt_${videoId}`,
            videoId,
            title,
            artist,
            album: 'Toki Web Stream',
            duration: durationStr,
            format: 'M4A / WEB',
            sourceType: 'web',
            webUrl: e.webpage_url || `https://www.youtube.com/watch?v=${videoId}`,
            thumbnail: thumb
          };
        });

        resolve(results);
      } catch (err) {
        resolve([]);
      }
    });

    child.on('error', () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

/**
 * Realiza una búsqueda flexible y resiliente de pistas en la web
 * Aplica estrategia multi-nivel: Término Sanitizado -> Término Original -> Término Relajado
 */
export async function searchWebAudio(rawQuery, limit = 8) {
  if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return [];
  }

  const cleanQuery = rawQuery.trim();

  // Si es un enlace directo de YouTube, ejecutar directamente
  if (cleanQuery.startsWith('http://') || cleanQuery.startsWith('https://')) {
    return await runSingleYtSearch(cleanQuery, limit);
  }

  const sanitized = sanitizeSearchQuery(cleanQuery);
  const seenHashes = new Set();
  const aggregatedResults = [];

  const addUniqueResults = (items) => {
    for (const item of items) {
      if (!seenHashes.has(item.trackHash)) {
        seenHashes.add(item.trackHash);
        aggregatedResults.push(item);
        if (aggregatedResults.length >= limit) break;
      }
    }
  };

  // Nivel 1: Búsqueda con término sanitizado (limpio de ruido y puntuación)
  if (sanitized) {
    const tier1Results = await runSingleYtSearch(sanitized, limit);
    addUniqueResults(tier1Results);
  }

  // Nivel 2: Si no hubo resultados o fueron pocos, intentar con el término original
  if (aggregatedResults.length < limit && cleanQuery !== sanitized) {
    const tier2Results = await runSingleYtSearch(cleanQuery, limit);
    addUniqueResults(tier2Results);
  }

  // Nivel 3: Si aún no hay resultados, intentar término ultra-relajado (solo palabras clave principales)
  if (aggregatedResults.length === 0 && sanitized) {
    const relaxedWords = sanitized.split(' ').filter(w => w.length > 2 && !['ft', 'para', 'del', 'los', 'las', 'por', 'con'].includes(w.toLowerCase())).slice(0, 4);
    if (relaxedWords.length > 0) {
      const relaxedQuery = relaxedWords.join(' ');
      const tier3Results = await runSingleYtSearch(relaxedQuery, limit);
      addUniqueResults(tier3Results);
    }
  }

  return aggregatedResults.slice(0, limit);
}

/**
 * Retorna la ruta del archivo de audio si ya existe en la caché del servidor
 */
export function getTrackAudioPath(trackHash) {
  ensureCacheDir();
  const filePath = path.join(CACHE_DIR, `${trackHash}.m4a`);
  return fs.existsSync(filePath) ? filePath : null;
}

/**
 * Descarga una canción completa en el disco del servidor antes de reproducir
 */
export function downloadAudioTrack(trackHash, webUrl) {
  ensureCacheDir();
  const finalPath = path.join(CACHE_DIR, `${trackHash}.m4a`);

  // Si ya está descargada en caché, retornar ruta de inmediato
  if (fs.existsSync(finalPath)) {
    return Promise.resolve(finalPath);
  }

  // Si ya hay una descarga en progreso para este mismo trackHash, reutilizar la promesa
  if (activeDownloads.has(trackHash)) {
    return activeDownloads.get(trackHash);
  }

  const tempPath = path.join(CACHE_DIR, `${trackHash}.temp.m4a`);
  let targetUrl = webUrl;
  if (!targetUrl) {
    if (trackHash.startsWith('trk_yt_')) {
      targetUrl = `https://www.youtube.com/watch?v=${trackHash.replace(/^trk_yt_/, '')}`;
    } else {
      targetUrl = `ytsearch1:${trackHash.replace(/^trk_(yt|sp)_/, '')}`;
    }
  }

  const promise = new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '-x',
      '--audio-format', 'm4a',
      '--audio-quality', '0',
      '--ffmpeg-location', '/usr/bin/ffmpeg',
      '--extractor-args', 'youtube:player_client=android,web,ios',
      '-o', tempPath,
      '--no-warnings',
      '--no-check-certificates',
      '--no-playlist',
      '--no-live-from-start',
      targetUrl
    ];

    const child = spawn(YTDLP_BIN, args);
    let errorOutput = '';

    const downloadTimeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
      activeDownloads.delete(trackHash);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
      reject(new Error('Tiempo de descarga excedido (90s).'));
    }, 90000);

    child.stderr.on('data', (d) => {
      errorOutput += d;
    });

    child.on('close', (code) => {
      clearTimeout(downloadTimeout);
      activeDownloads.delete(trackHash);

      if (code === 0 && fs.existsSync(tempPath)) {
        try {
          fs.renameSync(tempPath, finalPath);
          resolve(finalPath);
        } catch (renameErr) {
          reject(renameErr);
        }
      } else {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (e) {}
        }
        reject(new Error(errorOutput || `Fallo al descargar audio con yt-dlp (código ${code})`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(downloadTimeout);
      activeDownloads.delete(trackHash);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
      reject(err);
    });
  });

  activeDownloads.set(trackHash, promise);
  return promise;
}

/**
 * Extrae pistas de una URL de Spotify (playlist, album, track)
 */
export async function extractSpotifyFromUrl(spotifyUrl) {
  try {
    const clean = (spotifyUrl || '').trim();
    const match = clean.match(/\/(playlist|album|track)\/([a-zA-Z0-9]+)/);
    if (!match) {
      return { playlistTitle: '', tracks: [] };
    }

    const type = match[1];
    const id = match[2];
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;

    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!res.ok) {
      return { playlistTitle: '', tracks: [] };
    }

    const html = await res.text();
    const scriptMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!scriptMatch || !scriptMatch[1]) {
      return { playlistTitle: '', tracks: [] };
    }

    const json = JSON.parse(scriptMatch[1]);
    const entity = json.props?.pageProps?.state?.data?.entity;
    if (!entity) {
      return { playlistTitle: '', tracks: [] };
    }

    const playlistTitle = entity.name || entity.title || `Spotify ${type.toUpperCase()}`;
    const rawList = Array.isArray(entity.trackList) ? entity.trackList : (entity.type === 'track' ? [entity] : []);

    let defaultThumb = '';
    if (Array.isArray(entity.visualIdentity?.image) && entity.visualIdentity.image.length > 0) {
      defaultThumb = entity.visualIdentity.image[entity.visualIdentity.image.length - 1]?.url || '';
    }

    const tracks = rawList.map((t, idx) => {
      const spId = (t.uri || t.id || '').replace(/^spotify:track:/, '') || `sp_${Date.now()}_${idx}`;
      const title = t.title || t.name || 'Pista de Spotify';
      const artist = t.subtitle || (Array.isArray(t.artists) ? t.artists.map(a => a.name).join(', ') : 'Artista Spotify');
      const durSecs = Math.floor((t.duration || t.duration_ms || 0) / 1000);
      const durationStr = formatSeconds(durSecs);
      const trackHash = `trk_sp_${spId}`;
      const cleanSearch = sanitizeSearchQuery(`${artist} ${title}`);

      return {
        trackHash,
        title,
        artist,
        album: playlistTitle,
        duration: durationStr !== '--:--' ? durationStr : '03:30',
        format: 'M4A / SPOTIFY',
        sourceType: 'web',
        webUrl: `ytsearch1:${cleanSearch}`,
        thumbnail: defaultThumb
      };
    });

    return { playlistTitle, tracks };
  } catch (err) {
    console.error('[SPOTIFY EXTRACT ERROR]', err);
    return { playlistTitle: '', tracks: [] };
  }
}

/**
 * Extrae todas las canciones de una URL de lista de reproducción de YouTube, Spotify o enlace web compatible
 */
export async function extractPlaylistFromUrl(playlistUrl) {
  if (!playlistUrl || typeof playlistUrl !== 'string') {
    return { playlistTitle: '', tracks: [] };
  }

  const cleanUrl = playlistUrl.trim();

  // Si es un enlace de Spotify (playlist, album o track)
  if (cleanUrl.includes('spotify.com')) {
    return await extractSpotifyFromUrl(cleanUrl);
  }

  // Si es YouTube u otra plataforma compatible con yt-dlp
  return new Promise((resolve) => {
    const args = [
      cleanUrl,
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--ignore-errors',
      '--extractor-args', 'youtube:player_client=android,web,ios',
      '--match-filter', '!is_live & !live_status'
    ];

    const child = spawn(YTDLP_BIN, args);
    let stdoutData = '';

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
      resolve({ playlistTitle: '', tracks: [] });
    }, 45000);

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });

    child.on('close', () => {
      clearTimeout(timeout);
      try {
        const json = JSON.parse(stdoutData);
        if (!json) return resolve({ playlistTitle: '', tracks: [] });
        const playlistTitle = json.title || 'Lista Importada de la Web';
        const rawEntries = Array.isArray(json.entries) ? json.entries : (json.id || json.url ? [json] : []);
        const validEntries = rawEntries.filter(e => {
          if (!e || (!e.id && !e.url)) return false;
          if (e.is_live || e.live_status === 'is_live' || e.live_status === 'post_live') return false;
          return true;
        });

        const tracks = validEntries.map((e) => {
          const videoId = e.id || e.url;
          const artist = e.uploader || e.channel || e.artist || 'Artista Web';
          const title = e.title || 'Pista de Audio Web';
          const durationStr = formatSeconds(e.duration);
          const thumb = Array.isArray(e.thumbnails) && e.thumbnails.length > 0
            ? (e.thumbnails[e.thumbnails.length - 1]?.url || e.thumbnails[0]?.url || '')
            : (e.thumbnail || '');

          return {
            trackHash: `trk_yt_${videoId}`,
            title,
            artist,
            album: playlistTitle,
            duration: durationStr,
            format: 'M4A / WEB',
            sourceType: 'web',
            webUrl: e.webpage_url || (e.url && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${videoId}`),
            thumbnail: thumb
          };
        });

        resolve({ playlistTitle, tracks });
      } catch (err) {
        console.error('[EXTRACT PLAYLIST ERROR]', err);
        resolve({ playlistTitle: '', tracks: [] });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[EXTRACT PLAYLIST SPAWN ERROR]', err);
      resolve({ playlistTitle: '', tracks: [] });
    });
  });
}
