/**
 * state.js - Estado Global Centralizado de TokiDorocoro
 * Administra las estructuras en memoria, variables de reproducción y elementos de la interfaz.
 */

// =============================================================================
// ESTRUCTURAS EN MEMORIA
// =============================================================================
export const allTracksMap = new Map(); // trackHash -> Track object
export let userPlaylists = [];        // Lista de playlists: [{ id, name, trackHashes: [] }]
export let currentQueue = [];         // Array de canciones actualmente en la lista activa
export let currentIndex = 0;          // Índice de la pista en reproducción
export let isPlaying = false;
export let repeatMode = 'off';        // 'off' | 'all' | 'one'
export let isShuffle = false;
export let activePlaylistId = 'all';  // 'all' | 'drive' | 'favorites' | '<playlistId>'
export let activeTab = 'local';        // 'local' | 'web'

// Elemento central HTML5 Audio compartido
export const audio = new Audio();
audio.crossOrigin = 'anonymous';

// =============================================================================
// SETTERS DE ESTADO SEGUROS
// =============================================================================
export function setUserPlaylists(playlists) {
    userPlaylists = Array.isArray(playlists) ? playlists : [];
}

export function setCurrentQueue(queue) {
    currentQueue = Array.isArray(queue) ? queue : [];
}

export function setCurrentIndex(idx) {
    currentIndex = typeof idx === 'number' ? idx : 0;
}

export function setIsPlaying(val) {
    isPlaying = Boolean(val);
}

export function setRepeatMode(mode) {
    if (['off', 'all', 'one'].includes(mode)) {
        repeatMode = mode;
    }
}

export function setIsShuffle(val) {
    isShuffle = Boolean(val);
}

export function setActivePlaylistId(id) {
    activePlaylistId = id || 'all';
}

export function setActiveTab(tab) {
    activeTab = tab || 'local';
}

// =============================================================================
// REFERENCIAS DINÁMICAS DEL DOM (GETTERS SEGUROS)
// =============================================================================
export const dom = {
    get audio() { return audio; },
    get canvas() { return document.getElementById('visualizer-canvas'); },
    get terminalLog() { return document.getElementById('terminal-log-output'); },
    get statusIndicator() { return document.getElementById('deck-status-indicator'); },
    get userDisplayTag() { return document.getElementById('user-display-tag'); },
    get folderDisplayTag() { return document.getElementById('folder-display-tag'); },

    // Elementos de Metadata y Progreso
    get trackTitle() { return document.getElementById('current-track-title'); },
    get trackArtist() { return document.getElementById('current-track-artist'); },
    get trackFormat() { return document.getElementById('track-format-badge'); },
    get trackRate() { return document.getElementById('track-rate-badge'); },
    get currentTime() { return document.getElementById('current-time'); },
    get durationTime() { return document.getElementById('duration-time'); },
    get progressFill() { return document.getElementById('progress-fill'); },
    get progressBar() { return document.getElementById('progress-bar'); },

    // Controles de Reproducción
    get playBtn() { return document.getElementById('btn-play'); },
    get playIcon() { return document.getElementById('play-icon'); },
    get prevBtn() { return document.getElementById('btn-prev'); },
    get nextBtn() { return document.getElementById('btn-next'); },
    get repeatBtn() { return document.getElementById('btn-repeat'); },
    get repeatIcon() { return document.getElementById('repeat-icon'); },
    get shuffleBtn() { return document.getElementById('btn-shuffle'); },
    get volumeSlider() { return document.getElementById('volume-slider'); },

    // Acciones de Pista en el Reproductor
    get deckTrackActions() { return document.getElementById('deck-track-actions'); },
    get deckBtnFav() { return document.getElementById('deck-btn-fav'); },
    get deckIconFav() { return document.getElementById('deck-icon-fav'); },
    get deckBtnDownload() { return document.getElementById('deck-btn-download'); },
    get deckBtnAddPl() { return document.getElementById('deck-btn-add-pl'); },
    get deckBtnEdit() { return document.getElementById('deck-btn-edit'); },

    // Listas y Contenedores
    get playlistContainer() { return document.getElementById('playlist-items'); },
    get playlistSelect() { return document.getElementById('playlist-select'); },
    get playlistCurrentTitle() { return document.getElementById('playlist-current-title'); },
    get tracksCountBadge() { return document.getElementById('tracks-count-badge'); },
    get playlistDropzone() { return document.getElementById('playlist-dropzone'); },
    get searchInput() { return document.getElementById('playlist-search'); },

    // Botones de Biblioteca
    get btnOpenFolder() { return document.getElementById('btn-open-folder'); },
    get folderInputHidden() { return document.getElementById('folder-input-hidden'); },
    get btnAddFiles() { return document.getElementById('btn-add-files'); },
    get filesInputHidden() { return document.getElementById('files-input-hidden'); },
    get btnClearLibrary() { return document.getElementById('btn-clear-playlist'); },
    get btnNewPlaylist() { return document.getElementById('btn-new-playlist'); },
    get btnDeletePlaylist() { return document.getElementById('btn-delete-playlist'); },

    // Pestañas y Búsqueda Web
    get tabBtnLocal() { return document.getElementById('tab-btn-local'); },
    get tabBtnWeb() { return document.getElementById('tab-btn-web'); },
    get panelLocal() { return document.getElementById('view-local-playlist'); },
    get panelWeb() { return document.getElementById('view-web-search'); },
    get inputWebSearch() { return document.getElementById('input-web-search'); },
    get btnDoWebSearch() { return document.getElementById('btn-do-web-search'); },
    get webSearchStatus() { return document.getElementById('web-search-status'); },
    get webSearchResults() { return document.getElementById('web-search-results'); },

    // Modales
    get modalNewPlaylist() { return document.getElementById('modal-new-playlist'); },
    get inputNewPlaylistName() { return document.getElementById('input-playlist-name'); },
    get inputPlaylistImportUrl() { return document.getElementById('input-playlist-import-url'); },
    get newPlImportStatus() { return document.getElementById('new-pl-import-status'); },
    get btnConfirmNewPlaylist() { return document.getElementById('btn-confirm-modal-pl'); },
    get btnCancelNewPlaylist() { return document.getElementById('btn-cancel-modal-pl'); },
    get btnCloseModalNewPl() { return document.getElementById('btn-close-modal-pl'); },

    get modalEditTrack() { return document.getElementById('modal-edit-track'); },
    get editTrackHash() { return document.getElementById('edit-track-hash'); },
    get editTrackTitle() { return document.getElementById('edit-track-title'); },
    get editTrackArtist() { return document.getElementById('edit-track-artist'); },
    get editTrackAlbum() { return document.getElementById('edit-track-album'); },
    get btnConfirmEditTrack() { return document.getElementById('btn-confirm-modal-edit'); },
    get btnCancelEditTrack() { return document.getElementById('btn-cancel-modal-edit'); },
    get btnCloseModalEdit() { return document.getElementById('btn-close-modal-edit'); },

    get modalAddToPlaylist() { return document.getElementById('modal-add-to-playlist'); },
    get addToPlTrackHash() { return document.getElementById('add-to-pl-track-hash'); },
    get addToPlTrackName() { return document.getElementById('add-to-pl-track-name'); },
    get addToPlListOptions() { return document.getElementById('add-to-pl-list-options'); },
    get btnCancelAddToPl() { return document.getElementById('btn-cancel-modal-add-pl'); },
    get btnCloseModalAddPl() { return document.getElementById('btn-close-modal-add-pl'); }
};

// =============================================================================
// LOGGING EN TERMINAL RETRO
// =============================================================================
export function appendLog(msg, isAlert = false) {
    const logEl = dom.terminalLog;
    if (!logEl) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${isAlert ? 'alert' : ''}`;
    const timeStr = new Date().toLocaleTimeString();
    entry.textContent = `[${timeStr}] > ${msg}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
}
