import express from 'express';
import { MC_CONTAINER, CK_SERVICE, isUserAllowed } from '../config/constants.js';
import { getClientIp, requireAuth } from '../middleware/authMiddleware.js';
import { logAudit } from '../services/auditService.js';
import { getMinecraftStatus, getCorekeeperStatus, execPromise } from '../services/systemService.js';
import { getCommandMap, formatAuditLogsForTerminal } from '../db.js';

const router = express.Router();

// POST /api/command
router.post('/', requireAuth, async (req, res) => {
  const clientIp = getClientIp(req);
  const { command } = req.body;
  const timestamp = new Date().toLocaleTimeString();
  const currentUser = req.user;
  const commandMap = getCommandMap();

  console.log(`\n--------------------------------------------------`);
  console.log(`[AUDIT LOG] Hora: ${timestamp} | IP Solicitante: ${clientIp} | Usuario: ${currentUser}`);
  console.log(`[AUDIT LOG] Comando Solicitado: "${command}"`);

  if (!command || !commandMap[command]) {
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

  const target = commandMap[command];

  // Restricción de permisos dinámica según atributos onlyUsers y allUsersExcept
  if (!isUserAllowed(currentUser, target)) {
    console.warn(`[AUDIT ALERTA] Permiso denegado: El usuario ${currentUser} (IP ${clientIp}) intentó ejecutar ${command}`);
    console.log(`--------------------------------------------------\n`);
    logAudit(clientIp, command, false, `Acceso denegado: usuario sin permisos para ejecutar ${command}`, currentUser);

    return res.status(403).json({
      success: false,
      clientIp,
      user: currentUser,
      error: `Acceso denegado: El usuario ${currentUser} no tiene permisos para ejecutar este comando.`,
      timestamp
    });
  }

  // Toggle Minecraft
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

  // Toggle Core Keeper
  if (command === 'COREKEEPER_TOGGLE') {
    const currentStatus = await getCorekeeperStatus();
    const shouldStop = currentStatus.running;
    const sysCmd = shouldStop ? `sudo systemctl stop ${CK_SERVICE}` : `sudo systemctl start ${CK_SERVICE}`;
    const actionLabel = shouldStop ? `DETENER CORE KEEPER (${CK_SERVICE})` : `INICIAR CORE KEEPER (${CK_SERVICE})`;

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
        error: `Fallo al gestionar servicio (${CK_SERVICE}): ${err.message}`,
        stdout: err.stdout ? err.stdout.trim() : '',
        stderr: err.stderr ? err.stderr.trim() : '',
        timestamp
      });
  // VIEW_LOGS desde SQLite DB
  if (command === 'VIEW_LOGS') {
    const mcStatus = await getMinecraftStatus();
    const ckStatus = await getCorekeeperStatus();
    const logsOutput = formatAuditLogsForTerminal(35);

    console.log(`[AUDIT SQLITE LOGS] Consulta de logs de auditoría realizada por: ${currentUser} (IP: ${clientIp})`);
    console.log(`--------------------------------------------------\n`);
    logAudit(clientIp, command, true, target.label, currentUser);

    return res.json({
      success: true,
      command,
      label: target.label,
      clientIp,
      user: currentUser,
      minecraft: mcStatus,
      corekeeper: ckStatus,
      stdout: logsOutput,
      stderr: '',
      timestamp
    });
  }

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

export default router;
