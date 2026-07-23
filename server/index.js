import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';

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

// Middleware de registro global de peticiones (Logging)
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
    label: 'VIEW_LOGS',
    cmd: `echo "=== ULTIMOS REGISTROS DE DOCKER (${MC_CONTAINER}) ===" && docker logs --tail 20 ${MC_CONTAINER} 2>&1 || (echo "=== REGISTROS DE SERVIDOR ===" && date && ls -lh ..)`
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
  console.log(`Controlador Docker activado para: ${MC_CONTAINER}`);
  console.log(`==================================================\n`);
});
