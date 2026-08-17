/**
 * playlists.js - Gestión de Listas de Reproducción, Cola de Reproducción Local y Renderizado de Pistas
 */

import {
    dom,
    allTracksMap,
    userPlaylists,
    currentQueue,
    currentIndex,
    displayedPlaylistTracks,
    isPlaying,
    activePlaylistId,
    setCurrentQueue,
    setCurrentIndex,
    setDisplayedPlaylistTracks,
    setActivePlaylistId,
    setUserPlaylists,
    appendLog
} from './state.js';
import { getTrackSourceState } from './utils.js';
import { apiFetch, downloadTrackFile } from './api.js';
import { saveTrackToIDB, deleteTrackFromIDB, saveStateToIDB, saveQueueToIDB } from './storage.js';
import { loadTrack, playTrack, pauseTrack, nextTrack } from './audio.js';
import { openEditTrackModal, openAddToPlaylistModal } from './modals.js';

let activeQueueMenuEl = null;

/**
 * Cierra cualquier popover de opciones de cola abierto.
 */
export function closeQueuePopover() {
    if (activeQueueMenuEl) {
        activeQueueMenuEl.remove();
        activeQueueMenuEl = null;
    }
}

/**
 * Abre el mini-menú flotante retro para elegir si reproducir a continuación o al final.
 */
export function openQueuePopover(anchorEl, onSelect) {
    closeQueuePopover();
    if (!anchorEl) return;

    const menu = document.createElement('div');
    menu.className = 'retro-queue-menu';
    menu.innerHTML = `
        <button type="button" class="retro-queue-menu-item" data-pos="next">
            <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/skip-forward.svg'); mask-image: url('/img/icons/skip-forward.svg'); width: 12px; height: 12px;"></span>
            <span>A CONTINUACIÓN</span>
        </button>
        <button type="button" class="retro-queue-menu-item" data-pos="end">
            <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/plus.svg'); mask-image: url('/img/icons/plus.svg'); width: 12px; height: 12px;"></span>
            <span>AL FINAL DE LA COLA</span>
        </button>
    `;

    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 4;
    let left = rect.left + window.scrollX;

    const menuWidth = 195;
    if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10;
    }
    if (left < 10) left = 10;

    menu.style.position = 'absolute';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    menu.querySelectorAll('.retro-queue-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const pos = item.dataset.pos;
            closeQueuePopover();
            if (onSelect) onSelect(pos);
        });
    });

    activeQueueMenuEl = menu;
}

// Cierre al hacer clic fuera
document.addEventListener('click', (e) => {
    if (!e.target.closest('.retro-queue-menu') &&
        !e.target.closest('[data-action="queue-menu"]') &&
        !e.target.closest('#btn-queue-playlist') &&
        !e.target.closest('.btn-web-action.add-to-queue')) {
        closeQueuePopover();
    }
});

/**
 * Obtiene el arreglo de pistas correspondiente a un identificador de lista.
 */
export function getTracksForPlaylist(playlistId = activePlaylistId) {
    if (playlistId === 'all') {
        return Array.from(allTracksMap.values()).filter(t => Boolean(t.file) || t.sourceType === 'local');
    } else if (playlistId === 'drive') {
        return Array.from(allTracksMap.values()).filter(t => t.sourceType === 'drive' || (t.webUrl && t.webUrl.startsWith('/drive/')) || (t.webUrl && t.webUrl.includes('/drive-stream/')));
    } else if (playlistId === 'favorites') {
        return Array.from(allTracksMap.values()).filter(t => t.isFavorite);
    } else {
        const pl = userPlaylists.find(p => p.id === playlistId);
        if (pl) {
            return (pl.trackHashes || [])
                .map(hash => allTracksMap.get(hash))
                .filter(Boolean);
        }
    }
    return [];
}

/**
 * Obtiene el nombre legible de una lista de reproducción.
 */
export function getPlaylistName(playlistId = activePlaylistId) {
    if (playlistId === 'all') return 'BIBLIOTECA LOCAL';
    if (playlistId === 'drive') return 'TOKIDRIVE MUSIC';
    if (playlistId === 'favorites') return 'FAVORITAS';
    const pl = userPlaylists.find(p => p.id === playlistId);
    return pl ? pl.name.toUpperCase() : 'LISTA';
}

/**
 * Actualiza y renderiza las pistas de la lista seleccionada en la vista de biblioteca.
 */
export function updateDisplayedPlaylist() {
    const isLocalLibrary = activePlaylistId === 'all';

    // Los botones de cargar carpeta y archivos físicos solo se muestran en la Biblioteca Local
    if (dom.btnOpenFolder) dom.btnOpenFolder.style.display = isLocalLibrary ? "inline-flex" : "none";
    if (dom.btnAddFiles) dom.btnAddFiles.style.display = isLocalLibrary ? "inline-flex" : "none";
    if (dom.btnClearLibrary) dom.btnClearLibrary.style.display = isLocalLibrary ? "inline-flex" : "none";

    const folderBar = document.querySelector('.folder-actions-bar');
    if (folderBar) folderBar.style.display = isLocalLibrary ? "flex" : "none";

    const tracks = getTracksForPlaylist(activePlaylistId);
    setDisplayedPlaylistTracks(tracks);

    if (activePlaylistId === 'all') {
        if (dom.playlistCurrentTitle) dom.playlistCurrentTitle.textContent = "BIBLIOTECA LOCAL";
        if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.style.display = "none";
    } else if (activePlaylistId === 'drive') {
        if (dom.playlistCurrentTitle) dom.playlistCurrentTitle.textContent = "TOKIDRIVE MUSIC";
        if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.style.display = "none";
    } else if (activePlaylistId === 'favorites') {
        if (dom.playlistCurrentTitle) dom.playlistCurrentTitle.textContent = "FAVORITAS";
        if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.style.display = "none";
    } else {
        const pl = userPlaylists.find(p => p.id === activePlaylistId);
        if (pl) {
            if (dom.playlistCurrentTitle) dom.playlistCurrentTitle.textContent = `PLAYLIST: ${pl.name.toUpperCase()}`;
            if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.style.display = "inline-flex";
        } else {
            setActivePlaylistId('all');
            updateDisplayedPlaylist();
            return;
        }
    }

    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
    saveStateToIDB(dom.folderDisplayTag ? dom.folderDisplayTag.textContent : '', activePlaylistId, currentIndex);
}

/**
 * Función de compatibilidad principal
 */
export function updateCurrentQueue() {
    updateDisplayedPlaylist();
    renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
}

/**
 * Renderiza las opciones en el selector `<select>` de playlists.
 */
export function renderPlaylistSelectOptions() {
    if (!dom.playlistSelect) return;
    const currentVal = activePlaylistId;
    const localCount = Array.from(allTracksMap.values()).filter(t => Boolean(t.file) || t.sourceType === 'local').length;
    const driveCount = Array.from(allTracksMap.values()).filter(t => t.sourceType === 'drive' || (t.webUrl && t.webUrl.startsWith('/drive/')) || (t.webUrl && t.webUrl.includes('/drive-stream/'))).length;
    const favCount = Array.from(allTracksMap.values()).filter(t => t.isFavorite).length;

    dom.playlistSelect.innerHTML = `
        <option value="all">[BIBLIOTECA LOCAL] (${localCount})</option>
        <option value="drive">[TOKIDRIVE] (${driveCount})</option>
        <option value="favorites">[FAVORITAS] (${favCount})</option>
    `;

    userPlaylists.filter(p => p.id !== 'all' && p.id !== 'drive' && p.id !== 'favorites').forEach(pl => {
        const count = (pl.trackHashes || []).length;
        const opt = document.createElement('option');
        opt.value = pl.id;
        opt.textContent = `[PLAYLIST] ${pl.name} (${count})`;
        dom.playlistSelect.appendChild(opt);
    });

    dom.playlistSelect.value = currentVal;
}

/**
 * Reproduce una playlist completa reemplazando la cola de reproducción local.
 */
export function playPlaylist(playlistId = activePlaylistId) {
    const rawTracks = getTracksForPlaylist(playlistId);
    const plName = getPlaylistName(playlistId);

    if (rawTracks.length === 0) {
        appendLog(`ADVERTENCIA: La lista "${plName}" no contiene canciones.`, true);
        return;
    }

    const queueItems = rawTracks.map(t => ({
        ...t,
        queueUid: 'qu_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    }));

    pauseTrack();
    setCurrentQueue(queueItems);
    setCurrentIndex(0);
    saveQueueToIDB(currentQueue, 0);

    loadTrack(0, true, () => {
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
        renderQueue();
    });

    appendLog(`[COLA] REPRODUCIENDO PLAYLIST: "${plName}" (${queueItems.length} PISTAS EN COLA)`);
    renderQueue();
    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
}

/**
 * Añade todas las canciones de una playlist a la cola de reproducción.
 * @param {string} playlistId - ID de la lista
 * @param {'next'|'end'} position - 'next' para insertar a continuación, 'end' para el final.
 */
export function queuePlaylist(playlistId = activePlaylistId, position = 'end') {
    const rawTracks = getTracksForPlaylist(playlistId);
    const plName = getPlaylistName(playlistId);

    if (rawTracks.length === 0) {
        appendLog(`ADVERTENCIA: La lista "${plName}" no contiene canciones para añadir a la cola.`, true);
        return;
    }

    const queueItems = rawTracks.map(t => ({
        ...t,
        queueUid: 'qu_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    }));

    const wasEmpty = currentQueue.length === 0;

    if (position === 'next' && !wasEmpty) {
        currentQueue.splice(currentIndex + 1, 0, ...queueItems);
        appendLog(`[COLA] +${queueItems.length} PISTAS DE "${plName}" PROGRAMADAS A CONTINUACIÓN`);
    } else {
        setCurrentQueue([...currentQueue, ...queueItems]);
        appendLog(`[COLA] +${queueItems.length} PISTAS DE "${plName}" AÑADIDAS AL FINAL DE LA COLA (${currentQueue.length} TOTAL)`);
    }

    saveQueueToIDB(currentQueue, currentIndex);

    if (wasEmpty && !isPlaying) {
        setCurrentIndex(0);
        loadTrack(0, true, () => {
            renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
            renderQueue();
        });
    }

    renderQueue();
    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
}

/**
 * Añade una pista individual a la cola de reproducción local.
 * @param {Object} track - Objeto de pista
 * @param {'now'|'next'|'end'|boolean} position - 'now' (reproducir ya), 'next' (a continuación), 'end' (al final)
 */
export function addTrackToQueue(track, position = 'end') {
    if (!track) return;
    
    // Crear una instancia de cola individual e independiente
    const queueItem = {
        ...track,
        queueUid: 'qu_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    };

    if (position === 'now' || position === true) {
        if (currentQueue.length === 0) {
            setCurrentQueue([queueItem]);
            setCurrentIndex(0);
            loadTrack(0, true, () => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue();
            });
        } else {
            const insertIdx = currentIndex + 1;
            currentQueue.splice(insertIdx, 0, queueItem);
            setCurrentIndex(insertIdx);
            loadTrack(insertIdx, true, () => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue();
            });
        }
        appendLog(`[COLA] REPRODUCIENDO AHORA: "${queueItem.artist} - ${queueItem.title}"`);
    } else if (position === 'next') {
        const wasEmpty = currentQueue.length === 0;
        if (wasEmpty) {
            setCurrentQueue([queueItem]);
            setCurrentIndex(0);
            if (!isPlaying) {
                loadTrack(0, false, () => {
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                    renderQueue();
                });
            }
        } else {
            currentQueue.splice(currentIndex + 1, 0, queueItem);
        }
        appendLog(`[COLA] PISTA PROGRAMADA A CONTINUACIÓN (SIGUIENTE): "${queueItem.artist} - ${queueItem.title}"`);
    } else { // 'end' or false
        const wasEmpty = currentQueue.length === 0;
        setCurrentQueue([...currentQueue, queueItem]);
        if (wasEmpty && !isPlaying) {
            setCurrentIndex(0);
            loadTrack(0, false, () => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue();
            });
        }
        appendLog(`[COLA] PISTA AÑADIDA AL FINAL DE LA COLA (+1): "${queueItem.artist} - ${queueItem.title}"`);
    }

    saveQueueToIDB(currentQueue, currentIndex);
    renderQueue();
    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
}

/**
 * Elimina una pista de la cola de reproducción local por su índice.
 */
export function removeTrackFromQueue(idx) {
    if (idx < 0 || idx >= currentQueue.length) return;
    const removedTrack = currentQueue[idx];
    const isCurrentPlaying = (idx === currentIndex);

    currentQueue.splice(idx, 1);

    if (currentQueue.length === 0) {
        setCurrentIndex(0);
        pauseTrack();
        if (dom.audio) dom.audio.removeAttribute('src');
        if (dom.trackTitle) dom.trackTitle.textContent = "SIN PISTAS EN COLA";
        if (dom.trackArtist) dom.trackArtist.textContent = "REPRODUCE O AÑADE UNA PLAYLIST A LA COLA";
        if (dom.durationTime) dom.durationTime.textContent = "--:--";
        if (dom.currentTime) dom.currentTime.textContent = "00:00";
        if (dom.progressFill) dom.progressFill.style.width = "0%";
    } else {
        if (isCurrentPlaying) {
            let nextSafeIdx = idx;
            if (nextSafeIdx >= currentQueue.length) nextSafeIdx = 0;
            setCurrentIndex(nextSafeIdx);
            loadTrack(nextSafeIdx, isPlaying, () => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue();
            });
        } else if (idx < currentIndex) {
            setCurrentIndex(currentIndex - 1);
        }
    }

    saveQueueToIDB(currentQueue, currentIndex);
    appendLog(`[COLA] PISTA QUITADA DE LA COLA: "${removedTrack?.title || 'Pista'}"`);
    renderQueue();
    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
}

/**
 * Mueve la posición de un elemento dentro de la cola de reproducción.
 */
export function moveQueueItem(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= currentQueue.length || toIdx < 0 || toIdx >= currentQueue.length) return;
    const item = currentQueue.splice(fromIdx, 1)[0];
    currentQueue.splice(toIdx, 0, item);

    if (currentIndex === fromIdx) {
        setCurrentIndex(toIdx);
    } else if (fromIdx < currentIndex && toIdx >= currentIndex) {
        setCurrentIndex(currentIndex - 1);
    } else if (fromIdx > currentIndex && toIdx <= currentIndex) {
        setCurrentIndex(currentIndex + 1);
    }

    saveQueueToIDB(currentQueue, currentIndex);
    renderQueue();
    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
}

/**
 * Vacía completamente la cola de reproducción activa.
 */
export function clearQueue() {
    if (currentQueue.length === 0) return;
    setCurrentQueue([]);
    setCurrentIndex(0);
    pauseTrack();
    if (dom.audio) dom.audio.removeAttribute('src');
    if (dom.trackTitle) dom.trackTitle.textContent = "SIN PISTAS EN COLA";
    if (dom.trackArtist) dom.trackArtist.textContent = "REPRODUCE O AÑADE UNA PLAYLIST A LA COLA";
    if (dom.durationTime) dom.durationTime.textContent = "--:--";
    if (dom.currentTime) dom.currentTime.textContent = "00:00";
    if (dom.progressFill) dom.progressFill.style.width = "0%";

    saveQueueToIDB([], 0);
    appendLog(`[COLA] COLA DE REPRODUCCIÓN VACIADA`);
    renderQueue();
    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
}

/**
 * Mezcla aleatoriamente las pistas de la cola de reproducción local.
 */
export function shuffleQueue() {
    if (currentQueue.length <= 1) {
        appendLog(`[COLA] Se necesitan al menos 2 canciones en la cola para mezclar.`);
        return;
    }
    const currentTrack = currentQueue[currentIndex];
    const currentUid = currentTrack?.queueUid;
    
    // Algoritmo Fisher-Yates
    for (let i = currentQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentQueue[i], currentQueue[j]] = [currentQueue[j], currentQueue[i]];
    }

    if (currentTrack) {
        const newIdx = currentQueue.findIndex(t => (currentUid ? t.queueUid === currentUid : t === currentTrack));
        if (newIdx !== -1) setCurrentIndex(newIdx);
    }

    saveQueueToIDB(currentQueue, currentIndex);
    appendLog(`[COLA] COLA DE REPRODUCCIÓN MEZCLADA ALEATORIAMENTE`);
    renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
}

/**
 * Renderiza la interfaz visual de la Cola de Reproducción Local (#queue-items).
 */
export function renderQueue(filter = '') {
    if (dom.queueCountBadge) {
        dom.queueCountBadge.textContent = currentQueue.length.toString();
    }
    if (dom.queueTracksCount) {
        dom.queueTracksCount.textContent = `${currentQueue.length} PISTA${currentQueue.length === 1 ? '' : 'S'}`;
    }

    if (!dom.queueContainer) return;
    dom.queueContainer.innerHTML = '';

    if (currentQueue.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'track-item';
        emptyLi.style.justifyContent = 'center';
        emptyLi.style.opacity = '0.6';
        emptyLi.textContent = '-- COLA DE REPRODUCCIÓN VACÍA. REPRODUCE O AÑADE UNA PLAYLIST --';
        dom.queueContainer.appendChild(emptyLi);
        return;
    }

    const itemsWithIndex = currentQueue.map((track, originalIndex) => ({ track, originalIndex }));

    const filtered = itemsWithIndex.filter(({ track }) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (track.title && track.title.toLowerCase().includes(q)) || (track.artist && track.artist.toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'track-item';
        emptyLi.style.justifyContent = 'center';
        emptyLi.style.opacity = '0.6';
        emptyLi.textContent = '-- NO SE ENCONTRARON COINCIDENCIAS EN LA COLA --';
        dom.queueContainer.appendChild(emptyLi);
        return;
    }

    filtered.forEach(({ track, originalIndex }) => {
        const actualIdx = originalIndex;
        const isCurrentActive = actualIdx === currentIndex;
        const isPlayingThis = isCurrentActive && isPlaying;
        const sourceState = getTrackSourceState(track);

        let tagClass = 'tag-local';
        let tagText = 'LOCAL';
        let downloadTooltip = 'Descargar copia del archivo';

        if (sourceState === 'OFFLINE') {
            tagClass = 'tag-offline';
            tagText = 'OFFLINE';
            downloadTooltip = 'Pista guardada en este dispositivo (Modo Offline listo)';
        } else if (sourceState === 'DRIVE') {
            tagClass = 'tag-drive';
            tagText = 'DRIVE';
            downloadTooltip = 'Descargar de TokiDrive a este dispositivo';
        } else if (sourceState === 'WEB') {
            tagClass = 'tag-web';
            tagText = 'WEB';
            downloadTooltip = 'Descargar a este dispositivo para modo Offline';
        } else {
            tagClass = 'tag-local';
            tagText = track.format || 'LOCAL';
            downloadTooltip = 'Archivo en carpeta local de este dispositivo';
        }

        const li = document.createElement('li');
        li.className = `track-item queue-item draggable ${isCurrentActive ? 'active' : ''}`;
        li.setAttribute('draggable', 'true');
        li.dataset.idx = actualIdx.toString();

        li.innerHTML = `
            <div class="track-item-info">
                <span class="queue-drag-handle" title="Arrastra para reordenar en la cola">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/more-vertical.svg'); mask-image: url('/img/icons/more-vertical.svg'); width: 14px; height: 14px;"></span>
                </span>
                <span class="track-num">${isPlayingThis ? '>' : (actualIdx + 1).toString().padStart(2, '0')}</span>
                <span class="track-format-tag ${tagClass}">${tagText}</span>
                <span class="track-name-text" title="${track.artist} - ${track.title}">${track.artist} - ${track.title}</span>
            </div>
            <div class="track-actions-group">
                <button type="button" class="btn-track-action fav ${track.isFavorite ? 'active' : ''}" title="${track.isFavorite ? 'Quitar de Favoritas' : 'Marcar como Favorita'}" data-action="fav" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('${track.isFavorite ? '/img/icons/star-filled.svg' : '/img/icons/star.svg'}'); mask-image: url('${track.isFavorite ? '/img/icons/star-filled.svg' : '/img/icons/star.svg'}'); width: 14px; height: 14px;"></span>
                </button>
                <button type="button" class="btn-track-action download ${sourceState === 'OFFLINE' ? 'active' : ''}" title="${downloadTooltip}" data-action="download" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/download.svg'); mask-image: url('/img/icons/download.svg'); width: 13px; height: 13px;"></span>
                </button>
                <button type="button" class="btn-track-action" title="Agregar a Playlist..." data-action="add-to-pl" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/playlist.svg'); mask-image: url('/img/icons/playlist.svg'); width: 13px; height: 13px;"></span>
                </button>
                <button type="button" class="btn-track-action danger" data-action="remove-queue" data-idx="${actualIdx}" title="Quitar de la cola">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/x.svg'); mask-image: url('/img/icons/x.svg'); width: 13px; height: 13px;"></span>
                </button>
                <span class="track-item-duration">${track.duration || '--:--'}</span>
            </div>
        `;

        // Eventos Drag and Drop para reordenamiento interactivo
        li.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', actualIdx.toString());
            setTimeout(() => {
                li.classList.add('dragging');
            }, 0);
        });

        li.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = li.getBoundingClientRect();
            const offset = e.clientY - rect.top;
            if (offset < rect.height / 2) {
                li.classList.add('drag-over-top');
                li.classList.remove('drag-over-bottom');
            } else {
                li.classList.add('drag-over-bottom');
                li.classList.remove('drag-over-top');
            }
        });

        li.addEventListener('dragleave', () => {
            li.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        li.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            li.classList.remove('drag-over-top', 'drag-over-bottom');
            const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (isNaN(fromIdx) || fromIdx === actualIdx) return;

            const rect = li.getBoundingClientRect();
            const offset = e.clientY - rect.top;
            let targetIdx = actualIdx;

            if (offset >= rect.height / 2) {
                targetIdx = (fromIdx < actualIdx) ? actualIdx : actualIdx + 1;
            } else {
                targetIdx = (fromIdx < actualIdx) ? actualIdx - 1 : actualIdx;
            }

            if (targetIdx < 0) targetIdx = 0;
            if (targetIdx >= currentQueue.length) targetIdx = currentQueue.length - 1;

            moveQueueItem(fromIdx, targetIdx);
        });

        li.addEventListener('dragend', () => {
            li.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
            if (dom.queueContainer) {
                dom.queueContainer.querySelectorAll('.track-item').forEach(el => {
                    el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
                });
            }
        });

        li.addEventListener('click', (e) => {
            if (e.target.closest('.btn-track-action') || e.target.closest('.queue-drag-handle')) return;
            loadTrack(actualIdx, true, () => {
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
            });
        });

        dom.queueContainer.appendChild(li);
    });

    // Eventos de botones en la cola
    dom.queueContainer.querySelectorAll('.btn-track-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const hash = btn.dataset.hash;
            const track = allTracksMap.get(hash);

            if (action === 'fav' && track) {
                track.isFavorite = !track.isFavorite;
                await saveTrackToIDB(track);
                apiFetch(`/tracks/${hash}/favorite`, { method: 'POST' }).catch(() => {});
                appendLog(`FAVORITO [${track.isFavorite ? 'AÑADIDO' : 'REMOVIDO'}]: ${track.title}`);
                renderPlaylistSelectOptions();
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
            } else if (action === 'download' && track) {
                await downloadTrackFile(track, () => {
                    renderPlaylistSelectOptions();
                    renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                });
            } else if (action === 'add-to-pl' && track) {
                openAddToPlaylistModal(track, () => {
                    renderPlaylistSelectOptions();
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                    renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
                });
            } else if (action === 'remove-queue') {
                const idx = parseInt(btn.dataset.idx, 10);
                if (!isNaN(idx)) {
                    removeTrackFromQueue(idx);
                }
            }
        });
    });
}

/**
 * Renderiza visualmente la lista de canciones con sus botones de acción retro.
 */
export function renderPlaylist(filter = '') {
    if (!dom.playlistContainer) return;
    dom.playlistContainer.innerHTML = '';

    const listTracks = displayedPlaylistTracks.length > 0 ? displayedPlaylistTracks : getTracksForPlaylist(activePlaylistId);

    if (dom.tracksCountBadge) {
        dom.tracksCountBadge.textContent = `${listTracks.length} PISTA${listTracks.length === 1 ? '' : 'S'}`;
    }

    const itemsWithIndex = listTracks.map((track, originalIndex) => ({ track, originalIndex }));

    const filtered = itemsWithIndex.filter(({ track }) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (track.title && track.title.toLowerCase().includes(q)) || (track.artist && track.artist.toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'track-item';
        emptyLi.style.justifyContent = 'center';
        emptyLi.style.opacity = '0.6';
        emptyLi.textContent = filter ? '-- NO SE ENCONTRARON COINCIDENCIAS --' : '-- LISTA VACÍA. ABRE UNA CARPETA O BUSCA EN LA WEB --';
        dom.playlistContainer.appendChild(emptyLi);
        return;
    }

    const currentPlayingHash = currentQueue[currentIndex]?.trackHash;

    filtered.forEach(({ track, originalIndex }) => {
        const actualIdx = originalIndex;
        const isCurrentPlayingInQueue = Boolean(currentPlayingHash && track.trackHash === currentPlayingHash && isPlaying);
        const li = document.createElement('li');
        li.className = `track-item ${isCurrentPlayingInQueue ? 'active' : ''}`;
        const sourceState = getTrackSourceState(track);

        let tagClass = 'tag-local';
        let tagText = 'LOCAL';
        let downloadTooltip = 'Descargar copia del archivo';

        if (sourceState === 'OFFLINE') {
            tagClass = 'tag-offline';
            tagText = 'OFFLINE';
            downloadTooltip = 'Pista guardada en este dispositivo (Modo Offline listo)';
        } else if (sourceState === 'DRIVE') {
            tagClass = 'tag-drive';
            tagText = 'DRIVE';
            downloadTooltip = 'Descargar de TokiDrive a este dispositivo';
        } else if (sourceState === 'WEB') {
            tagClass = 'tag-web';
            tagText = 'WEB';
            downloadTooltip = 'Descargar a este dispositivo para modo Offline';
        } else {
            tagClass = 'tag-local';
            tagText = track.format || 'LOCAL';
            downloadTooltip = 'Archivo en carpeta local de este dispositivo';
        }

        li.innerHTML = `
            <div class="track-item-info">
                <span class="track-num">${isCurrentPlayingInQueue ? '>' : (actualIdx + 1).toString().padStart(2, '0')}</span>
                <span class="track-format-tag ${tagClass}">${tagText}</span>
                <span class="track-name-text" title="${track.artist} - ${track.title}">${track.artist} - ${track.title}</span>
            </div>
            <div class="track-actions-group">
                <button type="button" class="btn-track-action queue" title="Añadir a la Cola de Reproducción..." data-action="queue-menu" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/plus.svg'); mask-image: url('/img/icons/plus.svg'); width: 13px; height: 13px;"></span>
                </button>
                <button type="button" class="btn-track-action fav ${track.isFavorite ? 'active' : ''}" title="${track.isFavorite ? 'Quitar de Favoritas' : 'Marcar como Favorita'}" data-action="fav" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('${track.isFavorite ? '/img/icons/star-filled.svg' : '/img/icons/star.svg'}'); mask-image: url('${track.isFavorite ? '/img/icons/star-filled.svg' : '/img/icons/star.svg'}'); width: 14px; height: 14px;"></span>
                </button>
                <button type="button" class="btn-track-action download ${sourceState === 'OFFLINE' ? 'active' : ''}" title="${downloadTooltip}" data-action="download" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/download.svg'); mask-image: url('/img/icons/download.svg'); width: 13px; height: 13px;"></span>
                </button>
                <button type="button" class="btn-track-action" title="Agregar a Playlist..." data-action="add-to-pl" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/playlist.svg'); mask-image: url('/img/icons/playlist.svg'); width: 13px; height: 13px;"></span>
                </button>
                <button type="button" class="btn-track-action" title="Editar Título / Artista" data-action="edit" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/edit.svg'); mask-image: url('/img/icons/edit.svg'); width: 13px; height: 13px;"></span>
                </button>
                ${activePlaylistId !== 'all' && activePlaylistId !== 'favorites' && activePlaylistId !== 'drive' ? `
                <button type="button" class="btn-track-action danger" title="Quitar de esta Playlist" data-action="remove-from-pl" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/trash.svg'); mask-image: url('/img/icons/trash.svg'); width: 13px; height: 13px;"></span>
                </button>` : `
                <button type="button" class="btn-track-action danger" title="${activePlaylistId === 'drive' ? 'Eliminar de TokiDrive' : (activePlaylistId === 'favorites' ? 'Quitar de Favoritas' : 'Quitar de la lista local')}" data-action="delete-track" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/trash.svg'); mask-image: url('/img/icons/trash.svg'); width: 13px; height: 13px;"></span>
                </button>`}
                <span class="track-item-duration">${track.duration || '--:--'}</span>
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (e.target.closest('.btn-track-action')) return;
            addTrackToQueue(track, true);
        });

        dom.playlistContainer.appendChild(li);
    });

    // Vincular eventos de botones de acción
    dom.playlistContainer.querySelectorAll('.btn-track-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const hash = btn.dataset.hash;
            const track = allTracksMap.get(hash);
            if (!track) return;

            if (action === 'queue-menu') {
                openQueuePopover(btn, (pos) => {
                    addTrackToQueue(track, pos);
                });
            } else if (action === 'fav') {
                track.isFavorite = !track.isFavorite;
                saveTrackToIDB(track);
                apiFetch(`/tracks/${hash}/favorite`, { method: 'POST' }).catch(() => {});
                appendLog(`FAVORITO [${track.isFavorite ? 'AÑADIDO' : 'REMOVIDO'}]: ${track.title}`);
                renderPlaylistSelectOptions();
                if (activePlaylistId === 'favorites') {
                    updateDisplayedPlaylist();
                } else {
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                }
            } else if (action === 'download') {
                await downloadTrackFile(track, () => {
                    renderPlaylistSelectOptions();
                    updateDisplayedPlaylist();
                });
            } else if (action === 'add-to-pl') {
                openAddToPlaylistModal(track, () => {
                    renderPlaylistSelectOptions();
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                });
            } else if (action === 'edit') {
                openEditTrackModal(track, () => {
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                    renderQueue();
                });
            } else if (action === 'remove-from-pl') {
                await removeTrackFromCurrentPlaylist(hash);
            } else if (action === 'delete-track') {
                await handleDeleteSingleTrack(track);
            }
        });
    });
}

/**
 * Maneja el borrado contextual según la lista activa.
 */
export async function handleDeleteSingleTrack(track) {
    if (!track) return;
    const hash = track.trackHash;
    const isCurrentPlaying = (currentQueue[currentIndex]?.trackHash === hash);

    // CASO 1: EN [TOKIDRIVE] -> Borrado físico en disco de Drive + SQLite + memoria
    if (activePlaylistId === 'drive') {
        if (!confirm(`¿Deseas eliminar permanentemente "${track.artist} - ${track.title}" de tu TokiDrive?\n\nEl archivo de audio se borrará del servidor TokiDrive y de la lista.`)) {
            return;
        }

        if (track.file) {
            delete track.file;
            delete track.isLocal;
        }

        allTracksMap.delete(hash);
        userPlaylists.forEach(pl => {
            if (pl.trackHashes) {
                pl.trackHashes = pl.trackHashes.filter(h => h !== hash);
            }
        });

        await deleteTrackFromIDB(hash);

        const filename = (track.webUrl && track.webUrl.includes('/drive-stream/'))
            ? track.webUrl.split('/').pop()
            : (track.file ? track.file.name : '');

        apiFetch(`/drive-track/${hash}?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' }).catch(() => {});

        // Quitar de la cola si está
        const qIdx = currentQueue.findIndex(t => t.trackHash === hash);
        if (qIdx !== -1) {
            removeTrackFromQueue(qIdx);
        }

        renderPlaylistSelectOptions();
        updateDisplayedPlaylist();
        appendLog(`[TOKIDRIVE] ARCHIVO BORRADO DEL SERVIDOR Y DE LA LISTA: "${track.artist} - ${track.title}"`);
        return;
    }

    // CASO 2: EN [FAVORITAS] -> Simplemente desmarcar
    if (activePlaylistId === 'favorites') {
        track.isFavorite = false;
        await saveTrackToIDB(track);
        apiFetch(`/tracks/${hash}/favorite`, { method: 'POST' }).catch(() => {});
        renderPlaylistSelectOptions();
        updateDisplayedPlaylist();
        appendLog(`[FAVORITAS] PISTA REMOVIDA DE FAVORITAS: "${track.artist} - ${track.title}"`);
        return;
    }

    // CASO 3: EN [BIBLIOTECA LOCAL] -> Desaparece de la lista local (no borra archivos del disco)
    if (activePlaylistId === 'all') {
        if (!confirm(`¿Quitar "${track.artist} - ${track.title}" de la lista local?\n\n(Tu archivo de audio original en tu disco NO será modificado ni borrado).`)) {
            return;
        }

        allTracksMap.delete(hash);
        await deleteTrackFromIDB(hash);

        const qIdx = currentQueue.findIndex(t => t.trackHash === hash);
        if (qIdx !== -1) {
            removeTrackFromQueue(qIdx);
        }

        renderPlaylistSelectOptions();
        updateDisplayedPlaylist();
        appendLog(`[BIBLIOTECA LOCAL] PISTA REMOVIDA DE LA LISTA: "${track.artist} - ${track.title}"`);
        return;
    }

    // CASO 4: EN PLAYLIST PERSONALIZADA
    await removeTrackFromCurrentPlaylist(hash);
}

/**
 * Quita una canción de una lista personalizada.
 */
export async function removeTrackFromCurrentPlaylist(trackHash) {
    if (activePlaylistId === 'all' || activePlaylistId === 'favorites' || activePlaylistId === 'drive') return;
    const pl = userPlaylists.find(p => p.id === activePlaylistId);
    if (!pl) return;

    const track = allTracksMap.get(trackHash);
    const trackTitle = track ? `"${track.artist} - ${track.title}"` : 'la canción';

    if (!confirm(`¿Quitar ${trackTitle} de la lista "${pl.name}"?`)) {
        return;
    }

    try {
        if (track && track.file) {
            delete track.file;
            delete track.isLocal;
            allTracksMap.set(track.trackHash, track);
            await saveTrackToIDB(track);
        }

        await apiFetch(`/playlists/${activePlaylistId}/tracks/${trackHash}`, { method: 'DELETE' });
        pl.trackHashes = (pl.trackHashes || []).filter(h => h !== trackHash);

        appendLog(`[PLAYLIST] PISTA REMOVIDA DE [${pl.name.toUpperCase()}]: ${track?.title || trackHash}`);
        renderPlaylistSelectOptions();
        updateDisplayedPlaylist();
    } catch (err) {
        appendLog('ERROR al remover pista de la lista.', true);
    }
}

/**
 * Elimina la lista de reproducción activa actualmente.
 */
export async function deleteCurrentPlaylist() {
    if (activePlaylistId === 'all' || activePlaylistId === 'drive' || activePlaylistId === 'favorites') return;
    const pl = userPlaylists.find(p => p.id === activePlaylistId);
    if (!pl) return;

    if (!confirm(`¿Estás seguro de eliminar la lista "${pl.name}"? (Las canciones no se borrarán de tu biblioteca).`)) {
        return;
    }

    try {
        await apiFetch(`/playlists/${pl.id}`, { method: 'DELETE' });
        setUserPlaylists(userPlaylists.filter(p => p.id !== pl.id));
        appendLog(`LISTA DE REPRODUCCIÓN ELIMINADA: "${pl.name.toUpperCase()}"`);
        setActivePlaylistId('all');
        renderPlaylistSelectOptions();
        updateDisplayedPlaylist();
    } catch (err) {
        console.error('[DELETE PLAYLIST ERROR]', err);
        appendLog('ERROR al eliminar lista de reproducción.', true);
    }
}
