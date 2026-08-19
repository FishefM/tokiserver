/**
 * state.js - Estado Global Centralizado de TokiDorocoro
 * Administra las estructuras en memoria, variables de reproducción y elementos de la interfaz.
 */

// =============================================================================
// ESTRUCTURAS EN MEMORIA
// =============================================================================
export const allTracksMap = new Map();         // trackHash -> Track object
export let userPlaylists = [];                // Lista de playlists: [{ id, name, trackHashes: [] }]
export let currentQueue = [];                 // Array de canciones en la cola de reproducción activa
export let currentIndex = 0;                  // Índice de la pista en reproducción en la cola
export let displayedPlaylistTracks = [];      // Pistas mostradas actualmente en la pestaña de listas
export let isPlaying = false;
export let repeatMode = 'off';                // 'off' | 'all' | 'one'
export let isShuffle = false;
export let activePlaylistId = 'all';          // 'all' | 'drive' | 'favorites' | '<playlistId>'
export let activeTab = 'local';                // 'local' | 'queue' | 'web'

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

export function setDisplayedPlaylistTracks(tracks) {
    displayedPlaylistTracks = Array.isArray(tracks) ? tracks : [];
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
    get mainContainer() { return document.querySelector('.dorocoro-container'); },
    get btnWinMin() { return document.getElementById('btn-win-min'); },
    get btnWinMax() { return document.getElementById('btn-win-max'); },
    get btnWinClose() { return document.getElementById('btn-win-close'); },
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

    // Botones de Biblioteca y Playlist Actions
    get btnPlayPlaylist() { return document.getElementById('btn-play-playlist'); },
    get btnQueuePlaylist() { return document.getElementById('btn-queue-playlist-end') || document.getElementById('btn-queue-playlist'); },
    get btnQueuePlaylistNext() { return document.getElementById('btn-queue-playlist-next'); },
    get btnQueuePlaylistEnd() { return document.getElementById('btn-queue-playlist-end'); },
    get btnOpenFolder() { return document.getElementById('btn-open-folder'); },
    get folderInputHidden() { return document.getElementById('folder-input-hidden'); },
    get btnAddFiles() { return document.getElementById('btn-add-files'); },
    get filesInputHidden() { return document.getElementById('files-input-hidden'); },
    get btnClearLibrary() { return document.getElementById('btn-clear-playlist'); },
    get btnNewPlaylist() { return document.getElementById('btn-new-playlist'); },
    get btnSyncPlaylist() { return document.getElementById('btn-sync-playlist'); },
    get btnDeletePlaylist() { return document.getElementById('btn-delete-playlist'); },

    // Pestañas, Cola y Búsqueda Web
    get tabBtnLocal() { return document.getElementById('tab-btn-local'); },
    get tabBtnQueue() { return document.getElementById('tab-btn-queue'); },
    get tabBtnWeb() { return document.getElementById('tab-btn-web'); },
    get queueCountBadge() { return document.getElementById('queue-count-badge'); },
    get panelLocal() { return document.getElementById('view-local-playlist'); },
    get panelQueue() { return document.getElementById('view-queue'); },
    get panelWeb() { return document.getElementById('view-web-search'); },
    
    // Elementos de la Cola de Reproducción (Local)
    get queueTracksCount() { return document.getElementById('queue-tracks-count'); },
    get queueContainer() { return document.getElementById('queue-items'); },
    get queueSearchInput() { return document.getElementById('queue-search'); },
    get btnClearQueue() { return document.getElementById('btn-clear-queue'); },
    get btnShuffleQueue() { return document.getElementById('btn-shuffle-queue'); },

    // Búsqueda Web
    get inputWebSearch() { return document.getElementById('input-web-search'); },
    get btnDoWebSearch() { return document.getElementById('btn-do-web-search'); },
    get webSearchStatus() { return document.getElementById('web-search-status'); },
    get webSearchResults() { return document.getElementById('web-search-results'); },

    get btnWinSpotify() { return document.getElementById('btn-win-spotify'); },

    // Modales
    get modalNewPlaylist() { return document.getElementById('modal-new-playlist'); },
    get tabBtnPlUrl() { return document.getElementById('tab-btn-pl-url'); },
    get tabBtnPlSpotify() { return document.getElementById('tab-btn-pl-spotify'); },
    get panelNewPlUrl() { return document.getElementById('panel-new-pl-url'); },
    get panelNewPlSpotify() { return document.getElementById('panel-new-pl-spotify'); },
    get spotifyMyPlaylistsHeader() { return document.getElementById('spotify-my-playlists-header'); },
    get spotifyMyPlaylistsUserBadge() { return document.getElementById('spotify-my-playlists-user-badge'); },
    get btnRefreshSpotifyPl() { return document.getElementById('btn-refresh-spotify-pl'); },
    get btnUnlinkSpotifyTab() { return document.getElementById('btn-unlink-spotify-tab'); },
    get spotifyMyPlaylistsList() { return document.getElementById('spotify-my-playlists-list'); },
    get btnCancelModalPlSpotify() { return document.getElementById('btn-cancel-modal-pl-spotify'); },
    get inputNewPlaylistName() { return document.getElementById('input-playlist-name'); },
    get inputPlaylistImportUrl() { return document.getElementById('input-playlist-import-url'); },
    get newPlImportStatus() { return document.getElementById('new-pl-import-status'); },
    get btnConfirmNewPlaylist() { return document.getElementById('btn-confirm-modal-pl'); },
    get btnCancelNewPlaylist() { return document.getElementById('btn-cancel-modal-pl'); },
    get btnCloseModalNewPl() { return document.getElementById('btn-close-modal-pl'); },

    // Modal Spotify Account
    get modalSpotifyAccount() { return document.getElementById('modal-spotify-account'); },
    get btnCloseModalSpotify() { return document.getElementById('btn-close-modal-spotify'); },
    get btnCancelModalSpotify() { return document.getElementById('btn-cancel-modal-spotify'); },
    get btnActionSpotifyAuth() { return document.getElementById('btn-action-spotify-auth'); },
    get spotifyAccountStatusText() { return document.getElementById('spotify-account-status-text'); },
    get spotifyAccountDetails() { return document.getElementById('spotify-account-details'); },

    get modalEditTrack() { return document.getElementById('modal-edit-track'); },
    get editTrackHash() { return document.getElementById('edit-track-hash'); },
    get editTrackTitle() { return document.getElementById('edit-track-title'); },
    get editTrackArtist() { return document.getElementById('edit-track-artist'); },
    get editTrackAlbum() { return document.getElementById('edit-track-album'); },
    get editTrackUrl() { return document.getElementById('edit-track-url'); },
    get btnConfirmEditTrack() { return document.getElementById('btn-confirm-modal-edit'); },
    get btnCancelEditTrack() { return document.getElementById('btn-cancel-modal-edit'); },
    get btnCloseModalEdit() { return document.getElementById('btn-close-modal-edit'); },
    get btnEditTrackRelink() { return document.getElementById('btn-edit-track-relink'); },

    get modalAddToPlaylist() { return document.getElementById('modal-add-to-playlist'); },
    get addToPlTrackHash() { return document.getElementById('add-to-pl-track-hash'); },
    get addToPlTrackName() { return document.getElementById('add-to-pl-track-name'); },
    get addToPlListOptions() { return document.getElementById('add-to-pl-list-options'); },
    get btnCancelAddToPl() { return document.getElementById('btn-cancel-modal-add-pl'); },
    get btnCloseModalAddPl() { return document.getElementById('btn-close-modal-add-pl'); },

    get modalRelinkTrack() { return document.getElementById('modal-relink-track'); },
    get relinkTrackName() { return document.getElementById('relink-track-name'); },
    get relinkTrackContent() { return document.getElementById('relink-track-content'); },
    get btnRelinkSkipNext() { return document.getElementById('btn-relink-skip-next'); },
    get btnCancelModalRelink() { return document.getElementById('btn-cancel-modal-relink'); },
    get btnCloseModalRelink() { return document.getElementById('btn-close-modal-relink'); },

    // JAM Colaborativa
    get btnWinJam() { return document.getElementById('btn-win-jam'); },
    get btnDeckJam() { return document.getElementById('deck-btn-jam'); },
    get btnPlJam() { return document.getElementById('btn-pl-jam'); },
    get btnQueueJam() { return document.getElementById('btn-queue-jam'); },
    get jamDeckIndicator() { return document.getElementById('jam-deck-indicator'); },
    get modalJamActive() { return document.getElementById('modal-jam-active'); },
    get btnCopyJamUrl() { return document.getElementById('btn-copy-jam-url'); },
    get btnStopActiveJam() { return document.getElementById('btn-stop-active-jam'); },
    get btnCloseModalJam() { return document.getElementById('btn-close-modal-jam'); },
    get btnCancelModalJam() { return document.getElementById('btn-cancel-modal-jam'); }
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
