import { dom, allTracksMap, appendLog } from './state.js';
import { apiFetch, getBackendUrl } from './api.js';
import { saveTrackToIDB } from './storage.js';
import { openAddToPlaylistModal } from './modals.js';
import { showLoader, hideLoader } from './utils.js';
import { addTrackToQueue, openQueuePopover } from './playlists.js';
import { queueTrackToActiveJam } from './jam.js';

/**
 * Ejecuta una búsqueda de audio en la web a través del backend de TokiServer (yt-dlp).
 */
export async function performWebSearch(onTrackSelected) {
    const query = dom.inputWebSearch ? dom.inputWebSearch.value.trim() : '';
    if (!query) {
        appendLog('ERROR: Ingresa un término de búsqueda en la red.', true);
        return;
    }

    if (dom.webSearchStatus) {
        dom.webSearchStatus.textContent = `BUSCANDO EN LA RED: "${query.toUpperCase()}"...`;
    }
    if (dom.webSearchResults) {
        dom.webSearchResults.innerHTML = `
            <div style="padding: 30px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px;">
                <div class="retro-loader-visual" style="max-width: 320px;">
                    <div class="retro-loader-bars">
                        <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                    </div>
                </div>
                <div style="font-size: 1.15rem; color: var(--green);">BUSCANDO RESULTADOS EN LA RED CON YT-DLP...</div>
            </div>
        `;
    }

    showLoader('BUSCANDO EN LA RED...', `Consultando "${query.toUpperCase()}" con motor yt-dlp...`);

    try {
        const data = await apiFetch(`/search?q=${encodeURIComponent(query)}&limit=15`);
        hideLoader();
        if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
            if (dom.webSearchStatus) dom.webSearchStatus.textContent = `SIN RESULTADOS PARA "${query.toUpperCase()}"`;
            if (dom.webSearchResults) {
                dom.webSearchResults.innerHTML = `
                    <div style="padding: 20px; text-align: center; opacity: 0.6;">
                        No se encontraron canciones en la red. Intenta con otro término.
                    </div>
                `;
            }
            return;
        }

        if (dom.webSearchStatus) {
            dom.webSearchStatus.textContent = `RESULTADOS: ${data.results.length} PISTAS ENCONTRADAS`;
        }

        renderWebSearchResults(data.results, onTrackSelected);
    } catch (err) {
        hideLoader();
        console.error('[WEB SEARCH ERROR]', err);
        if (dom.webSearchStatus) dom.webSearchStatus.textContent = `ERROR AL BUSCAR EN LA RED`;
        if (dom.webSearchResults) {
            dom.webSearchResults.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #ff0055;">
                    Error de conexión con el servicio de búsqueda de TokiServer.
                </div>
            `;
        }
    }
}

/**
 * Renderiza la lista de resultados de búsqueda web con opciones de reproducir, agregar a cola y a playlist.
 */
export function renderWebSearchResults(results, onTrackSelected) {
    if (!dom.webSearchResults) return;
    dom.webSearchResults.innerHTML = '';

    results.forEach((item) => {
        const row = document.createElement('li');
        row.className = 'web-track-item';
        row.innerHTML = `
            <div class="web-track-main">
                <div class="web-thumb-box">
                    ${item.thumbnail 
                        ? `<img src="${item.thumbnail}" class="web-thumb-img" alt="cover" loading="lazy">` 
                        : `<span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/music.svg'); mask-image: url('/img/icons/music.svg'); width: 16px; height: 16px;"></span>`}
                </div>
                <div class="web-track-text">
                    <span class="web-track-title" title="${item.title}">${item.title}</span>
                    <div class="web-track-meta">
                        <span class="web-badge-source">WEB</span>
                        <span style="opacity: 0.8;">${item.artist || 'Artista Web'}</span>
                        <span style="opacity: 0.6;">&bull; ${item.duration || '--:--'}</span>
                    </div>
                </div>
            </div>
            <div class="web-actions-group">
                <button type="button" class="btn-web-action add-to-queue" data-hash="${item.trackHash}" title="Opciones de Cola de Reproducción...">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/plus.svg'); mask-image: url('/img/icons/plus.svg'); width: 12px; height: 12px;"></span>
                    <span>COLA</span>
                </button>
                <button type="button" class="btn-web-action add-to-pl" data-hash="${item.trackHash}" title="Agregar a una lista de reproducción">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/playlist.svg'); mask-image: url('/img/icons/playlist.svg'); width: 12px; height: 12px;"></span>
                    <span>LISTA</span>
                </button>
                <button type="button" class="btn-web-action play-direct" data-hash="${item.trackHash}" title="Reproducir ahora">
                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/play.svg'); mask-image: url('/img/icons/play.svg'); width: 12px; height: 12px;"></span>
                    <span>REPRODUCIR</span>
                </button>
            </div>
        `;

        const getTrackObj = () => ({
            trackHash: item.trackHash,
            title: item.title,
            artist: item.artist || 'Artista Web',
            album: "Toki Web Stream",
            duration: item.duration || '--:--',
            format: "M4A / WEB",
            rate: "WEB STREAM",
            sourceType: 'web',
            webUrl: item.webUrl,
            isFavorite: false,
            isLocal: false,
            file: null,
            src: `${getBackendUrl()}/api/tokitube/stream/${item.trackHash}?url=${encodeURIComponent(item.webUrl)}`
        });

        // Botón + COLA (Menú contextual)
        row.querySelector('.btn-web-action.add-to-queue').addEventListener('click', (e) => {
            e.stopPropagation();
            const btnEl = e.currentTarget;
            const trackObj = getTrackObj();
            openQueuePopover(btnEl, async (pos) => {
                allTracksMap.set(trackObj.trackHash, trackObj);
                await saveTrackToIDB(trackObj);

                apiFetch('/tracks/sync', {
                    method: 'POST',
                    body: JSON.stringify({ tracks: [trackObj] })
                }).catch(() => {});

                await queueTrackToActiveJam(trackObj, pos);
            });
        });

        // Botón + LISTA
        row.querySelector('.btn-web-action.add-to-pl').addEventListener('click', async () => {
            const trackObj = getTrackObj();
            allTracksMap.set(trackObj.trackHash, trackObj);
            await saveTrackToIDB(trackObj);

            // Sincronizar pista con SQLite para asegurar su existencia en la BD
            apiFetch('/tracks/sync', {
                method: 'POST',
                body: JSON.stringify({ tracks: [trackObj] })
            }).catch(() => {});

            openAddToPlaylistModal(trackObj);
        });

        // Botón REPRODUCIR
        row.querySelector('.btn-web-action.play-direct').addEventListener('click', async () => {
            const trackObj = getTrackObj();
            allTracksMap.set(trackObj.trackHash, trackObj);
            await saveTrackToIDB(trackObj);

            // Sincronizar en segundo plano con backend
            apiFetch('/tracks/sync', {
                method: 'POST',
                body: JSON.stringify({ tracks: [trackObj] })
            }).catch(() => {});

            addTrackToQueue(trackObj, true);

            if (onTrackSelected) onTrackSelected(trackObj);
        });

        dom.webSearchResults.appendChild(row);
    });
}
