/**
 * playlists.js - Gestión de Listas de Reproducción, Colas y Renderizado de Pistas
 */

import {
    dom,
    allTracksMap,
    userPlaylists,
    currentQueue,
    currentIndex,
    isPlaying,
    activePlaylistId,
    setCurrentQueue,
    setCurrentIndex,
    setActivePlaylistId,
    setUserPlaylists,
    appendLog
} from './state.js';
import { getTrackSourceState } from './utils.js';
import { apiFetch, downloadTrackFile } from './api.js';
import { saveTrackToIDB, deleteTrackFromIDB, saveStateToIDB } from './storage.js';
import { loadTrack, playTrack, pauseTrack, nextTrack } from './audio.js';
import { openEditTrackModal, openAddToPlaylistModal } from './modals.js';

/**
 * Actualiza la cola de reproducción actual según la lista seleccionada en el dropdown.
 */
export function updateCurrentQueue() {
    const isLocalLibrary = activePlaylistId === 'all';

    // Los botones de cargar carpeta y archivos físicos solo se muestran en la Biblioteca Local
    if (dom.btnOpenFolder) dom.btnOpenFolder.style.display = isLocalLibrary ? "inline-flex" : "none";
    if (dom.btnAddFiles) dom.btnAddFiles.style.display = isLocalLibrary ? "inline-flex" : "none";
    if (dom.btnClearLibrary) dom.btnClearLibrary.style.display = isLocalLibrary ? "inline-flex" : "none";

    const folderBar = document.querySelector('.folder-actions-bar');
    if (folderBar) folderBar.style.display = isLocalLibrary ? "flex" : "none";

    if (activePlaylistId === 'all') {
        // Biblioteca Local: Muestra pistas físicas presentes en este equipo o descargadas offline
        const localTracks = Array.from(allTracksMap.values()).filter(t => Boolean(t.file) || t.sourceType === 'local');
        setCurrentQueue(localTracks);
        if (dom.playlistCurrentTitle) dom.playlistCurrentTitle.textContent = "BIBLIOTECA LOCAL";
        if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.style.display = "none";
    } else if (activePlaylistId === 'drive') {
        // TokiDrive: Muestra exclusivamente canciones alojadas en TokiDrive
        const driveTracks = Array.from(allTracksMap.values()).filter(t => t.sourceType === 'drive' || (t.webUrl && t.webUrl.startsWith('/drive/')) || (t.webUrl && t.webUrl.includes('/drive-stream/')));
        setCurrentQueue(driveTracks);
        if (dom.playlistCurrentTitle) dom.playlistCurrentTitle.textContent = "TOKIDRIVE MUSIC";
        if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.style.display = "none";
    } else if (activePlaylistId === 'favorites') {
        // Favoritas
        const favTracks = Array.from(allTracksMap.values()).filter(t => t.isFavorite);
        setCurrentQueue(favTracks);
        if (dom.playlistCurrentTitle) dom.playlistCurrentTitle.textContent = "FAVORITAS";
        if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.style.display = "none";
    } else {
        // Listas personalizadas sincronizadas
        const pl = userPlaylists.find(p => p.id === activePlaylistId);
        if (pl) {
            const tracks = (pl.trackHashes || [])
                .map(hash => allTracksMap.get(hash))
                .filter(Boolean);
            setCurrentQueue(tracks);
            if (dom.playlistCurrentTitle) dom.playlistCurrentTitle.textContent = `PLAYLIST: ${pl.name.toUpperCase()}`;
            if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.style.display = "inline-flex";
        } else {
            setActivePlaylistId('all');
            updateCurrentQueue();
            return;
        }
    }

    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');

    if (currentQueue.length > 0) {
        if (currentIndex >= currentQueue.length) setCurrentIndex(0);
        loadTrack(currentIndex, false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
    } else {
        loadTrack(0, false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
    }

    saveStateToIDB(dom.folderDisplayTag ? dom.folderDisplayTag.textContent : '', activePlaylistId, currentIndex);
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
 * Renderiza visualmente la lista de canciones con sus botones de acción retro.
 */
export function renderPlaylist(filter = '') {
    if (!dom.playlistContainer) return;
    dom.playlistContainer.innerHTML = '';

    if (dom.tracksCountBadge) {
        dom.tracksCountBadge.textContent = `${currentQueue.length} PISTA${currentQueue.length === 1 ? '' : 'S'}`;
    }

    const filtered = currentQueue.filter(t => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (t.title && t.title.toLowerCase().includes(q)) || (t.artist && t.artist.toLowerCase().includes(q));
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

    filtered.forEach((track) => {
        const actualIdx = currentQueue.indexOf(track);
        const li = document.createElement('li');
        li.className = `track-item ${actualIdx === currentIndex ? 'active' : ''}`;
        const isPlayingThis = actualIdx === currentIndex && isPlaying;
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
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/plus.svg'); mask-image: url('/img/icons/plus.svg'); width: 14px; height: 14px;"></span>
                </button>
                <button type="button" class="btn-track-action" title="Editar Título / Artista" data-action="edit" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/edit.svg'); mask-image: url('/img/icons/edit.svg'); width: 13px; height: 13px;"></span>
                </button>
                ${activePlaylistId !== 'all' && activePlaylistId !== 'favorites' && activePlaylistId !== 'drive' ? `
                <button type="button" class="btn-track-action danger" title="Quitar de esta Playlist (y eliminar copia local si existía)" data-action="remove-from-pl" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/trash.svg'); mask-image: url('/img/icons/trash.svg'); width: 13px; height: 13px;"></span>
                </button>` : `
                <button type="button" class="btn-track-action danger" title="${activePlaylistId === 'drive' ? 'Eliminar de TokiDrive (archivo físico y lista)' : (activePlaylistId === 'favorites' ? 'Quitar de Favoritas' : 'Quitar de la lista local (no borra tu archivo del disco)')}" data-action="delete-track" data-hash="${track.trackHash}">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/trash.svg'); mask-image: url('/img/icons/trash.svg'); width: 13px; height: 13px;"></span>
                </button>`}
                <span class="track-item-duration">${track.duration || '--:--'}</span>
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (e.target.closest('.btn-track-action')) return;
            loadTrack(actualIdx, true, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
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

            if (action === 'fav') {
                track.isFavorite = !track.isFavorite;
                saveTrackToIDB(track);
                apiFetch(`/tracks/${hash}/favorite`, { method: 'POST' }).catch(() => {});
                appendLog(`FAVORITO [${track.isFavorite ? 'AÑADIDO' : 'REMOVIDO'}]: ${track.title}`);
                renderPlaylistSelectOptions();
                if (activePlaylistId === 'favorites') {
                    updateCurrentQueue();
                } else {
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                }
            } else if (action === 'download') {
                await downloadTrackFile(track, () => {
                    renderPlaylistSelectOptions();
                    updateCurrentQueue();
                });
            } else if (action === 'add-to-pl') {
                openAddToPlaylistModal(track, () => {
                    renderPlaylistSelectOptions();
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                });
            } else if (action === 'edit') {
                openEditTrackModal(track, () => {
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
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

        if (isCurrentPlaying) {
            if (currentQueue.length > 1) {
                nextTrack(false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
            } else {
                pauseTrack();
                if (dom.audio) dom.audio.removeAttribute('src');
                if (dom.trackTitle) dom.trackTitle.textContent = "SIN PISTAS DISPONIBLES";
                if (dom.trackArtist) dom.trackArtist.textContent = "ABRE UNA CARPETA O BUSCA EN LA WEB";
                if (dom.durationTime) dom.durationTime.textContent = "--:--";
                if (dom.currentTime) dom.currentTime.textContent = "00:00";
                if (dom.progressFill) dom.progressFill.style.width = "0%";
            }
        }

        renderPlaylistSelectOptions();
        updateCurrentQueue();
        appendLog(`[TOKIDRIVE] ARCHIVO BORRADO DEL SERVIDOR Y DE LA LISTA: "${track.artist} - ${track.title}"`);
        return;
    }

    // CASO 2: EN [FAVORITAS] -> Simplemente desmarcar
    if (activePlaylistId === 'favorites') {
        track.isFavorite = false;
        await saveTrackToIDB(track);
        apiFetch(`/tracks/${hash}/favorite`, { method: 'POST' }).catch(() => {});
        renderPlaylistSelectOptions();
        updateCurrentQueue();
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

        if (isCurrentPlaying) {
            if (currentQueue.length > 1) {
                nextTrack(false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
            } else {
                pauseTrack();
                if (dom.audio) dom.audio.removeAttribute('src');
                if (dom.trackTitle) dom.trackTitle.textContent = "SIN PISTAS DISPONIBLES";
                if (dom.trackArtist) dom.trackArtist.textContent = "ABRE UNA CARPETA O BUSCA EN LA WEB";
                if (dom.durationTime) dom.durationTime.textContent = "--:--";
                if (dom.currentTime) dom.currentTime.textContent = "00:00";
                if (dom.progressFill) dom.progressFill.style.width = "0%";
            }
        }

        renderPlaylistSelectOptions();
        updateCurrentQueue();
        appendLog(`[BIBLIOTECA LOCAL] PISTA REMOVIDA DE LA LISTA (ARCHIVO LOCAL PRESERVADO): "${track.artist} - ${track.title}"`);
        return;
    }

    // CASO 4: EN PLAYLIST PERSONALIZADA
    await removeTrackFromCurrentPlaylist(hash);
}

/**
 * Quita una canción de una lista personalizada, limpiando la copia offline si existía.
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
            appendLog(`[OFFLINE] Copia local descargada eliminada de este equipo: ${track.title}`);
        }

        await apiFetch(`/playlists/${activePlaylistId}/tracks/${trackHash}`, { method: 'DELETE' });
        pl.trackHashes = (pl.trackHashes || []).filter(h => h !== trackHash);

        const isCurrentPlaying = (currentQueue[currentIndex]?.trackHash === trackHash);
        if (isCurrentPlaying) {
            if (currentQueue.length > 1) {
                nextTrack(false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
            } else {
                pauseTrack();
                if (dom.audio) dom.audio.removeAttribute('src');
                if (dom.trackTitle) dom.trackTitle.textContent = "SIN PISTAS DISPONIBLES";
                if (dom.trackArtist) dom.trackArtist.textContent = "ABRE UNA CARPETA O BUSCA EN LA WEB";
                if (dom.durationTime) dom.durationTime.textContent = "--:--";
                if (dom.currentTime) dom.currentTime.textContent = "00:00";
                if (dom.progressFill) dom.progressFill.style.width = "0%";
            }
        }

        appendLog(`[PLAYLIST] PISTA REMOVIDA DE [${pl.name.toUpperCase()}]: ${track?.title || trackHash}`);
        renderPlaylistSelectOptions();
        updateCurrentQueue();
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
        updateCurrentQueue();
    } catch (err) {
        console.error('[DELETE PLAYLIST ERROR]', err);
        appendLog('ERROR al eliminar lista de reproducción.', true);
    }
}
