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
    console.log('[TAILSCALE DIAGNOSTIC] Consultando estado de Tailscale: tailscale status --json');
    const { stdout } = await execAsync('tailscale status --json');
    const data = JSON.parse(stdout);
    if (data.Self && data.Self.DNSName) {
      const dns = data.Self.DNSName.replace(/\.$/, '');
      const ips = data.Self.TailscaleIPs ? data.Self.TailscaleIPs.join(', ') : 'N/A';
      console.log(`[TAILSCALE DIAGNOSTIC] Nodo: ${data.Self.HostName || 'Self'} | DNS: ${dns} | IP: ${ips}`);
      return dns;
    } else {
      console.warn('[TAILSCALE DIAGNOSTIC] Nodo Tailscale encontrado pero sin DNSName (MagicDNS podría estar apagado).');
    }
  } catch (err) {
    console.warn(`[TAILSCALE DIAGNOSTIC] Tailscale CLI no disponible: ${err.message}`);
  }
  return null;
}

/**
 * Asegura que Tailscale Funnel esté habilitado en segundo plano para el puerto del servidor.
 */
export async function ensureTailscaleFunnel() {
  console.log(`\n==================================================`);
  console.log(`[JAM PUBLICA] Iniciando diagnostico de Tailscale Funnel para puerto ${PORT}...`);
  try {
    const tsDomain = await getTailscaleDnsName();
    if (!tsDomain) {
      console.warn('[JAM PUBLICA DIAGNOSTICO] No se detectó dominio MagicDNS de Tailscale.');
      console.log(`==================================================\n`);
      return null;
    }

    console.log(`[JAM PUBLICA] Ejecutando comando: tailscale funnel --bg ${PORT}`);
    const { stdout, stderr } = await execAsync(`tailscale funnel --bg ${PORT}`);
    if (stdout && stdout.trim()) {
      console.log(`[JAM PUBLICA STDOUT] ${stdout.trim()}`);
    }
    if (stderr && stderr.trim()) {
      console.log(`[JAM PUBLICA STDERR] ${stderr.trim()}`);
    }

    const funnelHttps = `https://${tsDomain}`;
    console.log(`[JAM PUBLICA OK] Funnel configurado exitosamente: ${funnelHttps}`);
    console.log(`==================================================\n`);
    return funnelHttps;
  } catch (err) {
    console.error(`[JAM PUBLICA ERROR] Fallo al ejecutar tailscale funnel: ${err.message}`);
    if (err.stderr) {
      console.error(`[JAM PUBLICA STDERR] ${err.stderr.trim()}`);
    }
    console.log(`[JAM PUBLICA CONSEJO] Si el error indica permisos, ejecuta 'sudo tailscale set --operator=$USER' y revisa las ACLs de Tailscale.`);
    console.log(`==================================================\n`);
    return null;
  }
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
    const isPublicHttps = baseUrl.startsWith('https://') && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');
    if (isPublicHttps) {
      console.log(`[JAM GENERAL] Servidor ya alojado bajo HTTPS publico (${baseUrl}). Usando dominio directo.`);
      shareUrl = `${baseUrl}/tokitube/jam.html?room=${roomId}`;
    } else {
      console.log(`[JAM GENERAL] Entorno local/HTTP detectado. Activando Tailscale Funnel...`);
      const tsHttps = await ensureTailscaleFunnel();
      if (tsHttps) {
        funnelUrl = `${tsHttps}/tokitube/jam.html?room=${roomId}`;
        shareUrl = funnelUrl;
        console.log(`[JAM GENERAL] Enlace Funnel generado: ${shareUrl}`);
      } else {
        shareUrl = `${baseUrl}/tokitube/jam.html?room=${roomId}`;
        console.warn(`[JAM GENERAL AVISO] Funnel no disponible. Enlace alternativo: ${shareUrl}`);
      }
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

/**
 * Detiene una sesión JAM activa y notifica a todos los clientes conectados.
 */
export async function stopJamSession(roomId, requestedBy) {
  const jam = activeJams.get(roomId);
  if (!jam) return false;

  // Notificar cierre a todos los oyentes/invitados
  broadcastToJam(roomId, 'jam_closed', {
    roomId,
    message: 'La sesión JAM ha sido finalizada por el anfitrión.'
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

  jam.currentPlaying = playingTrack ? {
    title: playingTrack.title,
    artist: playingTrack.artist,
    duration: playingTrack.duration || '--:--',
    thumbnail: playingTrack.thumbnail || '',
    format: playingTrack.format || 'WEB',
    sourceType: playingTrack.sourceType || 'web',
    updatedAt: new Date().toISOString()
  } : null;

  broadcastToJam(roomId, 'track_changed', {
    currentPlaying: jam.currentPlaying
  });
}
