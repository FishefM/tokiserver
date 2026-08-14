import {
    getToken,
    getUser,
    setSession,
    clearSession,
    togglePasswordVisibility,
    openPasswordModal,
    closePasswordModal,
    openEasterEggModal,
    closeEasterEggModal
} from './modules/authUI.js';

import { logoutApi, changePasswordApi } from '/js/auth.js';
import { appendTerminalLine } from './modules/consoleUI.js';
import { getBackendUrl, checkBackendHealth, executeCommand, renderControlButtons } from './modules/commandUI.js';

let healthCheckInterval = null;

// Exponer funciones globales requeridas por atributos de eventos HTML (onclick, onsubmit)
window.togglePasswordVisibility = togglePasswordVisibility;
window.openPasswordModal = openPasswordModal;
window.closePasswordModal = closePasswordModal;
window.openEasterEggModal = openEasterEggModal;
window.closeEasterEggModal = closeEasterEggModal;
window.appendTerminalLine = appendTerminalLine;
window.logout = logout;
window.handleChangePassword = handleChangePassword;
window.executeCommand = (cmdName, e) => executeCommand(cmdName, e, logout);

// Aplicar restricciones de permisos según comandos permitidos devueltos por el backend
export function applyUserPermissions(username, allowedCommands = []) {
    renderControlButtons('controls-grid', allowedCommands);
}

// Redirigir al módulo de login si el usuario no tiene sesión válida
function redirectToLogin() {
    window.location.href = '/login?redirect=/admin';
}

// Verificar autenticación actual del usuario
export async function checkAuthStatus() {
    const token = getToken();
    const mainPanel = document.getElementById('admin-main-panel');
    const currentUserDisplay = document.getElementById('current-user-display');

    if (!token) {
        document.documentElement.classList.remove('has-token');
        if (mainPanel) mainPanel.style.display = 'none';
        if (healthCheckInterval) clearInterval(healthCheckInterval);
        applyUserPermissions('');
        redirectToLogin();
        return false;
    }

    // Si existe token, mostramos inmediatamente el panel mientras valida de fondo
    document.documentElement.classList.add('has-token');
    if (mainPanel) mainPanel.style.display = 'flex';
    if (getUser()) {
        if (currentUserDisplay) currentUserDisplay.textContent = getUser();
        applyUserPermissions(getUser());
    }

    try {
        const res = await fetch(`${getBackendUrl()}/api/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            if (currentUserDisplay) currentUserDisplay.textContent = data.username;
            applyUserPermissions(data.username, data.allowedCommands);

            checkBackendHealth();
            if (!healthCheckInterval) {
                healthCheckInterval = setInterval(checkBackendHealth, 4000);
            }
            return true;
        } else {
            clearSession();
            if (mainPanel) mainPanel.style.display = 'none';
            if (healthCheckInterval) clearInterval(healthCheckInterval);
            applyUserPermissions('');
            redirectToLogin();
            return false;
        }
    } catch (err) {
        if (getUser()) {
            if (currentUserDisplay) currentUserDisplay.textContent = getUser();
            applyUserPermissions(getUser());
        }
        return false;
    }
}

// Cerrar sesión y redirigir a /login
export async function logout() {
    await logoutApi();
    applyUserPermissions('');
    redirectToLogin();
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

    try {
        const { ok, data } = await changePasswordApi(currentPassword, newPassword);

        if (ok && data.success) {
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
    renderControlButtons('controls-grid');
    checkAuthStatus();
});
