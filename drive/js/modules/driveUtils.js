/**
 * Convierte una cantidad de bytes en una cadena legible con sufijo de unidad
 */
export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Retorna la URL base del backend dinámicamente según el puerto de escucha
 */
export function getBackendUrl() {
    const port = window.location.port;
    if (port && port !== '80' && port !== '443') {
        return `http://${window.location.hostname}:3000`;
    }
    return '';
}

/**
 * Determina la carpeta actual basada en la URL (Query string, Hash o Path)
 */
export function getCurrentFolderFromUrl() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('folder')) {
            return decodeURIComponent(urlParams.get('folder')).replace(/^\/+|\/+$/g, '');
        }
        
        if (window.location.hash) {
            const rawHash = window.location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
            return decodeURIComponent(rawHash);
        }

        const path = window.location.pathname.replace(/\/$/, '');
        const driveMatch = path.match(/\/drive\/(.+)/);
        if (driveMatch && driveMatch[1] && !driveMatch[1].endsWith('.html')) {
            return decodeURIComponent(driveMatch[1]);
        }
    } catch (e) {}

    return '';
}
