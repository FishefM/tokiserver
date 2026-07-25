// Módulo de Autenticación de Usuario (UI)
const TOKEN_KEY = 'toki_admin_token';
const USER_KEY = 'toki_admin_user';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getUser = () => localStorage.getItem(USER_KEY);

export const setSession = (token, username) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
    document.documentElement.classList.add('has-token');
};

export const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    document.documentElement.classList.remove('has-token');
};

export const USER_AVATARS = {
    'yucef': { img: 'img/yucef.png', role: 'YUCEF', phrase: 'VIVA CRISTO REY' },
    'jesus': { img: 'img/jesus.png', role: 'JESUS', phrase: 'LET ME COOK' },
    'hector': { img: 'img/hector.png', role: 'HECTOR', phrase: 'YO DEBI PROGRAMAR ESTO' },
    'inge': { img: 'img/inge.png', role: 'INGE', phrase: 'DEIGO?' },
    'kitzya': { img: 'img/kitzya.png', role: 'KITZYA', phrase: 'ONLINE' }
};

export const USERS_LIST = ['Yucef', 'Jesus', 'Hector', 'Inge', 'Kitzya'];

// Precarga y caché de imágenes en memoria para evitar retardos al cambiar de usuario
const avatarCache = new Map();
let currentAvatarLoadToken = 0;

export function preloadAvatars() {
    Object.values(USER_AVATARS).forEach(info => {
        if (info.img && !avatarCache.has(info.img)) {
            const img = new Image();
            img.src = info.img;
            avatarCache.set(info.img, img);
        }
    });
}

// Ejecutar precarga al importar el módulo
preloadAvatars();

export function updateLoginAvatar(animate = false) {
    const usernameSelect = document.getElementById('login-username');
    const avatarImg = document.getElementById('user-avatar-img');
    const avatarRole = document.getElementById('user-avatar-role');
    const avatarPhrase = document.getElementById('user-avatar-phrase');
    if (!usernameSelect || !avatarImg || !avatarRole) return;

    const selected = usernameSelect.value.toLowerCase();
    const info = USER_AVATARS[selected] || USER_AVATARS['yucef'];

    // Incrementar token para ignorar peticiones obsoletas al hacer clics rápidos
    const loadToken = ++currentAvatarLoadToken;

    // Actualizar roles y texto inmediatamente
    avatarRole.textContent = info.role;
    if (avatarPhrase) avatarPhrase.textContent = info.phrase || '';

    const applyImage = () => {
        if (loadToken === currentAvatarLoadToken) {
            avatarImg.src = info.img;
            if (animate) {
                setTimeout(() => avatarImg.classList.remove('fading'), 50);
            } else {
                avatarImg.classList.remove('fading');
            }
        }
    };

    if (animate) {
        avatarImg.classList.add('fading');
    }

    // Obtener o registrar en caché
    let cachedImg = avatarCache.get(info.img);
    if (!cachedImg) {
        cachedImg = new Image();
        cachedImg.src = info.img;
        avatarCache.set(info.img, cachedImg);
    }

    if (cachedImg.complete && cachedImg.naturalWidth !== 0) {
        if (animate) {
            setTimeout(applyImage, 100);
        } else {
            applyImage();
        }
    } else {
        cachedImg.onload = () => applyImage();
        cachedImg.onerror = () => {
            if (loadToken === currentAvatarLoadToken) {
                console.warn(`[AVATAR] Error al cargar la imagen: ${info.img}`);
                avatarImg.classList.remove('fading');
            }
        };
    }
}

export function updateMiniAvatar(username) {
    const miniAvatar = document.getElementById('current-user-avatar-mini');
    if (!miniAvatar || !username) return;
    const info = USER_AVATARS[username.toLowerCase()];
    if (info) {
        miniAvatar.src = info.img;
    }
}

export function navigateUser(direction) {
    const usernameSelect = document.getElementById('login-username');
    if (!usernameSelect) return;

    const currentVal = usernameSelect.value;
    let currentIndex = USERS_LIST.findIndex(u => u.toLowerCase() === currentVal.toLowerCase());
    if (currentIndex === -1) currentIndex = 0;

    const newIndex = (currentIndex + direction + USERS_LIST.length) % USERS_LIST.length;
    usernameSelect.value = USERS_LIST[newIndex];
    updateLoginAvatar(true);
}

export function togglePasswordVisibility(inputId, btn) {
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
