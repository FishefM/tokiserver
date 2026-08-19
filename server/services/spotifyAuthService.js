import crypto from 'crypto';
import { saveUserSpotifyAccount, getUserSpotifyAccount, deleteUserSpotifyAccount } from '../db/queries.js';

// Almacenamiento temporal en memoria para validar estados OAuth anti-CSRF
const stateCache = new Map();

// Limpiar estados antiguos cada 15 minutos
setInterval(() => {
  const now = Date.now();
  for (const [state, info] of stateCache.entries()) {
    if (now - info.createdAt > 15 * 60 * 1000) {
      stateCache.delete(state);
    }
  }
}, 15 * 60 * 1000);

function getCredentials() {
  const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

function sanitizeSearchQuery(str) {
  if (!str) return '';
  return str
    .replace(/[^\p{L}\p{N}\s\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSeconds(secs) {
  if (isNaN(secs) || secs === null || secs === undefined || secs < 0) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Genera un state aleatorio seguro vinculado al usuario de TokiTube
 */
export function generateOAuthState(username) {
  const state = crypto.randomBytes(24).toString('hex');
  stateCache.set(state, {
    username: (username || 'admin').toLowerCase(),
    createdAt: Date.now()
  });
  return state;
}

/**
 * Valida un state OAuth y extrae el usuario asociado
 */
export function verifyOAuthState(state) {
  if (!state || !stateCache.has(state)) return null;
  const info = stateCache.get(state);
  stateCache.delete(state);
  return info.username;
}

/**
 * Construye la URL oficial de autorización de Spotify
 */
export function getSpotifyAuthorizeUrl(state, redirectUri) {
  const { clientId } = getCredentials();
  if (!clientId) return null;

  const scopes = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-private',
    'user-read-email'
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes,
    state: state,
    show_dialog: 'true'
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/**
 * Intercambia el código de autorización por tokens de acceso y refresco
 */
export async function exchangeCodeForTokens(code, redirectUri) {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) throw new Error('Credenciales de Spotify no configuradas.');

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    }).toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error en Spotify Token (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const expiresIn = data.expires_in || 3600;
  const expiresAt = Date.now() + (expiresIn - 60) * 1000;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt
  };
}

/**
 * Obtiene el perfil del usuario autenticado en Spotify
 */
export async function fetchSpotifyUserProfile(accessToken) {
  try {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[SPOTIFY ME ERROR] status ${res.status}: ${errText}`);
      return {
        spotifyUserId: '',
        spotifyDisplayName: 'Usuario Spotify',
        spotifyAvatar: null
      };
    }

    const data = await res.json();
    const avatar = Array.isArray(data.images) && data.images.length > 0 ? data.images[0].url : null;
    const name = data.display_name || data.id || 'Usuario Spotify';

    return {
      spotifyUserId: data.id || '',
      spotifyDisplayName: name,
      spotifyAvatar: avatar
    };
  } catch (err) {
    console.error('[SPOTIFY ME EXCEPTION]', err);
    return {
      spotifyUserId: '',
      spotifyDisplayName: 'Usuario Spotify',
      spotifyAvatar: null
    };
  }
}

/**
 * Obtiene un token válido para el usuario, renovándolo automáticamente si ha expirado
 */
export async function getValidUserSpotifyToken(username) {
  const account = await getUserSpotifyAccount(username);
  if (!account || !account.accessToken) return null;

  // Si el token aún es válido (con margen de 60 segundos), devolverlo
  if (Date.now() < account.expiresAt) {
    return account.accessToken;
  }

  // Si expiró pero tenemos refreshToken, renovarlo
  if (account.refreshToken) {
    try {
      const { clientId, clientSecret } = getCredentials();
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: account.refreshToken
        }).toString()
      });

      if (res.ok) {
        const data = await res.json();
        const expiresIn = data.expires_in || 3600;
        const newExpiresAt = Date.now() + (expiresIn - 60) * 1000;
        const newAccessToken = data.access_token;
        const newRefreshToken = data.refresh_token || account.refreshToken;

        await saveUserSpotifyAccount(username, {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresAt: newExpiresAt,
          spotifyUserId: account.spotifyUserId,
          spotifyDisplayName: account.spotifyDisplayName,
          spotifyAvatar: account.spotifyAvatar
        });

        console.log(`[SPOTIFY REFRESH] Token renovado exitosamente para el usuario "${username}"`);
        return newAccessToken;
      } else {
        console.warn(`[SPOTIFY REFRESH ERROR] Fallo al renovar token (${res.status}).`);
      }
    } catch (err) {
      console.error('[SPOTIFY REFRESH EXCEPTION]', err);
    }
  }

  return null;
}

/**
 * Obtiene todas las playlists del usuario autenticado en Spotify
 */
export async function fetchUserSpotifyPlaylists(username) {
  const token = await getValidUserSpotifyToken(username);
  if (!token) {
    return { success: false, connected: false, playlists: [] };
  }

  try {
    const playlists = [];
    let nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50&offset=0';

    while (nextUrl) {
      const res = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) break;
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];

      for (const p of items) {
        if (!p || !p.id) continue;
        const cover = Array.isArray(p.images) && p.images.length > 0 ? p.images[0].url : '';
        playlists.push({
          id: p.id,
          name: p.name || 'Lista sin nombre',
          description: p.description || '',
          tracksCount: p.tracks?.total || 0,
          coverUrl: cover,
          owner: p.owner?.display_name || 'Spotify User',
          spotifyUrl: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`
        });
      }

      nextUrl = data.next || null;
    }

    return {
      success: true,
      connected: true,
      playlists
    };
  } catch (err) {
    console.error('[SPOTIFY USER PLAYLISTS ERROR]', err);
    return { success: false, connected: true, error: err.message, playlists: [] };
  }
}

/**
 * Extrae todas las canciones de una playlist o álbum usando el token OAuth del usuario (sin límite de 100)
 */
export async function extractSpotifyWithUserToken(type, id, username) {
  const token = await getValidUserSpotifyToken(username);
  if (!token) return null;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  };

  if (type === 'track') {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, { headers });
    if (!res.ok) return null;
    const t = await res.json();
    const title = t.name || 'Pista de Spotify';
    const artist = Array.isArray(t.artists) ? t.artists.map(a => a.name).join(', ') : 'Artista Spotify';
    const durSecs = Math.floor((t.duration_ms || 0) / 1000);
    const durationStr = formatSeconds(durSecs);
    const thumb = Array.isArray(t.album?.images) && t.album.images.length > 0 ? t.album.images[0].url : '';
    const cleanSearch = sanitizeSearchQuery(`${artist} ${title}`);

    return {
      playlistTitle: title,
      tracks: [{
        trackHash: `trk_sp_${t.id || id}`,
        title,
        artist,
        album: t.album?.name || 'Sencillo',
        duration: durationStr !== '--:--' ? durationStr : '03:30',
        format: 'M4A / SPOTIFY',
        sourceType: 'web',
        webUrl: `ytsearch1:${cleanSearch}`,
        thumbnail: thumb
      }]
    };
  }

  if (type === 'album') {
    const albumRes = await fetch(`https://api.spotify.com/v1/albums/${id}`, { headers });
    if (!albumRes.ok) return null;
    const albumData = await albumRes.json();
    const playlistTitle = albumData.name || 'Álbum de Spotify';
    const defaultThumb = Array.isArray(albumData.images) && albumData.images.length > 0 ? albumData.images[0].url : '';

    let nextUrl = `https://api.spotify.com/v1/albums/${id}/tracks?limit=50&offset=0`;
    const tracks = [];

    while (nextUrl) {
      const pageRes = await fetch(nextUrl, { headers });
      if (!pageRes.ok) break;
      const pageData = await pageRes.json();
      const items = Array.isArray(pageData.items) ? pageData.items : [];

      for (const t of items) {
        if (!t || !t.id) continue;
        const title = t.name || 'Pista de Spotify';
        const artist = Array.isArray(t.artists) ? t.artists.map(a => a.name).join(', ') : 'Artista Spotify';
        const durSecs = Math.floor((t.duration_ms || 0) / 1000);
        const durationStr = formatSeconds(durSecs);
        const cleanSearch = sanitizeSearchQuery(`${artist} ${title}`);

        tracks.push({
          trackHash: `trk_sp_${t.id}`,
          title,
          artist,
          album: playlistTitle,
          duration: durationStr !== '--:--' ? durationStr : '03:30',
          format: 'M4A / SPOTIFY',
          sourceType: 'web',
          webUrl: `ytsearch1:${cleanSearch}`,
          thumbnail: defaultThumb
        });
      }

      nextUrl = pageData.next || null;
    }

    return { playlistTitle, tracks };
  }

  if (type === 'playlist') {
    const playlistRes = await fetch(`https://api.spotify.com/v1/playlists/${id}`, { headers });
    if (!playlistRes.ok) return null;
    const playlistData = await playlistRes.json();
    const playlistTitle = playlistData.name || 'Lista de Spotify';
    const defaultThumb = Array.isArray(playlistData.images) && playlistData.images.length > 0 ? playlistData.images[0].url : '';

    const tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=50&offset=0`;

    while (nextUrl) {
      const pageRes = await fetch(nextUrl, { headers });
      if (!pageRes.ok) break;
      const pageData = await pageRes.json();
      const items = Array.isArray(pageData.items) ? pageData.items : [];

      for (const item of items) {
        const t = item?.track;
        if (!t || !t.id) continue;
        const title = t.name || 'Pista de Spotify';
        const artist = Array.isArray(t.artists) ? t.artists.map(a => a.name).join(', ') : 'Artista Spotify';
        const durSecs = Math.floor((t.duration_ms || 0) / 1000);
        const durationStr = formatSeconds(durSecs);
        const thumb = Array.isArray(t.album?.images) && t.album.images.length > 0
          ? t.album.images[0].url
          : defaultThumb;
        const cleanSearch = sanitizeSearchQuery(`${artist} ${title}`);

        tracks.push({
          trackHash: `trk_sp_${t.id}`,
          title,
          artist,
          album: t.album?.name || playlistTitle,
          duration: durationStr !== '--:--' ? durationStr : '03:30',
          format: 'M4A / SPOTIFY',
          sourceType: 'web',
          webUrl: `ytsearch1:${cleanSearch}`,
          thumbnail: thumb
        });
      }

      nextUrl = pageData.next || null;
    }

    return { playlistTitle, tracks };
  }

  return null;
}
