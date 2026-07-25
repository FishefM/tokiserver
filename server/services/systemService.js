import { exec } from 'child_process';
import { promisify } from 'util';
import { MC_CONTAINER, CK_SERVICE } from '../config/constants.js';

export const execPromise = promisify(exec);

// Verificar el estado de Docker para Minecraft
export async function getMinecraftStatus() {
  try {
    const { stdout } = await execPromise(`docker inspect -f '{{.State.Running}}' ${MC_CONTAINER}`);
    const isRunning = stdout.trim() === 'true';
    return { exists: true, running: isRunning, container: MC_CONTAINER };
  } catch (err) {
    return { exists: false, running: false, container: MC_CONTAINER, error: 'Contenedor no encontrado o Docker detenido' };
  }
}

// Verificar el estado de systemctl para Core Keeper
export async function getCorekeeperStatus() {
  try {
    let statusText = '';
    try {
      const { stdout } = await execPromise(`systemctl is-active ${CK_SERVICE}`);
      statusText = (stdout || '').trim();
    } catch (err) {
      statusText = (err.stdout || '').trim();
    }

    if (statusText === 'active') {
      return { exists: true, running: true, service: CK_SERVICE };
    } else if (['inactive', 'failed', 'deactivating', 'activating', 'reloading'].includes(statusText)) {
      return { exists: true, running: false, service: CK_SERVICE };
    } else {
      return { exists: false, running: false, service: CK_SERVICE, error: statusText || 'Servicio no encontrado' };
    }
  } catch (err) {
    return { exists: false, running: false, service: CK_SERVICE, error: err.message };
  }
}
