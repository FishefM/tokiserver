import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginUser, verifySession, logoutUser, changePassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '.data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');

// Crear el directorio dedicado /server/.data/logs si no existe
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Obtener la ruta del archivo de log del día actual (Formato: audit-YYYY-MM-DD.log)
function getTodayLogPath() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `audit-${year}-${month}-${day}.log`);
}

// Función auxiliar para registrar acciones en el archivo del día (sin sobrescribir nada)
function logAudit(ip, command, success, detail = '', username = 'ANONIMO') {
  const logFile = getTodayLogPath();
  const timestamp = new Date().toLocaleString('es-MX', { timeZoneName: 'short' });
  const statusStr = success ? 'EXITO' : 'FALLO';
  const entry = `[${timestamp}] [IP: ${ip}] [USUARIO: ${username}] -> COMANDO: "${command}" | RESULTADO: ${statusStr} ${detail ? '| ' + detail : ''}\n`;

  fs.appendFile(logFile, entry, (err) => {
    if (err) console.error('[ERROR AUDITORIA] No se pudo escribir en el archivo de logs:', err);
  });
}

const execPromise = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;
const MC_CONTAINER = 'mc_forge_server';

// Confiar en cabeceras de proxy como X-Forwarded-For si se usa Nginx
app.set('trust proxy', true);

app.use(cors());
app.use(express.json());

// Función auxiliar para extraer y limpiar la dirección IP del cliente
function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || req.ip;
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  if (ip === '::1') {
    ip = '127.0.0.1 (Localhost)';
  }
  return ip || 'IP Desconocida';
}

// Middleware de autenticación para requerir sesión válida en rutas protegidas
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.slice(7)
    : req.headers['x-auth-token'];

  const session = verifySession(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'NO_AUTORIZADO: Debes iniciar sesión en la pestaña de admin.',
      sessionExpired: true
    });
  }

  req.user = session.username;
  req.token = token;
  next();
}

// Función auxiliar para verificar el estado de Docker para Minecraft
async function getMinecraftStatus() {
  try {
    const { stdout } = await execPromise(`docker inspect -f '{{.State.Running}}' ${MC_CONTAINER}`);
    const isRunning = stdout.trim() === 'true';
    return { exists: true, running: isRunning, container: MC_CONTAINER };
  } catch (err) {
    return { exists: false, running: false, container: MC_CONTAINER, error: 'Contenedor no encontrado o Docker detenido' };
  }
}

// Función auxiliar para verificar el estado de systemctl para Core Keeper
async function getCorekeeperStatus() {
  const serviceName = 'corekeeper-server.service';
  try {
    let statusText = '';
    try {
      const { stdout } = await execPromise(`systemctl is-active ${serviceName}`);
      statusText = (stdout || '').trim();
    } catch (err) {
      statusText = (err.stdout || '').trim();
    }

    if (statusText === 'active') {
      return { exists: true, running: true, service: serviceName };
    } else if (['inactive', 'failed', 'deactivating', 'activating', 'reloading'].includes(statusText)) {
      return { exists: true, running: false, service: serviceName };
    } else {
      return { exists: false, running: false, service: serviceName, error: statusText || 'Servicio no encontrado' };
    }
  } catch (err) {
    return { exists: false, running: false, service: serviceName, error: err.message };
  }
}

// Middleware de registro global de peticiones (Logging en consola)
app.use((req, res, next) => {
  const clientIp = getClientIp(req);
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] HTTP ${req.method} ${req.url} desde IP: ${clientIp}`);
  next();
});

// --- ENDPOINTS DE AUTENTICACIÓN ---

// Endpoint de inicio de sesión
app.post('/api/login', (req, res) => {
  const clientIp = getClientIp(req);
  const { username, password } = req.body;
  const result = loginUser(username, password);

  if (result.success) {
    console.log(`[AUDIT LOGIN] Inicio de sesión exitoso: ${result.username} desde IP: ${clientIp}`);
    logAudit(clientIp, 'LOGIN', true, 'Inicio de sesión exitoso', result.username);
    return res.json(result);
  } else {
    console.warn(`[AUDIT LOGIN FALLO] Intento fallido para usuario "${username}" desde IP: ${clientIp}`);
    logAudit(clientIp, 'LOGIN_FAILED', false, result.error, username || 'DESCONOCIDO');
    return res.status(401).json(result);
  }
});

// Endpoint para cerrar sesión
app.post('/api/logout', requireAuth, (req, res) => {
  const clientIp = getClientIp(req);
  logoutUser(req.token);
  logAudit(clientIp, 'LOGOUT', true, 'Cierre de sesión', req.user);
  res.json({ success: true, message: 'Sesión cerrada correctamente' });
});

// Endpoint para verificar sesión activa
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    username: req.user
  });
});

// Endpoint para cambiar contraseña
app.post('/api/change-password', requireAuth, (req, res) => {
  const clientIp = getClientIp(req);
  const { currentPassword, newPassword } = req.body;
  const result = changePassword(req.user, currentPassword, newPassword);

  if (result.success) {
    console.log(`[AUDIT PASSWORD_CHANGE] ${req.user} cambió su contraseña desde IP: ${clientIp}`);
    logAudit(clientIp, 'CHANGE_PASSWORD', true, 'Contraseña actualizada', req.user);
    return res.json(result);
  } else {
    console.warn(`[AUDIT PASSWORD_CHANGE FALLO] ${req.user} falló al cambiar contraseña desde IP: ${clientIp}`);
    logAudit(clientIp, 'CHANGE_PASSWORD_FAILED', false, result.error, req.user);
    return res.status(400).json(result);
  }
});

// Mapa seguro de comandos permitidos (Command Whitelist)
const COMMAND_MAP = {
  MINECRAFT_TOGGLE: {
    label: 'MINECRAFT_TOGGLE',
    dynamic: true
  },
  MINECRAFT_START: {
    label: 'MINECRAFT_START',
    cmd: `docker start ${MC_CONTAINER}`
  },
  MINECRAFT_STOP: {
    label: 'MINECRAFT_STOP',
    cmd: `docker stop ${MC_CONTAINER}`
  },
  COREKEEPER_TOGGLE: {
    label: 'COREKEEPER_TOGGLE',
    dynamic: true
  },
  COREKEEPER_START: {
    label: 'COREKEEPER_START',
    cmd: 'sudo systemctl start corekeeper-server.service'
  },
  COREKEEPER_STOP: {
    label: 'COREKEEPER_STOP',
    cmd: 'sudo systemctl stop corekeeper-server.service'
  },
  PURGE_CACHE: {
    label: 'PURGE_CACHE',
    cmd: 'echo "[CACHE] Ejecutando sincronización de buffers (sync)..." && sync && echo "[CACHE] Sincronización completada con éxito."'
  },
  SYS_DIAGNOSTICS: {
    label: 'SYS_DIAGNOSTICS',
    cmd: 'echo "=== INFORMACION DEL SISTEMA ===" && uname -sr && uptime && echo "\n=== MEMORIA RAM ===" && free -h && echo "\n=== ALMACENAMIENTO DE DISCO ===" && df -h /'
  },
  VIEW_LOGS: {
    label: 'HISTORIAL_DE_AUDITORIA_DIARIA',
    cmd: `echo "=== HISTORIAL DE AUDITORIA DE COMANDOS EN SECCION /server/logs ===" && (tail -n 35 "${LOGS_DIR}"/audit-*.log 2>/dev/null || echo "[AUDIT LOG] No se han registrado comandos ejecutados el día de hoy.")`
  },
  LOCK_SESSION: {
    label: 'LOCK_SESSION',
    cmd: 'echo "[SECURITY] Sesión de administración bloqueada a las $(date +\'%T\')."'
  }
};

// Endpoint API para recibir comandos del panel administrativo (Protegido con requireAuth)
app.post('/api/command', requireAuth, async (req, res) => {
  const clientIp = getClientIp(req);
  const { command } = req.body;
  const timestamp = new Date().toLocaleTimeString();
  const currentUser = req.user;

  console.log(`\n--------------------------------------------------`);
  console.log(`[AUDIT LOG] Hora: ${timestamp} | IP Solicitante: ${clientIp} | Usuario: ${currentUser}`);
  console.log(`[AUDIT LOG] Comando Solicitado: "${command}"`);

  if (!command || !COMMAND_MAP[command]) {
    console.warn(`[AUDIT ALERTA] Usuario ${currentUser} (IP ${clientIp}) intentó ejecutar comando no permitido: "${command}"`);
    console.log(`--------------------------------------------------\n`);
    logAudit(clientIp, command || 'DESCONOCIDO', false, 'Comando no permitido', currentUser);

    return res.status(400).json({
      success: false,
      clientIp,
      error: `Comando no reconocido o no permitido: ${command}`,
      timestamp
    });
  }

  // Manejo especial para conmutar (toggle) el servidor de Minecraft
  if (command === 'MINECRAFT_TOGGLE') {
    const currentStatus = await getMinecraftStatus();
    const shouldStop = currentStatus.running;
    const dockerCmd = shouldStop ? `docker stop ${MC_CONTAINER}` : `docker start ${MC_CONTAINER}`;
    const actionLabel = shouldStop ? `DETENER MINECRAFT (${MC_CONTAINER})` : `INICIAR MINECRAFT (${MC_CONTAINER})`;

    try {
      const { stdout, stderr } = await execPromise(dockerCmd, { timeout: 30000 });
      const newStatus = await getMinecraftStatus();
      const ckStatus = await getCorekeeperStatus();

      console.log(`[AUDIT DOCKER] ${actionLabel} completado por usuario: ${currentUser} (IP: ${clientIp})`);
      console.log(`--------------------------------------------------\n`);
      logAudit(clientIp, command, true, actionLabel, currentUser);

      return res.json({
        success: true,
        command,
        label: actionLabel,
        clientIp,
        user: currentUser,
        minecraft: newStatus,
        corekeeper: ckStatus,
        stdout: stdout.trim() || `Comando ejecutado: ${dockerCmd}`,
        stderr: stderr.trim(),
        timestamp
      });
    } catch (err) {
      const newStatus = await getMinecraftStatus();
      const ckStatus = await getCorekeeperStatus();
      console.error(`[AUDIT DOCKER ERROR] Fallo en ${dockerCmd} por usuario: ${currentUser} (IP: ${clientIp})`, err.message);
      console.log(`--------------------------------------------------\n`);
      logAudit(clientIp, command, false, `Error: ${err.message}`, currentUser);

      return res.status(500).json({
        success: false,
        command,
        clientIp,
        user: currentUser,
        minecraft: newStatus,
        corekeeper: ckStatus,
        error: `Fallo al gestionar contenedor (${MC_CONTAINER}): ${err.message}`,
        stdout: err.stdout ? err.stdout.trim() : '',
        stderr: err.stderr ? err.stderr.trim() : '',
        timestamp
      });
    }
  }

  // Manejo especial para conmutar (toggle) el servidor de Core Keeper
  if (command === 'COREKEEPER_TOGGLE') {
    const currentStatus = await getCorekeeperStatus();
    const shouldStop = currentStatus.running;
    const sysCmd = shouldStop ? 'sudo systemctl stop corekeeper-server.service' : 'sudo systemctl start corekeeper-server.service';
    const actionLabel = shouldStop ? 'DETENER CORE KEEPER (corekeeper-server.service)' : 'INICIAR CORE KEEPER (corekeeper-server.service)';

    try {
      const { stdout, stderr } = await execPromise(sysCmd, { timeout: 30000 });
      const newStatus = await getCorekeeperStatus();
      const mcStatus = await getMinecraftStatus();

      console.log(`[AUDIT SYSTEMCTL] ${actionLabel} completado por usuario: ${currentUser} (IP: ${clientIp})`);
      console.log(`--------------------------------------------------\n`);
      logAudit(clientIp, command, true, actionLabel, currentUser);

      return res.json({
        success: true,
        command,
        label: actionLabel,
        clientIp,
        user: currentUser,
        minecraft: mcStatus,
        corekeeper: newStatus,
        stdout: stdout.trim() || `Comando ejecutado: ${sysCmd}`,
        stderr: stderr.trim(),
        timestamp
      });
    } catch (err) {
      const newStatus = await getCorekeeperStatus();
      const mcStatus = await getMinecraftStatus();
      console.error(`[AUDIT SYSTEMCTL ERROR] Fallo en ${sysCmd} por usuario: ${currentUser} (IP: ${clientIp})`, err.message);
      console.log(`--------------------------------------------------\n`);
      logAudit(clientIp, command, false, `Error: ${err.message}`, currentUser);

      return res.status(500).json({
        success: false,
        command,
        clientIp,
        user: currentUser,
        minecraft: mcStatus,
        corekeeper: newStatus,
        error: `Fallo al gestionar servicio (corekeeper-server.service): ${err.message}`,
        stdout: err.stdout ? err.stdout.trim() : '',
        stderr: err.stderr ? err.stderr.trim() : '',
        timestamp
      });
    }
  }

  const target = COMMAND_MAP[command];

  try {
    const { stdout, stderr } = await execPromise(target.cmd, { timeout: 15000 });
    const mcStatus = await getMinecraftStatus();
    const ckStatus = await getCorekeeperStatus();

    console.log(`[AUDIT EXITOSO] Comando ${command} ejecutado correctamente por ${currentUser} (IP: ${clientIp})`);
    console.log(`--------------------------------------------------\n`);
    logAudit(clientIp, command, true, target.label, currentUser);

    res.json({
      success: true,
      command,
      label: target.label,
      clientIp,
      user: currentUser,
      minecraft: mcStatus,
      corekeeper: ckStatus,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      timestamp
    });
  } catch (err) {
    const mcStatus = await getMinecraftStatus();
    const ckStatus = await getCorekeeperStatus();
    console.error(`[AUDIT ERROR] Fallo al ejecutar ${command} por usuario: ${currentUser} (IP: ${clientIp})`, err.message);
    console.log(`--------------------------------------------------\n`);
    logAudit(clientIp, command, false, err.message, currentUser);

    res.status(500).json({
      success: false,
      command,
      clientIp,
      user: currentUser,
      minecraft: mcStatus,
      corekeeper: ckStatus,
      error: err.message,
      stdout: err.stdout ? err.stdout.trim() : '',
      stderr: err.stderr ? err.stderr.trim() : '',
      timestamp
    });
  }
});

// Endpoint de prueba / estado de salud
app.get('/api/status', async (req, res) => {
  const clientIp = getClientIp(req);
  const mcStatus = await getMinecraftStatus();
  const ckStatus = await getCorekeeperStatus();

  res.json({
    status: 'ONLINE',
    service: 'Tokiserver Admin Backend',
    clientIp,
    minecraft: mcStatus,
    corekeeper: ckStatus,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`[TOKISERVER BACKEND ONLINE] Escuchando en el puerto ${PORT}`);
  console.log(`Disponible en entorno LAN: http://0.0.0.0:${PORT}`);
  console.log(`Directorio de logs diarios activado en: ${LOGS_DIR}`);
  console.log(`==================================================\n`);
});
