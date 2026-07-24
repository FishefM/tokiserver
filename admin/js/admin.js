// Determinar la URL del Backend (Soporta Nginx Reverse Proxy /api y desarrollo en puerto 3000)
const getBackendUrl = () => {
    const port = window.location.port;
    if (port && port !== '80' && port !== '443') {
        return `http://${window.location.hostname}:3000`;
    }
    return '';
};

// Cargar subdominios dinámicamente desde /config.json
async function loadNavbar() {
    try {
        const response = await fetch('/config.json');
        const data = await response.json();
        const navbar = document.getElementById('dynamic-navbar');
        
        data.subdomains.forEach(sub => {
            const link = document.createElement('a');
            if (sub.url === '/admin' || sub.url === '/admin/') {
                link.classList.add('active');
            }
            if (sub.url.startsWith(':')) {
                link.href = window.location.protocol + "//" + window.location.hostname + sub.url;
            } else {
                link.href = sub.url;
            }
            link.innerText = sub.name;
            navbar.appendChild(link);
        });
    } catch (error) {
        console.error('Error al cargar la configuración de la barra de navegación:', error);
    }
}

// Generador de lluvia de partículas ASCII estilo Matrix
function initParticles() {
    const container = document.getElementById('particles');
    if (!container) return;

    const chars = ['0', '1', '{', '}', '>', '_', '$', 'X', '#', '!', '?'];
    
    function createParticle() {
        const p = document.createElement('div');
        p.classList.add('particle');
        p.innerText = chars[Math.floor(Math.random() * chars.length)];
        p.style.left = Math.random() * 100 + 'vw';
        const duration = Math.random() * 5 + 3;
        p.style.animationDuration = duration + 's';
        p.style.opacity = Math.random() * 0.4 + 0.1;
        
        container.appendChild(p);

        setTimeout(() => {
            p.remove();
        }, duration * 1000);
    }

    setInterval(createParticle, 150);
}

// Actualizar la interfaz de usuario para el estado de Minecraft
function updateMinecraftUI(mcInfo) {
    const labelEl = document.getElementById('mc-btn-label');
    const statusEl = document.getElementById('mc-btn-status');
    if (!mcInfo || !labelEl || !statusEl) return;

    if (!mcInfo.exists) {
        labelEl.innerText = '> START MC (mc_forge_server)';
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
function updateCorekeeperUI(ckInfo) {
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
async function checkBackendHealth() {
    const badge = document.getElementById('backend-status-badge');
    const statusText = document.getElementById('backend-status-text');
    if (!badge || !statusText) return;

    try {
        const res = await fetch(`${getBackendUrl()}/api/status`);
        if (res.ok) {
            const data = await res.json();
            badge.classList.remove('offline');
            statusText.innerText = `BACKEND: ONLINE | TU IP: ${data.clientIp}`;
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

// Impresión en consola interactiva estilo CRT
function appendTerminalLine(text, type = 'sys') {
    const output = document.getElementById('console-output');
    if (!output) return;

    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

// Ejecutar comando vía Backend API
async function executeCommand(cmdName) {
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cmdName })
        });

        const data = await res.json();

        if (data.minecraft) {
            updateMinecraftUI(data.minecraft);
        }
        if (data.corekeeper) {
            updateCorekeeperUI(data.corekeeper);
        }

        if (res.ok && data.success) {
            appendTerminalLine(`[${data.timestamp}] [IP: ${data.clientIp}] > [SUCCESS] ${data.label}`, 'sys');
            if (data.stdout) {
                data.stdout.split('\n').forEach(l => appendTerminalLine(l, 'out'));
            }
        } else {
            appendTerminalLine(`[${timestamp}] [IP: ${data.clientIp || 'UNKNOWN'}] > [ERROR] ${data.error || 'Fallo en servidor'}`, 'err');
            if (data.stderr) {
                data.stderr.split('\n').forEach(l => appendTerminalLine(l, 'err'));
            }
        }
    } catch (err) {
        appendTerminalLine(`[${timestamp}] > [CONNECTION_ERROR] No se pudo comunicar con el backend (${getBackendUrl() || '/api'})`, 'err');
        appendTerminalLine(`> Asegúrate de haber iniciado el servidor backend con 'pnpm start' dentro de /server`, 'warn');
    } finally {
        if (btnMc) {
            btnMc.disabled = false;
        }
        if (btnCk) {
            btnCk.disabled = false;
        }
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    loadNavbar();
    initParticles();
    checkBackendHealth();
    setInterval(checkBackendHealth, 4000);
});
