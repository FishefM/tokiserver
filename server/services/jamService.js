import { exec } from 'child_process';
import crypto from 'crypto';
import util from 'util';
import { getDb } from '../db.js';
import { PORT } from '../config/constants.js';

const execAsync = util.promisify(exec);

// Almacén en memoria de sesiones JAM activas
const activeJams = new Map();

/**
 * Obtiene el nombre de dominio DNS de Tailscale de esta máquina si está disponible.
 */
export async function getTailscaleDnsName() {
  try {
    const { stdout } = await execAsync('tailscale status --json');
    const data = JSON.parse(stdout);
    if (data.Self && data.Self.DNSName) {
      const dns = data.Self.DNSName.replace(/\.$/, '');
      return dns;
    }
  } catch (err) {
    // Tailscale no disponible
  }
  return null;
}

/**
 * Activa dinámicamente Tailscale Funnel en el puerto 8443 cuando se crea una Jam General.
 */
export async function enableTailscaleFunnel() {
  try {
    console.log('[TAILSCALE FUNNEL] Activando Funnel en puerto 8443 para Jam General...');
    await execAsync('tailscale funnel --bg --https=8443 on').catch(() => 
      execAsync(`tailscale funnel --bg --https=8443 ${PORT}`)
    );
    console.log('[TAILSCALE FUNNEL] Funnel activado exitosamente en puerto 8443.');
    return true;
  } catch (err) {
    console.warn('[TAILSCALE FUNNEL WARN] No se pudo activar Funnel automáticamente:', err.message);
    return false;
  }
}

/**
 * Apaga Tailscale Funnel en el puerto 8443 si no quedan Jams Generales activas en el servidor.
 */
export async function disableTailscaleFunnelIfNoActive() {
  try {
    let hasActiveGeneralJam = false;
    for (const jam of activeJams.values()) {
      if (jam.type === 'general' && jam.status === 'active') {
        hasActiveGeneralJam = true;
        break;
      }
    }

    if (!hasActiveGeneralJam) {
      console.log('[TAILSCALE FUNNEL] Apagando Funnel en puerto 8443 (cero Jams Generales activas)...');
      await execAsync('tailscale funnel --https=8443 off').catch(() => {});
      console.log('[TAILSCALE FUNNEL] Funnel apagado correctamente.');
    }
  } catch (err) {
    console.warn('[TAILSCALE FUNNEL OFF WARN]', err.message);
  }
}

// Asegurar que el Funnel esté apagado al arrancar hasta que alguien inicie una Jam General
disableTailscaleFunnelIfNoActive().catch(() => {});

/**
 * Obtiene la URL pública de Tailscale de forma segura.
 * Detecta automáticamente si Funnel está activo en el puerto estándar o en :8443 / :10000.
 */
export async function getTailscalePublicUrl() {
  try {
    try {
      const { stdout } = await execAsync('tailscale serve status --json');
      const data = JSON.parse(stdout);
      if (data.AllowFunnel) {
        for (const hostAndPort of Object.keys(data.AllowFunnel)) {
          if (data.AllowFunnel[hostAndPort]) {
            return `https://${hostAndPort}`;
          }
        }
      }
      if (data.Web) {
        for (const hostAndPort of Object.keys(data.Web)) {
          return `https://${hostAndPort}`;
        }
      }
    } catch (e) {}

    const tsDomain = await getTailscaleDnsName();
    if (tsDomain) {
      return `https://${tsDomain}:8443`;
    }
  } catch (err) {}
  return null;
}

/**
 * Inicia una nueva sesión JAM (TokiJAM o Jam General).
 * @param {string} hostUsername - Nombre del usuario anfitrión.
 * @param {'tokijam'|'general'} type - Tipo de Jam.
 * @param {string} baseUrl - URL base de la solicitud HTTP actual.
 */
export async function startJamSession(hostUsername, type = 'tokijam', baseUrl = '') {
  const normalizedUser = (hostUsername || 'admin').toLowerCase();
  console.log(`[JAM START] Usuario @${normalizedUser} iniciando sesion de tipo: ${type.toUpperCase()} | BaseUrl: ${baseUrl}`);
  
  if (type === 'tokijam') {
    // Solo puede existir UNA TokiJAM activa a la vez en todo el servidor
    for (const [existingId, jam] of activeJams.entries()) {
      if (jam.type === 'tokijam' && jam.status === 'active' && jam.hostUsername.toLowerCase() !== normalizedUser) {
        throw new Error(`Ya existe una TokiJAM activa creada por @${jam.hostUsername}. Solo puedes unirte a su sesión.`);
      }
    }
  }

  // Cerrar cualquier Jam previa del mismo usuario
  for (const [existingId, jam] of activeJams.entries()) {
    if (jam.hostUsername.toLowerCase() === normalizedUser) {
      await stopJamSession(existingId, normalizedUser);
    }
  }

  const randomSuffix = crypto.randomBytes(3).toString('hex');
  const roomId = `jam_${normalizedUser}_${randomSuffix}`;
  const createdAt = new Date().toISOString();

  let shareUrl = '';
  let funnelUrl = null;

  if (type === 'general') {
    // Activar Funnel bajo demanda para acceso público
    await enableTailscaleFunnel();

    const tsHttps = await getTailscalePublicUrl();
    if (tsHttps) {
      funnelUrl = `${tsHttps}/tokitube/jam.html?room=${roomId}`;
      shareUrl = funnelUrl;
      console.log(`[JAM GENERAL] Enlace publico de Tailscale asignado: ${shareUrl}`);
    } else {
      shareUrl = `${baseUrl}/tokitube/jam.html?room=${roomId}`;
      console.log(`[JAM GENERAL] Enlace base asignado: ${shareUrl}`);
    }
  } else {
    // TokiJAM para usuarios autenticados
    shareUrl = `${baseUrl}/tokitube/jam.html?room=${roomId}`;
    console.log(`[TOKIJAM] Enlace interno generado: ${shareUrl}`);
  }

  const newJam = {
    roomId,
    type,
    hostUsername,
    status: 'active',
    funnelUrl,
    shareUrl,
    currentPlaying: null,
    queueSnapshot: [],
    subscribers: new Set(),
    lastActivityTimestamp: Date.now(),
    createdAt
  };

  activeJams.set(roomId, newJam);

  // Registrar en SQLite
  try {
    const db = getDb();
    db.run(
      `INSERT OR REPLACE INTO dorocoro_jams (roomId, type, hostUsername, status, funnelUrl, createdAt)
       VALUES (?, ?, ?, 'active', ?, ?)`,
      [roomId, type, hostUsername, funnelUrl, createdAt]
    );
  } catch (err) {
    console.warn('[DB JAM INSERT WARN]', err.message);
  }

  return {
    success: true,
    roomId,
    type,
    hostUsername,
    shareUrl,
    funnelUrl,
    createdAt
  };
}

// Tiempo límite de inactividad: 10 minutos sin reproducción (600,000 ms)
const JAM_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

// Timer en segundo plano para verificar periódicamente salas inactivas
setInterval(async () => {
  const now = Date.now();
  for (const [roomId, jam] of activeJams.entries()) {
    if (jam.status !== 'active') continue;

    // Si la sala está reproduciendo música activamente, actualizar timestamp y mantener viva
    const isPlaying = jam.currentPlaying && jam.currentPlaying.isPlaying;
    if (isPlaying) {
      jam.lastActivityTimestamp = now;
      continue;
    }

    // Si han pasado más de 10 minutos sin reproducción ni actividad
    const idleTime = now - (jam.lastActivityTimestamp || now);
    if (idleTime >= JAM_INACTIVITY_TIMEOUT_MS) {
      console.log(`[JAM INACTIVIDAD] Sala ${roomId} (@${jam.hostUsername}) cerrada automaticamente tras 10 minutos sin reproduccion.`);
      await stopJamSession(roomId, 'sistema_inactividad');
    }
  }
}, 30000);

/**
 * Detiene una sesión JAM activa y notifica a todos los clientes conectados.
 */
export async function stopJamSession(roomId, requestedBy) {
  const jam = activeJams.get(roomId);
  if (!jam) return false;

  const isTimeout = requestedBy === 'sistema_inactividad';
  const closeMessage = isTimeout
    ? 'La sesión JAM se ha cerrado automáticamente por 10 minutos de inactividad (sin reproducción).'
    : 'La sesión JAM ha sido finalizada por el anfitrión.';

  // Notificar cierre a todos los oyentes/invitados
  broadcastToJam(roomId, 'jam_closed', {
    roomId,
    reason: isTimeout ? 'inactivity_timeout' : 'host_stopped',
    message: closeMessage
  });

  // Cerrar todas las conexiones SSE activas
  jam.subscribers.forEach(res => {
    try {
      res.end();
    } catch (e) {}
  });
  jam.subscribers.clear();

  jam.status = 'closed';
  jam.closedAt = new Date().toISOString();
  activeJams.delete(roomId);

  // Si se cerró una Jam General, apagar Funnel automáticamente si no hay más salas públicas
  if (jam.type === 'general') {
    await disableTailscaleFunnelIfNoActive();
  }

  // Actualizar SQLite
  try {
    const db = getDb();
    db.run(
      `UPDATE dorocoro_jams SET status = 'closed', closedAt = ? WHERE roomId = ?`,
      [jam.closedAt, roomId]
    );
  } catch (err) {
    console.warn('[DB JAM CLOSE WARN]', err.message);
  }

  return true;
}

/**
 * Obtiene información pública de una sala JAM para clientes e invitados.
 */
export function getJamInfo(roomId) {
  const jam = activeJams.get(roomId);
  if (!jam || jam.status !== 'active') return null;

  return {
    roomId: jam.roomId,
    type: jam.type,
    hostUsername: jam.hostUsername,
    status: jam.status,
    shareUrl: jam.shareUrl,
    activeListeners: Math.max(1, jam.subscribers.size),
    currentPlaying: jam.currentPlaying,
    queueCount: jam.queueSnapshot.length,
    queueSnapshot: jam.queueSnapshot.slice(0, 20),
    createdAt: jam.createdAt
  };
}

/**
 * Lista todas las TokiJAMs activas en el servidor.
 */
export function getActiveTokiJams() {
  const list = [];
  for (const jam of activeJams.values()) {
    if (jam.status === 'active') {
      list.push({
        roomId: jam.roomId,
        type: jam.type,
        hostUsername: jam.hostUsername,
        activeListeners: Math.max(1, jam.subscribers.size),
        currentPlaying: jam.currentPlaying,
        createdAt: jam.createdAt
      });
    }
  }
  return list;
}

/**
 * Obtiene la sesión activa que un usuario específico está hosteando.
 */
export function getJamSessionByHost(username) {
  const normUser = (username || '').toLowerCase();
  for (const jam of activeJams.values()) {
    if (jam.status === 'active' && jam.hostUsername.toLowerCase() === normUser) {
      return {
        roomId: jam.roomId,
        type: jam.type,
        hostUsername: jam.hostUsername,
        status: jam.status,
        shareUrl: jam.shareUrl,
        funnelUrl: jam.funnelUrl,
        activeListeners: Math.max(1, jam.subscribers.size),
        currentPlaying: jam.currentPlaying,
        queueCount: jam.queueSnapshot.length,
        createdAt: jam.createdAt
      };
    }
  }
  return null;
}

/**
 * Envía un mensaje / evento en tiempo real a todos los clientes suscritos a la sala.
 */
export function broadcastToJam(roomId, eventName, payload) {
  const jam = activeJams.get(roomId);
  if (!jam || !jam.subscribers) return;

  const dataStr = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  jam.subscribers.forEach(res => {
    try {
      res.write(dataStr);
    } catch (err) {
      jam.subscribers.delete(res);
    }
  });
}

/**
 * Registra un cliente en el flujo de Server-Sent Events (SSE) de una sala.
 */
export function subscribeToJamEvents(roomId, req, res) {
  const jam = activeJams.get(roomId);
  if (!jam || jam.status !== 'active') {
    res.status(404).json({ error: 'La sesión JAM no existe o ha finalizado.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  jam.subscribers.add(res);

  // Enviar estado inicial
  const initPayload = {
    type: 'init',
    jamInfo: getJamInfo(roomId)
  };
  res.write(`event: jam_init\ndata: ${JSON.stringify(initPayload)}\n\n`);

  // Notificar al anfitrión y demás oyentes del cambio de oyentes
  broadcastToJam(roomId, 'listeners_updated', {
    activeListeners: jam.subscribers.size
  });

  // Keep-alive ping cada 20 segundos
  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      clearInterval(pingInterval);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(pingInterval);
    jam.subscribers.delete(res);
    if (jam.status === 'active') {
      broadcastToJam(roomId, 'listeners_updated', {
        activeListeners: Math.max(1, jam.subscribers.size)
      });
    }
  });
}

/**
 * Agrega una canción a la cola de la sala JAM.
 */
export function addTrackToJam(roomId, rawTrack, senderName = 'Invitado', position = 'end') {
  const jam = activeJams.get(roomId);
  if (!jam || jam.status !== 'active') {
    throw new Error('La sesión JAM no está activa.');
  }

  if (!rawTrack || !rawTrack.title) {
    throw new Error('Información de canción incompleta o inválida.');
  }

  // Las canciones locales puras no se pueden agregar a una JAM remota
  if (rawTrack.sourceType === 'local' && (!rawTrack.webUrl || rawTrack.webUrl.startsWith('blob:'))) {
    throw new Error('No se pueden agregar pistas locales del dispositivo a una sesión compartida.');
  }

  const cleanTitle = (rawTrack.title || 'Canción Web').trim();
  const cleanArtist = (rawTrack.artist || 'Artista Web').trim();
  const trackHash = rawTrack.trackHash || ('trk_jam_' + crypto.randomBytes(6).toString('hex'));

  const queueTrack = {
    trackHash,
    title: cleanTitle,
    artist: cleanArtist,
    duration: rawTrack.duration || '--:--',
    format: rawTrack.format || 'M4A / WEB',
    sourceType: rawTrack.sourceType || 'web',
    webUrl: rawTrack.webUrl || '',
    thumbnail: rawTrack.thumbnail || '',
    addedBy: senderName || 'Invitado',
    position: position === 'next' ? 'next' : 'end',
    addedAt: new Date().toISOString()
  };

  // Guardar en el historial de la sala
  if (position === 'next') {
    jam.queueSnapshot.unshift(queueTrack);
  } else {
    jam.queueSnapshot.push(queueTrack);
  }
  if (jam.queueSnapshot.length > 50) {
    jam.queueSnapshot.pop();
  }

  jam.lastActivityTimestamp = Date.now();

  // Notificar al anfitrión y a todos los invitados vía SSE
  broadcastToJam(roomId, 'track_added', {
    track: queueTrack,
    senderName,
    position: queueTrack.position,
    queueCount: jam.queueSnapshot.length
  });

  return queueTrack;
}

/**
 * Actualiza la pista que está sonando actualmente en la Jam (enviado por el Anfitrión).
 */
export function updateJamPlayingTrack(roomId, playingTrack) {
  const jam = activeJams.get(roomId);
  if (!jam || jam.status !== 'active') return;

  jam.lastActivityTimestamp = Date.now();

  jam.currentPlaying = playingTrack ? {
    hash: playingTrack.hash || playingTrack.trackHash || '',
    title: playingTrack.title || 'Pista sin título',
    artist: playingTrack.artist || 'Artista Desconocido',
    duration: playingTrack.duration || '--:--',
    durationSec: typeof playingTrack.durationSec === 'number' ? playingTrack.durationSec : 0,
    thumbnail: playingTrack.thumbnail || '',
    url: playingTrack.url || '',
    format: playingTrack.format || 'WEB',
    sourceType: playingTrack.sourceType || 'web',
    isPlaying: playingTrack.isPlaying !== false,
    currentTime: typeof playingTrack.currentTime === 'number' ? playingTrack.currentTime : 0,
    updatedAt: Date.now()
  } : null;

  broadcastToJam(roomId, 'track_changed', {
    currentPlaying: jam.currentPlaying
  });
}
