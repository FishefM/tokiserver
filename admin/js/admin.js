import {
    getToken,
    getUser,
    setSession,
    clearSession,
    updateLoginAvatar,
    updateMiniAvatar,
    navigateUser,
    togglePasswordVisibility,
    openPasswordModal,
    closePasswordModal
} from './modules/authUI.js';

import { appendTerminalLine } from './modules/consoleUI.js';
import { getBackendUrl, checkBackendHealth, executeCommand } from './modules/commandUI.js';

let healthCheckInterval = null;

// Exponer funciones globales requeridas por atributos de eventos HTML (onclick, onsubmit, onchange)
window.navigateUser = navigateUser;
window.updateLoginAvatar = updateLoginAvatar;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openPasswordModal = openPasswordModal;
window.closePasswordModal = closePasswordModal;
window.logout = logout;
window.handleLogin = handleLogin;
window.handleChangePassword = handleChangePassword;
window.executeCommand = (cmdName, e) => executeCommand(cmdName, e, logout);

// Verificar autenticación actual del usuario
export async function checkAuthStatus() {
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
        if (getUser()) {
            if (currentUserDisplay) currentUserDisplay.textContent = getUser();
            updateMiniAvatar(getUser());
        }
        return false;
    }
}

// Iniciar sesión
export async function handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
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
export async function logout() {
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

// Procesar cambio de contraseña
export async function handleChangePassword(e) {
    if (e && e.preventDefault) e.preventDefault();
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

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.loadNavbar === 'function') {
        window.loadNavbar('/admin');
    }
    if (typeof window.initParticles === 'function') {
        window.initParticles();
    }
    checkAuthStatus();
});
