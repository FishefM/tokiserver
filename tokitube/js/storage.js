/**
 * storage.js - Persistencia Local del Cliente en IndexedDB (TokiDorocoroDB)
 */

const DB_NAME = 'TokiDorocoroDB';
const DB_VERSION = 2;
const STORE_TRACKS = 'user_tracks';
const STORE_STATE = 'player_state';

let dbInstance = null;

/**
 * Obtiene el token de sesión autenticado desde localStorage o cookies.
 */
export function getAuthToken() {
    try {
        const token = localStorage.getItem('toki_admin_token');
        if (token) return token;
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, val] = cookie.trim().split('=');
            if (name === 'toki_session' && val) return decodeURIComponent(val);
        }
    } catch (e) {}
    return '';
}

/**
 * Obtiene el usuario autenticado actualmente desde localStorage o cookies.
 */
export function getCurrentUser() {
    try {
        const adminUser = localStorage.getItem('toki_admin_user');
        if (adminUser) return adminUser.toLowerCase();

        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, val] = cookie.trim().split('=');
            if (name === 'toki_user' && val) return decodeURIComponent(val).toLowerCase();
        }
        const localUser = localStorage.getItem('toki_user');
        if (localUser) return localUser.toLowerCase();
    } catch (e) {}
    return 'admin';
}

/**
 * Abre o inicializa la base de datos local IndexedDB.
 */
export function openDatabase() {
    return new Promise((resolve, reject) => {
        if (dbInstance) return resolve(dbInstance);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_TRACKS)) {
                db.createObjectStore(STORE_TRACKS, { keyPath: 'trackHash' });
            }
            if (!db.objectStoreNames.contains(STORE_STATE)) {
                db.createObjectStore(STORE_STATE, { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            console.error('[INDEXEDDB ERROR]', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Guarda o actualiza los metadatos y blob de una pista en IndexedDB.
 */
export async function saveTrackToIDB(track) {
    if (!track || !track.trackHash) return;
    try {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_TRACKS, 'readwrite');
            const store = tx.objectStore(STORE_TRACKS);

            const getReq = store.get(track.trackHash);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                const fileBlob = (track.file && (track.file instanceof Blob || track.file.size > 0))
                    ? track.file
                    : (existing && existing.file ? existing.file : null);

                const record = {
                    trackHash: track.trackHash,
                    username: (getCurrentUser() || 'admin').toLowerCase(),
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    duration: track.duration,
                    format: track.format,
                    rate: track.rate,
                    sourceType: track.sourceType || (fileBlob && !track.webUrl ? 'local' : (track.webUrl ? 'drive' : 'local')),
                    webUrl: track.webUrl || (existing ? existing.webUrl : null),
                    isFavorite: Boolean(track.isFavorite !== undefined ? track.isFavorite : (existing ? existing.isFavorite : false)),
                    file: fileBlob,
                    updatedAt: new Date().toISOString()
                };

                store.put(record);
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (err) {
        console.warn('[IDB SAVE TRACK ERROR]', err);
    }
}

/**
 * Elimina una canción específica de IndexedDB.
 */
export async function deleteTrackFromIDB(trackHash) {
    if (!trackHash) return;
    try {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_TRACKS, 'readwrite');
            const store = tx.objectStore(STORE_TRACKS);
            store.delete(trackHash);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (err) {
        console.warn('[IDB DELETE TRACK ERROR]', err);
    }
}

/**
 * Carga todas las pistas guardadas en IndexedDB sin restricciones artificiales.
 */
export async function loadAllTracksFromIDB() {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const store = tx.objectStore(STORE_TRACKS);
        const req = store.getAll();

        return new Promise((resolve) => {
            req.onsuccess = () => {
                const list = req.result || [];
                const validList = [];
                for (const t of list) {
                    const isRemote = Boolean(t.webUrl) || t.sourceType === 'web' || t.sourceType === 'drive';
                    const hasBlob = Boolean(t.file && (t.file instanceof Blob || (t.file.size && t.file.size > 0)));

                    if (isRemote || hasBlob) {
                        validList.push(t);
                    }
                }
                resolve(validList);
            };
            req.onerror = () => resolve([]);
        });
    } catch (err) {
        return [];
    }
}

/**
 * Guarda el estado del reproductor (carpeta, playlist activa, índice actual).
 */
export async function saveStateToIDB(folderName, activePlaylistId, currentIndex) {
    try {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_STATE, 'readwrite');
            const store = tx.objectStore(STORE_STATE);
            store.put({
                id: 'dorocoro_app_state',
                folderName: folderName || 'Carpeta Local',
                activePlaylistId: activePlaylistId || 'all',
                currentIndex: currentIndex || 0,
                updatedAt: new Date().toISOString()
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (err) {
        console.warn('[IDB SAVE STATE ERROR]', err);
    }
}

/**
 * Carga el estado guardado del reproductor para este navegador.
 */
export async function loadStateFromIDB() {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_STATE, 'readonly');
        const store = tx.objectStore(STORE_STATE);
        const req = store.get('dorocoro_app_state');
        return new Promise((resolve) => {
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (err) {
        return null;
    }
}

/**
 * Guarda la cola de reproducción activa exclusivamente en IndexedDB local (0 llamadas a backend).
 */
export async function saveQueueToIDB(queue, currentIndex) {
    try {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_STATE, 'readwrite');
            const store = tx.objectStore(STORE_STATE);
            const trackHashes = Array.isArray(queue) ? queue.map(t => t.trackHash) : [];
            store.put({
                id: 'tokitube_playback_queue',
                queueHashes: trackHashes,
                currentIndex: typeof currentIndex === 'number' ? currentIndex : 0,
                updatedAt: new Date().toISOString()
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (err) {
        console.warn('[IDB SAVE QUEUE ERROR]', err);
    }
}

/**
 * Carga la cola de reproducción guardada localmente en IndexedDB.
 */
export async function loadQueueFromIDB() {
    try {
        const db = await openDatabase();
        const tx = db.transaction(STORE_STATE, 'readonly');
        const store = tx.objectStore(STORE_STATE);
        const req = store.get('tokitube_playback_queue');
        return new Promise((resolve) => {
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (err) {
        return null;
    }
}

/**
 * Vacía completamente el almacenamiento IndexedDB de este navegador para el usuario actual.
 */
export async function clearAllLocalDataFromIDB() {
    try {
        const db = await openDatabase();
        const tx = db.transaction([STORE_TRACKS, STORE_STATE], 'readwrite');
        tx.objectStore(STORE_TRACKS).clear();
        tx.objectStore(STORE_STATE).clear();
    } catch (err) {
        console.warn('[IDB CLEAR ERROR]', err);
    }
}

