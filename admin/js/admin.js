// Determinar la URL del Backend (Soporta Nginx Reverse Proxy /api y desarrollo en puerto 3000)
const getBackendUrl = () => {
    const port = window.location.port;
    if (port && port !== '80' && port !== '443') {
        return `http://${window.location.hostname}:3000`;
    }
    return '';
};

// Manejo de almacenamiento de sesión en localStorage
const TOKEN_KEY = 'toki_admin_token';
const USER_KEY = 'toki_admin_user';

const getToken = () => localStorage.getItem(TOKEN_KEY);
const getUser = () => localStorage.getItem(USER_KEY);

const setSession = (token, username) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
    document.documentElement.classList.add('has-token');
};

const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    document.documentElement.classList.remove('has-token');
};

let healthCheckInterval = null;

// Cargar subdominios dinámicamente desde /config.json
async function loadNavbar() {
    try {
        const response = await fetch('/config.json');
        const data = await response.json();
        const navbar = document.getElementById('dynamic-navbar');
        if (!navbar) return;
        
        // Conservar enlace HOME si ya existe
        navbar.innerHTML = '<a href="/">HOME</a>';

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

// Mapeo de avatares dinámicos por usuario
const USER_AVATARS = {
    'yucef': { img: 'img/yucef.png', role: 'NETRUNNER // YUCEF' },
    'jesus': { img: 'img/jesus.png', role: 'SYS_OPERATOR // JESUS' },
    'hector': { img: 'img/hector.png', role: 'SYSADMIN // HECTOR' },
    'inge': { img: 'img/inge.png', role: 'LEAD_ENGINEER // INGE' }
};

// Actualizar avatar al seleccionar un usuario en el login
function updateLoginAvatar() {
    const usernameSelect = document.getElementById('login-username');
    const avatarImg = document.getElementById('user-avatar-img');
    const avatarRole = document.getElementById('user-avatar-role');
    if (!usernameSelect || !avatarImg || !avatarRole) return;

    const selected = usernameSelect.value.toLowerCase();
    const info = USER_AVATARS[selected] || USER_AVATARS['yucef'];

    avatarImg.src = info.img;
    avatarRole.textContent = info.role;
}

function updateMiniAvatar(username) {
    const miniAvatar = document.getElementById('current-user-avatar-mini');
    if (!miniAvatar || !username) return;
    const info = USER_AVATARS[username.toLowerCase()];
    if (info) {
        miniAvatar.src = info.img;
    }
}

// Verificar autenticación actual del usuario
async function checkAuthStatus() {
    const token = getToken();
    const loginView = document.getElementById('login-view');
    const mainPanel = document.getElementById('admin-main-panel');
    const currentUserDisplay = document.getElementById('current-user-display');

    if (!token) {
        document.documentElement.classList.remove('has-token');
        if (loginView) loginView.style.display = 'flex';
        if (mainPanel) mainPanel.style.display = 'none';
        if (healthCheckInterval) clearInterval(healthCheckInterval);
        updateLoginAvatar();
        return false;
    }

    // Si existe token, mostramos inmediatamente el panel mientras valida de fondo
    document.documentElement.classList.add('has-token');
    if (loginView) loginView.style.display = 'none';
    if (mainPanel) mainPanel.style.display = 'flex';
    if (getUser()) {
        if (currentUserDisplay) currentUserDisplay.textContent = getUser();
        updateMiniAvatar(getUser());
    }

    try {
        const res = await fetch(`${getBackendUrl()}/api/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            if (currentUserDisplay) currentUserDisplay.textContent = data.username;
            updateMiniAvatar(data.username);
            
            checkBackendHealth();
            if (!healthCheckInterval) {
                healthCheckInterval = setInterval(checkBackendHealth, 4000);
            }
            return true;
        } else {
            clearSession();
            if (loginView) loginView.style.display = 'flex';
            if (mainPanel) mainPanel.style.display = 'none';
            if (healthCheckInterval) clearInterval(healthCheckInterval);
            updateLoginAvatar();
            return false;
        }
    } catch (err) {
        // En caso de problema de conexión temporal, mantenemos token pero permitimos ver panel si existe
        if (getUser()) {
            if (currentUserDisplay) currentUserDisplay.textContent = getUser();
            updateMiniAvatar(getUser());
        }
        return false;
    }
}

// Iniciar sesión
async function handleLogin(e) {
    e.preventDefault();
    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-password');
    const errorMsgEl = document.getElementById('login-error-msg');

    if (!usernameEl || !passwordEl) return;

    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    if (errorMsgEl) errorMsgEl.textContent = '';

    try {
        const res = await fetch(`${getBackendUrl()}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            setSession(data.token, data.username);
            passwordEl.value = '';
            await checkAuthStatus();
            appendTerminalLine(`[SESIÓN INICIADA] Bienvenido ${data.username}. Acceso concedido al panel de administración.`, 'sys');
        } else {
            if (errorMsgEl) errorMsgEl.textContent = data.error || 'Credenciales incorrectas';
        }
    } catch (err) {
        if (errorMsgEl) errorMsgEl.textContent = `Error al conectar con el servidor (${getBackendUrl() || '/api'})`;
    }
}

// Cerrar sesión
async function logout() {
    const token = getToken();
    if (token) {
        try {
            await fetch(`${getBackendUrl()}/api/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (err) {
            console.error('Error al notificar logout al servidor:', err);
        }
    }
    clearSession();
    checkAuthStatus();
}

// Abrir modal de cambio de contraseña
function openPasswordModal() {
    const modal = document.getElementById('password-modal');
    const statusMsg = document.getElementById('modal-status-msg');
    if (statusMsg) statusMsg.textContent = '';
    if (modal) modal.style.display = 'flex';
}

// Cerrar modal de cambio de contraseña
function closePasswordModal() {
    const modal = document.getElementById('password-modal');
    const form = document.getElementById('password-form');
    if (form) form.reset();
    if (modal) modal.style.display = 'none';
}

// Procesar cambio de contraseña
async function handleChangePassword(e) {
    e.preventDefault();
    const currentPassword = document.getElementById('pwd-current').value;
    const newPassword = document.getElementById('pwd-new').value;
    const confirmPassword = document.getElementById('pwd-confirm').value;
    const statusMsg = document.getElementById('modal-status-msg');

    if (statusMsg) {
        statusMsg.className = 'auth-msg';
        statusMsg.textContent = '';
    }

    if (newPassword !== confirmPassword) {
        if (statusMsg) statusMsg.textContent = 'Las nuevas contraseñas no coinciden';
        return;
    }

    if (newPassword.length < 4) {
        if (statusMsg) statusMsg.textContent = 'La nueva contraseña debe tener al menos 4 caracteres';
        return;
    }

    const token = getToken();
    if (!token) {
        if (statusMsg) statusMsg.textContent = 'Sesión no válida. Inicia sesión nuevamente.';
        return;
    }

    try {
        const res = await fetch(`${getBackendUrl()}/api/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            if (statusMsg) {
                statusMsg.className = 'auth-msg success';
                statusMsg.textContent = '✓ Contraseña actualizada correctamente';
            }
            appendTerminalLine(`[SEGURIDAD] Tu contraseña ha sido actualizada con éxito.`, 'sys');
            setTimeout(() => {
                closePasswordModal();
            }, 1200);
        } else {
            if (statusMsg) statusMsg.textContent = data.error || 'Error al cambiar contraseña';
        }
    } catch (err) {
        if (statusMsg) statusMsg.textContent = 'Error de conexión con el backend';
    }
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
async function executeCommand(cmdName, e) {
    if (e && e.preventDefault) e.preventDefault();
    const token = getToken();
    if (!token) {
        appendTerminalLine(`[ACCESO DENEGADO] No hay sesión activa. Por favor inicia sesión.`, 'err');
        logout();
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
            logout();
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

        if (cmdName === 'LOCK_SESSION') {
            setTimeout(() => {
                logout();
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

// Alternar visibilidad de contraseña (mostrar / ocultar)
function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
        btn.title = 'Ocultar contraseña';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
        btn.title = 'Mostrar contraseña';
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    loadNavbar();
    initParticles();
    checkAuthStatus();
});

