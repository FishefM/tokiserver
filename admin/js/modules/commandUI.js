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

// Actualizar la etiqueta (Start/Stop) e indicador de estado (ONLINE/OFFLINE/NOT CREATED) de servicios dinámicos
export function updateIconLabel(serviceType, info) {
    let labelEl, statusEl, serviceName;

    if (serviceType === 'minecraft') {
        labelEl = document.getElementById('mc-btn-label');
        statusEl = document.getElementById('mc-btn-status');
        serviceName = 'MINECRAFT';
    } else if (serviceType === 'corekeeper') {
        labelEl = document.getElementById('ck-btn-label');
        statusEl = document.getElementById('ck-btn-status');
        serviceName = 'CORE KEEPER';
    } else {
        return;
    }

    if (!labelEl || !statusEl) return;

    if (!info) {
        labelEl.innerText = `> START ${serviceName}`;
        statusEl.innerText = '[RESTART BACKEND ⚠️]';
        statusEl.style.color = 'var(--yellow-warn)';
        return;
    }

    if (!info.exists) {
        labelEl.innerText = `> START ${serviceName}`;
        statusEl.innerText = '[NOT CREATED ⚠️]';
        statusEl.style.color = 'var(--yellow-warn)';
    } else if (info.running) {
        labelEl.innerText = `> STOP ${serviceName}`;
        statusEl.innerText = '[ONLINE 🟢]';
        statusEl.style.color = 'var(--green)';
    } else {
        labelEl.innerText = `> START ${serviceName}`;
        statusEl.innerText = '[OFFLINE 🔴]';
        statusEl.style.color = 'var(--red-alert)';
    }
}

export const updateMinecraftUI = (mcInfo) => updateIconLabel('minecraft', mcInfo);
export const updateCorekeeperUI = (ckInfo) => updateIconLabel('corekeeper', ckInfo);

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
            updateIconLabel('minecraft', data.minecraft);
            updateIconLabel('corekeeper', data.corekeeper);
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
            updateIconLabel('minecraft', data.minecraft);
        }
        if (data.corekeeper) {
            updateIconLabel('corekeeper', data.corekeeper);
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

// Renderizar componentes de botones de control suministrados por la API del servidor
export function renderControlButtons(containerId = 'controls-grid', allowedCommands = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (Array.isArray(allowedCommands)) {
        allowedCommands.forEach(config => {
            if (!config || typeof config !== 'object' || !config.label) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-cmd';
            if (config.id) btn.id = config.id;

            if (config.type === 'dynamic') {
                const spanLabel = document.createElement('span');
                spanLabel.id = config.labelId;
                spanLabel.textContent = config.label;

                const spanStatus = document.createElement('span');
                spanStatus.id = config.statusId;
                spanStatus.style.fontSize = '1.1rem';
                spanStatus.textContent = config.defaultStatus || '[CHECKING...]';

                btn.appendChild(spanLabel);
                btn.appendChild(spanStatus);
            } else {
                const spanLabel = document.createElement('span');
                spanLabel.textContent = config.label;

                const spanIcon = document.createElement('span');
                const iconMap = {
                    '💻': 'device-laptop',
                    '🧹': 'trash',
                    '🔍': 'search',
                    '📜': 'notes',
                    '🔒': 'lock',
                    '🔑': 'lock',
                    '👤': 'user',
                    '🚪': 'logout'
                };

                const iconName = iconMap[config.icon] || config.icon;

                if (iconName) {
                    spanIcon.className = 'pixel-icon-mask magenta';
                    spanIcon.style.cssText = `-webkit-mask-image: url('/img/icons/${iconName}.svg'); mask-image: url('/img/icons/${iconName}.svg'); width: 20px; height: 20px;`;
                }

                btn.appendChild(spanLabel);
                btn.appendChild(spanIcon);
            }

            btn.addEventListener('click', (e) => executeCommand(config.key, e, window.logout));
            container.appendChild(btn);
        });
    }

    // Acción local del frontend: Botón de Easter Egg (.env)
    const envBtn = document.createElement('button');
    envBtn.type = 'button';
    envBtn.className = 'btn-cmd danger';
    
    const envLabel = document.createElement('span');
    envLabel.textContent = '> Descargar .env';

    const envIcon = document.createElement('span');
    envIcon.className = 'pixel-icon-mask magenta';
    envIcon.style.cssText = `-webkit-mask-image: url('/img/icons/lock.svg'); mask-image: url('/img/icons/lock.svg'); width: 20px; height: 20px;`;

    envBtn.appendChild(envLabel);
    envBtn.appendChild(envIcon);
    envBtn.addEventListener('click', (e) => {
        if (typeof window.openEasterEggModal === 'function') {
            window.openEasterEggModal(e);
        }
    });

    container.appendChild(envBtn);
}

