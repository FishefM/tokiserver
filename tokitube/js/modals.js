import {
    dom,
    allTracksMap,
    userPlaylists,
    setUserPlaylists,
    currentQueue,
    currentIndex,
    appendLog
} from './state.js';
import { apiFetch, getBackendUrl } from './api.js';
import { saveTrackToIDB, saveTracksBatchToIDB, saveQueueToIDB, getCurrentUser, getAuthToken } from './storage.js';
import { showLoader, hideLoader } from './utils.js';

let activeEditTrackHash = null;

export function getActiveEditTrack() {
    return activeEditTrackHash ? allTracksMap.get(activeEditTrackHash) : null;
}

// =============================================================================
// MODAL: NUEVA PLAYLIST (CREAR O IMPORTAR DESDE YOUTUBE/WEB)
// =============================================================================
export function openNewPlaylistModal() {
    if (!dom.modalNewPlaylist) return;
    switchPlaylistTab('url');
    if (dom.inputNewPlaylistName) {
        dom.inputNewPlaylistName.value = '';
    }
    if (dom.inputPlaylistImportUrl) {
        dom.inputPlaylistImportUrl.value = '';
    }
    if (dom.newPlImportStatus) {
        dom.newPlImportStatus.style.display = 'none';
        dom.newPlImportStatus.textContent = '';
    }
    if (dom.btnConfirmNewPlaylist) {
        dom.btnConfirmNewPlaylist.disabled = false;
        dom.btnConfirmNewPlaylist.textContent = 'CREAR / IMPORTAR';
    }

    dom.modalNewPlaylist.style.display = 'flex';
    if (dom.inputNewPlaylistName) {
        dom.inputNewPlaylistName.focus();
    }
}

export function closeNewPlaylistModal() {
    if (dom.modalNewPlaylist) dom.modalNewPlaylist.style.display = 'none';
}

export async function handleConfirmNewPlaylist(onCreated) {
    const customName = dom.inputNewPlaylistName ? dom.inputNewPlaylistName.value.trim() : '';
    const importUrl = dom.inputPlaylistImportUrl ? dom.inputPlaylistImportUrl.value.trim() : '';

    if (!customName && !importUrl) {
        appendLog('ERROR: Ingresa un nombre para la lista o pega una URL de YouTube para importar.', true);
        if (dom.newPlImportStatus) {
            dom.newPlImportStatus.style.display = 'block';
            dom.newPlImportStatus.style.borderColor = 'var(--red-alert)';
            dom.newPlImportStatus.style.color = 'var(--red-alert)';
            dom.newPlImportStatus.textContent = 'Ingresa un nombre o pega una URL de playlist.';
        }
        return;
    }

    // CASO 1: Importar lista completa desde YouTube / Spotify con yt-dlp
    if (importUrl) {
        const isSpotify = importUrl.includes('spotify.com');
        const platformName = isSpotify ? 'SPOTIFY' : 'YOUTUBE';

        if (dom.newPlImportStatus) {
            dom.newPlImportStatus.style.display = 'block';
            dom.newPlImportStatus.style.borderColor = 'var(--magenta-neon)';
            dom.newPlImportStatus.style.color = '#fff';
            dom.newPlImportStatus.textContent = `EXTRAYENDO CANCIONES DE ${platformName}... ESPERA UN MOMENTO...`;
        }
        if (dom.btnConfirmNewPlaylist) {
            dom.btnConfirmNewPlaylist.disabled = true;
            dom.btnConfirmNewPlaylist.textContent = 'IMPORTANDO...';
        }

        showLoader(`IMPORTANDO LISTA DE ${platformName}...`, 'Extrayendo metadatos y preparando catálogo de streaming...');
        appendLog(`PROCESANDO IMPORTACIÓN DE LISTA WEB (${platformName}): ${importUrl}`);

        try {
            const data = await apiFetch('/playlists/import-web', {
                method: 'POST',
                body: JSON.stringify({ url: importUrl, name: customName })
            });

            hideLoader();

            if (data.success && data.playlist) {
                // Guardar las pistas importadas en memoria y en IndexedDB en lote atómico
                if (Array.isArray(data.tracks)) {
                    data.tracks.forEach(trk => allTracksMap.set(trk.trackHash, trk));
                    await saveTracksBatchToIDB(data.tracks);
                }

                setUserPlaylists([...userPlaylists, data.playlist]);
                appendLog(`PLAYLIST IMPORTADA DE ${platformName}: "${data.playlist.name.toUpperCase()}" (${data.importedCount || 0} pistas)`);

                if (isSpotify && data.importedCount >= 100) {
                    appendLog(`[AVISO SPOTIFY] Se extrajeron las primeras 100 canciones (límite máximo de Spotify Web). Si tu lista tiene más pistas, impórtala desde YouTube para obtener el 100%.`, true);
                }

                closeNewPlaylistModal();
                document.dispatchEvent(new CustomEvent('dorocoro:playlist-changed', { detail: { playlistId: data.playlist.id } }));
                if (onCreated) onCreated(data.playlist.id);
            } else {
                const errMsg = data.error || 'No se pudieron extraer canciones del enlace.';
                appendLog(`ERROR AL IMPORTAR LISTA: ${errMsg}`, true);
                if (dom.newPlImportStatus) {
                    dom.newPlImportStatus.style.display = 'block';
                    dom.newPlImportStatus.style.borderColor = 'var(--red-alert)';
                    dom.newPlImportStatus.style.color = 'var(--red-alert)';
                    dom.newPlImportStatus.textContent = `Error: ${errMsg}`;
                }
                if (dom.btnConfirmNewPlaylist) {
                    dom.btnConfirmNewPlaylist.disabled = false;
                    dom.btnConfirmNewPlaylist.textContent = 'REINTENTAR';
                }
            }
        } catch (err) {
            hideLoader();
            console.error('[IMPORT PLAYLIST ERROR]', err);
            appendLog(`ERROR DE CONEXIÓN AL IMPORTAR LISTA: ${err.message}`, true);
            if (dom.newPlImportStatus) {
                dom.newPlImportStatus.style.display = 'block';
                dom.newPlImportStatus.style.borderColor = 'var(--red-alert)';
                dom.newPlImportStatus.style.color = 'var(--red-alert)';
                dom.newPlImportStatus.textContent = 'Error de conexión con el servidor al procesar la lista.';
            }
            if (dom.btnConfirmNewPlaylist) {
                dom.btnConfirmNewPlaylist.disabled = false;
                dom.btnConfirmNewPlaylist.textContent = 'REINTENTAR';
            }
        }
        return;
    }

    // CASO 2: Creación manual de lista vacía
    const playlistId = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
        const data = await apiFetch('/playlists', {
            method: 'POST',
            body: JSON.stringify({ id: playlistId, name: customName })
        });

        if (data.success) {
            const newPl = {
                id: playlistId,
                name: customName,
                trackHashes: []
            };
            setUserPlaylists([...userPlaylists, newPl]);
            appendLog(`PLAYLIST CREADA CON ÉXITO: "${customName.toUpperCase()}"`);
            closeNewPlaylistModal();
            document.dispatchEvent(new CustomEvent('dorocoro:playlist-changed', { detail: { playlistId } }));
            if (onCreated) onCreated(playlistId);
        } else {
            appendLog(`ERROR AL CREAR PLAYLIST: ${data.error || 'Error del servidor'}`, true);
        }
    } catch (err) {
        appendLog(`ERROR DE CONEXIÓN AL CREAR PLAYLIST`, true);
    }
}

// =============================================================================
// MODAL: EDITAR METADATOS Y ENLACE DE PISTA
// =============================================================================
export function openEditTrackModal(track, onSaved) {
    if (!dom.modalEditTrack || !track) return;
    activeEditTrackHash = track.trackHash;

    if (dom.editTrackTitle) dom.editTrackTitle.value = track.title || '';
    if (dom.editTrackArtist) dom.editTrackArtist.value = track.artist || '';
    if (dom.editTrackAlbum) dom.editTrackAlbum.value = track.album || '';
    if (dom.editTrackUrl) dom.editTrackUrl.value = track.webUrl || '';

    dom.modalEditTrack.style.display = 'flex';
    if (dom.editTrackTitle) dom.editTrackTitle.focus();
}

export function closeEditTrackModal() {
    if (dom.modalEditTrack) dom.modalEditTrack.style.display = 'none';
    activeEditTrackHash = null;
}

export async function handleConfirmEditTrack(onSaved) {
    if (!activeEditTrackHash) return;
    const track = allTracksMap.get(activeEditTrackHash);
    if (!track) return;

    const newTitle = dom.editTrackTitle ? dom.editTrackTitle.value.trim() : '';
    const newArtist = dom.editTrackArtist ? dom.editTrackArtist.value.trim() : '';
    const newAlbum = dom.editTrackAlbum ? dom.editTrackAlbum.value.trim() : '';
    const newUrl = dom.editTrackUrl ? dom.editTrackUrl.value.trim() : '';

    if (!newTitle) {
        appendLog('ERROR: El título no puede estar vacío.', true);
        return;
    }

    track.title = newTitle;
    track.artist = newArtist || 'Desconocido';
    track.album = newAlbum || 'Álbum';

    // Actualizar enlace y fuente si cambió
    if (newUrl !== (track.webUrl || '')) {
        track.webUrl = newUrl;
        if (newUrl) {
            const isDrive = (newUrl.startsWith('/drive/') || newUrl.includes('/drive-stream/'));
            track.sourceType = isDrive ? 'drive' : 'web';
            track.src = isDrive
                ? `${getBackendUrl()}${newUrl}`
                : `${getBackendUrl()}/api/tokitube/stream/${track.trackHash}?url=${encodeURIComponent(newUrl)}`;
        } else if (track.file) {
            track.sourceType = 'local';
            track.src = URL.createObjectURL(track.file);
        } else {
            track.sourceType = 'local';
            track.src = '';
        }
    }

    allTracksMap.set(activeEditTrackHash, track);
    await saveTrackToIDB(track);

    // Actualizar instancias activas en la cola de reproducción
    currentQueue.forEach(item => {
        if (item.trackHash === track.trackHash) {
            item.title = track.title;
            item.artist = track.artist;
            item.album = track.album;
            item.webUrl = track.webUrl;
            item.sourceType = track.sourceType;
            if (track.src) item.src = track.src;
        }
    });
    saveQueueToIDB(currentQueue, currentIndex);

    // Si el track editado está sonando actualmente, actualizar LCD del Deck
    if (currentQueue[currentIndex]?.trackHash === track.trackHash) {
        if (dom.trackTitle) dom.trackTitle.textContent = track.title;
        if (dom.trackArtist) dom.trackArtist.textContent = track.artist;
    }

    // Sincronizar con el backend SQLite
    apiFetch(`/tracks/${activeEditTrackHash}`, {
        method: 'PUT',
        body: JSON.stringify({
            title: track.title,
            artist: track.artist,
            album: track.album,
            webUrl: track.webUrl || null,
            sourceType: track.sourceType || 'web'
        })
    }).catch(() => {});

    appendLog(`METADATOS Y ENLACE ACTUALIZADOS: "${track.artist} - ${track.title}" ${track.webUrl ? `[${track.webUrl.slice(0, 40)}...]` : ''}`);
    document.dispatchEvent(new CustomEvent('dorocoro:track-relinked', { detail: { track } }));
    closeEditTrackModal();
    if (onSaved) onSaved(track);
}

// =============================================================================
// MODAL: AGREGAR A PLAYLIST / VINCULACIÓN WEB/DRIVE
// =============================================================================
export function openAddToPlaylistModal(track, onTrackLinked) {
    if (!dom.modalAddToPlaylist || !track) return;
    if (dom.addToPlTrackHash) dom.addToPlTrackHash.value = track.trackHash;
    if (dom.addToPlTrackName) {
        dom.addToPlTrackName.textContent = `Pista: ${track.artist} - ${track.title}`;
    }

    const container = dom.addToPlListOptions;
    if (!container) return;
    container.innerHTML = '';

    const isLinked = Boolean(track.webUrl) || track.sourceType === 'web' || track.sourceType === 'drive';

    if (isLinked) {
        renderTargetPlaylistsList(container, track, onTrackLinked);
    } else {
        renderLinkWizard(container, track, onTrackLinked);
    }

    dom.modalAddToPlaylist.style.display = 'flex';
}

export function closeAddToPlaylistModal() {
    if (dom.modalAddToPlaylist) dom.modalAddToPlaylist.style.display = 'none';
}

function renderTargetPlaylistsList(container, track, onTrackLinked) {
    const customPlaylists = userPlaylists.filter(p => p.id !== 'all' && p.id !== 'drive' && p.id !== 'favorites');

    container.innerHTML = `
        <!-- Sección de Creación Rápida de Nueva Playlist -->
        <div class="modal-inline-create-box">
            <div class="modal-inline-create-label">CREAR NUEVA PLAYLIST Y AGREGAR ESTA PISTA:</div>
            <div class="modal-inline-create-row">
                <input type="text" id="input-modal-inline-new-pl" class="modal-input" placeholder="Nombre de la nueva lista..." maxlength="40">
                <button type="button" class="btn-pl-action primary" id="btn-modal-inline-create-pl">
                    <span class="pixel-icon-mask magenta" style="-webkit-mask-image: url('/img/icons/plus.svg'); mask-image: url('/img/icons/plus.svg'); width: 12px; height: 12px;"></span>
                    <span>CREAR Y AGREGAR</span>
                </button>
            </div>
            <div id="modal-inline-create-status" style="display: none; font-size: 0.85rem; margin-top: 4px; color: var(--magenta-neon);"></div>
        </div>

        <!-- Lista de Playlists Existentes -->
        <div class="modal-existing-pls-title">TUS PLAYLISTS EXISTENTES:</div>
        <div class="modal-existing-pls-list">
            ${customPlaylists.length === 0 ? `
                <div style="padding: 14px; text-align: center; opacity: 0.7; font-size: 0.95rem;">
                    No tienes listas creadas aún. Escribe un nombre arriba para crear tu primera lista.
                </div>
            ` : ''}
        </div>
    `;

    // Handler para Crear y Agregar Inline
    const inlineInput = container.querySelector('#input-modal-inline-new-pl');
    const inlineBtn = container.querySelector('#btn-modal-inline-create-pl');
    const inlineStatus = container.querySelector('#modal-inline-create-status');

    const handleCreateInline = async () => {
        const name = (inlineInput.value || '').trim();
        if (!name) {
            if (inlineStatus) {
                inlineStatus.style.display = 'block';
                inlineStatus.textContent = 'Ingresa un nombre para la nueva playlist.';
            }
            if (inlineInput) inlineInput.focus();
            return;
        }

        inlineBtn.disabled = true;
        inlineBtn.textContent = 'CREANDO...';

        const playlistId = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        try {
            // 1. Crear playlist en backend
            const createRes = await apiFetch('/playlists', {
                method: 'POST',
                body: JSON.stringify({ id: playlistId, name })
            });

            if (createRes.success) {
                // 2. Agregar pista a la nueva playlist
                await apiFetch(`/playlists/${playlistId}/tracks`, {
                    method: 'POST',
                    body: JSON.stringify({ trackHash: track.trackHash })
                });

                const newPl = {
                    id: playlistId,
                    name,
                    trackHashes: [track.trackHash]
                };

                setUserPlaylists([...userPlaylists, newPl]);
                appendLog(`PLAYLIST CREADA Y PISTA AGREGADA: "${name.toUpperCase()}" -> "${track.title}"`);
                
                document.dispatchEvent(new CustomEvent('dorocoro:playlist-changed', { detail: { playlistId, track } }));
                if (onTrackLinked) onTrackLinked(track);

                renderTargetPlaylistsList(container, track, onTrackLinked);
            } else {
                if (inlineStatus) {
                    inlineStatus.style.display = 'block';
                    inlineStatus.textContent = createRes.error || 'Error al crear la playlist.';
                }
                inlineBtn.disabled = false;
                inlineBtn.textContent = 'CREAR Y AGREGAR';
            }
        } catch (err) {
            console.error('[INLINE CREATE PL ERROR]', err);
            if (inlineStatus) {
                inlineStatus.style.display = 'block';
                inlineStatus.textContent = 'Error de conexión con el servidor.';
            }
            inlineBtn.disabled = false;
            inlineBtn.textContent = 'CREAR Y AGREGAR';
        }
    };

    if (inlineBtn) inlineBtn.addEventListener('click', handleCreateInline);
    if (inlineInput) {
        inlineInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleCreateInline();
            }
        });
    }

    // Renderizar filas de playlists existentes
    const existingListEl = container.querySelector('.modal-existing-pls-list');
    if (existingListEl && customPlaylists.length > 0) {
        customPlaylists.forEach(pl => {
            const isAlreadyIn = (pl.trackHashes || []).includes(track.trackHash);
            const row = document.createElement('div');
            row.className = 'modal-pl-row';
            row.innerHTML = `
                <span class="modal-pl-name" title="${pl.name}">[PLAYLIST] ${pl.name} (${(pl.trackHashes || []).length} pistas)</span>
                <button type="button" class="btn-pl-action ${isAlreadyIn ? 'danger' : 'primary'}">
                    ${isAlreadyIn ? 'QUITAR' : '+ AGREGAR'}
                </button>
            `;

            row.querySelector('button').addEventListener('click', async () => {
                const btn = row.querySelector('button');
                btn.disabled = true;
                btn.textContent = '...';

                if (isAlreadyIn) {
                    await apiFetch(`/playlists/${pl.id}/tracks/${track.trackHash}`, { method: 'DELETE' });
                    pl.trackHashes = pl.trackHashes.filter(h => h !== track.trackHash);
                    appendLog(`PISTA QUITADA DE [${pl.name}]: ${track.title}`);
                } else {
                    await apiFetch(`/playlists/${pl.id}/tracks`, {
                        method: 'POST',
                        body: JSON.stringify({ trackHash: track.trackHash })
                    });
                    if (!pl.trackHashes.includes(track.trackHash)) {
                        pl.trackHashes.push(track.trackHash);
                    }
                    appendLog(`PISTA AGREGADA A [${pl.name}]: ${track.title}`);
                }

                renderTargetPlaylistsList(container, track, onTrackLinked);
                document.dispatchEvent(new CustomEvent('dorocoro:playlist-changed', { detail: { playlistId: pl.id, track } }));
                if (onTrackLinked) onTrackLinked(track);
            });

            existingListEl.appendChild(row);
        });
    }
}

function getCleanQuery(track) {
    let raw = track.title || '';
    raw = raw.replace(/\.(mp3|m4a|wav|flac|ogg|opus|aac|webm|mp4)$/i, '');
    raw = raw.replace(/^\d+[\s.-]+/, '');
    raw = raw.replace(/_/g, ' ').trim();

    const badArtists = ['PISTA LOCAL', 'LOCAL', 'DESCONOCIDO', 'ADMIN', 'CARPETA LOCAL', 'CARPETA'];
    const artist = (track.artist && !badArtists.includes(track.artist.toUpperCase().trim()))
        ? track.artist.trim()
        : '';

    if (artist && !raw.toLowerCase().includes(artist.toLowerCase())) {
        return `${artist} ${raw}`;
    }
    return raw;
}

function renderLinkWizard(container, track, onTrackLinked) {
    const initialQuery = getCleanQuery(track);

    container.innerHTML = `
        <div class="web-link-box">
            <div class="web-link-notice">
                Esta pista es <strong>exclusivamente local</strong>. Para agregarla a una lista multi-dispositivo, selecciónala de las coincidencias web o súbela a tu TokiDrive:
            </div>
            
            <!-- Barra de Refinamiento de Búsqueda -->
            <div class="web-direct-url-row">
                <input type="text" id="modal-wizard-search-input" class="web-direct-url-input" value="${initialQuery}" placeholder="Buscar en la red...">
                <button type="button" class="btn-web-link" id="btn-modal-wizard-search">BUSCAR</button>
            </div>

            <!-- Lista de Coincidencias Candidatas -->
            <div id="link-wizard-candidates" class="web-candidates-list">
                <div style="text-align: center; opacity: 0.7; padding: 25px; font-size: 1rem;">
                    BUSCANDO COINCIDENCIAS AUTOMÁTICAS CON YT-DLP...
                </div>
            </div>

            <!-- Enlace Directo -->
            <div class="web-direct-url-row">
                <input type="text" id="modal-direct-web-url" class="web-direct-url-input" placeholder="O pega un enlace de YouTube...">
                <button type="button" class="btn-web-link" id="btn-modal-apply-url">VINCULAR</button>
            </div>

            <!-- Subir a TokiDrive -->
            <div style="margin-top: 2px;">
                <button type="button" class="btn-modal" id="btn-modal-upload-drive" style="width: 100%; border-color: #ffd700; color: #ffd700; background: rgba(255, 215, 0, 0.08); font-size: 0.95rem; padding: 6px;">
                    [↑] SUBIR A MI TOKIDRIVE Y VINCULAR
                </button>
            </div>
        </div>
    `;

    const candidatesBox = container.querySelector('#link-wizard-candidates');
    const searchInput = container.querySelector('#modal-wizard-search-input');
    const searchBtn = container.querySelector('#btn-modal-wizard-search');
    const directInput = container.querySelector('#modal-direct-web-url');
    const directBtn = container.querySelector('#btn-modal-apply-url');
    const driveUploadBtn = container.querySelector('#btn-modal-upload-drive');

    const applyWebLink = async (cand) => {
        track.webUrl = cand.webUrl;
        track.sourceType = cand.sourceType || 'web';
        if (cand.thumbnail) track.thumbnail = cand.thumbnail;
        allTracksMap.set(track.trackHash, track);
        await saveTrackToIDB(track);

        apiFetch('/tracks/sync', {
            method: 'POST',
            body: JSON.stringify({
                tracks: [{
                    trackHash: track.trackHash,
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    duration: track.duration,
                    format: track.format,
                    sourceType: track.sourceType,
                    webUrl: track.webUrl
                }]
            })
        }).catch(() => {});

        appendLog(`PISTA VINCULADA: "${track.title}" -> ${cand.title || cand.webUrl}`);
        if (onTrackLinked) onTrackLinked(track);
        renderTargetPlaylistsList(container, track, onTrackLinked);
    };

    const executeSearch = (qText) => {
        const query = (qText || '').trim();
        if (!query || !candidatesBox) return;

        candidatesBox.innerHTML = `
            <div style="text-align: center; opacity: 0.7; padding: 25px; font-size: 1rem;">
                BUSCANDO EN LA RED: "${query.toUpperCase()}"...
            </div>
        `;

        apiFetch(`/search?q=${encodeURIComponent(query)}&limit=8`).then(data => {
            if (!candidatesBox) return;
            if (data.success && Array.isArray(data.results) && data.results.length > 0) {
                candidatesBox.innerHTML = '';
                data.results.forEach(cand => {
                    const row = document.createElement('div');
                    row.className = 'web-candidate-item';
                    row.innerHTML = `
                        <div class="web-candidate-info">
                            ${cand.thumbnail 
                                ? `<img src="${cand.thumbnail}" class="web-candidate-thumb" alt="cover" loading="lazy">` 
                                : `<span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/music.svg'); mask-image: url('/img/icons/music.svg'); width: 20px; height: 20px;"></span>`}
                            <div class="web-candidate-text">
                                <div style="color: var(--green); font-size: 0.98rem;" title="${cand.title}">${cand.title}</div>
                                <div style="font-size: 0.85rem; opacity: 0.8;">${cand.artist} &bull; ${cand.duration}</div>
                            </div>
                        </div>
                        <button type="button" class="btn-web-link" style="padding: 5px 10px;">VINCULAR</button>
                    `;

                    row.querySelector('.btn-web-link').addEventListener('click', () => {
                        applyWebLink(cand);
                    });

                    candidatesBox.appendChild(row);
                });
            } else {
                candidatesBox.innerHTML = `
                    <div style="text-align: center; opacity: 0.7; padding: 20px; font-size: 0.95rem; line-height: 1.4;">
                        No se encontraron coincidencias automáticas para "${query}".<br>
                        Puedes editar el término en el buscador arriba, pegar un enlace de YouTube o subirla a TokiDrive.
                    </div>
                `;
            }
        }).catch(err => {
            if (candidatesBox) {
                candidatesBox.innerHTML = `
                    <div style="text-align: center; color: var(--red-alert); padding: 20px;">
                        Error al consultar el servicio de búsqueda de TokiServer.
                    </div>
                `;
            }
        });
    };

    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => executeSearch(searchInput.value));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') executeSearch(searchInput.value);
        });
    }

    if (driveUploadBtn) {
        driveUploadBtn.addEventListener('click', async () => {
            const doUpload = async (fileObj) => {
                appendLog(`SUBIENDO "${fileObj.name}" A TOKIDRIVE (drive/Music/)...`);
                driveUploadBtn.textContent = "SUBIENDO A TOKIDRIVE...";
                driveUploadBtn.disabled = true;

                const formData = new FormData();
                formData.append('file', fileObj);

                try {
                    const token = getAuthToken();
                    const user = getCurrentUser();
                    const uploadRes = await fetch(`${getBackendUrl()}/api/tokitube/upload-to-drive`, {
                        method: 'POST',
                        headers: {
                            ...(token ? { 'Authorization': `Bearer ${token}`, 'x-auth-token': token } : {}),
                            ...(user ? { 'x-user': user } : {})
                        },
                        body: formData
                    });
                    const data = await uploadRes.json();
                    if (data.success && data.webUrl) {
                        applyWebLink({
                            webUrl: data.webUrl,
                            sourceType: 'drive',
                            title: track.title
                        });
                    } else {
                        throw new Error(data.error || 'Error en la respuesta del servidor');
                    }
                } catch (upErr) {
                    console.error('[DRIVE UPLOAD ERROR]', upErr);
                    appendLog(`ERROR AL SUBIR A DRIVE: ${upErr.message}`, true);
                    driveUploadBtn.textContent = "[↑] SUBIR A MI TOKIDRIVE Y VINCULAR";
                    driveUploadBtn.disabled = false;
                }
            };

            if (!track.file) {
                const tempInput = document.createElement('input');
                tempInput.type = 'file';
                tempInput.accept = 'audio/*';
                tempInput.onchange = async (e) => {
                    if (e.target.files && e.target.files[0]) {
                        await doUpload(e.target.files[0]);
                    }
                };
                tempInput.click();
                return;
            }
            await doUpload(track.file);
        });
    }

    if (directBtn && directInput) {
        directBtn.addEventListener('click', () => {
            const url = directInput.value.trim();
            if (!url) return;
            applyWebLink({
                webUrl: url,
                sourceType: 'web',
                thumbnail: '',
                duration: track.duration || '--:--'
            });
        });
    }

    // Iniciar búsqueda automática de coincidencias
    executeSearch(initialQuery);
}

// =============================================================================
// MODAL: REPARAR / CAMBIAR ENLACE O FUENTE DE PISTA
// =============================================================================
export function openRelinkTrackModal(track, isErrorMode = false, onRelinked = null) {
    if (!dom.modalRelinkTrack || !track) return;

    if (dom.relinkTrackName) {
        dom.relinkTrackName.innerHTML = `
            <div style="font-size: 1.15rem; color: var(--green); font-weight: bold;">[${track.artist}] - ${track.title}</div>
            ${isErrorMode ? `<div style="color: var(--red-alert); font-size: 0.95rem; margin-top: 6px; line-height: 1.3;">[AVISO] El video o enlace de audio anterior no está disponible en YouTube (video eliminado, privado o no disponible). Elige o busca una alternativa abajo:</div>` : ''}
        `;
    }

    if (dom.btnRelinkSkipNext) {
        dom.btnRelinkSkipNext.style.display = isErrorMode ? 'inline-flex' : 'none';
    }

    if (dom.relinkTrackContent) {
        renderLinkWizard(dom.relinkTrackContent, track, async (updatedTrack) => {
            closeRelinkTrackModal();
            // Actualizar todas las instancias de esta pista en la cola de reproducción
            currentQueue.forEach(item => {
                if (item.trackHash === updatedTrack.trackHash) {
                    item.webUrl = updatedTrack.webUrl;
                    item.sourceType = updatedTrack.sourceType;
                    if (updatedTrack.thumbnail) item.thumbnail = updatedTrack.thumbnail;
                }
            });
            saveQueueToIDB(currentQueue, currentIndex);

            appendLog(`[ENLACE ACTUALIZADO] Fuente corregida para: "${updatedTrack.title}"`);
            document.dispatchEvent(new CustomEvent('dorocoro:track-relinked', { detail: { track: updatedTrack } }));
            if (onRelinked) onRelinked(updatedTrack);
        });
    }

    dom.modalRelinkTrack.style.display = 'flex';
}

export function closeRelinkTrackModal() {
    if (dom.modalRelinkTrack) {
        dom.modalRelinkTrack.style.display = 'none';
    }
}

// =============================================================================
// GESTIÓN DE CUENTA SPOTIFY (OAUTH 2.0)
// =============================================================================
export let spotifyAccountState = {
    connected: false,
    displayName: '',
    userId: '',
    avatar: null
};

/**
 * Consulta el estado de vinculación de Spotify con el backend
 */
export async function checkSpotifyStatus() {
    try {
        const data = await apiFetch('/spotify/status');
        if (data && data.success && data.connected) {
            spotifyAccountState = {
                connected: true,
                displayName: data.spotifyDisplayName || 'Usuario Spotify',
                userId: data.spotifyUserId || '',
                avatar: data.spotifyAvatar || null
            };
            if (dom.btnWinSpotify) {
                dom.btnWinSpotify.textContent = `[SPOTIFY: ${spotifyAccountState.displayName.toUpperCase()}]`;
                dom.btnWinSpotify.style.display = 'none';
            }
            if (dom.spotifyMyPlaylistsUserBadge) {
                dom.spotifyMyPlaylistsUserBadge.textContent = `[CONECTADO: ${spotifyAccountState.displayName.toUpperCase()}]`;
            }
            if (dom.btnUnlinkSpotifyTab) {
                dom.btnUnlinkSpotifyTab.style.display = 'inline-block';
            }
        } else {
            spotifyAccountState = {
                connected: false,
                displayName: '',
                userId: '',
                avatar: null
            };
            if (dom.btnWinSpotify) {
                dom.btnWinSpotify.textContent = '[SPOTIFY]';
                dom.btnWinSpotify.style.display = 'none';
            }
            if (dom.spotifyMyPlaylistsUserBadge) {
                dom.spotifyMyPlaylistsUserBadge.textContent = '[ESTADO: NO VINCULADO]';
            }
            if (dom.btnUnlinkSpotifyTab) {
                dom.btnUnlinkSpotifyTab.style.display = 'none';
            }
        }
        document.dispatchEvent(new CustomEvent('dorocoro:spotify-status-changed', { detail: spotifyAccountState }));
        return spotifyAccountState;
    } catch (err) {
        console.warn('[SPOTIFY STATUS CHECK ERROR]', err);
        return spotifyAccountState;
    }
}

/**
 * Abre la ventana emergente centrada para el inicio de sesión OAuth de Spotify
 */
export function openSpotifyLoginPopup() {
    const width = 520;
    const height = 720;
    const left = Math.max(0, (window.screen.width - width) / 2);
    const top = Math.max(0, (window.screen.height - height) / 2);
    const user = (getCurrentUser() || 'admin').toLowerCase();
    const token = getAuthToken() || '';
    const query = new URLSearchParams({ user, token }).toString();
    const url = `${getBackendUrl()}/api/tokitube/spotify/login?${query}`;

    appendLog(`[SPOTIFY] Abriendo ventana de inicio de sesión oficial para usuario "${user}"...`);
    window.open(url, 'tokitube_spotify_auth', `width=${width},height=${height},top=${top},left=${left},status=no,toolbar=no,menubar=no,location=no`);
}

/**
 * Abre el modal de configuración de cuenta de Spotify
 */
export async function openSpotifyAccountModal() {
    if (!dom.modalSpotifyAccount) return;
    await checkSpotifyStatus();

    if (dom.spotifyAccountStatusText) {
        dom.spotifyAccountStatusText.textContent = spotifyAccountState.connected
            ? `[CUENTA VINCULADA: ${spotifyAccountState.displayName.toUpperCase()}]`
            : '[CUENTA DE SPOTIFY NO VINCULADA]';
        dom.spotifyAccountStatusText.style.color = spotifyAccountState.connected ? 'var(--green)' : 'var(--magenta-neon)';
    }

    if (dom.spotifyAccountDetails) {
        if (spotifyAccountState.connected) {
            dom.spotifyAccountDetails.style.display = 'block';
            dom.spotifyAccountDetails.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; margin-top: 6px;">
                    ${spotifyAccountState.avatar ? `<img src="${spotifyAccountState.avatar}" style="width: 44px; height: 44px; border: 1px solid var(--green); border-radius: 4px;">` : `<div style="width: 44px; height: 44px; background: rgba(0,255,65,0.1); border: 1px solid var(--green); display: flex; align-items: center; justify-content: center; font-size: 0.75rem;">USER</div>`}
                    <div>
                        <div style="font-weight: bold; color: var(--green); font-size: 1.05rem;">${spotifyAccountState.displayName}</div>
                        <div style="font-size: 0.8rem; color: rgba(255,255,255,0.6);">ID Spotify: ${spotifyAccountState.userId || 'N/A'}</div>
                    </div>
                </div>
            `;
        } else {
            dom.spotifyAccountDetails.style.display = 'block';
            dom.spotifyAccountDetails.innerHTML = `
                <div style="color: rgba(255,255,255,0.85); font-size: 0.9rem; margin-top: 4px;">
                    Inicia sesión con tu cuenta de Spotify para habilitar la extracción de playlists completas sin límite de 100 canciones y explorar tus listas personales.
                </div>
            `;
        }
    }

    if (dom.btnActionSpotifyAuth) {
        if (spotifyAccountState.connected) {
            dom.btnActionSpotifyAuth.textContent = 'DESVINCULAR CUENTA';
            dom.btnActionSpotifyAuth.style.borderColor = 'var(--red-alert)';
            dom.btnActionSpotifyAuth.style.color = 'var(--red-alert)';
        } else {
            dom.btnActionSpotifyAuth.textContent = 'INICIAR SESIÓN CON SPOTIFY';
            dom.btnActionSpotifyAuth.style.borderColor = 'var(--magenta-neon)';
            dom.btnActionSpotifyAuth.style.color = 'var(--magenta-neon)';
        }
    }

    dom.modalSpotifyAccount.style.display = 'flex';
}

export function closeSpotifyAccountModal() {
    if (dom.modalSpotifyAccount) dom.modalSpotifyAccount.style.display = 'none';
}

/**
 * Maneja el botón de acción del modal de cuenta (Login o Desvincular)
 */
export async function handleSpotifyAuthAction() {
    if (spotifyAccountState.connected) {
        if (!confirm('¿Deseas desvincular tu cuenta de Spotify de TokiTube?')) return;
        try {
            showLoader('DESVINCULANDO CUENTA...', 'Eliminando tokens de Spotify...');
            await apiFetch('/spotify/unlink', { method: 'POST' });
            hideLoader();
            appendLog('[SPOTIFY] Cuenta de Spotify desvinculada exitosamente.');
            await checkSpotifyStatus();
            closeSpotifyAccountModal();
            if (dom.panelNewPlSpotify && dom.panelNewPlSpotify.style.display !== 'none') {
                loadUserSpotifyPlaylists();
            }
        } catch (err) {
            hideLoader();
            appendLog(`[ERROR SPOTIFY] No se pudo desvincular: ${err.message}`, true);
        }
    } else {
        openSpotifyLoginPopup();
    }
}

/**
 * Cambia entre la pestaña de URL manual y Mis Playlists en el modal de nueva lista
 */
export function switchPlaylistTab(tab) {
    if (tab === 'url') {
        if (dom.tabBtnPlUrl) dom.tabBtnPlUrl.classList.add('active');
        if (dom.tabBtnPlSpotify) dom.tabBtnPlSpotify.classList.remove('active');
        if (dom.panelNewPlUrl) dom.panelNewPlUrl.style.display = 'block';
        if (dom.panelNewPlSpotify) dom.panelNewPlSpotify.style.display = 'none';
    } else if (tab === 'spotify') {
        if (dom.tabBtnPlSpotify) dom.tabBtnPlSpotify.classList.add('active');
        if (dom.tabBtnPlUrl) dom.tabBtnPlUrl.classList.remove('active');
        if (dom.panelNewPlUrl) dom.panelNewPlUrl.style.display = 'none';
        if (dom.panelNewPlSpotify) dom.panelNewPlSpotify.style.display = 'block';
        loadUserSpotifyPlaylists();
    }
}

/**
 * Carga y renderiza la lista de playlists del usuario desde Spotify
 */
export async function loadUserSpotifyPlaylists() {
    if (!dom.spotifyMyPlaylistsList) return;
    await checkSpotifyStatus();

    if (!spotifyAccountState.connected) {
        dom.spotifyMyPlaylistsList.innerHTML = `
            <div style="text-align: center; padding: 24px 10px; border: 1px dashed rgba(255, 0, 127, 0.4); background: rgba(0,0,0,0.4);">
                <div style="font-size: 1rem; color: var(--magenta-neon); font-weight: bold; margin-bottom: 8px;">[CUENTA NO VINCULADA]</div>
                <div style="font-size: 0.9rem; color: rgba(255,255,255,0.8); margin-bottom: 14px;">Inicia sesión con Spotify para cargar tus listas de reproducción personales.</div>
                <button type="button" id="btn-login-from-tab" class="btn-modal confirm" style="border-color: var(--magenta-neon); color: var(--magenta-neon);">INICIAR SESIÓN CON SPOTIFY</button>
            </div>
        `;
        const btnLoginTab = document.getElementById('btn-login-from-tab');
        if (btnLoginTab) {
            btnLoginTab.addEventListener('click', openSpotifyLoginPopup);
        }
        return;
    }

    dom.spotifyMyPlaylistsList.innerHTML = `
        <div style="text-align: center; padding: 20px; font-size: 0.95rem; color: var(--green);">
            [CONSULTANDO PLAYLISTS EN TU CUENTA DE SPOTIFY...]
        </div>
    `;

    try {
        const data = await apiFetch('/spotify/my-playlists');
        if (data.success && Array.isArray(data.playlists)) {
            if (data.playlists.length === 0) {
                dom.spotifyMyPlaylistsList.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.7); font-size: 0.95rem;">
                        No se encontraron listas de reproducción en tu biblioteca de Spotify.
                    </div>
                `;
                return;
            }

            dom.spotifyMyPlaylistsList.innerHTML = '';
            data.playlists.forEach(p => {
                const item = document.createElement('div');
                item.className = 'spotify-pl-item';
                item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px dashed rgba(0, 255, 65, 0.25); background: rgba(0,0,0,0.4);';

                item.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                        ${p.coverUrl ? `<img src="${p.coverUrl}" style="width: 40px; height: 40px; object-fit: cover; border: 1px solid var(--green); flex-shrink: 0;">` : `<div style="width: 40px; height: 40px; background: rgba(0,255,65,0.1); border: 1px solid var(--green); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; flex-shrink: 0;">LISTA</div>`}
                        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                            <div style="font-size: 0.95rem; font-weight: bold; color: #fff; overflow: hidden; text-overflow: ellipsis;">${p.name}</div>
                            <div style="font-size: 0.8rem; color: rgba(0, 255, 65, 0.7);">${p.tracksCount} canciones | por ${p.owner}</div>
                        </div>
                    </div>
                    <button type="button" class="btn-modal confirm btn-import-sp-pl" style="padding: 5px 10px; font-size: 0.8rem; flex-shrink: 0;">[IMPORTAR]</button>
                `;

                const btnImport = item.querySelector('.btn-import-sp-pl');
                if (btnImport) {
                    btnImport.addEventListener('click', () => importUserSpotifyPlaylistDirect(p, btnImport));
                }

                dom.spotifyMyPlaylistsList.appendChild(item);
            });
        } else {
            dom.spotifyMyPlaylistsList.innerHTML = `
                <div style="text-align: center; padding: 16px; color: var(--red-alert); font-size: 0.95rem;">
                    Error al obtener playlists: ${data.error || 'Error desconocido'}
                </div>
            `;
        }
    } catch (err) {
        dom.spotifyMyPlaylistsList.innerHTML = `
            <div style="text-align: center; padding: 16px; color: var(--red-alert); font-size: 0.95rem;">
                Error de conexión: ${err.message}
            </div>
        `;
    }
}

/**
 * Importa directamente una playlist seleccionada del usuario de Spotify
 */
async function importUserSpotifyPlaylistDirect(playlist, buttonElement) {
    if (!playlist || !playlist.spotifyUrl) return;

    if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.textContent = '[IMPORTANDO...]';
    }

    showLoader(`IMPORTANDO "${playlist.name.toUpperCase()}"...`, `Extrayendo ${playlist.tracksCount || ''} canciones con tu cuenta de Spotify...`);
    appendLog(`[SPOTIFY] Iniciando importación completa de tu playlist: "${playlist.name}" (${playlist.spotifyUrl})`);

    try {
        const data = await apiFetch('/playlists/import-web', {
            method: 'POST',
            body: JSON.stringify({
                url: playlist.spotifyUrl,
                name: playlist.name
            })
        });

        hideLoader();

        if (data.success && data.playlist) {
            if (Array.isArray(data.tracks)) {
                data.tracks.forEach(trk => allTracksMap.set(trk.trackHash, trk));
                await saveTracksBatchToIDB(data.tracks);
            }

            setUserPlaylists([...userPlaylists, data.playlist]);
            appendLog(`PLAYLIST IMPORTADA DE SPOTIFY: "${data.playlist.name.toUpperCase()}" (${data.importedCount || 0} pistas)`);

            closeNewPlaylistModal();
            document.dispatchEvent(new CustomEvent('dorocoro:playlist-changed', { detail: { playlistId: data.playlist.id } }));
        } else {
            const errMsg = data.error || 'No se pudieron extraer canciones de la playlist.';
            appendLog(`ERROR AL IMPORTAR LISTA DE SPOTIFY: ${errMsg}`, true);
            alert(`Error: ${errMsg}`);
            if (buttonElement) {
                buttonElement.disabled = false;
                buttonElement.textContent = '[IMPORTAR]';
            }
        }
    } catch (err) {
        hideLoader();
        appendLog(`ERROR AL IMPORTAR: ${err.message}`, true);
        alert(`Error al importar: ${err.message}`);
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.textContent = '[IMPORTAR]';
        }
    }
}

/**
 * Inicializa todos los eventos y listeners para la autenticación de Spotify
 */
export function initSpotifyAuthModal() {
    // Botón de Spotify en la barra de ventana
    if (dom.btnWinSpotify) {
        dom.btnWinSpotify.addEventListener('click', openSpotifyAccountModal);
    }

    // Modal de cuenta Spotify
    if (dom.btnCloseModalSpotify) {
        dom.btnCloseModalSpotify.addEventListener('click', closeSpotifyAccountModal);
    }
    if (dom.btnCancelModalSpotify) {
        dom.btnCancelModalSpotify.addEventListener('click', closeSpotifyAccountModal);
    }
    if (dom.btnActionSpotifyAuth) {
        dom.btnActionSpotifyAuth.addEventListener('click', handleSpotifyAuthAction);
    }

    // Pestañas de Nueva Playlist
    if (dom.tabBtnPlUrl) {
        dom.tabBtnPlUrl.addEventListener('click', () => switchPlaylistTab('url'));
    }
    if (dom.tabBtnPlSpotify) {
        dom.tabBtnPlSpotify.addEventListener('click', () => switchPlaylistTab('spotify'));
    }
    if (dom.btnCancelModalPlSpotify) {
        dom.btnCancelModalPlSpotify.addEventListener('click', closeNewPlaylistModal);
    }
    if (dom.btnRefreshSpotifyPl) {
        dom.btnRefreshSpotifyPl.addEventListener('click', loadUserSpotifyPlaylists);
    }
    if (dom.btnUnlinkSpotifyTab) {
        dom.btnUnlinkSpotifyTab.addEventListener('click', handleSpotifyAuthAction);
    }

    // Escuchador de mensaje desde la ventana emergente de autenticación
    window.addEventListener('message', async (event) => {
        if (event.data && event.data.type === 'SPOTIFY_AUTH_RESULT') {
            if (event.data.success) {
                appendLog(`[SPOTIFY] Autenticación exitosa: ${event.data.message}`);
                await checkSpotifyStatus();
                closeSpotifyAccountModal();
                if (dom.panelNewPlSpotify && dom.panelNewPlSpotify.style.display !== 'none') {
                    loadUserSpotifyPlaylists();
                }
            } else {
                appendLog(`[ERROR SPOTIFY] ${event.data.message || 'Fallo en la autenticación.'}`, true);
            }
        }
    });

    // Comprobar estado inicial silenciosamente
    checkSpotifyStatus().catch(() => {});
}
