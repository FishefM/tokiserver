/**
 * guest_jam.js - Cliente móvil / web para invitados de TokiTube Jam
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

// Elementos DOM
const roomTitleEl = document.getElementById('jam-room-title');
const hostTagEl = document.getElementById('jam-host-tag');
const nicknameDisplayEl = document.getElementById('guest-nickname-display');
const btnChangeNick = document.getElementById('btn-change-nickname');

const npTitleEl = document.getElementById('np-title');
const npArtistEl = document.getElementById('np-artist');
const npThumbEl = document.getElementById('np-thumbnail');

const searchInput = document.getElementById('guest-search-input');
const btnSearch = document.getElementById('btn-guest-search');
const resultsBox = document.getElementById('guest-results-box');

const queueCountEl = document.getElementById('guest-queue-count');
const queueListEl = document.getElementById('guest-queue-list');

export function getBackendUrl() {
    const port = window.location.port;
    const hostname = window.location.hostname;
    // Solo aplicar fallback a :3000 si se ejecuta en localhost con servidor de desarrollo (live-server en 8080 o 5500)
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && (port === '8080' || port === '5500')) {
        return `${window.location.protocol}//${hostname}:3000`;
    }
    return '';
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

    // Inicializar búsqueda
    if (btnSearch && searchInput) {
        btnSearch.addEventListener('click', () => doSearch(searchInput.value));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch(searchInput.value);
        });
    }

    connectSSE();
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
            if (data.currentPlaying) {
                updateNowPlayingUI(data.currentPlaying);
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

    sseConnection.addEventListener('jam_closed', () => {
        showToast('La sesión JAM ha finalizado.');
        if (npTitleEl) npTitleEl.textContent = 'SESION FINALIZADA';
        if (npArtistEl) npArtistEl.textContent = 'El anfitrión ha cerrado la Jam';
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
        hostTagEl.textContent = `ANFITRION: @${(info.hostUsername || 'Host').toUpperCase()}`;
    }

    // Si es TokiJAM y tenemos usuario autenticado, asegurar que se muestre su nombre real
    const loggedUser = getAuthUserName();
    if (info.type === 'tokijam' && loggedUser) {
        currentNickname = loggedUser;
        if (nicknameDisplayEl) nicknameDisplayEl.textContent = loggedUser;
    }

    if (info.currentPlaying) {
        updateNowPlayingUI(info.currentPlaying);
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
    if (npTitleEl) npTitleEl.textContent = track.title || 'EN REPRODUCCION';
    if (npArtistEl) npArtistEl.textContent = track.artist || 'TokiTube Jam';
    if (npThumbEl) {
        npThumbEl.src = track.thumbnail || '/toki.jpeg';
    }
}

function appendQueueItem(track, senderName = 'Invitado') {
    if (!queueListEl) return;
    
    if (queueListEl.children.length === 1 && queueListEl.textContent.includes('AUN NO HAY')) {
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
                    <button type="button" class="btn-add-jam-queue">+ ANADIR</button>
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
        buttonEl.textContent = '+ ANADIR';
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
