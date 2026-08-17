/**
 * dorocoro.js - Entry Point & Orquestador Principal de TokiDorocoro
 * Inicializa los módulos ES6, event listeners, drag & drop y atajos de teclado.
 */

import {
    dom,
    allTracksMap,
    userPlaylists,
    currentQueue,
    currentIndex,
    isPlaying,
    repeatMode,
    isShuffle,
    activePlaylistId,
    activeTab,
    setCurrentIndex,
    setActivePlaylistId,
    setActiveTab,
    setUserPlaylists,
    appendLog
} from './state.js';

import {
    computeTrackHash,
    parseAudioFilename,
    getFileExtension,
    formatSeconds,
    isAudioFile,
    getTrackSourceState,
    showLoader,
    hideLoader
} from './utils.js';

import {
    getCurrentUser,
    saveTrackToIDB,
    loadAllTracksFromIDB,
    saveStateToIDB,
    loadStateFromIDB,
    clearAllLocalDataFromIDB
} from './storage.js';

import {
    getBackendUrl,
    apiFetch,
    syncLibraryWithServer,
    resolveTracksDurations,
    downloadTrackFile
} from './api.js';

import {
    ensureAudioContext,
    initVisualizer,
    loadTrack,
    playTrack,
    pauseTrack,
    togglePlay,
    nextTrack,
    prevTrack,
    toggleShuffle,
    toggleRepeat,
    updateRepeatButtonUI,
    setVolume,
    updateDeckTrackActions
} from './audio.js';

import {
    updateCurrentQueue,
    renderPlaylistSelectOptions,
    renderPlaylist,
    deleteCurrentPlaylist
} from './playlists.js';

import {
    openNewPlaylistModal,
    closeNewPlaylistModal,
    handleConfirmNewPlaylist,
    openEditTrackModal,
    closeEditTrackModal,
    handleConfirmEditTrack,
    openAddToPlaylistModal,
    closeAddToPlaylistModal
} from './modals.js';

import {
    performWebSearch
} from './search.js';

// =============================================================================
// PROCESAMIENTO DE ARCHIVOS LOCALES
// =============================================================================
async function handleAudioFiles(files, folderName = '', replace = false) {
    const audioFiles = Array.from(files).filter(isAudioFile);

    if (audioFiles.length === 0) {
        appendLog(`ADVERTENCIA: No se detectaron archivos de audio válidos.`, true);
        return;
    }

    if (audioFiles.length > 2) {
        showLoader('INDEXANDO CARPETA DE AUDIO...', `Calculando hashes criptográficos de ${audioFiles.length} canciones...`);
    }

    appendLog(`PROCESANDO HASHES Y METADATOS DE ${audioFiles.length} ARCHIVOS...`);
    audioFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const actualFolderName = folderName || (audioFiles[0].webkitRelativePath ? audioFiles[0].webkitRelativePath.split('/')[0] : 'Carpeta Local');
    const processedTracks = [];

    for (const file of audioFiles) {
        const trackHash = await computeTrackHash(file);
        const meta = parseAudioFilename(file.name);
        const ext = getFileExtension(file.name);
        const persistentBlob = file.slice(0, file.size, file.type || 'audio/mpeg');

        const trackObj = {
            trackHash,
            title: meta.title,
            artist: meta.artist,
            album: actualFolderName,
            duration: "--:--",
            file: persistentBlob,
            src: URL.createObjectURL(persistentBlob),
            format: ext,
            rate: "LOCAL " + ext,
            sourceType: 'local',
            isFavorite: false,
            isLocal: true
        };

        const existing = allTracksMap.get(trackHash);
        if (existing) {
            trackObj.title = existing.title;
            trackObj.artist = existing.artist;
            trackObj.album = existing.album;
            trackObj.duration = existing.duration || "--:--";
            trackObj.isFavorite = existing.isFavorite;
        }

        allTracksMap.set(trackHash, trackObj);
        processedTracks.push(trackObj);

        // Guardar en IndexedDB local exclusivamente (Cero llamadas a SQLite)
        await saveTrackToIDB(trackObj);
    }

    hideLoader();

    if (dom.folderDisplayTag) {
        dom.folderDisplayTag.textContent = actualFolderName;
    }

    appendLog(`CARPETA LOCAL CARGADA: ${processedTracks.length} pistas guardadas en este dispositivo.`);

    setActivePlaylistId('all');
    await saveStateToIDB(actualFolderName, 'all', 0);

    renderPlaylistSelectOptions();
    updateCurrentQueue();

    if (currentQueue.length > 0 && !isPlaying) {
        loadTrack(0, false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
    }

    resolveTracksDurations(processedTracks, (hash, dur) => {
        const track = allTracksMap.get(hash);
        if (track) track.duration = dur;
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
    });
}

// =============================================================================
// NAVEGACIÓN POR PESTAÑAS (LOCAL vs WEB)
// =============================================================================
function switchViewTab(tab) {
    setActiveTab(tab);
    if (tab === 'local') {
        if (dom.tabBtnLocal) dom.tabBtnLocal.classList.add('active');
        if (dom.tabBtnWeb) dom.tabBtnWeb.classList.remove('active');
        if (dom.panelLocal) dom.panelLocal.style.display = 'block';
        if (dom.panelWeb) dom.panelWeb.style.display = 'none';
        appendLog("VISTA: BIBLIOTECA & LISTAS");
    } else {
        if (dom.tabBtnLocal) dom.tabBtnLocal.classList.remove('active');
        if (dom.tabBtnWeb) dom.tabBtnWeb.classList.add('active');
        if (dom.panelLocal) dom.panelLocal.style.display = 'none';
        if (dom.panelWeb) dom.panelWeb.style.display = 'block';
        appendLog("VISTA: BÚSQUEDA WEB (YT-DLP STREAM)");
        setTimeout(() => {
            if (dom.inputWebSearch) dom.inputWebSearch.focus();
        }, 100);
    }
}

// =============================================================================
// DRAG AND DROP
// =============================================================================
function setupDragAndDrop() {
    if (!dom.playlistDropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dom.playlistDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dom.playlistDropzone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dom.playlistDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dom.playlistDropzone.classList.remove('drag-over');
        });
    });

    dom.playlistDropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
            appendLog(`PROCESANDO ELEMENTOS ARRASTRADOS (${dt.files.length} ARCHIVOS)...`);
            handleAudioFiles(dt.files, '', false);
        }
    });
}

// =============================================================================
// ASIGNACIÓN DE EVENT LISTENERS
// =============================================================================
function setupEventListeners() {
    // Controles Principales
    if (dom.playBtn) dom.playBtn.addEventListener('click', togglePlay);
    if (dom.prevBtn) dom.prevBtn.addEventListener('click', () => prevTrack(() => renderPlaylist(dom.searchInput ? dom.searchInput.value : '')));
    if (dom.nextBtn) dom.nextBtn.addEventListener('click', () => nextTrack(false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : '')));
    if (dom.repeatBtn) dom.repeatBtn.addEventListener('click', toggleRepeat);
    if (dom.shuffleBtn) dom.shuffleBtn.addEventListener('click', toggleShuffle);

    // Control de Volumen Dual (HTML5 Audio + Web Audio API GainNode)
    if (dom.volumeSlider) {
        setVolume(dom.volumeSlider.value / 100);
        dom.volumeSlider.addEventListener('input', (e) => {
            setVolume(e.target.value / 100);
        });
    }

    // Barra de Progreso y Seek
    if (dom.progressBar && dom.audio) {
        dom.progressBar.addEventListener('click', (e) => {
            if (!dom.audio.duration || isNaN(dom.audio.duration)) return;
            const rect = dom.progressBar.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            dom.audio.currentTime = pos * dom.audio.duration;
        });
    }

    // Acciones Rápidas de la Pista Actual en el Deck
    if (dom.deckBtnFav) {
        dom.deckBtnFav.addEventListener('click', async () => {
            if (currentQueue.length === 0) return;
            const track = currentQueue[currentIndex];
            if (!track) return;
            track.isFavorite = !track.isFavorite;
            await saveTrackToIDB(track);
            apiFetch(`/tracks/${track.trackHash}/favorite`, { method: 'POST' }).catch(() => {});
            appendLog(`FAVORITO [${track.isFavorite ? 'AÑADIDO' : 'REMOVIDO'}]: ${track.title}`);
            updateDeckTrackActions(track);
            renderPlaylistSelectOptions();
            if (activePlaylistId === 'favorites') {
                updateCurrentQueue();
            } else {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
            }
        });
    }

    if (dom.deckBtnDownload) {
        dom.deckBtnDownload.addEventListener('click', async () => {
            if (currentQueue.length === 0) return;
            const track = currentQueue[currentIndex];
            if (!track) return;
            await downloadTrackFile(track, () => {
                updateDeckTrackActions(track);
                renderPlaylistSelectOptions();
                updateCurrentQueue();
            });
        });
    }

    if (dom.deckBtnAddPl) {
        dom.deckBtnAddPl.addEventListener('click', () => {
            if (currentQueue.length === 0) return;
            const track = currentQueue[currentIndex];
            if (!track) return;
            openAddToPlaylistModal(track, () => {
                renderPlaylistSelectOptions();
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
            });
        });
    }

    if (dom.deckBtnEdit) {
        dom.deckBtnEdit.addEventListener('click', () => {
            if (currentQueue.length === 0) return;
            const track = currentQueue[currentIndex];
            if (!track) return;
            openEditTrackModal(track, () => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                if (dom.trackTitle) dom.trackTitle.textContent = track.title;
                if (dom.trackArtist) dom.trackArtist.textContent = track.artist;
            });
        });
    }

    // Eventos del elemento HTML5 Audio
    if (dom.audio) {
        dom.audio.addEventListener('timeupdate', () => {
            if (!dom.audio.duration || isNaN(dom.audio.duration)) return;
            const pct = (dom.audio.currentTime / dom.audio.duration) * 100;
            if (dom.progressFill) dom.progressFill.style.width = `${pct}%`;
            if (dom.currentTime) dom.currentTime.textContent = formatSeconds(dom.audio.currentTime);
            if (dom.durationTime && dom.audio.duration) dom.durationTime.textContent = formatSeconds(dom.audio.duration);
        });

        dom.audio.addEventListener('playing', () => {
            if (dom.statusIndicator) dom.statusIndicator.textContent = "PLAYING";
        });

        dom.audio.addEventListener('waiting', () => {
            if (dom.statusIndicator) dom.statusIndicator.textContent = "BUFFERING";
        });

        dom.audio.addEventListener('ended', () => {
            if (repeatMode === 'one') {
                dom.audio.currentTime = 0;
                playTrack();
            } else {
                nextTrack(true, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
            }
        });

        dom.audio.addEventListener('error', () => {
            const track = currentQueue[currentIndex];
            if (track && track.file && track.webUrl) {
                appendLog(`AVISO: Falló el archivo local de "${track.title}". Conmutando automáticamente a streaming...`, true);
                delete track.file;
                delete track.isLocal;
                allTracksMap.set(track.trackHash, track);
                saveTrackToIDB(track);
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');

                const streamUrl = (track.sourceType === 'drive' || track.webUrl.startsWith('/drive/'))
                    ? `${getBackendUrl()}${track.webUrl}`
                    : `${getBackendUrl()}/api/tokitube/stream/${track.trackHash}?url=${encodeURIComponent(track.webUrl)}`;
                track.src = streamUrl;
                dom.audio.src = streamUrl;
                if (dom.statusIndicator) dom.statusIndicator.textContent = "BUFFERING";
                dom.audio.load();
                playTrack();
                return;
            }

            const err = dom.audio.error;
            let detail = 'Error de conexión o formato';
            if (err) {
                if (err.code === 1) detail = 'Reproducción cancelada';
                if (err.code === 2) detail = 'Error de red al descargar/transmitir';
                if (err.code === 3) detail = 'Error al decodificar flujo de audio';
                if (err.code === 4) detail = 'Formato no soportado o el servidor respondió con error HTTP';
            }
            if (dom.statusIndicator) dom.statusIndicator.textContent = "ERROR";
            appendLog(`ERROR DE AUDIO: ${detail} [${track?.title || 'Pista'}]`, true);
        });
    }

    // Buscador en Lista
    if (dom.searchInput) {
        dom.searchInput.addEventListener('input', (e) => {
            renderPlaylist(e.target.value);
        });
    }

    // Pestañas
    if (dom.tabBtnLocal) dom.tabBtnLocal.addEventListener('click', () => switchViewTab('local'));
    if (dom.tabBtnWeb) dom.tabBtnWeb.addEventListener('click', () => switchViewTab('web'));

    // Búsqueda Web
    if (dom.btnDoWebSearch) dom.btnDoWebSearch.addEventListener('click', () => performWebSearch());

    if (dom.inputWebSearch) {
        dom.inputWebSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                performWebSearch();
            }
        });
    }

    // Selector de Listas y CRUD
    if (dom.playlistSelect) {
        dom.playlistSelect.addEventListener('change', (e) => {
            setActivePlaylistId(e.target.value);
            updateCurrentQueue();
        });
    }

    if (dom.btnNewPlaylist) dom.btnNewPlaylist.addEventListener('click', openNewPlaylistModal);
    if (dom.btnConfirmNewPlaylist) {
        const triggerCreate = () => handleConfirmNewPlaylist((newId) => {
            setActivePlaylistId(newId);
            renderPlaylistSelectOptions();
            updateCurrentQueue();
        });

        dom.btnConfirmNewPlaylist.addEventListener('click', triggerCreate);
        if (dom.inputNewPlaylistName) {
            dom.inputNewPlaylistName.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') triggerCreate();
            });
        }
        if (dom.inputPlaylistImportUrl) {
            dom.inputPlaylistImportUrl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') triggerCreate();
            });
        }
    }
    if (dom.btnCancelNewPlaylist) dom.btnCancelNewPlaylist.addEventListener('click', closeNewPlaylistModal);
    if (dom.btnCloseModalNewPl) dom.btnCloseModalNewPl.addEventListener('click', closeNewPlaylistModal);
    if (dom.btnDeletePlaylist) dom.btnDeletePlaylist.addEventListener('click', deleteCurrentPlaylist);

    // Modales de Edición y Agregar
    if (dom.btnConfirmEditTrack) dom.btnConfirmEditTrack.addEventListener('click', () => handleConfirmEditTrack(() => {
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
    }));
    if (dom.btnCancelEditTrack) dom.btnCancelEditTrack.addEventListener('click', closeEditTrackModal);
    if (dom.btnCloseModalEdit) dom.btnCloseModalEdit.addEventListener('click', closeEditTrackModal);

    if (dom.btnCancelAddToPl) dom.btnCancelAddToPl.addEventListener('click', closeAddToPlaylistModal);
    if (dom.btnCloseModalAddPl) dom.btnCloseModalAddPl.addEventListener('click', closeAddToPlaylistModal);

    // Evento Global Desacoplado de Actualización de Playlists
    document.addEventListener('dorocoro:playlist-changed', () => {
        renderPlaylistSelectOptions();
        updateCurrentQueue();
    });

    // Carga de Carpetas y Archivos
    if (dom.btnOpenFolder && dom.folderInputHidden) {
        dom.btnOpenFolder.addEventListener('click', () => { dom.folderInputHidden.click(); });
        dom.folderInputHidden.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const folderName = e.target.files[0].webkitRelativePath ? e.target.files[0].webkitRelativePath.split('/')[0] : 'Carpeta';
                handleAudioFiles(e.target.files, folderName, false);
                e.target.value = '';
            }
        });
    }

    if (dom.btnAddFiles && dom.filesInputHidden) {
        dom.btnAddFiles.addEventListener('click', () => { dom.filesInputHidden.click(); });
        dom.filesInputHidden.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleAudioFiles(e.target.files, dom.folderDisplayTag ? dom.folderDisplayTag.textContent : '', false);
                e.target.value = '';
            }
        });
    }

    // Vaciar Biblioteca Total
    if (dom.btnClearLibrary) {
        dom.btnClearLibrary.addEventListener('click', async () => {
            if (allTracksMap.size === 0) return;
            if (!confirm("¿Deseas vaciar la biblioteca y memoria local en este y todos tus dispositivos?")) return;
            pauseTrack();
            allTracksMap.clear();
            setUserPlaylists([]);
            setCurrentQueue([]);
            setCurrentIndex(0);
            if (dom.folderDisplayTag) dom.folderDisplayTag.textContent = 'VACÍO';
            loadTrack(0, false);
            renderPlaylistSelectOptions();
            renderPlaylist();
            await clearAllLocalDataFromIDB();

            // Vaciar también el registro central en SQLite
            apiFetch('/library', { method: 'DELETE' }).catch(() => {});
            appendLog('BIBLIOTECA Y MEMORIA VACIADAS EN TODOS LOS DISPOSITIVOS');
        });
    }

    // Atajos de Teclado
    window.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.code === 'Space') {
            e.preventDefault();
            togglePlay();
        } else if (e.code === 'ArrowRight' && e.shiftKey) {
            e.preventDefault();
            nextTrack(false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
        } else if (e.code === 'ArrowLeft' && e.shiftKey) {
            e.preventDefault();
            prevTrack(() => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
        }
    });
}

// =============================================================================
// INICIALIZACIÓN GENERAL Y AUTO-RESTAURACIÓN
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const u = getCurrentUser();
    if (dom.userDisplayTag) {
        dom.userDisplayTag.textContent = u.toUpperCase();
    }

    initVisualizer();
    setupDragAndDrop();
    setupEventListeners();

    // 1. Renderizar opciones del selector de listas de inmediato
    renderPlaylistSelectOptions();
    updateCurrentQueue();

    // 2. Restaurar biblioteca de IndexedDB local
    try {
        const cachedTracks = await loadAllTracksFromIDB();
        if (cachedTracks && cachedTracks.length > 0) {
            cachedTracks.forEach(t => {
                const isDrive = (t.sourceType === 'drive' || (t.webUrl && t.webUrl.startsWith('/drive/')) || (t.webUrl && t.webUrl.includes('/drive-stream/')));
                const isWeb = (t.sourceType === 'web' || t.trackHash.startsWith('trk_yt_') || (t.webUrl && !isDrive));
                const src = isDrive
                    ? `${getBackendUrl()}${t.webUrl}`
                    : (isWeb
                        ? `${getBackendUrl()}/api/tokitube/stream/${t.trackHash}?url=${encodeURIComponent(t.webUrl || '')}`
                        : (t.file ? URL.createObjectURL(t.file) : ''));

                allTracksMap.set(t.trackHash, {
                    ...t,
                    src,
                    isLocal: !isWeb && !isDrive
                });
            });

            const savedState = await loadStateFromIDB();
            if (savedState) {
                if (savedState.folderName && dom.folderDisplayTag) {
                    dom.folderDisplayTag.textContent = savedState.folderName;
                }
                if (savedState.activePlaylistId) {
                    setActivePlaylistId(savedState.activePlaylistId);
                }
                if (typeof savedState.currentIndex === 'number') {
                    setCurrentIndex(savedState.currentIndex);
                }
            }

            renderPlaylistSelectOptions();
            updateCurrentQueue();
            appendLog(`MEMORIA LOCAL RESTAURADA (${cachedTracks.length} PISTAS DE AUDIO)`);

            resolveTracksDurations(Array.from(allTracksMap.values()), (hash, dur) => {
                const track = allTracksMap.get(hash);
                if (track) track.duration = dur;
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
            });
        } else {
            loadTrack(0, false);
        }
    } catch (err) {
        console.warn('[TOKITUBE IDB RESTORE]', err);
        loadTrack(0, false);
    }

    // 3. Sincronizar listas y TokiDrive con SQLite
    syncLibraryWithServer({
        onSyncComplete: () => {
            renderPlaylistSelectOptions();
            updateCurrentQueue();
        }
    });
});

// API Global de TokiTube para scripts externos
window.TokiTubePlayer = {
    loadFolder: (files, folderName) => handleAudioFiles(files, folderName, false),
    searchWeb: (q) => {
        if (dom.inputWebSearch) dom.inputWebSearch.value = q;
        switchViewTab('web');
        performWebSearch((track) => {
            switchViewTab('local');
            renderPlaylistSelectOptions();
            updateCurrentQueue();
            const idx = currentQueue.findIndex(t => t.trackHash === track.trackHash);
            if (idx !== -1) {
                loadTrack(idx, true, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
            }
        });
    },
    play: playTrack,
    pause: pauseTrack,
    next: () => nextTrack(false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : '')),
    prev: () => prevTrack(() => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''))
};
