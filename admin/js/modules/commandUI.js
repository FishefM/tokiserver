import { getToken, getUser } from './authUI.js';
import { appendTerminalLine } from './consoleUI.js';

// Determinar la URL del Backend (Soporta Nginx Reverse Proxy /api y desarrollo en puerto 3000)
export const getBackendUrl = () => {
    const port = window.location.port;
    if (port && port !== '80' && port !== '443') {
        return `http://${window.location.hostname}:3000`;
    }
    return '';
};

// Actualizar la interfaz de usuario para el estado de Minecraft
export function updateMinecraftUI(mcInfo) {
    const labelEl = document.getElementById('mc-btn-label');
    const statusEl = document.getElementById('mc-btn-status');
    if (!mcInfo || !labelEl || !statusEl) return;

    if (!mcInfo.exists) {
        labelEl.innerText = '> START MINECRAFT';
        statusEl.innerText = '[NOT CREATED ⚠️]';
        statusEl.style.color = 'var(--yellow-warn)';
    } else if (mcInfo.running) {
        labelEl.innerText = '> STOP MINECRAFT';
        statusEl.innerText = '[ONLINE 🟢]';
        statusEl.style.color = 'var(--green)';
    } else {
        labelEl.innerText = '> START MINECRAFT';
        statusEl.innerText = '[OFFLINE 🔴]';
        statusEl.style.color = 'var(--red-alert)';
    }
}

// Actualizar la interfaz de usuario para el estado de Core Keeper
export function updateCorekeeperUI(ckInfo) {
    const labelEl = document.getElementById('ck-btn-label');
    const statusEl = document.getElementById('ck-btn-status');
    if (!labelEl || !statusEl) return;

    if (!ckInfo) {
        labelEl.innerText = '> START CORE KEEPER';
        statusEl.innerText = '[RESTART BACKEND ⚠️]';
        statusEl.style.color = 'var(--yellow-warn)';
        return;
    }

    if (!ckInfo.exists) {
        labelEl.innerText = '> START CORE KEEPER';
        statusEl.innerText = '[NOT CREATED ⚠️]';
        statusEl.style.color = 'var(--yellow-warn)';
    } else if (ckInfo.running) {
        labelEl.innerText = '> STOP CORE KEEPER';
        statusEl.innerText = '[ONLINE 🟢]';
        statusEl.style.color = 'var(--green)';
    } else {
        labelEl.innerText = '> START CORE KEEPER';
        statusEl.innerText = '[OFFLINE 🔴]';
        statusEl.style.color = 'var(--red-alert)';
    }
}

// Verificación de estado del backend y servicios en tiempo real
export async function checkBackendHealth() {
    const badge = document.getElementById('backend-status-badge');
    const statusText = document.getElementById('backend-status-text');
    if (!badge || !statusText) return;

    try {
        const res = await fetch(`${getBackendUrl()}/api/status`);
        if (res.ok) {
            const data = await res.json();
            badge.classList.remove('offline');
            statusText.innerText = `BACKEND: ONLINE | IP: ${data.clientIp}`;
            updateMinecraftUI(data.minecraft);
            updateCorekeeperUI(data.corekeeper);
        } else {
            throw new Error('HTTP Error');
        }
    } catch (err) {
        badge.classList.add('offline');
        statusText.innerText = `BACKEND: OFFLINE (${getBackendUrl() || '/api'})`;
    }
}

// Ejecutar comando vía Backend API
export async function executeCommand(cmdName, e, logoutCallback) {
    if (e && e.preventDefault) e.preventDefault();
    const token = getToken();
    if (!token) {
        appendTerminalLine(`[ACCESO DENEGADO] No hay sesión activa. Por favor inicia sesión.`, 'err');
        if (logoutCallback) logoutCallback();
        return;
    }

    const timestamp = new Date().toLocaleTimeString();
    appendTerminalLine(`[${timestamp}] > DISPATCHING: ${cmdName}...`, 'sys');

    const btnMc = document.getElementById('btn-minecraft');
    const btnCk = document.getElementById('btn-corekeeper');
    if (cmdName === 'MINECRAFT_TOGGLE' && btnMc) {
        btnMc.disabled = true;
    }
    if (cmdName === 'COREKEEPER_TOGGLE' && btnCk) {
        btnCk.disabled = true;
    }

    try {
        const res = await fetch(`${getBackendUrl()}/api/command`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ command: cmdName })
        });

        const data = await res.json();

        if (res.status === 401 || data.sessionExpired) {
            appendTerminalLine(`[SESIÓN EXPIRADA] Tu sesión ha caducado. Vuelve a iniciar sesión.`, 'err');
            if (logoutCallback) logoutCallback();
            return;
        }

        if (data.minecraft) {
            updateMinecraftUI(data.minecraft);
        }
        if (data.corekeeper) {
            updateCorekeeperUI(data.corekeeper);
        }

        if (res.ok && data.success) {
            appendTerminalLine(`[${data.timestamp}] [USUARIO: ${data.user || getUser()}] > [SUCCESS] ${data.label}`, 'sys');
            if (data.stdout) {
                data.stdout.split('\n').forEach(l => appendTerminalLine(l, 'out'));
            }
        } else {
            appendTerminalLine(`[${timestamp}] [IP: ${data.clientIp || 'UNKNOWN'}] > [ERROR] ${data.error || 'Fallo en servidor'}`, 'err');
            if (data.stderr) {
                data.stderr.split('\n').forEach(l => appendTerminalLine(l, 'err'));
            }
        }

        if (cmdName === 'LOCK_SESSION' && logoutCallback) {
            setTimeout(() => {
                logoutCallback();
            }, 1000);
        }
    } catch (err) {
        appendTerminalLine(`[${timestamp}] > [CONNECTION_ERROR] No se pudo comunicar con el backend (${getBackendUrl() || '/api'})`, 'err');
        appendTerminalLine(`> Asegúrate de haber iniciado el servidor backend con 'npm start' dentro de /server`, 'warn');
    } finally {
        if (btnMc) {
            btnMc.disabled = false;
        }
        if (btnCk) {
            btnCk.disabled = false;
        }
    }
}
