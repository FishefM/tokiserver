// Módulo de Autenticación de Usuario (UI de Admin)
import {
    getToken,
    getUser,
    setSession,
    clearSession,
    USER_AVATARS,
    USERS_LIST
} from '/js/auth.js';

export {
    getToken,
    getUser,
    setSession,
    clearSession,
    USER_AVATARS,
    USERS_LIST
};

export function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = `<span class="pixel-icon-mask magenta" style="-webkit-mask-image: url('/img/icons/eye.svg'); mask-image: url('/img/icons/eye.svg'); opacity: 0.4;"></span>`;
        btn.title = 'Ocultar contraseña';
    } else {
        input.type = 'password';
        btn.innerHTML = `<span class="pixel-icon-mask magenta" style="-webkit-mask-image: url('/img/icons/eye.svg'); mask-image: url('/img/icons/eye.svg');"></span>`;
        btn.title = 'Mostrar contraseña';
    }
}

export function openPasswordModal() {
    const modal = document.getElementById('password-modal');
    const statusMsg = document.getElementById('modal-status-msg');
    if (statusMsg) statusMsg.textContent = '';
    if (modal) modal.style.display = 'flex';
}

export function closePasswordModal() {
    const modal = document.getElementById('password-modal');
    const form = document.getElementById('password-form');
    if (form) form.reset();
    if (modal) modal.style.display = 'none';
}

export function openEasterEggModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    const modal = document.getElementById('easteregg-modal');
    if (modal) modal.style.display = 'flex';
    if (typeof window.appendTerminalLine === 'function') {
        window.appendTerminalLine(`[ALERTA DE SEGURIDAD] ¡Intento de descarga de archivo .env detectado!`, 'err');
    }
}

export function closeEasterEggModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    const modal = document.getElementById('easteregg-modal');
    if (modal) modal.style.display = 'none';
}
