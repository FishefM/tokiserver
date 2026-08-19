/**
 * guest_jam.js - Cliente móvil / web para invitados de TokiTube Jam con Audio Sincronizado
 */

const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');

// Obtener usuario autenticado si existe en el navegador
function getAuthUserName() {
    return (localStorage.getItem('toki_admin_user') || localStorage.getItem('toki_user') || '').trim();
}

const authUser = getAuthUserName();
let currentNickname = authUser || localStorage.getItem('tokijam_guest_nick') || `Invitado_${Math.floor(Math.random() * 899 + 100)}`;
let sseConnection = null;

// Estado de Reproducción Sincronizada
let isAudioSyncEnabled = false;
let currentPlayingData = null;
let progressUpdateTimer = null;

// Elementos DOM
const roomTitleEl = document.getElementById('jam-room-title');
const hostTagEl = document.getElementById('jam-host-tag');
const nicknameDisplayEl = document.getElementById('guest-nickname-display');
const btnChangeNick = document.getElementById('btn-change-nickname');

const npTitleEl = document.getElementById('np-title');
const npArtistEl = document.getElementById('np-artist');
const npThumbEl = document.getElementById('np-thumbnail');
const npMiniEqEl = document.getElementById('np-mini-eq');
const npTimeCurrentEl = document.getElementById('np-time-current');
const npTimeDurationEl = document.getElementById('np-time-duration');
const npProgressFillEl = document.getElementById('np-progress-fill');

const btnToggleSyncAudio = document.getElementById('btn-toggle-sync-audio');
const syncIconIndicator = document.getElementById('sync-icon-indicator');
const syncBtnLabel = document.getElementById('sync-btn-label');
const syncAudioEl = document.getElementById('guest-sync-audio');

const searchInput = document.getElementById('guest-search-input');
const btnSearch = document.getElementById('btn-guest-search');
const resultsBox = document.getElementById('guest-results-box');

const queueCountEl = document.getElementById('guest-queue-count');
const queueListEl = document.getElementById('guest-queue-list');

export function getBackendUrl() {
    const port = window.location.port;
    const hostname = window.location.hostname;
    // Redirigir al puerto 3000 de TokiServer cuando se accede desde un servidor estático (como live-server en 8080 o 5500)
    if (port && port !== '3000' && port !== '80' && port !== '443') {
        return `${window.location.protocol}//${hostname}:3000`;
    }
    return '';
}

function parseDurationToSec(durationStr, fallbackSec) {
    if (typeof fallbackSec === 'number' && fallbackSec > 0) return fallbackSec;
    if (!durationStr || typeof durationStr !== 'string') return 0;
    const parts = durationStr.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const s = Math.floor(seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Compensación de latencia de red y buffer para invitados (+1.5 segundos / 1s 500ms)
const GUEST_AUDIO_SYNC_OFFSET_SEC = 1.5;

function getCalculatedHostTime(trackData, applyOffset = false) {
    if (!trackData) return 0;
    const baseTime = typeof trackData.currentTime === 'number' ? trackData.currentTime : 0;
    if (!trackData.isPlaying) return baseTime;
    const elapsedSec = (Date.now() - (trackData.updatedAt || Date.now())) / 1000;
    const durSec = parseDurationToSec(trackData.duration, trackData.durationSec);
    const offset = applyOffset ? GUEST_AUDIO_SYNC_OFFSET_SEC : 0;
    const total = baseTime + Math.max(0, elapsedSec) + offset;
    return durSec > 0 ? Math.min(total, durSec) : total;
}

function init() {
    if (!roomId) {
        document.body.innerHTML = `
            <div style="text-align:center; padding: 40px 15px; color: var(--green); font-size: 1.5rem;">
                <p style="color: var(--magenta-neon); font-size: 2rem;">[!] ERROR DE ENLACE</p>
                <p style="margin-top: 10px;">No se especificó ninguna sala Jam activa.</p>
                <p style="opacity: 0.7; font-size: 1.1rem; margin-top: 5px;">Escanea el código QR del anfitrión o solicita el enlace completo.</p>
            </div>
        `;
        return;
    }

    if (nicknameDisplayEl) nicknameDisplayEl.textContent = currentNickname;

    if (btnChangeNick) {
        btnChangeNick.addEventListener('click', () => {
            const nuevo = prompt('Ingresa tu nombre o apodo para la Jam:', currentNickname);
            if (nuevo && nuevo.trim()) {
                currentNickname = nuevo.trim().slice(0, 20);
                localStorage.setItem('tokijam_guest_nick', currentNickname);
                if (nicknameDisplayEl) nicknameDisplayEl.textContent = currentNickname;
                showToast(`Nombre actualizado a: ${currentNickname}`);
            }
        });
    }

    // Botón de sincronización de audio (Activar/Desactivar)
    if (btnToggleSyncAudio) {
        btnToggleSyncAudio.addEventListener('click', handleSyncToggleClick);
    }

    if (syncAudioEl) {
        syncAudioEl.addEventListener('loadedmetadata', () => {
            if (currentPlayingData && isAudioSyncEnabled) {
                const target = getCalculatedHostTime(currentPlayingData, true);
                try {
                    syncAudioEl.currentTime = target;
                } catch (e) {}
            }
        });
    }

    // Inicializar buscador
    if (btnSearch && searchInput) {
        btnSearch.addEventListener('click', () => doSearch(searchInput.value));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch(searchInput.value);
        });
    }

    // Timer periódico de actualización de la barra de progreso en vivo
    if (progressUpdateTimer) clearInterval(progressUpdateTimer);
    progressUpdateTimer = setInterval(updateLiveProgressBar, 400);

    connectSSE();
}

async function handleSyncToggleClick() {
    isAudioSyncEnabled = !isAudioSyncEnabled;
    updateSyncButtonUI();

    if (isAudioSyncEnabled) {
        showToast('Reproducción sincronizada activada');
        if (currentPlayingData) {
            await syncAudioPlayback(currentPlayingData);
        }
    } else {
        showToast('Audio en silencio');
        if (syncAudioEl) {
            syncAudioEl.pause();
        }
    }
}

function updateSyncButtonUI() {
    if (!btnToggleSyncAudio) return;

    if (isAudioSyncEnabled) {
        btnToggleSyncAudio.classList.add('active');
        if (syncIconIndicator) {
            syncIconIndicator.className = 'sync-indicator-dot on';
        }
        if (syncBtnLabel) {
            syncBtnLabel.textContent = '[AUDIO EN VIVO: SINCRONIZADO (ON)]';
        }
    } else {
        btnToggleSyncAudio.classList.remove('active');
        if (syncIconIndicator) {
            syncIconIndicator.className = 'sync-indicator-dot off';
        }
        if (syncBtnLabel) {
            syncBtnLabel.textContent = '[AUDIO EN VIVO: EN SILENCIO (OFF)]';
        }
    }
}

function updateLiveProgressBar() {
    if (!currentPlayingData) {
        if (npTimeCurrentEl) npTimeCurrentEl.textContent = '00:00';
        if (npProgressFillEl) npProgressFillEl.style.width = '0%';
        return;
    }

    const durSec = parseDurationToSec(currentPlayingData.duration, currentPlayingData.durationSec);
    let currTime = 0;

    if (isAudioSyncEnabled && syncAudioEl && !syncAudioEl.paused && syncAudioEl.currentTime > 0) {
        currTime = syncAudioEl.currentTime;
    } else {
        currTime = getCalculatedHostTime(currentPlayingData);
    }

    if (npTimeCurrentEl) npTimeCurrentEl.textContent = formatTime(currTime);
    if (npTimeDurationEl) npTimeDurationEl.textContent = currentPlayingData.duration || '--:--';

    if (npProgressFillEl) {
        const percent = durSec > 0 ? Math.min(100, (currTime / durSec) * 100) : 0;
        npProgressFillEl.style.width = `${percent}%`;
    }
}

async function syncAudioPlayback(trackData) {
    if (!isAudioSyncEnabled || !syncAudioEl || !trackData) return;

    const hash = trackData.hash || trackData.trackHash;
    if (!hash) {
        syncAudioEl.pause();
        return;
    }

    const expectedSrc = `${getBackendUrl()}/api/tokitube/stream/${encodeURIComponent(hash)}?url=${encodeURIComponent(trackData.url || '')}`;
    
    // Si la pista cambió, actualizar src
    if (!syncAudioEl.src || !syncAudioEl.src.includes(encodeURIComponent(hash))) {
        syncAudioEl.src = expectedSrc;
    }

    // Posición con adelanto de +1.5 segundos para compensar latencia de red y buffering
    const targetTime = getCalculatedHostTime(trackData, true);

    // Corregir desfase de tiempo si es mayor a 1.2 segundos
    if (Math.abs(syncAudioEl.currentTime - targetTime) > 1.2) {
        try {
            syncAudioEl.currentTime = targetTime;
        } catch (e) {}
    }

    if (trackData.isPlaying) {
        try {
            await syncAudioEl.play();
        } catch (err) {
            console.warn('[GUEST AUDIO AUTOPLAY BLOCKED]', err);
        }
    } else {
        syncAudioEl.pause();
    }
}

function connectSSE() {
    if (sseConnection) sseConnection.close();

    const url = `${getBackendUrl()}/api/tokitube/jam/events/${roomId}`;
    sseConnection = new EventSource(url);

    sseConnection.addEventListener('jam_init', (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.jamInfo) {
                applyJamInfo(data.jamInfo);
            }
        } catch (err) {}
    });

    sseConnection.addEventListener('track_changed', (e) => {
        try {
            const data = JSON.parse(e.data);
            currentPlayingData = data.currentPlaying;
            updateNowPlayingUI(data.currentPlaying);
            if (isAudioSyncEnabled) {
                syncAudioPlayback(data.currentPlaying);
            }
        } catch (err) {}
    });

    sseConnection.addEventListener('track_added', (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.track) {
                appendQueueItem(data.track, data.senderName);
                if (queueCountEl && typeof data.queueCount === 'number') {
                    queueCountEl.textContent = `${data.queueCount} PISTAS`;
                }
            }
        } catch (err) {}
    });

    sseConnection.addEventListener('jam_closed', (e) => {
        let msg = 'La sesión JAM ha finalizado.';
        try {
            const data = JSON.parse(e.data);
            if (data.message) msg = data.message;
        } catch (err) {}
        showToast(msg);
        if (npTitleEl) npTitleEl.textContent = 'SESIÓN FINALIZADA';
        if (npArtistEl) npArtistEl.textContent = msg;
        if (syncAudioEl) {
            syncAudioEl.pause();
            syncAudioEl.removeAttribute('src');
        }
        if (npMiniEqEl) npMiniEqEl.classList.add('paused');
    });

    sseConnection.onerror = () => {
        console.warn('[GUEST SSE RECONNECTING]');
    };
}

function applyJamInfo(info) {
    if (roomTitleEl) {
        roomTitleEl.textContent = info.type === 'general' ? 'JAM GENERAL' : 'TOKIJAM';
    }
    if (hostTagEl) {
        hostTagEl.textContent = `ANFITRIÓN: @${(info.hostUsername || 'Host').toUpperCase()}`;
    }

    const loggedUser = getAuthUserName();
    if (info.type === 'tokijam' && loggedUser) {
        currentNickname = loggedUser;
        if (nicknameDisplayEl) nicknameDisplayEl.textContent = loggedUser;
    }

    currentPlayingData = info.currentPlaying;
    if (info.currentPlaying) {
        updateNowPlayingUI(info.currentPlaying);
        if (isAudioSyncEnabled) {
            syncAudioPlayback(info.currentPlaying);
        }
    }
    if (queueCountEl) {
        queueCountEl.textContent = `${info.queueCount || 0} PISTAS`;
    }
    if (queueListEl && Array.isArray(info.queueSnapshot) && info.queueSnapshot.length > 0) {
        queueListEl.innerHTML = '';
        info.queueSnapshot.forEach(t => appendQueueItem(t, t.addedBy));
    }
}

function updateNowPlayingUI(track) {
    if (!track) {
        if (npTitleEl) npTitleEl.textContent = 'ESPERANDO ANFITRIÓN...';
        if (npArtistEl) npArtistEl.textContent = 'TokiTube Station';
        if (npThumbEl) npThumbEl.src = '/toki.jpeg';
        if (npTimeDurationEl) npTimeDurationEl.textContent = '--:--';
        if (npTimeCurrentEl) npTimeCurrentEl.textContent = '00:00';
        if (npProgressFillEl) npProgressFillEl.style.width = '0%';
        if (npMiniEqEl) npMiniEqEl.classList.add('paused');
        return;
    }

    if (npTitleEl) npTitleEl.textContent = track.title || 'EN REPRODUCCIÓN';
    if (npArtistEl) npArtistEl.textContent = track.artist || 'TokiTube Jam';
    if (npThumbEl) {
        npThumbEl.src = track.thumbnail || '/toki.jpeg';
    }
    if (npTimeDurationEl) {
        npTimeDurationEl.textContent = track.duration || '--:--';
    }

    if (npMiniEqEl) {
        if (track.isPlaying) {
            npMiniEqEl.classList.remove('paused');
        } else {
            npMiniEqEl.classList.add('paused');
        }
    }

    updateLiveProgressBar();
}

function appendQueueItem(track, senderName = 'Invitado') {
    if (!queueListEl) return;
    
    if (queueListEl.children.length === 1 && queueListEl.textContent.includes('AÚN NO HAY')) {
        queueListEl.innerHTML = '';
    }

    const row = document.createElement('div');
    row.className = 'guest-queue-row';
    row.innerHTML = `
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
            ${track.artist} - ${track.title}
        </span>
        <span class="guest-queue-addedby">@${senderName}</span>
    `;
    queueListEl.appendChild(row);
    queueListEl.scrollTop = queueListEl.scrollHeight;
}

async function doSearch(query) {
    const q = (query || '').trim();
    if (!q || !resultsBox) return;

    resultsBox.style.display = 'flex';
    resultsBox.innerHTML = `
        <div style="text-align: center; opacity: 0.7; padding: 20px; font-size: 1.2rem;">
            BUSCANDO EN YOUTUBE: "${q.toUpperCase()}"...
        </div>
    `;

    try {
        const searchUrl = `${getBackendUrl()}/api/tokitube/search?q=${encodeURIComponent(q)}&limit=8`;
        const res = await fetch(searchUrl);
        const data = await res.json();

        if (data.success && Array.isArray(data.results) && data.results.length > 0) {
            resultsBox.innerHTML = '';
            data.results.forEach(item => {
                const card = document.createElement('div');
                card.className = 'guest-result-card';
                card.innerHTML = `
                    <div class="guest-result-info">
                        <img src="${item.thumbnail || '/toki.jpeg'}" class="guest-result-thumb" alt="thumb" loading="lazy">
                        <div class="guest-result-text">
                            <div class="guest-result-title" title="${item.title}">${item.title}</div>
                            <div class="guest-result-artist">${item.artist} &bull; ${item.duration || '--:--'}</div>
                        </div>
                    </div>
                    <button type="button" class="btn-add-jam-queue">+ AÑADIR</button>
                `;

                const btn = card.querySelector('.btn-add-jam-queue');
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    btn.textContent = '...';
                    await queueTrack(item, btn);
                });

                resultsBox.appendChild(card);
            });
        } else {
            resultsBox.innerHTML = `
                <div style="text-align: center; opacity: 0.7; padding: 15px;">
                    No se encontraron canciones para "${q}". Intenta con otro término.
                </div>
            `;
        }
    } catch (err) {
        console.error('[GUEST JAM SEARCH ERROR]', err);
        resultsBox.innerHTML = `
            <div style="text-align: center; color: var(--magenta-neon); padding: 15px;">
                Error al buscar en la red. Verifica tu conexión (${err.message}).
            </div>
        `;
    }
}

async function queueTrack(track, buttonEl) {
    try {
        const queueUrl = `${getBackendUrl()}/api/tokitube/jam/queue/${roomId}`;
        const token = localStorage.getItem('toki_admin_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        if (currentNickname) {
            headers['x-user'] = currentNickname;
        }

        const res = await fetch(queueUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                track: {
                    title: track.title,
                    artist: track.artist,
                    duration: track.duration,
                    thumbnail: track.thumbnail,
                    webUrl: track.webUrl,
                    format: track.format || 'M4A / WEB',
                    sourceType: 'web'
                },
                senderName: currentNickname
            })
        });

        const data = await res.json();
        if (data.success) {
            buttonEl.textContent = '[EN COLA]';
            buttonEl.classList.add('added');
            showToast(`"${track.title}" añadida a la Jam`);
        } else {
            throw new Error(data.error || 'Error al agregar');
        }
    } catch (err) {
        buttonEl.disabled = false;
        buttonEl.textContent = '+ AÑADIR';
        alert(`Error al agregar a la Jam: ${err.message}`);
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'jam-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 2600);
}

document.addEventListener('DOMContentLoaded', init);
