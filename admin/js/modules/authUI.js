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
    'inge': { img: 'img/inge.png', role: 'INGE', phrase: 'DEIGO?' }
};

export const USERS_LIST = ['Yucef', 'Jesus', 'Hector', 'Inge'];

export function updateLoginAvatar(animate = false) {
    const usernameSelect = document.getElementById('login-username');
    const avatarImg = document.getElementById('user-avatar-img');
    const avatarRole = document.getElementById('user-avatar-role');
    const avatarPhrase = document.getElementById('user-avatar-phrase');
    if (!usernameSelect || !avatarImg || !avatarRole) return;

    const selected = usernameSelect.value.toLowerCase();
    const info = USER_AVATARS[selected] || USER_AVATARS['yucef'];

    if (animate) {
        avatarImg.classList.add('fading');
        setTimeout(() => {
            avatarImg.src = info.img;
            avatarRole.textContent = info.role;
            avatarImg.classList.remove('fading');
            avatarPhrase.textContent = info.phrase || '';
        }, 180);
    } else {
        avatarImg.src = info.img;
        avatarRole.textContent = info.role;
        avatarPhrase.textContent = info.phrase || '';
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
