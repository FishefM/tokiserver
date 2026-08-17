/**
 * api.js - Comunicación HTTP con TokiServer y Sincronización SQLite
 */

import { allTracksMap, userPlaylists, setUserPlaylists, appendLog, dom } from './state.js';
import { saveTrackToIDB, deleteTrackFromIDB, getCurrentUser, getAuthToken } from './storage.js';
import { verifyLocalAudioBlob, getTrackSourceState, showLoader, hideLoader } from './utils.js';

export function getBackendUrl() {
    const port = window.location.port;
    const hostname = window.location.hostname;
    // Solo aplicar fallback a :3000 si se ejecuta en localhost con servidor de desarrollo (live-server en 8080 o 5500)
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && (port === '8080' || port === '5500')) {
        return `${window.location.protocol}//${hostname}:3000`;
    }
    return '';
}

/**
 * Wrapper de Fetch con autenticación y manejo de errores estandarizado.
 */
export async function apiFetch(endpoint, options = {}) {
    const url = `${getBackendUrl()}/api/tokitube${endpoint}`;
    const token = getAuthToken();
    const user = getCurrentUser();

    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}`, 'x-auth-token': token } : {}),
        ...(user ? { 'x-user': user } : {}),
        ...(options.headers || {})
    };

    const res = await fetch(url, {
        ...options,
        headers
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const textPreview = await res.text();
        console.error('[TOKITUBE API] Respuesta no-JSON recibida:', res.status, textPreview.slice(0, 150));
        throw new Error(`El servidor respondió con código ${res.status} (No es JSON). Verifica que el backend de TokiServer esté iniciado.`);
    }

    return res.json();
}

/**
 * Sincroniza la biblioteca de listas y metadatos con el backend SQLite y TokiDrive.
 */
export async function syncLibraryWithServer(callbacks = {}) {
    try {
        const data = await apiFetch('/library');
        if (data.success) {
            // Sincronizar listas personalizadas
            const playlists = (data.playlists || []).map(pl => ({
                ...pl,
                trackHashes: []
            }));

            if (Array.isArray(data.playlistTracks)) {
                data.playlistTracks.forEach(pt => {
                    const pl = playlists.find(p => p.id === pt.playlistId);
                    if (pl && !pl.trackHashes.includes(pt.trackHash)) {
                        pl.trackHashes.push(pt.trackHash);
                    }
                });
            }
            setUserPlaylists(playlists);

            // Sincronizar metadatos de pistas guardadas en el servidor y de TokiDrive
            const serverTracks = [...(data.tracks || []), ...(data.driveTracks || [])];
            const validServerHashes = new Set(serverTracks.map(t => t.trackHash));

            // Purgar de memoria y de IndexedDB pistas de Drive o Web que ya no existen en el servidor
            for (const [hash, localTrack] of allTracksMap.entries()) {
                const isRemoteOrDrive = (localTrack.sourceType === 'drive' || localTrack.sourceType === 'web' || Boolean(localTrack.webUrl));
                if (isRemoteOrDrive && !validServerHashes.has(hash) && !localTrack.file) {
                    allTracksMap.delete(hash);
                    deleteTrackFromIDB(hash).catch(() => {});
                }
            }

            if (serverTracks.length > 0) {
                serverTracks.forEach(sTrack => {
                    const isDrive = (sTrack.sourceType === 'drive' || (sTrack.webUrl && sTrack.webUrl.startsWith('/drive/')) || (sTrack.webUrl && sTrack.webUrl.includes('/drive-stream/')));
                    const isWeb = (sTrack.sourceType === 'web' || sTrack.trackHash.startsWith('trk_yt_') || (sTrack.webUrl && !isDrive));

                    let streamSrc = '';
                    if (isDrive) {
                        streamSrc = `${getBackendUrl()}${sTrack.webUrl}`;
                    } else if (isWeb) {
                        streamSrc = `${getBackendUrl()}/api/tokitube/stream/${sTrack.trackHash}?url=${encodeURIComponent(sTrack.webUrl || '')}`;
                    }

                    // Buscar ÚNICAMENTE por hash exacto para nunca alterar ni colisionar con pistas de carpetas locales
                    let existingRemote = allTracksMap.get(sTrack.trackHash);

                    if (existingRemote) {
                        existingRemote.title = sTrack.title || existingRemote.title;
                        existingRemote.artist = sTrack.artist || existingRemote.artist;
                        existingRemote.album = sTrack.album || existingRemote.album;
                        existingRemote.duration = (sTrack.duration && sTrack.duration !== '--:--') ? sTrack.duration : existingRemote.duration;
                        existingRemote.isFavorite = (sTrack.isFavorite === 1 || existingRemote.isFavorite);
                        existingRemote.sourceType = sTrack.sourceType || (isDrive ? 'drive' : (isWeb ? 'web' : 'local'));
                        existingRemote.webUrl = sTrack.webUrl || existingRemote.webUrl;
                        if (!existingRemote.file && streamSrc) {
                            existingRemote.src = streamSrc;
                        }
                        saveTrackToIDB(existingRemote);
                    } else {
                        const newTrack = {
                            trackHash: sTrack.trackHash,
                            title: sTrack.title,
                            artist: sTrack.artist,
                            album: sTrack.album || (isDrive ? 'TokiDrive Music' : (isWeb ? 'Toki Web Stream' : 'Biblioteca')),
                            duration: sTrack.duration || '--:--',
                            format: sTrack.format || (isDrive ? 'DRIVE AUDIO' : (isWeb ? 'M4A / WEB' : 'AUDIO')),
                            sourceType: isDrive ? 'drive' : (isWeb ? 'web' : 'local'),
                            webUrl: sTrack.webUrl,
                            isFavorite: (sTrack.isFavorite === 1),
                            src: streamSrc,
                            file: null,
                            isLocal: false
                        };

                        allTracksMap.set(sTrack.trackHash, newTrack);
                        saveTrackToIDB(newTrack);
                    }
                });
            }

            if (callbacks.onSyncComplete) {
                callbacks.onSyncComplete(data);
            }
            appendLog(`SINCRONIZADO CON SQLITE: ${data.tracks?.length || 0} pistas remotas, ${userPlaylists.length} listas.`);
        }

        // Sincronizar metadatos de pistas remotas en memoria que falten en SQLite
        const remoteTracksToSend = Array.from(allTracksMap.values())
            .filter(t => Boolean(t.webUrl) || t.sourceType === 'web' || t.sourceType === 'drive')
            .map(t => ({
                trackHash: t.trackHash,
                title: t.title,
                artist: t.artist,
                album: t.album,
                duration: t.duration,
                format: t.format,
                sourceType: t.sourceType || 'web',
                webUrl: t.webUrl || null
            }));

        if (remoteTracksToSend.length > 0) {
            apiFetch('/tracks/sync', {
                method: 'POST',
                body: JSON.stringify({ tracks: remoteTracksToSend })
            }).catch(() => {});
        }
    } catch (err) {
        console.warn('[DOROCORO SYNC] Nota: trabajando en modo local o fuera de línea:', err);
    }
}

/**
 * Resuelve duraciones de pistas locales en segundo plano por lotes de 5.
 */
export async function resolveTracksDurations(tracks, onDurationUpdate) {
    const toResolve = tracks.filter(t => !t.duration || t.duration === '--:--' || t.duration === '00:00');
    if (toResolve.length === 0) return;

    const BATCH_SIZE = 5;
    for (let i = 0; i < toResolve.length; i += BATCH_SIZE) {
        const batch = toResolve.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (track) => {
            if (!track.file) return;
            const res = await verifyLocalAudioBlob(track.file);
            if (res.valid && res.duration) {
                track.duration = res.duration;
                saveTrackToIDB(track);
                if (onDurationUpdate) onDurationUpdate(track.trackHash, res.duration);
            }
        }));
    }

    const remoteUpdated = tracks.filter(t => (Boolean(t.webUrl) || t.sourceType === 'web' || t.sourceType === 'drive') && t.duration && t.duration !== '--:--').map(t => ({
        trackHash: t.trackHash,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        format: t.format,
        sourceType: t.sourceType || 'web',
        webUrl: t.webUrl
    }));

    if (remoteUpdated.length > 0) {
        apiFetch('/tracks/sync', {
            method: 'POST',
            body: JSON.stringify({ tracks: remoteUpdated })
        }).catch(() => {});
    }
}

const activeDownloads = new Set();

/**
 * Descarga una canción de Web/Drive y la guarda en IndexedDB para modo Offline.
 * Si la pista ya está descargada, pregunta si se desea eliminar la copia local.
 */
export async function downloadTrackFile(track, onComplete) {
    if (!track) return;

    // Si ya hay una descarga activa para esta pista, evitar duplicados
    if (activeDownloads.has(track.trackHash)) {
        appendLog(`AVISO: La descarga de "${track.title}" ya está en curso.`);
        return;
    }

    const hasLocalCopy = Boolean(track.file) || Boolean(track.isLocal);
    const sourceState = getTrackSourceState(track);

    // Si la pista ya está descargada localmente, preguntar si desea eliminarla
    if (hasLocalCopy || sourceState === 'OFFLINE') {
        const shouldRemove = confirm(`"${track.artist} - ${track.title}" ya se encuentra guardada en este dispositivo.\n\n¿Deseas ELIMINAR la copia local de este equipo?`);
        if (shouldRemove) {
            delete track.file;
            track.isLocal = false;
            allTracksMap.set(track.trackHash, track);
            await saveTrackToIDB(track);
            appendLog(`COPIA LOCAL ELIMINADA: "${track.title}" (Ahora en modo Streaming)`);
            if (onComplete) onComplete();
        }
        // En ningún caso se vuelve a descargar si ya estaba descargada
        return;
    }

    const downloadUrl = (track.sourceType === 'drive' || (track.webUrl && track.webUrl.startsWith('/drive/')) || (track.webUrl && track.webUrl.includes('/drive-stream/')))
        ? `${getBackendUrl()}${track.webUrl}`
        : (track.webUrl
            ? `${getBackendUrl()}/api/tokitube/stream/${track.trackHash}?url=${encodeURIComponent(track.webUrl)}`
            : track.src);

    if (!downloadUrl) {
        appendLog(`ERROR: No hay enlace de transmisión disponible para descargar "${track.title}"`, true);
        return;
    }

    activeDownloads.add(track.trackHash);
    const cleanFilename = `${track.artist} - ${track.title}`.replace(/[/\\?%*:|"<>]/g, '_') + '.mp3';
    appendLog(`INICIANDO DESCARGA OFFLINE: "${track.title}"...`);
    showLoader('DESCARGANDO PISTA OFFLINE...', `Descargando y verificando "${track.title}"...`);

    try {
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status} al descargar archivo.`);

        const blob = await response.blob();
        const verification = await verifyLocalAudioBlob(blob);

        if (!verification.valid) {
            throw new Error('El archivo de audio descargado no tiene formato reproducible válido.');
        }

        let savedToDisk = false;
        if (window.showSaveFilePicker) {
            try {
                const fileHandle = await window.showSaveFilePicker({
                    suggestedName: cleanFilename,
                    types: [{
                        description: 'Audio MP3',
                        accept: { 'audio/mpeg': ['.mp3'], 'audio/*': ['.mp3', '.m4a'] }
                    }]
                });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                savedToDisk = true;
                appendLog(`ARCHIVO GUARDADO EN DISCO: "${cleanFilename}"`);
            } catch (pickerErr) {
                hideLoader();
                if (pickerErr.name === 'AbortError') {
                    appendLog(`DESCARGA CANCELADA POR EL USUARIO: "${track.title}"`);
                    return;
                }
                console.warn('[SAVE PICKER FALLBACK]', pickerErr);
            }
        }

        if (!savedToDisk && !window.showSaveFilePicker) {
            const tempUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = tempUrl;
            a.download = cleanFilename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(tempUrl);
            }, 2000);
        }

        track.file = blob;
        track.isLocal = true;
        if (verification.duration) {
            track.duration = verification.duration;
        }

        allTracksMap.set(track.trackHash, track);
        await saveTrackToIDB(track);

        hideLoader();
        appendLog(`VERIFICACIÓN EXITOSA: "${track.title}" [${track.duration}] guardada en modo OFFLINE.`);
        if (onComplete) onComplete();
    } catch (err) {
        hideLoader();
        console.error('[DOWNLOAD OFFLINE ERROR]', err);
        appendLog(`ERROR AL DESCARGAR: ${err.message}`, true);
    } finally {
        activeDownloads.delete(track.trackHash);
    }
}
