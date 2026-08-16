/**
 * ==========================================================================
 * DOROCORO AUDIO STATION - CONTROLLER, PLAYLISTS & AUDIO ENGINE
 * TokiServer Cyber-Retro Audio Station
 * - Content-Addressable Track Hashing (Sparse SHA-256)
 * - Server SQLite Sync (server/.data/tokiserver.sqlite)
 * - Full Local IndexedDB Persistence (TokiDorocoroDB)
 * - Multi-Playlist Manager & Retro Tag Editor
 * ==========================================================================
 */

(function () {
    'use strict';

    // Elementos del DOM - Reproductor
    const audio = new Audio();
    audio.crossOrigin = "anonymous";

    const playBtn = document.getElementById('btn-play');
    const playIcon = document.getElementById('play-icon');
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    const shuffleBtn = document.getElementById('btn-shuffle');
    const repeatBtn = document.getElementById('btn-repeat');
    const repeatIcon = document.getElementById('repeat-icon');
    const progressBar = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');
    const currentTimeEl = document.getElementById('current-time');
    const durationTimeEl = document.getElementById('duration-time');
    const volumeSlider = document.getElementById('volume-slider');

    // Metadatos y Pantalla
    const trackTitleEl = document.getElementById('current-track-title');
    const trackArtistEl = document.getElementById('current-track-artist');
    const trackFormatEl = document.getElementById('track-format-badge');
    const trackRateEl = document.getElementById('track-rate-badge');
    const userDisplayTag = document.getElementById('user-display-tag');
    const folderDisplayTag = document.getElementById('folder-display-tag');
    const statusIndicator = document.getElementById('deck-status-indicator');
    const tracksCountBadge = document.getElementById('tracks-count-badge');
    const playlistCurrentTitle = document.getElementById('playlist-current-title');

    // Playlists y Carga de Archivos
    const playlistSelect = document.getElementById('playlist-select');
    const btnNewPlaylist = document.getElementById('btn-new-playlist');
    const btnDeletePlaylist = document.getElementById('btn-delete-playlist');
    const playlistContainer = document.getElementById('playlist-items');
    const searchInput = document.getElementById('playlist-search');
    const playlistDropzone = document.getElementById('playlist-dropzone');
    const btnOpenFolder = document.getElementById('btn-open-folder');
    const btnAddFiles = document.getElementById('btn-add-files');
    const btnClearPlaylist = document.getElementById('btn-clear-playlist');
    const folderInputHidden = document.getElementById('folder-input-hidden');
    const filesInputHidden = document.getElementById('files-input-hidden');
    const terminalLog = document.getElementById('terminal-log-output');

    // Modales Retro
    const modalNewPlaylist = document.getElementById('modal-new-playlist');
    const inputPlaylistName = document.getElementById('input-playlist-name');
    const btnCloseModalPl = document.getElementById('btn-close-modal-pl');
    const btnCancelModalPl = document.getElementById('btn-cancel-modal-pl');
    const btnConfirmModalPl = document.getElementById('btn-confirm-modal-pl');

    const modalEditTrack = document.getElementById('modal-edit-track');
    const editTrackHash = document.getElementById('edit-track-hash');
    const editTrackTitle = document.getElementById('edit-track-title');
    const editTrackArtist = document.getElementById('edit-track-artist');
    const editTrackAlbum = document.getElementById('edit-track-album');
    const btnCloseModalEdit = document.getElementById('btn-close-modal-edit');
    const btnCancelModalEdit = document.getElementById('btn-cancel-modal-edit');
    const btnConfirmModalEdit = document.getElementById('btn-confirm-modal-edit');

    const modalAddToPlaylist = document.getElementById('modal-add-to-playlist');
    const addToPlTrackHash = document.getElementById('add-to-pl-track-hash');
    const addToPlTrackName = document.getElementById('add-to-pl-track-name');
    const addToPlListOptions = document.getElementById('add-to-pl-list-options');
    const btnCloseModalAddPl = document.getElementById('btn-close-modal-add-pl');
    const btnCancelModalAddPl = document.getElementById('btn-cancel-modal-add-pl');

    // Visualizador Canvas
    const canvas = document.getElementById('visualizer-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    // Extensiones de Audio Soportadas
    const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.webm', '.wma'];

    // Autenticación y Token Dinámico
    function getCurrentUser() {
        return (localStorage.getItem('toki_admin_user') || 'ANONYMOUS').toLowerCase();
    }

    function getAuthToken() {
        return localStorage.getItem('toki_admin_token') || '';
    }

    function getBackendUrl() {
        const port = window.location.port;
        if (port && port !== '80' && port !== '443' && port !== '3000') {
            return `${window.location.protocol}//${window.location.hostname}:3000`;
        }
        return '';
    }

    // Estado del Reproductor y Biblioteca
    let allTracksMap = new Map(); // trackHash -> Track Object
    let userPlaylists = []; // [ { id, name, username, trackHashes: [] } ]
    let activePlaylistId = 'all'; // 'all' | 'favorites' | playlistId
    let currentQueue = []; // Pistas actualmente visibles y en reproducción
    let currentIndex = 0;
    let isPlaying = false;
    let isShuffle = false;
    let repeatMode = 'off'; // 'off' | 'all' | 'one'

    // Web Audio API
    let audioCtx = null;
    let analyser = null;
    let audioSource = null;
    let animationFrameId = null;

    // IndexedDB para almacenamiento local completo
    const DB_NAME = 'TokiDorocoroDB';
    const DB_VERSION = 3;
    const STORE_TRACKS = 'user_tracks';
    const STORE_PLAYLISTS = 'user_playlists';
    const STORE_STATE = 'user_state';

    // =========================================================================
    // MODULO DE HASHING CRIPTOGRÁFICO DE CONTENIDO (SPARSE SHA-256)
    // =========================================================================
    async function computeTrackHash(file) {
        if (!file) return 'trk_' + Math.random().toString(36).slice(2, 10);
        try {
            const size = file.size;
            const sliceSize = 64 * 1024; // 64 KB
            let buffer;

            if (size <= sliceSize * 3) {
                buffer = await file.arrayBuffer();
            } else {
                const firstChunk = await file.slice(0, sliceSize).arrayBuffer();
                const midPos = Math.floor(size / 2) - Math.floor(sliceSize / 2);
                const midChunk = await file.slice(midPos, midPos + sliceSize).arrayBuffer();
                const lastChunk = await file.slice(size - sliceSize, size).arrayBuffer();

                const combined = new Uint8Array(sliceSize * 3 + 8);
                combined.set(new Uint8Array(firstChunk), 0);
                combined.set(new Uint8Array(midChunk), sliceSize);
                combined.set(new Uint8Array(lastChunk), sliceSize * 2);

                const view = new DataView(combined.buffer);
                view.setFloat64(sliceSize * 3, size);
                buffer = combined.buffer;
            }

            const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuf));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return 'trk_' + hashHex.slice(0, 16);
        } catch (err) {
            console.warn('[DOROCORO HASH] Fallback hash:', err);
            const str = file.name + '_' + file.size;
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return 'trk_' + Math.abs(hash).toString(16);
        }
    }

    // =========================================================================
    // MODULO DE BASE DE DATOS LOCAL INDEXEDDB
    // =========================================================================
    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error('IndexedDB no disponible'));
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_TRACKS)) {
                    db.createObjectStore(STORE_TRACKS, { keyPath: 'trackHash' });
                }
                if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
                    db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_STATE)) {
                    db.createObjectStore(STORE_STATE, { keyPath: 'username' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function saveTrackToIDB(trackObj) {
        try {
            const db = await openDatabase();
            const tx = db.transaction(STORE_TRACKS, 'readwrite');
            const store = tx.objectStore(STORE_TRACKS);
            store.put({
                trackHash: trackObj.trackHash,
                username: getCurrentUser(),
                title: trackObj.title,
                artist: trackObj.artist,
                album: trackObj.album,
                duration: trackObj.duration || '--:--',
                format: trackObj.format,
                file: trackObj.file,
                isFavorite: !!trackObj.isFavorite,
                savedAt: Date.now()
            });
        } catch (err) {
            console.warn('[IDB] Error guardando track:', err);
        }
    }

    async function loadAllTracksFromIDB() {
        try {
            const db = await openDatabase();
            const tx = db.transaction(STORE_TRACKS, 'readonly');
            const store = tx.objectStore(STORE_TRACKS);
            const req = store.getAll();
            return new Promise((resolve) => {
                req.onsuccess = () => {
                    const u = getCurrentUser();
                    const list = (req.result || []).filter(t => !t.username || t.username === u);
                    resolve(list);
                };
                req.onerror = () => resolve([]);
            });
        } catch (err) {
            return [];
        }
    }

    async function saveStateToIDB(folderName, activePl, lastIdx) {
        try {
            const db = await openDatabase();
            const tx = db.transaction(STORE_STATE, 'readwrite');
            tx.objectStore(STORE_STATE).put({
                username: getCurrentUser(),
                folderName: folderName || 'BIBLIOTECA_LOCAL',
                activePlaylistId: activePl || 'all',
                currentIndex: lastIdx || 0,
                updatedAt: Date.now()
            });
        } catch (e) {}
    }

    async function loadStateFromIDB() {
        try {
            const db = await openDatabase();
            const tx = db.transaction(STORE_STATE, 'readonly');
            const req = tx.objectStore(STORE_STATE).get(getCurrentUser());
            return new Promise((resolve) => {
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    }

    async function clearAllLocalDataFromIDB() {
        try {
            const db = await openDatabase();
            const tx = db.transaction([STORE_TRACKS, STORE_PLAYLISTS, STORE_STATE], 'readwrite');
            tx.objectStore(STORE_TRACKS).clear();
            tx.objectStore(STORE_PLAYLISTS).clear();
            tx.objectStore(STORE_STATE).clear();
        } catch (e) {}
    }

    // =========================================================================
    // CLIENTE API BACKEND (SQLite server/.data/tokiserver.sqlite)
    // =========================================================================
    async function apiFetch(endpoint, options = {}) {
        const token = getAuthToken();
        const base = getBackendUrl();
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(options.headers || {})
        };

        const res = await fetch(`${base}/api/dorocoro${endpoint}`, {
            ...options,
            headers
        });

        if (res.status === 401) {
            appendLog('SESIÓN EXPIRADA. Redirigiendo a inicio de sesión...', true);
            setTimeout(() => { window.location.href = '/login?redirect=/dorocoro'; }, 1500);
            throw new Error('No autorizado');
        }

        return res.json();
    }

    async function syncLibraryWithServer() {
        try {
            // 1. Obtener datos guardados en SQLite
            const data = await apiFetch('/library');
            if (data.success) {
                // Sincronizar listas
                userPlaylists = (data.playlists || []).map(pl => ({
                    ...pl,
                    trackHashes: []
                }));

                // Mapear tracks en listas
                if (Array.isArray(data.playlistTracks)) {
                    data.playlistTracks.forEach(pt => {
                        const pl = userPlaylists.find(p => p.id === pt.playlistId);
                        if (pl && !pl.trackHashes.includes(pt.trackHash)) {
                            pl.trackHashes.push(pt.trackHash);
                        }
                    });
                }

                // Sincronizar metadatos de pistas guardadas en el servidor
                if (Array.isArray(data.tracks)) {
                    data.tracks.forEach(sTrack => {
                        const local = allTracksMap.get(sTrack.trackHash);
                        if (local) {
                            local.title = sTrack.title || local.title;
                            local.artist = sTrack.artist || local.artist;
                            local.album = sTrack.album || local.album;
                            local.isFavorite = (sTrack.isFavorite === 1);
                        }
                    });
                }

                renderPlaylistSelectOptions();
                updateCurrentQueue();
                appendLog(`SINCRONIZADO CON SQLITE: ${data.tracks?.length || 0} pistas, ${userPlaylists.length} listas.`);
            }

            // 2. Si tenemos pistas locales que aún no están en el servidor, sincronizarlas
            if (allTracksMap.size > 0) {
                const tracksToSend = Array.from(allTracksMap.values()).map(t => ({
                    trackHash: t.trackHash,
                    title: t.title,
                    artist: t.artist,
                    album: t.album,
                    duration: t.duration,
                    format: t.format,
                    sourceType: 'local'
                }));

                apiFetch('/tracks/sync', {
                    method: 'POST',
                    body: JSON.stringify({ tracks: tracksToSend })
                }).catch(() => {});
            }
        } catch (err) {
            console.warn('[DOROCORO SYNC] Nota: trabajando en modo local o fuera de línea:', err);
        }
    }

    // =========================================================================
    // UTILIDADES & REPRODUCTOR
    // =========================================================================
    function appendLog(msg, isAlert = false) {
        if (!terminalLog) return;
        const entry = document.createElement('div');
        entry.className = `log-entry${isAlert ? ' alert' : ''}`;
        const time = new Date().toLocaleTimeString();
        entry.textContent = `[${time}] > ${msg}`;
        terminalLog.appendChild(entry);
        terminalLog.scrollTop = terminalLog.scrollHeight;
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return "00:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function isAudioFile(file) {
        if (!file || !file.name) return false;
        const name = file.name.toLowerCase();
        return AUDIO_EXTENSIONS.some(ext => name.endsWith(ext));
    }

    function getFileExtension(filename) {
        const match = filename.match(/\.([0-9a-z]+)(?:[\?#]|$)/i);
        return match ? match[1].toUpperCase() : 'AUDIO';
    }

    function parseAudioFilename(filename) {
        const base = filename.replace(/\.[^/.]+$/, "");
        if (base.includes(" - ")) {
            const parts = base.split(" - ");
            const artist = parts[0].trim();
            const title = parts.slice(1).join(" - ").trim();
            return { artist, title };
        }
        const cleaned = base.replace(/^\d+[\s._-]+/, "").trim();
        return { artist: getCurrentUser().toUpperCase(), title: cleaned || base };
    }

    // =========================================================================
    // MOTOR DE AUDIO Y VISUALIZADOR MINIMALISTA (16 BARRAS LIMPIAS)
    // =========================================================================
    function ensureAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.85;
                try {
                    audioSource = audioCtx.createMediaElementSource(audio);
                    audioSource.connect(analyser);
                    analyser.connect(audioCtx.destination);
                } catch (err) {
                    console.warn('[DOROCORO AUDIO] MediaElementSource conectado:', err);
                }
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function initVisualizer() {
        if (!canvas || !ctx) return;

        const NUM_BARS = 16;
        const smoothedBars = new Float32Array(NUM_BARS);

        function resizeCanvas() {
            if (!canvas || !canvas.parentElement) return;
            const rect = canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.max(10, Math.round(rect.width * dpr));
            canvas.height = Math.max(10, Math.round(rect.height * dpr));
        }

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
            new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
        }

        const totalBins = 256;
        const dataArray = new Uint8Array(totalBins);
        const minHz = 28;
        const maxHz = 15000;

        function hzToBin(hz, sampleRate) {
            const nyquist = sampleRate / 2;
            const bin = Math.round((hz / nyquist) * totalBins);
            return Math.min(totalBins - 1, Math.max(0, bin));
        }

        function renderFrame() {
            animationFrameId = requestAnimationFrame(renderFrame);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const totalWidth = canvas.width;
            const totalHeight = canvas.height;
            const dpr = window.devicePixelRatio || 1;
            const barGap = Math.max(2, Math.round(3 * dpr));
            const availableWidth = totalWidth - ((NUM_BARS - 1) * barGap);
            const barWidth = availableWidth / NUM_BARS;

            const sampleRate = audioCtx ? audioCtx.sampleRate : 44100;

            if (isPlaying && analyser) {
                analyser.getByteFrequencyData(dataArray);

                for (let i = 0; i < NUM_BARS; i++) {
                    const fLow = minHz * Math.pow(maxHz / minHz, i / NUM_BARS);
                    const fHigh = minHz * Math.pow(maxHz / minHz, (i + 1) / NUM_BARS);
                    const binStart = hzToBin(fLow, sampleRate);
                    const binEnd = Math.max(binStart + 1, hzToBin(fHigh, sampleRate));

                    let sum = 0;
                    let count = 0;
                    for (let b = binStart; b < binEnd; b++) {
                        sum += dataArray[b];
                        count++;
                    }
                    const rawEnergy = count > 0 ? (sum / count) : (dataArray[binStart] || 0);

                    const normalizedEnergy = rawEnergy / 255;
                    const currentVol = (typeof audio.volume === 'number') ? audio.volume : 0.8;
                    const volumeFactor = Math.max(0.3, Math.pow(currentVol, 0.45));
                    const eqCurve = 0.70 + (i / NUM_BARS) * 0.30;

                    const targetLevel = Math.min(0.75, Math.pow(normalizedEnergy, 1.4) * eqCurve * 0.75 * volumeFactor);

                    const delta = targetLevel - smoothedBars[i];
                    if (delta > 0) {
                        smoothedBars[i] += delta * 0.28;
                    } else {
                        smoothedBars[i] += delta * 0.12;
                    }

                    if (smoothedBars[i] < 0.005) {
                        smoothedBars[i] = 0;
                    }

                    const x = Math.round(i * (barWidth + barGap));
                    const nextX = Math.round((i + 1) * (barWidth + barGap) - barGap);
                    const w = Math.max(1, (i === NUM_BARS - 1 ? (totalWidth - x) : (nextX - x)));

                    const level = smoothedBars[i];
                    const barHeight = Math.max(2, Math.floor(level * (totalHeight - 6)));
                    const y = totalHeight - barHeight;

                    ctx.fillStyle = '#00ff41';
                    ctx.shadowBlur = 0;
                    ctx.fillRect(x, y, w, barHeight);
                }
            } else {
                const time = Date.now() / 450;
                for (let i = 0; i < NUM_BARS; i++) {
                    const x = Math.round(i * (barWidth + barGap));
                    const nextX = Math.round((i + 1) * (barWidth + barGap) - barGap);
                    const w = Math.max(1, (i === NUM_BARS - 1 ? (totalWidth - x) : (nextX - x)));

                    const wave = Math.sin(time + (i / NUM_BARS) * Math.PI * 2) * 0.5 + 0.5;
                    const barHeight = Math.max(2, Math.floor(wave * (totalHeight * 0.22) + 2));
                    const y = totalHeight - barHeight;

                    ctx.fillStyle = 'rgba(0, 255, 65, 0.35)';
                    ctx.shadowBlur = 0;
                    ctx.fillRect(x, y, w, barHeight);
                }
            }
        }

        renderFrame();
    }

    // =========================================================================
    // GESTIÓN DE COLAS Y LISTAS DE REPRODUCCIÓN
    // =========================================================================
    function updateCurrentQueue() {
        if (activePlaylistId === 'all') {
            currentQueue = Array.from(allTracksMap.values());
            if (playlistCurrentTitle) playlistCurrentTitle.textContent = "BIBLIOTECA GENERAL";
            if (btnDeletePlaylist) btnDeletePlaylist.style.display = "none";
        } else if (activePlaylistId === 'favorites') {
            currentQueue = Array.from(allTracksMap.values()).filter(t => t.isFavorite);
            if (playlistCurrentTitle) playlistCurrentTitle.textContent = "FAVORITAS";
            if (btnDeletePlaylist) btnDeletePlaylist.style.display = "none";
        } else {
            const pl = userPlaylists.find(p => p.id === activePlaylistId);
            if (pl) {
                currentQueue = (pl.trackHashes || [])
                    .map(hash => allTracksMap.get(hash))
                    .filter(Boolean);
                if (playlistCurrentTitle) playlistCurrentTitle.textContent = `LISTA: ${pl.name.toUpperCase()}`;
                if (btnDeletePlaylist) btnDeletePlaylist.style.display = "inline-flex";
            } else {
                activePlaylistId = 'all';
                updateCurrentQueue();
                return;
            }
        }

        renderPlaylist(searchInput ? searchInput.value : '');

        if (currentQueue.length > 0) {
            if (currentIndex >= currentQueue.length) currentIndex = 0;
            loadTrack(currentIndex, false);
        } else {
            loadTrack(0, false);
        }

        saveStateToIDB(folderDisplayTag ? folderDisplayTag.textContent : '', activePlaylistId, currentIndex);
    }

    function renderPlaylistSelectOptions() {
        if (!playlistSelect) return;
        const currentVal = activePlaylistId;
        playlistSelect.innerHTML = `
            <option value="all">[BIBLIOTECA GENERAL] (${allTracksMap.size})</option>
            <option value="favorites">[FAVORITAS] (${Array.from(allTracksMap.values()).filter(t => t.isFavorite).length})</option>
        `;

        userPlaylists.forEach(pl => {
            const count = (pl.trackHashes || []).length;
            const opt = document.createElement('option');
            opt.value = pl.id;
            opt.textContent = `[LISTA] ${pl.name} (${count})`;
            playlistSelect.appendChild(opt);
        });

        playlistSelect.value = currentVal;
    }

    function loadTrack(index, autoPlay = false) {
        if (currentQueue.length === 0) {
            trackTitleEl.textContent = "SIN PISTAS DISPONIBLES";
            trackArtistEl.textContent = "ABRE UNA CARPETA O CREA UNA PLAYLIST";
            trackFormatEl.textContent = "VACÍO";
            trackRateEl.textContent = "--";
            progressFill.style.width = '0%';
            currentTimeEl.textContent = '00:00';
            durationTimeEl.textContent = '00:00';
            if (statusIndicator) statusIndicator.textContent = "STANDBY";
            return;
        }

        if (index < 0) index = 0;
        if (index >= currentQueue.length) index = currentQueue.length - 1;
        currentIndex = index;
        const track = currentQueue[currentIndex];

        trackTitleEl.textContent = track.title;
        trackArtistEl.textContent = track.artist;
        trackFormatEl.textContent = track.format || "AUDIO";
        trackRateEl.textContent = track.rate || (track.isLocal ? "LOCAL STEREO" : "44.1 kHz");

        if (track.src) {
            audio.src = track.src;
            audio.load();
            if (autoPlay && isPlaying) {
                playTrack();
            }
        } else if (track.file) {
            track.src = URL.createObjectURL(track.file);
            audio.src = track.src;
            audio.load();
            if (autoPlay && isPlaying) {
                playTrack();
            }
        } else {
            audio.removeAttribute('src');
        }

        audio.loop = (repeatMode === 'one');
        progressFill.style.width = '0%';
        currentTimeEl.textContent = '00:00';
        durationTimeEl.textContent = track.duration || '--:--';

        renderPlaylist(searchInput ? searchInput.value : '');
        appendLog(`PISTA SELECCIONADA: [${track.artist}] - ${track.title} [${track.format}]`);

        saveStateToIDB(folderDisplayTag ? folderDisplayTag.textContent : '', activePlaylistId, currentIndex);
    }

    function togglePlay() {
        if (currentQueue.length === 0) {
            appendLog('ADVERTENCIA: No hay canciones en la lista activa. Abre una carpeta local.', true);
            return;
        }
        ensureAudioContext();
        if (isPlaying) {
            pauseTrack();
        } else {
            playTrack();
        }
    }

    function playTrack() {
        if (currentQueue.length === 0) return;
        ensureAudioContext();
        isPlaying = true;
        playBtn.classList.add('active');
        playIcon.style.webkitMaskImage = "url('/img/icons/pause.svg')";
        playIcon.style.maskImage = "url('/img/icons/pause.svg')";
        if (statusIndicator) statusIndicator.textContent = "PLAYING";

        const track = currentQueue[currentIndex];
        if (audio.src) {
            audio.play().catch(e => {
                appendLog(`REPRODUCCIÓN: ${e.message}`);
            });
        }
        appendLog(`REPRODUCIENDO: ${track?.artist} - ${track?.title}`);
        renderPlaylist(searchInput ? searchInput.value : '');
    }

    function pauseTrack() {
        isPlaying = false;
        playBtn.classList.remove('active');
        playIcon.style.webkitMaskImage = "url('/img/icons/play.svg')";
        playIcon.style.maskImage = "url('/img/icons/play.svg')";
        if (statusIndicator) statusIndicator.textContent = "PAUSED";
        if (audio.src) {
            audio.pause();
        }
        appendLog(`PAUSA: ${currentQueue[currentIndex]?.title}`);
        renderPlaylist(searchInput ? searchInput.value : '');
    }

    function nextTrack(autoEnded = false) {
        if (currentQueue.length === 0) return;

        if (repeatMode === 'one' && autoEnded) {
            audio.currentTime = 0;
            playTrack();
            return;
        }

        if (isShuffle) {
            let nextIdx;
            do {
                nextIdx = Math.floor(Math.random() * currentQueue.length);
            } while (nextIdx === currentIndex && currentQueue.length > 1);
            loadTrack(nextIdx, true);
        } else {
            const isLastTrack = currentIndex === currentQueue.length - 1;
            if (isLastTrack && repeatMode === 'off' && autoEnded) {
                pauseTrack();
                audio.currentTime = 0;
                progressFill.style.width = '0%';
                currentTimeEl.textContent = '00:00';
                appendLog('FIN DE LA LISTA ALCANZADO');
                return;
            }
            const nextIdx = (currentIndex + 1) % currentQueue.length;
            loadTrack(nextIdx, true);
        }
    }

    function prevTrack() {
        if (currentQueue.length === 0) return;
        const prevIdx = (currentIndex - 1 + currentQueue.length) % currentQueue.length;
        loadTrack(prevIdx, true);
    }

    function updateRepeatUI() {
        if (!repeatBtn) return;
        repeatBtn.classList.remove('active', 'active-one');

        if (repeatMode === 'off') {
            repeatBtn.title = "Repetir: Desactivado";
            if (repeatIcon) {
                repeatIcon.style.webkitMaskImage = "url('/img/icons/repeat.svg')";
                repeatIcon.style.maskImage = "url('/img/icons/repeat.svg')";
            }
            audio.loop = false;
            appendLog("MODO REPETICIÓN: DESACTIVADO");
        } else if (repeatMode === 'all') {
            repeatBtn.classList.add('active');
            repeatBtn.title = "Repetir: Toda la Playlist";
            if (repeatIcon) {
                repeatIcon.style.webkitMaskImage = "url('/img/icons/repeat.svg')";
                repeatIcon.style.maskImage = "url('/img/icons/repeat.svg')";
            }
            audio.loop = false;
            appendLog("MODO REPETICIÓN: TODA LA PLAYLIST (LOOP)");
        } else if (repeatMode === 'one') {
            repeatBtn.classList.add('active-one');
            repeatBtn.title = "Repetir: Pista Actual (1)";
            if (repeatIcon) {
                repeatIcon.style.webkitMaskImage = "url('/img/icons/repeat-1.svg')";
                repeatIcon.style.maskImage = "url('/img/icons/repeat-1.svg')";
            }
            audio.loop = true;
            appendLog("MODO REPETICIÓN: PISTA ACTUAL (LOOP 1)");
        }
    }

    function renderPlaylist(filter = '') {
        if (!playlistContainer) return;
        playlistContainer.innerHTML = '';

        if (tracksCountBadge) {
            tracksCountBadge.textContent = `${currentQueue.length} PISTA${currentQueue.length === 1 ? '' : 'S'}`;
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
            emptyLi.textContent = filter ? '-- NO SE ENCONTRARON COINCIDENCIAS --' : '-- LISTA VACÍA. ABRE UNA CARPETA O AÑADE PISTAS --';
            playlistContainer.appendChild(emptyLi);
            return;
        }

        filtered.forEach((track) => {
            const actualIdx = currentQueue.indexOf(track);
            const li = document.createElement('li');
            li.className = `track-item ${actualIdx === currentIndex ? 'active' : ''}`;
            const isPlayingThis = actualIdx === currentIndex && isPlaying;

            li.innerHTML = `
                <div class="track-item-info">
                    <span class="track-num">${isPlayingThis ? '>' : (actualIdx + 1).toString().padStart(2, '0')}</span>
                    <span class="track-format-tag">${track.format}</span>
                    <span class="track-name-text" title="${track.artist} - ${track.title}">${track.artist} - ${track.title}</span>
                </div>
                <div class="track-actions-group">
                    <button type="button" class="btn-track-action fav ${track.isFavorite ? 'active' : ''}" title="${track.isFavorite ? 'Quitar de Favoritas' : 'Marcar como Favorita'}" data-action="fav" data-hash="${track.trackHash}">
                        <span class="pixel-icon-mask" style="-webkit-mask-image: url('${track.isFavorite ? '/img/icons/star-filled.svg' : '/img/icons/star.svg'}'); mask-image: url('${track.isFavorite ? '/img/icons/star-filled.svg' : '/img/icons/star.svg'}'); width: 14px; height: 14px;"></span>
                    </button>
                    <button type="button" class="btn-track-action" title="Agregar a Playlist..." data-action="add-to-pl" data-hash="${track.trackHash}">
                        <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/plus.svg'); mask-image: url('/img/icons/plus.svg'); width: 14px; height: 14px;"></span>
                    </button>
                    <button type="button" class="btn-track-action" title="Editar Título / Artista" data-action="edit" data-hash="${track.trackHash}">
                        <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/edit.svg'); mask-image: url('/img/icons/edit.svg'); width: 13px; height: 13px;"></span>
                    </button>
                    ${activePlaylistId !== 'all' && activePlaylistId !== 'favorites' ? `
                    <button type="button" class="btn-track-action danger" title="Quitar de esta Playlist" data-action="remove-from-pl" data-hash="${track.trackHash}">
                        <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/x.svg'); mask-image: url('/img/icons/x.svg'); width: 12px; height: 12px;"></span>
                    </button>` : ''}
                    <span class="track-item-duration">${track.duration || '--:--'}</span>
                </div>
            `;

            li.addEventListener('click', (e) => {
                if (e.target.closest('.btn-track-action')) return;
                loadTrack(actualIdx, true);
            });

            playlistContainer.appendChild(li);
        });

        // Vincular acciones de botones
        playlistContainer.querySelectorAll('.btn-track-action').forEach(btn => {
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
                        renderPlaylist(searchInput ? searchInput.value : '');
                    }
                } else if (action === 'add-to-pl') {
                    openAddToPlaylistModal(track);
                } else if (action === 'edit') {
                    openEditTrackModal(track);
                } else if (action === 'remove-from-pl') {
                    removeTrackFromCurrentPlaylist(hash);
                }
            });
        });
    }

    // =========================================================================
    // EXTRACCIÓN ASÍNCRONA DE DURACIONES EN SEGUNDO PLANO
    // =========================================================================
    function extractAudioDuration(file) {
        return new Promise((resolve) => {
            if (!file) return resolve('--:--');
            const tempAudio = new Audio();
            tempAudio.preload = 'metadata';
            const tempUrl = URL.createObjectURL(file);
            tempAudio.src = tempUrl;

            let isResolved = false;
            const cleanup = () => {
                if (!isResolved) {
                    isResolved = true;
                    URL.revokeObjectURL(tempUrl);
                    tempAudio.removeAttribute('src');
                }
            };

            tempAudio.onloadedmetadata = () => {
                const formatted = formatTime(tempAudio.duration);
                cleanup();
                resolve(formatted);
            };

            tempAudio.onerror = () => {
                cleanup();
                resolve('--:--');
            };

            setTimeout(() => {
                cleanup();
                resolve('--:--');
            }, 3500);
        });
    }

    function updateTrackDurationInList(trackHash, durationStr) {
        const track = allTracksMap.get(trackHash);
        if (track) {
            track.duration = durationStr;
            saveTrackToIDB(track);
        }
        if (currentQueue[currentIndex]?.trackHash === trackHash && durationTimeEl) {
            durationTimeEl.textContent = durationStr;
        }
        const btn = playlistContainer?.querySelector(`button[data-hash="${trackHash}"]`);
        if (btn) {
            const row = btn.closest('.track-item');
            if (row) {
                const durEl = row.querySelector('.track-item-duration');
                if (durEl) durEl.textContent = durationStr;
            }
        }
    }

    async function resolveTracksDurations(tracks) {
        const queue = tracks.filter(t => (!t.duration || t.duration === '--:--') && t.file);
        if (queue.length === 0) return;

        const BATCH_SIZE = 4;
        for (let i = 0; i < queue.length; i += BATCH_SIZE) {
            const batch = queue.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (track) => {
                const dur = await extractAudioDuration(track.file);
                if (dur && dur !== '--:--') {
                    updateTrackDurationInList(track.trackHash, dur);
                }
            }));
        }

        // Sincronizar duraciones actualizadas con SQLite
        const updated = tracks.filter(t => t.duration && t.duration !== '--:--').map(t => ({
            trackHash: t.trackHash,
            title: t.title,
            artist: t.artist,
            album: t.album,
            duration: t.duration,
            format: t.format,
            sourceType: 'local'
        }));

        if (updated.length > 0) {
            apiFetch('/tracks/sync', {
                method: 'POST',
                body: JSON.stringify({ tracks: updated })
            }).catch(() => {});
        }
    }

    // =========================================================================
    // PROCESAMIENTO DE ARCHIVOS LOCALES & CARGA DE CARPETAS
    // =========================================================================
    async function handleAudioFiles(files, folderName = '', replace = false) {
        const audioFiles = Array.from(files).filter(isAudioFile);

        if (audioFiles.length === 0) {
            appendLog(`ADVERTENCIA: No se detectaron archivos de audio válidos.`, true);
            return;
        }

        appendLog(`PROCESANDO HASHES Y METADATOS DE ${audioFiles.length} ARCHIVOS...`);

        audioFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        const actualFolderName = folderName || (audioFiles[0].webkitRelativePath ? audioFiles[0].webkitRelativePath.split('/')[0] : 'Carpeta Local');

        const newTracksToSync = [];
        const processedTracks = [];

        for (const file of audioFiles) {
            const trackHash = await computeTrackHash(file);
            const meta = parseAudioFilename(file.name);
            const ext = getFileExtension(file.name);

            const trackObj = {
                trackHash,
                title: meta.title,
                artist: meta.artist,
                album: actualFolderName,
                duration: "--:--",
                file: file,
                src: URL.createObjectURL(file),
                format: ext,
                rate: "LOCAL " + ext,
                isFavorite: false,
                isLocal: true
            };

            // Preservar si ya existía en memoria
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

            // Guardar en IndexedDB
            await saveTrackToIDB(trackObj);

            newTracksToSync.push({
                trackHash,
                title: trackObj.title,
                artist: trackObj.artist,
                album: actualFolderName,
                duration: trackObj.duration,
                format: ext,
                sourceType: 'local'
            });
        }

        if (folderDisplayTag) {
            folderDisplayTag.textContent = actualFolderName;
        }

        // Sincronizar metadatos iniciales al backend SQLite
        apiFetch('/tracks/sync', {
            method: 'POST',
            body: JSON.stringify({ tracks: newTracksToSync })
        }).then((res) => {
            if (res && res.success) {
                appendLog(`SINCRONIZADO CON SQLITE: ${newTracksToSync.length} pistas guardadas en el servidor.`);
            }
        }).catch(err => {
            console.warn('[DOROCORO API SYNC ERROR]', err);
        });

        renderPlaylistSelectOptions();
        updateCurrentQueue();

        if (currentQueue.length > 0 && !isPlaying) {
            loadTrack(0, false);
        }

        // Extraer duraciones en segundo plano en lotes
        resolveTracksDurations(processedTracks);
    }

    // =========================================================================
    // MODALES Y ACCIONES DE PLAYLIST
    // =========================================================================
    function openNewPlaylistModal() {
        if (!modalNewPlaylist) return;
        if (inputPlaylistName) inputPlaylistName.value = '';
        modalNewPlaylist.style.display = 'flex';
        if (inputPlaylistName) inputPlaylistName.focus();
    }

    function closeNewPlaylistModal() {
        if (modalNewPlaylist) modalNewPlaylist.style.display = 'none';
    }

    async function handleCreatePlaylistConfirm() {
        const name = inputPlaylistName ? inputPlaylistName.value.trim() : '';
        if (!name) {
            appendLog('ERROR: El nombre de la lista no puede estar vacío.', true);
            return;
        }

        try {
            const data = await apiFetch('/playlists', {
                method: 'POST',
                body: JSON.stringify({ name })
            });

            if (data.success && data.playlist) {
                userPlaylists.push({
                    id: data.playlist.id,
                    name: data.playlist.name,
                    trackHashes: []
                });
                renderPlaylistSelectOptions();
                activePlaylistId = data.playlist.id;
                playlistSelect.value = activePlaylistId;
                updateCurrentQueue();
                closeNewPlaylistModal();
                appendLog(`LISTA CREADA: [${data.playlist.name}]`);
            }
        } catch (err) {
            appendLog('ERROR al crear la lista de reproducción.', true);
        }
    }

    async function handleDeleteCurrentPlaylist() {
        if (activePlaylistId === 'all' || activePlaylistId === 'favorites') return;
        const pl = userPlaylists.find(p => p.id === activePlaylistId);
        if (!pl) return;

        if (!confirm(`¿Estás seguro de eliminar la lista "${pl.name}"? (Las canciones no se borrarán de tu biblioteca general)`)) {
            return;
        }

        try {
            const data = await apiFetch(`/playlists/${activePlaylistId}`, { method: 'DELETE' });
            if (data.success) {
                userPlaylists = userPlaylists.filter(p => p.id !== activePlaylistId);
                activePlaylistId = 'all';
                renderPlaylistSelectOptions();
                playlistSelect.value = 'all';
                updateCurrentQueue();
                appendLog(`LISTA ELIMINADA: [${pl.name}]`);
            }
        } catch (err) {
            appendLog('ERROR al eliminar lista.', true);
        }
    }

    function openEditTrackModal(track) {
        if (!modalEditTrack) return;
        editTrackHash.value = track.trackHash;
        editTrackTitle.value = track.title;
        editTrackArtist.value = track.artist;
        editTrackAlbum.value = track.album || '';
        modalEditTrack.style.display = 'flex';
        editTrackTitle.focus();
    }

    function closeEditTrackModal() {
        if (modalEditTrack) modalEditTrack.style.display = 'none';
    }

    async function handleEditTrackConfirm() {
        const hash = editTrackHash.value;
        const title = editTrackTitle.value.trim();
        const artist = editTrackArtist.value.trim();
        const album = editTrackAlbum.value.trim();

        if (!title) {
            appendLog('ERROR: El título no puede estar vacío.', true);
            return;
        }

        const track = allTracksMap.get(hash);
        if (track) {
            track.title = title;
            track.artist = artist || getCurrentUser().toUpperCase();
            track.album = album;

            saveTrackToIDB(track);

            if (currentQueue[currentIndex]?.trackHash === hash) {
                trackTitleEl.textContent = track.title;
                trackArtistEl.textContent = track.artist;
            }

            renderPlaylist(searchInput ? searchInput.value : '');

            // Actualizar en el backend SQLite
            apiFetch(`/tracks/${hash}`, {
                method: 'PUT',
                body: JSON.stringify({ title, artist, album })
            }).then(() => {
                appendLog(`ETIQUETAS ACTUALIZADAS: "${track.artist} - ${track.title}"`);
            }).catch(err => {
                console.warn('[DOROCORO EDIT ERROR]', err);
            });
        }

        closeEditTrackModal();
    }

    function openAddToPlaylistModal(track) {
        if (!modalAddToPlaylist) return;
        addToPlTrackHash.value = track.trackHash;
        addToPlTrackName.textContent = `${track.artist} - ${track.title}`;
        addToPlListOptions.innerHTML = '';

        if (userPlaylists.length === 0) {
            addToPlListOptions.innerHTML = `
                <div style="padding: 10px; text-align: center; opacity: 0.6; font-size: 0.95rem;">
                    No tienes listas personalizadas aún. ¡Crea una con [+ LISTA]!
                </div>
            `;
        } else {
            userPlaylists.forEach(pl => {
                const isInList = (pl.trackHashes || []).includes(track.trackHash);
                const item = document.createElement('div');
                item.className = `pl-option-item ${isInList ? 'in-playlist' : ''}`;
                item.innerHTML = `
                    <span>[LISTA] ${pl.name}</span>
                    <span>${isInList ? '[EN LISTA]' : '[+ AGREGAR]'}</span>
                `;
                item.addEventListener('click', async () => {
                    if (isInList) {
                        await apiFetch(`/playlists/${pl.id}/tracks/${track.trackHash}`, { method: 'DELETE' });
                        pl.trackHashes = pl.trackHashes.filter(h => h !== track.trackHash);
                        appendLog(`REMOVIDA DE LISTA [${pl.name}]: ${track.title}`);
                    } else {
                        await apiFetch(`/playlists/${pl.id}/tracks`, {
                            method: 'POST',
                            body: JSON.stringify({ trackHash: track.trackHash })
                        });
                        pl.trackHashes.push(track.trackHash);
                        appendLog(`AGREGADA A LISTA [${pl.name}]: ${track.title}`);
                    }
                    renderPlaylistSelectOptions();
                    closeAddToPlaylistModal();
                    if (activePlaylistId === pl.id) {
                        updateCurrentQueue();
                    }
                });
                addToPlListOptions.appendChild(item);
            });
        }

        modalAddToPlaylist.style.display = 'flex';
    }

    function closeAddToPlaylistModal() {
        if (modalAddToPlaylist) modalAddToPlaylist.style.display = 'none';
    }

    async function removeTrackFromCurrentPlaylist(trackHash) {
        if (activePlaylistId === 'all' || activePlaylistId === 'favorites') return;
        const pl = userPlaylists.find(p => p.id === activePlaylistId);
        if (!pl) return;

        try {
            await apiFetch(`/playlists/${activePlaylistId}/tracks/${trackHash}`, { method: 'DELETE' });
            pl.trackHashes = pl.trackHashes.filter(h => h !== trackHash);
            const track = allTracksMap.get(trackHash);
            appendLog(`PISTA REMOVIDA DE [${pl.name}]: ${track?.title || trackHash}`);
            renderPlaylistSelectOptions();
            updateCurrentQueue();
        } catch (err) {
            appendLog('ERROR al remover pista de la lista.', true);
        }
    }

    // =========================================================================
    // DRAG AND DROP & EVENT LISTENERS
    // =========================================================================
    function setupDragAndDrop() {
        if (!playlistDropzone) return;

        ['dragenter', 'dragover'].forEach(eventName => {
            playlistDropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                playlistDropzone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            playlistDropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                playlistDropzone.classList.remove('drag-over');
            });
        });

        playlistDropzone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                appendLog(`PROCESANDO ELEMENTOS ARRASTRADOS (${dt.files.length} ARCHIVOS)...`);
                handleAudioFiles(dt.files, 'DRAG_AND_DROP', false);
            }
        });
    }

    function setupEventListeners() {
        if (playBtn) playBtn.addEventListener('click', togglePlay);
        if (nextBtn) nextBtn.addEventListener('click', () => nextTrack(false));
        if (prevBtn) prevBtn.addEventListener('click', prevTrack);

        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', () => {
                isShuffle = !isShuffle;
                shuffleBtn.classList.toggle('active', isShuffle);
                appendLog(`MODO ALEATORIO: ${isShuffle ? 'ACTIVADO' : 'DESACTIVADO'}`);
            });
        }

        if (repeatBtn) {
            repeatBtn.addEventListener('click', () => {
                if (repeatMode === 'off') repeatMode = 'all';
                else if (repeatMode === 'all') repeatMode = 'one';
                else repeatMode = 'off';
                updateRepeatUI();
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                audio.volume = e.target.value / 100;
            });
        }

        if (progressBar) {
            progressBar.addEventListener('click', (e) => {
                const rect = progressBar.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const ratio = clickX / rect.width;
                if (audio.duration) {
                    audio.currentTime = ratio * audio.duration;
                }
                progressFill.style.width = `${ratio * 100}%`;
            });
        }

        audio.addEventListener('timeupdate', () => {
            if (audio.duration) {
                const progress = (audio.currentTime / audio.duration) * 100;
                progressFill.style.width = `${progress}%`;
                currentTimeEl.textContent = formatTime(audio.currentTime);
            }
        });

        audio.addEventListener('loadedmetadata', () => {
            const formatted = formatTime(audio.duration);
            durationTimeEl.textContent = formatted;
            if (currentQueue[currentIndex]) {
                currentQueue[currentIndex].duration = formatted;
                saveTrackToIDB(currentQueue[currentIndex]);
                renderPlaylist(searchInput ? searchInput.value : '');
            }
        });

        audio.addEventListener('ended', () => {
            if (repeatMode === 'one') {
                audio.currentTime = 0;
                playTrack();
            } else {
                nextTrack(true);
            }
        });

        audio.addEventListener('error', (e) => {
            appendLog(`ERROR DE AUDIO: No se pudo reproducir la pista (${e.message || 'Formato o permisos'})`, true);
        });

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                renderPlaylist(e.target.value);
            });
        }

        // Selección de Listas
        if (playlistSelect) {
            playlistSelect.addEventListener('change', (e) => {
                activePlaylistId = e.target.value;
                updateCurrentQueue();
            });
        }

        if (btnNewPlaylist) btnNewPlaylist.addEventListener('click', openNewPlaylistModal);
        if (btnDeletePlaylist) btnDeletePlaylist.addEventListener('click', handleDeleteCurrentPlaylist);

        // Modales Listeners
        if (btnCloseModalPl) btnCloseModalPl.addEventListener('click', closeNewPlaylistModal);
        if (btnCancelModalPl) btnCancelModalPl.addEventListener('click', closeNewPlaylistModal);
        if (btnConfirmModalPl) btnConfirmModalPl.addEventListener('click', handleCreatePlaylistConfirm);

        if (btnCloseModalEdit) btnCloseModalEdit.addEventListener('click', closeEditTrackModal);
        if (btnCancelModalEdit) btnCancelModalEdit.addEventListener('click', closeEditTrackModal);
        if (btnConfirmModalEdit) btnConfirmModalEdit.addEventListener('click', handleEditTrackConfirm);

        if (btnCloseModalAddPl) btnCloseModalAddPl.addEventListener('click', closeAddToPlaylistModal);
        if (btnCancelModalAddPl) btnCancelModalAddPl.addEventListener('click', closeAddToPlaylistModal);

        // Carga de Archivos y Carpetas
        if (btnOpenFolder && folderInputHidden) {
            btnOpenFolder.addEventListener('click', () => { folderInputHidden.click(); });
            folderInputHidden.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    const firstFile = e.target.files[0];
                    const folderName = firstFile.webkitRelativePath ? firstFile.webkitRelativePath.split('/')[0] : 'CARPETA_LOCAL';
                    handleAudioFiles(e.target.files, folderName, false);
                    e.target.value = '';
                }
            });
        }

        if (btnAddFiles && filesInputHidden) {
            btnAddFiles.addEventListener('click', () => { filesInputHidden.click(); });
            filesInputHidden.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    handleAudioFiles(e.target.files, folderDisplayTag ? folderDisplayTag.textContent : '', false);
                    e.target.value = '';
                }
            });
        }

        if (btnClearPlaylist) {
            btnClearPlaylist.addEventListener('click', () => {
                if (allTracksMap.size === 0) return;
                if (!confirm("¿Deseas vaciar la biblioteca y memoria local?")) return;
                pauseTrack();
                allTracksMap.clear();
                currentQueue = [];
                currentIndex = 0;
                if (folderDisplayTag) folderDisplayTag.textContent = 'VACÍO';
                loadTrack(0, false);
                renderPlaylistSelectOptions();
                renderPlaylist();
                clearAllLocalDataFromIDB();
                appendLog('BIBLIOTECA LOCAL Y MEMORIA VACIADAS');
            });
        }
    }

    // =========================================================================
    // INICIALIZACIÓN GENERAL Y AUTO-RESTAURACIÓN
    // =========================================================================
    document.addEventListener('DOMContentLoaded', async () => {
        const u = getCurrentUser();
        if (userDisplayTag) {
            userDisplayTag.textContent = u.toUpperCase();
        }

        initVisualizer();
        setupDragAndDrop();
        setupEventListeners();

        // 1. Restaurar biblioteca completa de IndexedDB local de inmediato (cero retardo)
        try {
            const cachedTracks = await loadAllTracksFromIDB();
            if (cachedTracks && cachedTracks.length > 0) {
                cachedTracks.forEach(t => {
                    allTracksMap.set(t.trackHash, {
                        ...t,
                        src: t.file ? URL.createObjectURL(t.file) : '',
                        isLocal: true
                    });
                });

                const savedState = await loadStateFromIDB();
                if (savedState) {
                    if (savedState.folderName && folderDisplayTag) {
                        folderDisplayTag.textContent = savedState.folderName;
                    }
                    if (savedState.activePlaylistId) {
                        activePlaylistId = savedState.activePlaylistId;
                    }
                    if (typeof savedState.currentIndex === 'number') {
                        currentIndex = savedState.currentIndex;
                    }
                }

                renderPlaylistSelectOptions();
                updateCurrentQueue();
                appendLog(`MEMORIA LOCAL RESTAURADA (${cachedTracks.length} PISTAS DE AUDIO)`);

                // Resolver duraciones faltantes de pistas en caché en segundo plano
                resolveTracksDurations(Array.from(allTracksMap.values()));
            } else {
                loadTrack(0, false);
            }
        } catch (err) {
            console.warn('[DOROCORO IDB RESTORE]', err);
            loadTrack(0, false);
        }

        // 2. Sincronizar listas y metadatos con el backend SQLite
        syncLibraryWithServer();
    });

    // API Global de Dorocoro
    window.DorocoroPlayer = {
        loadFolder: (files, folderName) => handleAudioFiles(files, folderName, false),
        play: playTrack,
        pause: pauseTrack,
        next: nextTrack,
        prev: prevTrack
    };
})();
