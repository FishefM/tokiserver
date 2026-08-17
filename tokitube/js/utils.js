/**
 * utils.js - Utilidades Puras, Clasificación y Procesamiento Criptográfico de Audio
 */

/**
 * Calcula un hash SHA-256 criptográfico para una pista a partir del nombre, tamaño y cabecera binaria.
 */
export async function computeTrackHash(file) {
    if (!file) return 'trk_unknown';
    try {
        const headerSlice = file.slice(0, 64 * 1024);
        const headerBuffer = await headerSlice.arrayBuffer();
        const metaStr = `${file.name}_${file.size}_${file.lastModified}`;
        const metaBuffer = new TextEncoder().encode(metaStr);

        const combined = new Uint8Array(headerBuffer.byteLength + metaBuffer.byteLength);
        combined.set(new Uint8Array(headerBuffer), 0);
        combined.set(metaBuffer, headerBuffer.byteLength);

        const digest = await crypto.subtle.digest('SHA-256', combined);
        const hashArray = Array.from(new Uint8Array(digest));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return 'trk_' + hashHex.slice(0, 16);
    } catch (e) {
        let hash = 0;
        const str = `${file.name}_${file.size}`;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return 'trk_' + Math.abs(hash).toString(16);
    }
}

/**
 * Extrae artista y título desde el nombre del archivo de audio.
 */
export function parseAudioFilename(name) {
    const base = name.replace(/\.[^/.]+$/, "");
    const parts = base.split(" - ");
    if (parts.length >= 2) {
        return {
            artist: parts[0].trim(),
            title: parts.slice(1).join(" - ").trim()
        };
    }
    return {
        artist: "PISTA LOCAL",
        title: base.trim()
    };
}

/**
 * Obtiene la extensión del archivo en mayúsculas.
 */
export function getFileExtension(name) {
    const ext = name.split('.').pop();
    return ext ? ext.toUpperCase() : 'AUDIO';
}

/**
 * Formatea segundos a formato mm:ss.
 */
export function formatSeconds(secs) {
    if (isNaN(secs) || secs < 0 || !isFinite(secs)) return "00:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Valida si un archivo es un formato de audio soportado.
 */
export function isAudioFile(file) {
    if (!file) return false;
    const validExtensions = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'webm'];
    const ext = file.name.split('.').pop().toLowerCase();
    return file.type.startsWith('audio/') || validExtensions.includes(ext);
}

/**
 * Determina con precisión la categoría de la canción:
 * - 'OFFLINE': Tiene link web/drive pero fue DESCARGADA localmente en este dispositivo.
 * - 'LOCAL': Canción propia del dispositivo (carpeta local, sin enlace web asociado).
 * - 'DRIVE': Canción alojada en TokiDrive que se transmite en streaming remoto.
 * - 'WEB': Canción vinculada a la red / YouTube que se transmite en streaming remoto.
 */
export function getTrackSourceState(track) {
    if (!track) return 'LOCAL';
    const hasWeb = Boolean(track.webUrl);
    const hasLocalFile = Boolean(track.file);

    if (hasWeb && hasLocalFile) {
        return 'OFFLINE';
    }
    if (hasWeb && !hasLocalFile) {
        return (track.sourceType === 'drive' || track.webUrl.startsWith('/drive/') || track.webUrl.includes('/drive-stream/')) ? 'DRIVE' : 'WEB';
    }
    if (track.sourceType === 'drive') return 'DRIVE';
    if (track.sourceType === 'web') return 'WEB';
    return 'LOCAL';
}

/**
 * Verifica la integridad binaria y decodificación de audio de un Blob.
 * Retorna { valid: true, duration: string } o { valid: false }.
 */
export function verifyLocalAudioBlob(blob) {
    return new Promise((resolve) => {
        if (!blob || !(blob instanceof Blob) || blob.size < 1024) {
            return resolve({ valid: false });
        }

        const testAudio = new Audio();
        const tempUrl = URL.createObjectURL(blob);
        let settled = false;

        const cleanup = (isValid, durationSecs) => {
            if (settled) return;
            settled = true;
            testAudio.removeAttribute('src');
            testAudio.load();
            URL.revokeObjectURL(tempUrl);

            if (isValid && durationSecs && isFinite(durationSecs) && durationSecs > 0) {
                const mins = Math.floor(durationSecs / 60);
                const secs = Math.floor(durationSecs % 60);
                const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                resolve({ valid: true, duration: formatted });
            } else if (isValid) {
                resolve({ valid: true, duration: null });
            } else {
                resolve({ valid: false });
            }
        };

        const timeout = setTimeout(() => {
            cleanup(false);
        }, 6000);

        testAudio.onloadedmetadata = () => {
            clearTimeout(timeout);
            if (testAudio.duration && isFinite(testAudio.duration) && testAudio.duration > 0) {
                cleanup(true, testAudio.duration);
            } else {
                cleanup(false);
            }
        };

        testAudio.oncanplay = () => {
            clearTimeout(timeout);
            cleanup(true, testAudio.duration);
        };

        testAudio.onerror = () => {
            clearTimeout(timeout);
            cleanup(false);
        };

        testAudio.preload = 'metadata';
        testAudio.src = tempUrl;
    });
}

/**
 * Muestra el loader retro global con mensaje personalizado.
 */
export function showLoader(message = 'PROCESANDO OPERACIÓN...', subMessage = 'ESPERA UN MOMENTO...') {
    const loader = document.getElementById('retro-global-loader');
    const msgEl = document.getElementById('loader-msg');
    const subEl = document.getElementById('loader-submsg');
    if (msgEl) msgEl.textContent = message;
    if (subEl) subEl.textContent = subMessage;
    if (loader) loader.style.display = 'flex';
}

/**
 * Oculta el loader retro global.
 */
export function hideLoader() {
    const loader = document.getElementById('retro-global-loader');
    if (loader) loader.style.display = 'none';
}
