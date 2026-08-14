// Módulo Global de Autenticación de Tokiserver
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

export const isAuthenticated = () => !!getToken();

export const USER_AVATARS = {
    'yucef': { img: '/img/avatars/yucef.png', role: 'YUCEF', phrase: 'VIVA CRISTO REY' },
    'jesus': { img: '/img/avatars/jesus.png', role: 'JESUS', phrase: 'LET ME COOK' },
    'hector': { img: '/img/avatars/hector.png', role: 'HECTOR', phrase: 'YO DEBI PROGRAMAR ESTO' },
    'inge': { img: '/img/avatars/inge.png', role: 'INGE', phrase: 'DEIGO?' },
    'kitzya': { img: '/img/avatars/kitzya.png', role: 'KITZYA', phrase: 'ÑIÑIÑIÑI PUTO' }
};

export const USERS_LIST = ['Yucef', 'Jesus', 'Hector', 'Inge', 'Kitzya'];

export const getBackendUrl = () => {
    const port = window.location.port;
    if (port && port !== '80' && port !== '443') {
        return `${window.location.protocol}//${window.location.hostname}:3000`;
    }
    return '';
};

export async function loginApi(username, password) {
    const res = await fetch(`${getBackendUrl()}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.success) {
        setSession(data.token, data.username);
    }
    return { ok: res.ok, status: res.status, data };
}

export async function logoutApi() {
    const token = getToken();
    if (token) {
        try {
            await fetch(`${getBackendUrl()}/api/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (err) {
            console.error('[AUTH] Error al notificar logout al backend:', err);
        }
    }
    clearSession();
}

export async function checkAuthApi() {
    const token = getToken();
    if (!token) {
        clearSession();
        return { authenticated: false };
    }
    try {
        const res = await fetch(`${getBackendUrl()}/api/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            return { authenticated: true, username: data.username, allowedCommands: data.allowedCommands };
        } else {
            clearSession();
            return { authenticated: false };
        }
    } catch (err) {
        // En caso de error de red pero teniendo token guardado
        return { authenticated: true, username: getUser(), allowedCommands: [], offline: true };
    }
}

export async function changePasswordApi(currentPassword, newPassword) {
    const token = getToken();
    if (!token) return { ok: false, data: { error: 'Sesión no válida. Inicia sesión nuevamente.' } };
    const res = await fetch(`${getBackendUrl()}/api/change-password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
}
