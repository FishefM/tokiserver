import {
    loginApi,
    checkAuthApi,
    USER_AVATARS,
    USERS_LIST,
    getToken
} from '/js/auth.js';

let currentAvatarLoadToken = 0;
const avatarCache = new Map();

// Precargar imágenes de avatares en memoria
export function preloadAvatars() {
    Object.values(USER_AVATARS).forEach(info => {
        if (info.img && !avatarCache.has(info.img)) {
            const img = new Image();
            img.src = info.img;
            avatarCache.set(info.img, img);
        }
    });
}

// Actualizar avatar en el carrusel de login
export function updateLoginAvatar(animate = false) {
    const usernameSelect = document.getElementById('login-username');
    const avatarImg = document.getElementById('user-avatar-img');
    const avatarRole = document.getElementById('user-avatar-role');
    const avatarPhrase = document.getElementById('user-avatar-phrase');
    if (!usernameSelect || !avatarImg || !avatarRole) return;

    const selected = usernameSelect.value.toLowerCase();
    const info = USER_AVATARS[selected] || USER_AVATARS['yucef'];

    const loadToken = ++currentAvatarLoadToken;

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
                console.warn(`[LOGIN] Error al cargar avatar: ${info.img}`);
                avatarImg.classList.remove('fading');
            }
        };
    }
}

// Navegar entre usuarios en el carrusel
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

// Conmutar visibilidad de contraseña
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

// Obtener la URL de redirección tras autenticarse
function getRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
        return redirect;
    }
    return '/admin';
}

// Manejador del formulario de inicio de sesión
export async function handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-password');
    const errorMsgEl = document.getElementById('login-error-msg');
    const submitBtn = document.getElementById('login-submit-btn');

    if (!usernameEl || !passwordEl) return;

    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    if (errorMsgEl) errorMsgEl.textContent = '';

    if (submitBtn) submitBtn.disabled = true;

    try {
        const { ok, data } = await loginApi(username, password);

        if (ok && data.success) {
            passwordEl.value = '';
            const targetUrl = getRedirectTarget();
            window.location.href = targetUrl;
        } else {
            if (errorMsgEl) errorMsgEl.textContent = data.error || 'Credenciales incorrectas';
        }
    } catch (err) {
        if (errorMsgEl) errorMsgEl.textContent = 'Error de conexión con el servidor backend';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

// Exponer funciones necesarias a window para manejadores inline HTML
window.navigateUser = navigateUser;
window.updateLoginAvatar = updateLoginAvatar;
window.togglePasswordVisibility = togglePasswordVisibility;
window.handleLogin = handleLogin;

// Inicialización del módulo
document.addEventListener('DOMContentLoaded', async () => {
    preloadAvatars();
    updateLoginAvatar();

    if (typeof window.loadNavbar === 'function') {
        window.loadNavbar('/login');
    }
    if (typeof window.initParticles === 'function') {
        window.initParticles();
    }

    // Si el usuario ya cuenta con un token válido, redirigir automáticamente
    if (getToken()) {
        const auth = await checkAuthApi();
        if (auth.authenticated) {
            window.location.href = getRedirectTarget();
        }
    }
});
