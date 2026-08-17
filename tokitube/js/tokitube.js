/**
 * tokitube.js - Entry Point & Orquestador Principal de TokiTube (Dorocoro)
 * Inicializa los módulos ES6, cola de reproducción local, event listeners, drag & drop y atajos.
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
    setCurrentQueue,
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
    saveQueueToIDB,
    loadQueueFromIDB,
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
    toggleRepeat,
    updateRepeatButtonUI,
    setVolume,
    updateDeckTrackActions
} from './audio.js';

import {
    updateDisplayedPlaylist,
    updateCurrentQueue,
    renderPlaylistSelectOptions,
    renderPlaylist,
    renderQueue,
    playPlaylist,
    queuePlaylist,
    clearQueue,
    shuffleQueue,
    deleteCurrentPlaylist,
    openQueuePopover
} from './playlists.js';

import {
    openNewPlaylistModal,
    closeNewPlaylistModal,
    handleConfirmNewPlaylist,
    openEditTrackModal,
    closeEditTrackModal,
    handleConfirmEditTrack,
    openAddToPlaylistModal,
    closeAddToPlaylistModal,
    openRelinkTrackModal,
    closeRelinkTrackModal,
    getActiveEditTrack
} from './modals.js';

import {
    openJamPopover,
    closeJamModal,
    stopJamSessionClient,
    syncJamCurrentPlaying,
    getActiveJam,
    getJoinedTokiJam,
    queueTrackToActiveJam,
    checkAndRestoreActiveJam
} from './jam.js';

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
    updateDisplayedPlaylist();

    // Si la cola estaba vacía, inicializar la cola con las pistas locales cargadas
    if (currentQueue.length === 0) {
        setCurrentQueue([...processedTracks]);
        saveQueueToIDB(currentQueue, 0);
        renderQueue();
        if (!isPlaying) {
            loadTrack(0, false, () => renderPlaylist(dom.searchInput ? dom.searchInput.value : ''));
        }
    }

    resolveTracksDurations(processedTracks, (hash, dur) => {
        const track = allTracksMap.get(hash);
        if (track) track.duration = dur;
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
        renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
    });
}

// =============================================================================
// NAVEGACIÓN POR PESTAÑAS (LOCAL vs COLA vs WEB)
// =============================================================================
function switchViewTab(tab) {
    setActiveTab(tab);

    if (dom.tabBtnLocal) dom.tabBtnLocal.classList.toggle('active', tab === 'local');
    if (dom.tabBtnQueue) dom.tabBtnQueue.classList.toggle('active', tab === 'queue');
    if (dom.tabBtnWeb) dom.tabBtnWeb.classList.toggle('active', tab === 'web');

    if (dom.panelLocal) dom.panelLocal.style.display = (tab === 'local') ? 'block' : 'none';
    if (dom.panelQueue) dom.panelQueue.style.display = (tab === 'queue') ? 'block' : 'none';
    if (dom.panelWeb) dom.panelWeb.style.display = (tab === 'web') ? 'block' : 'none';

    if (tab === 'local') {
        appendLog("VISTA: BIBLIOTECA & LISTAS");
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
    } else if (tab === 'queue') {
        appendLog("VISTA: COLA DE REPRODUCCIÓN (LOCAL)");
        renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
    } else if (tab === 'web') {
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
    // Controles Principales de Reproducción
    if (dom.playBtn) dom.playBtn.addEventListener('click', togglePlay);
    if (dom.prevBtn) dom.prevBtn.addEventListener('click', () => prevTrack(() => {
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
        renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
    }));
    if (dom.nextBtn) dom.nextBtn.addEventListener('click', () => nextTrack(false, () => {
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
        renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
    }));
    if (dom.repeatBtn) dom.repeatBtn.addEventListener('click', toggleRepeat);
    if (dom.shuffleBtn) dom.shuffleBtn.addEventListener('click', shuffleQueue);

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
            updateDisplayedPlaylist();
            renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
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
                updateDisplayedPlaylist();
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
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
                updateDisplayedPlaylist();
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
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
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
            renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
            renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
        });

        dom.audio.addEventListener('waiting', () => {
            if (dom.statusIndicator) dom.statusIndicator.textContent = "BUFFERING";
        });

        dom.audio.addEventListener('ended', () => {
            if (repeatMode === 'one') {
                dom.audio.currentTime = 0;
                playTrack();
            } else {
                nextTrack(true, () => {
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                    renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
                });
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
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');

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
                if (err.code === 4) detail = 'Enlace de YouTube no disponible (video eliminado o privado)';
            }
            if (dom.statusIndicator) dom.statusIndicator.textContent = "ERROR ENLACE";
            appendLog(`[ERROR DE AUDIO / STREAM] ${detail}: "${track?.title || 'Pista'}". Puedes elegir una fuente alternativa.`, true);

            if (track) {
                openRelinkTrackModal(track, true, () => {
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                    renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
                });
            }
        });
    }

    // Buscador en Lista
    if (dom.searchInput) {
        dom.searchInput.addEventListener('input', (e) => {
            renderPlaylist(e.target.value);
        });
    }

    // Buscador en Cola
    if (dom.queueSearchInput) {
        dom.queueSearchInput.addEventListener('input', (e) => {
            renderQueue(e.target.value);
        });
    }

    // Pestañas
    if (dom.tabBtnLocal) dom.tabBtnLocal.addEventListener('click', () => switchViewTab('local'));
    if (dom.tabBtnQueue) dom.tabBtnQueue.addEventListener('click', () => switchViewTab('queue'));
    if (dom.tabBtnWeb) dom.tabBtnWeb.addEventListener('click', () => switchViewTab('web'));

    // Botones de Acciones sobre la Playlist completa
    if (dom.btnPlayPlaylist) {
        dom.btnPlayPlaylist.addEventListener('click', () => playPlaylist(activePlaylistId));
    }
    if (dom.btnQueuePlaylist) {
        dom.btnQueuePlaylist.addEventListener('click', (e) => {
            e.stopPropagation();
            openQueuePopover(dom.btnQueuePlaylist, async (pos) => {
                const joinedJam = getJoinedTokiJam();
                if (joinedJam) {
                    const rawTracks = getTracksForPlaylist(activePlaylistId);
                    let sentCount = 0;
                    for (const t of rawTracks) {
                        if (t.sourceType === 'web' || t.sourceType === 'drive' || Boolean(t.webUrl)) {
                            await queueTrackToActiveJam(t, pos);
                            sentCount++;
                        }
                    }
                    if (sentCount === 0) {
                        alert('[JAM] No se encontraron pistas Web o TokiDrive en esta lista para enviar a la TokiJAM.');
                    }
                } else {
                    queuePlaylist(activePlaylistId, pos);
                }
            });
        });
    }

    // Botones de la Cola
    if (dom.btnClearQueue) {
        dom.btnClearQueue.addEventListener('click', () => {
            if (currentQueue.length === 0) return;
            if (confirm('¿Deseas vaciar toda la cola de reproducción?')) {
                clearQueue();
            }
        });
    }
    if (dom.btnShuffleQueue) {
        dom.btnShuffleQueue.addEventListener('click', shuffleQueue);
    }

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
            updateDisplayedPlaylist();
        });
    }

    if (dom.btnNewPlaylist) dom.btnNewPlaylist.addEventListener('click', openNewPlaylistModal);
    if (dom.btnConfirmNewPlaylist) {
        const triggerCreate = () => handleConfirmNewPlaylist((newId) => {
            setActivePlaylistId(newId);
            renderPlaylistSelectOptions();
            updateDisplayedPlaylist();
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
        renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
    }));
    if (dom.btnCancelEditTrack) dom.btnCancelEditTrack.addEventListener('click', closeEditTrackModal);
    if (dom.btnCloseModalEdit) dom.btnCloseModalEdit.addEventListener('click', closeEditTrackModal);
    if (dom.btnEditTrackRelink) {
        dom.btnEditTrackRelink.addEventListener('click', () => {
            const track = getActiveEditTrack();
            if (track) {
                closeEditTrackModal();
                openRelinkTrackModal(track, false, () => {
                    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                    renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
                });
            }
        });
    }

    if (dom.btnCancelAddToPl) dom.btnCancelAddToPl.addEventListener('click', closeAddToPlaylistModal);
    if (dom.btnCloseModalAddPl) dom.btnCloseModalAddPl.addEventListener('click', closeAddToPlaylistModal);

    // Modal Reparar / Cambiar Enlace
    if (dom.btnCancelModalRelink) dom.btnCancelModalRelink.addEventListener('click', closeRelinkTrackModal);
    if (dom.btnCloseModalRelink) dom.btnCloseModalRelink.addEventListener('click', closeRelinkTrackModal);
    if (dom.btnRelinkSkipNext) {
        dom.btnRelinkSkipNext.addEventListener('click', () => {
            closeRelinkTrackModal();
            nextTrack(true, () => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
            });
        });
    }

    // Modal y Botones de JAM Colaborativa
    if (dom.btnWinJam) {
        dom.btnWinJam.addEventListener('click', (e) => {
            e.stopPropagation();
            openJamPopover(dom.btnWinJam);
        });
    }
    if (dom.btnDeckJam) {
        dom.btnDeckJam.addEventListener('click', (e) => {
            e.stopPropagation();
            openJamPopover(dom.btnDeckJam);
        });
    }
    if (dom.btnPlJam) {
        dom.btnPlJam.addEventListener('click', (e) => {
            e.stopPropagation();
            openJamPopover(dom.btnPlJam);
        });
    }
    if (dom.btnQueueJam) {
        dom.btnQueueJam.addEventListener('click', (e) => {
            e.stopPropagation();
            openJamPopover(dom.btnQueueJam);
        });
    }

    if (dom.btnCloseModalJam) dom.btnCloseModalJam.addEventListener('click', closeJamModal);
    if (dom.btnCancelModalJam) dom.btnCancelModalJam.addEventListener('click', closeJamModal);
    if (dom.btnStopActiveJam) dom.btnStopActiveJam.addEventListener('click', stopJamSessionClient);

    if (dom.btnCopyJamUrl) {
        dom.btnCopyJamUrl.addEventListener('click', () => {
            const input = document.getElementById('jam-modal-url-input');
            if (input && input.value) {
                navigator.clipboard.writeText(input.value).then(() => {
                    const origText = dom.btnCopyJamUrl.textContent;
                    dom.btnCopyJamUrl.textContent = '¡COPIADO!';
                    setTimeout(() => { dom.btnCopyJamUrl.textContent = origText; }, 2000);
                }).catch(() => {
                    input.select();
                    document.execCommand('copy');
                });
            }
        });
    }

    // Eventos Globales Desacoplados de Actualización
    document.addEventListener('dorocoro:playlist-changed', () => {
        renderPlaylistSelectOptions();
        updateDisplayedPlaylist();
    });

    document.addEventListener('dorocoro:track-loaded', (e) => {
        const track = e.detail?.track;
        if (track) {
            syncJamCurrentPlaying(track);
        }
    });

    document.addEventListener('dorocoro:track-relinked', (e) => {
        const updatedTrack = e.detail?.track;
        renderPlaylistSelectOptions();
        updateDisplayedPlaylist();
        renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');

        // Si la pista revinculada es la que está en reproducción, cargar y reproducir de inmediato
        const currentPlayingTrack = currentQueue[currentIndex];
        if (updatedTrack && currentPlayingTrack && currentPlayingTrack.trackHash === updatedTrack.trackHash) {
            loadTrack(currentIndex, true, () => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
            });
        }
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
            updateDisplayedPlaylist();
            renderQueue();
            await clearAllLocalDataFromIDB();

            // Vaciar también el registro central en SQLite
            apiFetch('/library', { method: 'DELETE' }).catch(() => {});
            appendLog('BIBLIOTECA Y MEMORIA VACIADAS EN TODOS LOS DISPOSITIVOS');
        });
    }

    // Control de Ventana Retro: Maximizar al 90% en Escritorio
    if (dom.btnWinMax && dom.mainContainer) {
        dom.btnWinMax.addEventListener('click', () => {
            if (window.innerWidth <= 820) {
                appendLog("AVISO: El modo maximizado está optimizado para vista de escritorio (>820px).", true);
                return;
            }

            const isMax = dom.mainContainer.classList.toggle('is-maximized');
            dom.btnWinMax.textContent = isMax ? '❐' : '[]';
            dom.btnWinMax.title = isMax ? 'Restaurar Tamaño Normal' : 'Maximizar al 90%';
            appendLog(`[VENTANA] ${isMax ? 'VISTA MAXIMIZADA AL 90% (MODO ESCRITORIO)' : 'VISTA RESTAURADA A TAMAÑO NORMAL'}`);
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth <= 820 && dom.mainContainer.classList.contains('is-maximized')) {
                dom.mainContainer.classList.remove('is-maximized');
                dom.btnWinMax.textContent = '[]';
                dom.btnWinMax.title = 'Maximizar al 90%';
            }
        });
    }

    if (dom.btnWinMin) {
        dom.btnWinMin.addEventListener('click', () => {
            appendLog('[VENTANA] TOKITUBE EN EJECUCIÓN');
        });
    }

    if (dom.btnWinClose) {
        dom.btnWinClose.addEventListener('click', () => {
            if (confirm('¿Deseas salir de TokiTube y volver al portal?')) {
                window.location.href = '/';
            }
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
            nextTrack(false, () => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
            });
        } else if (e.code === 'ArrowLeft' && e.shiftKey) {
            e.preventDefault();
            prevTrack(() => {
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
            });
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
    updateDisplayedPlaylist();

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

            // Restaurar estado guardado
            const savedState = await loadStateFromIDB();
            if (savedState) {
                if (savedState.folderName && dom.folderDisplayTag) {
                    dom.folderDisplayTag.textContent = savedState.folderName;
                }
                if (savedState.activePlaylistId) {
                    setActivePlaylistId(savedState.activePlaylistId);
                }
            }

            // Restaurar cola de reproducción local desde IndexedDB
            const savedQueueData = await loadQueueFromIDB();
            if (savedQueueData && Array.isArray(savedQueueData.queueHashes) && savedQueueData.queueHashes.length > 0) {
                const restoredQueue = savedQueueData.queueHashes
                    .map(hash => {
                        const original = allTracksMap.get(hash);
                        return original ? { ...original, queueUid: 'qu_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) } : null;
                    })
                    .filter(Boolean);
                if (restoredQueue.length > 0) {
                    setCurrentQueue(restoredQueue);
                    const safeIdx = (typeof savedQueueData.currentIndex === 'number' && savedQueueData.currentIndex < restoredQueue.length)
                        ? savedQueueData.currentIndex
                        : 0;
                    setCurrentIndex(safeIdx);
                }
            } else {
                // Si no había cola previa guardada, inicializar con las canciones locales
                const defaultTracks = Array.from(allTracksMap.values())
                    .filter(t => Boolean(t.file) || t.sourceType === 'local')
                    .map(t => ({ ...t, queueUid: 'qu_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) }));
                if (defaultTracks.length > 0) {
                    setCurrentQueue(defaultTracks);
                    setCurrentIndex(0);
                }
            }

            renderPlaylistSelectOptions();
            updateDisplayedPlaylist();
            renderQueue();
            appendLog(`MEMORIA LOCAL RESTAURADA (${cachedTracks.length} PISTAS DE AUDIO, ${currentQueue.length} EN COLA)`);

            if (currentQueue.length > 0) {
                loadTrack(currentIndex, false);
            } else {
                loadTrack(0, false);
            }

            resolveTracksDurations(Array.from(allTracksMap.values()), (hash, dur) => {
                const track = allTracksMap.get(hash);
                if (track) track.duration = dur;
                renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
                renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
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
            updateDisplayedPlaylist();
        }
    });

    // 4. Verificar si existe una Jam activa para restaurar la interfaz en modo Jam
    checkAndRestoreActiveJam().catch(() => {});
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
            updateDisplayedPlaylist();
            renderQueue();
        });
    },
    play: playTrack,
    pause: pauseTrack,
    next: () => nextTrack(false, () => {
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
        renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
    }),
    prev: () => prevTrack(() => {
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
        renderQueue(dom.queueSearchInput ? dom.queueSearchInput.value : '');
    }),
    playPlaylist,
    queuePlaylist,
    clearQueue,
    shuffleQueue
};
