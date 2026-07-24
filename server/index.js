import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGS_DIR = path.join(__dirname, 'logs');

// Crear el directorio dedicado /server/logs si no existe
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
function logAudit(ip, command, success, detail = '') {
  const logFile = getTodayLogPath();
  const timestamp = new Date().toLocaleString('es-MX', { timeZoneName: 'short' });
  const statusStr = success ? 'EXITO' : 'FALLO';
  const entry = `[${timestamp}] [IP: ${ip}] -> COMANDO: "${command}" | RESULTADO: ${statusStr} ${detail ? '| ' + detail : ''}\n`;

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

// Middleware de registro global de peticiones (Logging en consola)
app.use((req, res, next) => {
  const clientIp = getClientIp(req);
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] HTTP ${req.method} ${req.url} desde IP: ${clientIp}`);
  next();
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

// Endpoint API para recibir comandos del panel administrativo
app.post('/api/command', async (req, res) => {
  const clientIp = getClientIp(req);
  const { command } = req.body;
  const timestamp = new Date().toLocaleTimeString();

  console.log(`\n--------------------------------------------------`);
  console.log(`[AUDIT LOG] Hora: ${timestamp} | IP Solicitante: ${clientIp}`);
  console.log(`[AUDIT LOG] Comando Solicitado: "${command}"`);

  if (!command || !COMMAND_MAP[command]) {
    console.warn(`[AUDIT ALERTA] IP ${clientIp} intentó ejecutar comando no permitido: "${command}"`);
    console.log(`--------------------------------------------------\n`);
    logAudit(clientIp, command || 'DESCONOCIDO', false, 'Comando no permitido');

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

      console.log(`[AUDIT DOCKER] ${actionLabel} completado por IP: ${clientIp}`);
      console.log(`--------------------------------------------------\n`);
      logAudit(clientIp, command, true, actionLabel);

      return res.json({
        success: true,
        command,
        label: actionLabel,
        clientIp,
        minecraft: newStatus,
        stdout: stdout.trim() || `Comando ejecutado: ${dockerCmd}`,
        stderr: stderr.trim(),
        timestamp
      });
    } catch (err) {
      const newStatus = await getMinecraftStatus();
      console.error(`[AUDIT DOCKER ERROR] Fallo en ${dockerCmd} por IP: ${clientIp}`, err.message);
      console.log(`--------------------------------------------------\n`);
      logAudit(clientIp, command, false, `Error: ${err.message}`);

      return res.status(500).json({
        success: false,
        command,
        clientIp,
        minecraft: newStatus,
        error: `Fallo al gestionar contenedor (${MC_CONTAINER}): ${err.message}`,
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

    console.log(`[AUDIT EXITOSO] Comando ${command} ejecutado correctamente para IP: ${clientIp}`);
    console.log(`--------------------------------------------------\n`);
    logAudit(clientIp, command, true, target.label);

    res.json({
      success: true,
      command,
      label: target.label,
      clientIp,
      minecraft: mcStatus,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      timestamp
    });
  } catch (err) {
    const mcStatus = await getMinecraftStatus();
    console.error(`[AUDIT ERROR] Fallo al ejecutar ${command} desde IP: ${clientIp}`, err.message);
    console.log(`--------------------------------------------------\n`);
    logAudit(clientIp, command, false, err.message);

    res.status(500).json({
      success: false,
      command,
      clientIp,
      minecraft: mcStatus,
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

  res.json({
    status: 'ONLINE',
    service: 'Tokiserver Admin Backend',
    clientIp,
    minecraft: mcStatus,
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
