/**
 * jam.js - Gestor de Sesiones Colaborativas TokiJAM y Jam General para el Anfitrión (Host)
 */

import {
    dom,
    currentQueue,
    currentIndex,
    isPlaying,
    appendLog
} from './state.js';
import { apiFetch, getBackendUrl } from './api.js';
import { addTrackToQueue, renderQueue, renderPlaylist } from './playlists.js';
import { generateQRCodeSVG } from './qrcode.js';

let activeJamData = null;
let joinedTokiJamData = null;
let jamEventSource = null;
let activeJamPopoverEl = null;

function getCurrentAuthUser() {
    return (localStorage.getItem('toki_admin_user') || localStorage.getItem('toki_user') || '').trim().toLowerCase();
}

export function getActiveJam() {
    return activeJamData;
}

export function getJoinedTokiJam() {
    return joinedTokiJamData;
}

export function isInsideJam() {
    return Boolean(activeJamData || joinedTokiJamData);
}

/**
 * Consulta al backend si el usuario actual ya tiene una JAM activa para reengancharla automáticamente.
 */
export async function checkAndRestoreActiveJam() {
    try {
        const currentUser = getCurrentAuthUser();
        const res = await apiFetch('/jam/status').catch(() => null);
        if (res && res.success && res.jam) {
            activeJamData = res.jam;
            joinedTokiJamData = null;
            connectHostSSE(activeJamData.roomId);
            updateJamBadgeUI(activeJamData.activeListeners || 1);
            return activeJamData;
        }

        const activeJamsRes = await apiFetch('/jam/active-tokijams').catch(() => null);
        if (activeJamsRes && Array.isArray(activeJamsRes.jams)) {
            const hostTokiJam = activeJamsRes.jams.find(j => j.type === 'tokijam');
            if (hostTokiJam) {
                if (currentUser && hostTokiJam.hostUsername.toLowerCase() === currentUser) {
                    activeJamData = hostTokiJam;
                    joinedTokiJamData = null;
                    connectHostSSE(activeJamData.roomId);
                    updateJamBadgeUI(activeJamData.activeListeners || 1);
                    return activeJamData;
                }
            }
        }
    } catch (err) {
        console.warn('[JAM RESTORE ERROR]', err);
    }
    return null;
}

/**
 * Abre el menú emergente retro para iniciar, unirse o gestionar la Jam activa.
 */
export async function openJamPopover(buttonEl) {
    closeJamPopover();
    if (!buttonEl) return;

    const currentUser = getCurrentAuthUser();
    await checkAndRestoreActiveJam();

    const rect = buttonEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'retro-queue-menu retro-jam-menu';
    menu.style.position = 'fixed';
    menu.style.zIndex = '999999';

    // 1. Si el usuario actual es Host de una JAM activa (TokiJAM o General)
    if (activeJamData) {
        const jamTypeLabel = activeJamData.type === 'general' ? 'MI JAM GENERAL (HOST)' : 'MI TOKIJAM (HOST)';
        menu.innerHTML = `
            <div class="retro-jam-menu-header">
                <span class="pixel-icon-mask magenta" style="-webkit-mask-image: url('/img/icons/zap.svg'); mask-image: url('/img/icons/zap.svg'); width: 14px; height: 14px;"></span>
                <span>${jamTypeLabel}</span>
            </div>
            <button type="button" class="retro-queue-menu-item" data-action="view-jam">
                <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/share.svg'); mask-image: url('/img/icons/share.svg'); width: 14px; height: 14px;"></span>
                <span>[VER ENLACE Y CODIGO QR]</span>
            </button>
            <button type="button" class="retro-queue-menu-item" data-action="stop-jam" style="color: var(--red-alert);">
                <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/x.svg'); mask-image: url('/img/icons/x.svg'); width: 14px; height: 14px; background-color: var(--red-alert);"></span>
                <span>[DETENER SESION JAM]</span>
            </button>
        `;
    } 
    // 2. Si el usuario está unido a la TokiJAM de otro anfitrión
    else if (joinedTokiJamData) {
        menu.innerHTML = `
            <div class="retro-jam-menu-header">
                <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/user.svg'); mask-image: url('/img/icons/user.svg'); width: 14px; height: 14px;"></span>
                <span>UNIDO A TOKIJAM @${(joinedTokiJamData.hostUsername || 'Host').toUpperCase()}</span>
            </div>
            <button type="button" class="retro-queue-menu-item" data-action="open-joined-jam">
                <span class="pixel-icon-mask magenta" style="-webkit-mask-image: url('/img/icons/plus.svg'); mask-image: url('/img/icons/plus.svg'); width: 14px; height: 14px;"></span>
                <span>[VER PANEL DE LA TOKIJAM]</span>
            </button>
            <button type="button" class="retro-queue-menu-item" data-action="leave-joined-jam" style="color: var(--red-alert);">
                <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/x.svg'); mask-image: url('/img/icons/x.svg'); width: 14px; height: 14px; background-color: var(--red-alert);"></span>
                <span>[SALIR DE LA TOKIJAM]</span>
            </button>
            <button type="button" class="retro-queue-menu-item" data-action="start-general">
                <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/globe.svg'); mask-image: url('/img/icons/globe.svg'); width: 14px; height: 14px;"></span>
                <span>[INICIAR MI JAM GENERAL (PUBLICA)]</span>
            </button>
        `;
    }
    // 3. Menú principal: Consultar si ya existe una TokiJAM en el servidor
    else {
        let existingTokiJam = null;
        try {
            const activeJamsRes = await apiFetch('/jam/active-tokijams').catch(() => null);
            if (activeJamsRes && Array.isArray(activeJamsRes.jams)) {
                existingTokiJam = activeJamsRes.jams.find(j => j.type === 'tokijam');
            }
        } catch (e) {}

        let tokijamOptionHtml = '';
        if (existingTokiJam) {
            if (currentUser && existingTokiJam.hostUsername.toLowerCase() === currentUser) {
                activeJamData = existingTokiJam;
                connectHostSSE(existingTokiJam.roomId);
                updateJamBadgeUI();
                openJamPopover(buttonEl);
                return;
            }

            tokijamOptionHtml = `
                <button type="button" class="retro-queue-menu-item" data-action="join-tokijam" data-room="${existingTokiJam.roomId}" data-host="${existingTokiJam.hostUsername}" style="color: #fff; background: rgba(0, 255, 65, 0.15);">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/user.svg'); mask-image: url('/img/icons/user.svg'); width: 14px; height: 14px;"></span>
                    <span>[UNIRSE A TOKIJAM DE @${existingTokiJam.hostUsername.toUpperCase()}]</span>
                </button>
                <div style="font-size: 0.8rem; opacity: 0.6; padding: 2px 10px; color: var(--yellow-warn);">
                    * Ya hay 1 TokiJAM activa en el servidor
                </div>
            `;
        } else {
            tokijamOptionHtml = `
                <button type="button" class="retro-queue-menu-item" data-action="start-tokijam">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/user.svg'); mask-image: url('/img/icons/user.svg'); width: 14px; height: 14px;"></span>
                    <span>[INICIAR TOKIJAM (TOKISERVER)]</span>
                </button>
            `;
        }

        menu.innerHTML = `
            <div class="retro-jam-menu-header">
                <span class="pixel-icon-mask magenta" style="-webkit-mask-image: url('/img/icons/zap.svg'); mask-image: url('/img/icons/zap.svg'); width: 14px; height: 14px;"></span>
                <span>SESION COLABORATIVA JAM</span>
            </div>
            ${tokijamOptionHtml}
            <button type="button" class="retro-queue-menu-item" data-action="start-general">
                <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/globe.svg'); mask-image: url('/img/icons/globe.svg'); width: 14px; height: 14px;"></span>
                <span>[INICIAR JAM GENERAL (PUBLICA / TAILSCALE)]</span>
            </button>
        `;
    }

    document.body.appendChild(menu);
    activeJamPopoverEl = menu;

    const menuRect = menu.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;

    if (left + menuRect.width > window.innerWidth - 10) {
        left = window.innerWidth - menuRect.width - 10;
    }
    if (top + menuRect.height > window.innerHeight + window.scrollY - 10) {
        top = rect.top + window.scrollY - menuRect.height - 6;
    }

    menu.style.top = `${Math.max(10, top)}px`;
    menu.style.left = `${Math.max(10, left)}px`;

    menu.querySelectorAll('.retro-queue-menu-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            const roomId = item.dataset.room;
            const hostUser = item.dataset.host;
            closeJamPopover();

            if (action === 'start-tokijam') {
                await startJamSessionClient('tokijam');
            } else if (action === 'start-general') {
                await startJamSessionClient('general');
            } else if (action === 'join-tokijam') {
                joinTokiJamSession(roomId, hostUser);
            } else if (action === 'open-joined-jam') {
                openJoinedJamWindow();
            } else if (action === 'leave-joined-jam') {
                leaveJoinedJamSession();
            } else if (action === 'view-jam') {
                openJamModal();
            } else if (action === 'stop-jam') {
                await stopJamSessionClient();
            }
        });
    });

    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
    }, 0);
}

function handleOutsideClick(e) {
    if (activeJamPopoverEl && !activeJamPopoverEl.contains(e.target)) {
        closeJamPopover();
    }
}

export function closeJamPopover() {
    if (activeJamPopoverEl) {
        activeJamPopoverEl.remove();
        activeJamPopoverEl = null;
    }
    document.removeEventListener('click', handleOutsideClick);
}

/**
 * Inicia la sesión JAM en el backend y conecta el canal SSE para el anfitrión.
 */
export async function startJamSessionClient(type = 'tokijam') {
    try {
        appendLog(`INICIANDO ${type === 'general' ? 'JAM GENERAL (PUBLICA)' : 'TOKIJAM (PRIVADA)'}...`);
        const res = await apiFetch('/jam/start', {
            method: 'POST',
            body: JSON.stringify({ type })
        });

        if (!res.success || !res.roomId) {
            throw new Error(res.error || 'No se pudo iniciar la sesión JAM');
        }

        activeJamData = res;
        joinedTokiJamData = null;
        connectHostSSE(res.roomId);
        updateJamBadgeUI();
        openJamModal();

        appendLog(`[JAM ACTIVA] Sala: ${res.roomId} (${res.type.toUpperCase()})`);
        appendLog(`[JAM ENLACE] Comparte: ${res.shareUrl}`);

        if (currentQueue.length > 0 && typeof currentIndex === 'number' && currentQueue[currentIndex]) {
            syncJamCurrentPlaying(currentQueue[currentIndex]);
        }
    } catch (err) {
        console.error('[START JAM ERROR]', err);
        appendLog(`ERROR AL INICIAR JAM: ${err.message}`, true);
        alert(`[JAM] ${err.message}`);
    }
}

/**
 * Unirse a la TokiJAM activa de otro usuario.
 */
export function joinTokiJamSession(roomId, hostUsername) {
    joinedTokiJamData = {
        roomId,
        hostUsername: hostUsername || 'Host'
    };
    activeJamData = null;
    updateJamBadgeUI();
    appendLog(`[TOKIJAM] Te has unido a la TokiJAM de @${(hostUsername || 'Host').toUpperCase()}`);
    appendLog(`[TOKIJAM] Ahora todos tus botones de anadir a la cola enviaran canciones a su TokiJAM.`);
    renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
}

/**
 * Abre la interfaz móvil/web de la TokiJAM en una pestaña o ventana retro.
 */
export function openJoinedJamWindow() {
    if (!joinedTokiJamData) return;
    const url = `/tokitube/jam.html?room=${joinedTokiJamData.roomId}`;
    window.open(url, '_blank', 'width=520,height=750,resizable=yes,scrollbars=yes');
}

/**
 * Desconectarse de la TokiJAM.
 */
export function leaveJoinedJamSession() {
    if (joinedTokiJamData) {
        appendLog(`[TOKIJAM] Has salido de la TokiJAM de @${joinedTokiJamData.hostUsername}`);
        joinedTokiJamData = null;
        updateJamBadgeUI();
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
    }
}

/**
 * Envía una canción a la Jam activa (sea como Host o como participante unido).
 */
export async function queueTrackToActiveJam(track, position = 'end') {
    if (!track) return false;

    // Caso A: Eres el Host de la sesión JAM
    if (activeJamData) {
        addTrackToQueue(track, position);
        return true;
    }

    // Caso B: Estás unido a la TokiJAM de otro usuario
    if (joinedTokiJamData) {
        if (track.sourceType === 'local' && (!track.webUrl || track.webUrl.startsWith('blob:'))) {
            appendLog('[JAM] Las pistas de archivos locales del disco no se pueden enviar a la TokiJAM. Usa canciones Web o de TokiDrive.', true);
            alert('[JAM] Las pistas de archivos locales de tu disco no se pueden enviar a la TokiJAM compartida. Selecciona canciones de YouTube/Web o de TokiDrive.');
            return false;
        }

        const currentUser = (localStorage.getItem('toki_admin_user') || localStorage.getItem('toki_user') || 'Usuario').trim();

        const res = await apiFetch(`/jam/queue/${joinedTokiJamData.roomId}`, {
            method: 'POST',
            body: JSON.stringify({
                track: {
                    title: track.title,
                    artist: track.artist,
                    duration: track.duration || '--:--',
                    thumbnail: track.thumbnail || '',
                    webUrl: track.webUrl || '',
                    format: track.format || 'M4A / WEB',
                    sourceType: track.sourceType || 'web'
                },
                senderName: currentUser,
                position
            })
        });

        if (res && res.success) {
            appendLog(`[TOKIJAM] PISTA ENVIADA A @${joinedTokiJamData.hostUsername.toUpperCase()}: "${track.artist} - ${track.title}" (${position === 'next' ? 'A CONTINUACION' : 'AL FINAL'})`);
            return true;
        } else {
            throw new Error(res?.error || 'Error al enviar a la TokiJAM');
        }
    }

    // Caso C: No estás en Jam -> agregar a la cola local normal
    addTrackToQueue(track, position);
    return true;
}

/**
 * Detiene la sesión JAM activa del anfitrión.
 */
export async function stopJamSessionClient() {
    if (!activeJamData) return;

    try {
        const roomId = activeJamData.roomId;
        appendLog(`DETENIENDO SESION JAM [${roomId}]...`);
        
        if (jamEventSource) {
            jamEventSource.close();
            jamEventSource = null;
        }

        await apiFetch('/jam/stop', {
            method: 'POST',
            body: JSON.stringify({ roomId })
        }).catch(() => {});

        activeJamData = null;
        updateJamBadgeUI();
        closeJamModal();
        appendLog(`SESION JAM FINALIZADA.`);
        renderPlaylist(dom.searchInput ? dom.searchInput.value : '');
    } catch (err) {
        console.error('[STOP JAM ERROR]', err);
    }
}

/**
 * Conecta el flujo SSE para recibir canciones de los invitados en tiempo real.
 */
function connectHostSSE(roomId) {
    if (jamEventSource) {
        jamEventSource.close();
    }

    const sseUrl = `${getBackendUrl()}/api/tokitube/jam/events/${roomId}`;
    jamEventSource = new EventSource(sseUrl);

    jamEventSource.addEventListener('track_added', (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.track) {
                const incomingTrack = data.track;
                const pos = incomingTrack.position || 'end';
                appendLog(`[JAM] @${data.senderName || 'Invitado'} ANADIO (${pos === 'next' ? 'A CONTINUACION' : 'AL FINAL'}): "${incomingTrack.artist} - ${incomingTrack.title}"`);
                
                addTrackToQueue(incomingTrack, pos);
                
                const badge = document.getElementById('jam-deck-indicator');
                if (badge) {
                    badge.classList.add('flash');
                    setTimeout(() => badge.classList.remove('flash'), 1000);
                }
            }
        } catch (err) {
            console.warn('[JAM SSE PARSE ERROR]', err);
        }
    });

    jamEventSource.addEventListener('listeners_updated', (e) => {
        try {
            const data = JSON.parse(e.data);
            if (typeof data.activeListeners === 'number') {
                updateJamBadgeUI(data.activeListeners);
            }
        } catch (err) {}
    });

    jamEventSource.addEventListener('jam_closed', () => {
        activeJamData = null;
        updateJamBadgeUI();
        closeJamModal();
    });

    jamEventSource.onerror = () => {
        console.warn('[JAM SSE HOST RECONNECTING]');
    };
}

/**
 * Sincroniza la pista que el anfitrión está reproduciendo actualmente hacia todos los invitados.
 */
export function syncJamCurrentPlaying(track) {
    if (!activeJamData || !activeJamData.roomId) return;

    apiFetch(`/jam/sync-now-playing/${activeJamData.roomId}`, {
        method: 'POST',
        body: JSON.stringify({
            currentPlaying: track ? {
                title: track.title,
                artist: track.artist,
                duration: track.duration,
                thumbnail: track.thumbnail || '',
                format: track.format,
                sourceType: track.sourceType
            } : null
        })
    }).catch(() => {});
}

/**
 * Actualiza el indicador visual en la barra de ventana, LCD deck y la pestaña de Cola / TokiJAM.
 */
export function updateJamBadgeUI(listenersCount = 1) {
    const badge = document.getElementById('jam-deck-indicator');
    const winJamBtn = document.getElementById('btn-win-jam');

    const tabQueue = document.getElementById('tab-btn-queue');
    const tabQueueLabel = document.getElementById('tab-queue-label');
    const queueHeaderTitle = document.getElementById('queue-view-title-text');
    const queueHeaderIcon = document.getElementById('queue-view-icon');
    const countSpan = document.getElementById('queue-count-badge');
    const count = countSpan ? countSpan.textContent : '0';

    if (activeJamData) {
        const isToki = (activeJamData.type === 'tokijam');
        const jamName = isToki ? 'TOKIJAM' : 'JAM GENERAL';

        document.body.classList.add('inside-jam-session');

        if (badge) {
            badge.style.display = 'inline-flex';
            badge.textContent = `[${jamName} ${isToki ? 'PRIV' : 'PUB'}:${listenersCount}]`;
        }
        if (winJamBtn) {
            winJamBtn.classList.add('active');
            winJamBtn.title = `Mi Jam Activa (Host - ${listenersCount} oyentes)`;
        }

        if (tabQueue) tabQueue.classList.add('jam-active');
        if (tabQueueLabel) tabQueueLabel.innerHTML = `[${jamName} (<span id="queue-count-badge">${count}</span>)]`;
        if (queueHeaderTitle) {
            queueHeaderTitle.textContent = jamName;
            queueHeaderTitle.classList.add('magenta');
        }
        if (queueHeaderIcon) queueHeaderIcon.classList.add('magenta');

    } else if (joinedTokiJamData) {
        const jamName = `TOKIJAM @${joinedTokiJamData.hostUsername.toUpperCase()}`;

        document.body.classList.add('inside-jam-session');

        if (badge) {
            badge.style.display = 'inline-flex';
            badge.textContent = `[UNIDO @${joinedTokiJamData.hostUsername.toUpperCase()}]`;
        }
        if (winJamBtn) {
            winJamBtn.classList.add('active');
            winJamBtn.title = `Unido a la TokiJAM de @${joinedTokiJamData.hostUsername}`;
        }

        if (tabQueue) tabQueue.classList.add('jam-active');
        if (tabQueueLabel) tabQueueLabel.innerHTML = `[${jamName}]`;
        if (queueHeaderTitle) {
            queueHeaderTitle.textContent = jamName;
            queueHeaderTitle.classList.add('magenta');
        }
        if (queueHeaderIcon) queueHeaderIcon.classList.add('magenta');

    } else {
        document.body.classList.remove('inside-jam-session');

        if (badge) badge.style.display = 'none';
        if (winJamBtn) {
            winJamBtn.classList.remove('active');
            winJamBtn.title = "Sesión Colaborativa JAM";
        }

        if (tabQueue) tabQueue.classList.remove('jam-active');
        if (tabQueueLabel) tabQueueLabel.innerHTML = `[COLA (<span id="queue-count-badge">${count}</span>)]`;
        if (queueHeaderTitle) {
            queueHeaderTitle.textContent = 'COLA DE REPRODUCCIÓN';
            queueHeaderTitle.classList.remove('magenta');
        }
        if (queueHeaderIcon) queueHeaderIcon.classList.remove('magenta');
    }
}

/**
 * Abre el modal con enlace y código QR de la JAM activa.
 */
export function openJamModal() {
    const modal = document.getElementById('modal-jam-active');
    if (!modal || !activeJamData) return;

    const titleEl = document.getElementById('jam-modal-title');
    const urlInput = document.getElementById('jam-modal-url-input');
    const qrBox = document.getElementById('jam-modal-qr-box');
    const typeTag = document.getElementById('jam-modal-type-tag');

    if (titleEl) {
        titleEl.textContent = activeJamData.type === 'general' ? '[JAM GENERAL ACTIVA]' : '[TOKIJAM ACTIVA]';
    }

    if (typeTag) {
        typeTag.textContent = activeJamData.type === 'general'
            ? 'PUBLICA (Acceso sin contrasena mediante Tailscale Funnel / Red)'
            : 'PRIVADA (Solo para miembros autenticados de TokiServer)';
    }

    if (urlInput) {
        urlInput.value = activeJamData.shareUrl;
    }

    if (qrBox) {
        qrBox.innerHTML = generateQRCodeSVG(activeJamData.shareUrl, 180, '#00ff41', '#05070a');
    }

    modal.style.display = 'flex';
}

export function closeJamModal() {
    const modal = document.getElementById('modal-jam-active');
    if (modal) modal.style.display = 'none';
}
