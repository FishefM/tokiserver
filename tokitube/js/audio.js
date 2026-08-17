/**
 * audio.js - Motor de Audio, Web Audio API y Visualizador Canvas
 */

import {
    dom,
    currentQueue,
    currentIndex,
    isPlaying,
    repeatMode,
    isShuffle,
    activePlaylistId,
    setCurrentIndex,
    setIsPlaying,
    setRepeatMode,
    setIsShuffle,
    appendLog
} from './state.js';
import { getTrackSourceState } from './utils.js';
import { getBackendUrl, apiFetch } from './api.js';
import { saveStateToIDB, saveQueueToIDB } from './storage.js';

let audioCtx = null;
let analyser = null;
let gainNode = null;
let source = null;
let dataArray = null;
let bufferLength = 0;
let canvasCtx = null;

/**
 * Inicializa el contexto de audio, GainNode y el analizador de frecuencias en el primer gesto del usuario.
 */
export function ensureAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        audioCtx = new AudioContextClass();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        gainNode = audioCtx.createGain();
        const currentVol = dom.volumeSlider ? (dom.volumeSlider.value / 100) : 0.8;
        gainNode.gain.setValueAtTime(currentVol, audioCtx.currentTime);

        if (dom.audio) {
            try {
                source = audioCtx.createMediaElementSource(dom.audio);
                source.connect(analyser);
                analyser.connect(gainNode);
                gainNode.connect(audioCtx.destination);
            } catch (e) {
                console.warn('[AUDIO CONTEXT WARNING]', e);
            }
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

/**
 * Ajusta el volumen tanto en el elemento HTML5 Audio como en el GainNode de Web Audio API.
 */
export function setVolume(fraction) {
    const val = Math.max(0, Math.min(1, fraction));
    if (dom.audio) {
        dom.audio.volume = val;
    }
    if (gainNode && audioCtx) {
        try {
            gainNode.gain.setValueAtTime(val, audioCtx.currentTime);
        } catch (e) {}
    }
}

/**
 * Inicializa el renderizado del visualizador retro en el Canvas con caída suave al pausar.
 */
let barHeights = new Float32Array(128);

export function initVisualizer() {
    if (!dom.canvas) return;
    canvasCtx = dom.canvas.getContext('2d');

    function renderFrame() {
        requestAnimationFrame(renderFrame);

        const width = dom.canvas.width;
        const height = dom.canvas.height;
        canvasCtx.fillStyle = '#05070a';
        canvasCtx.fillRect(0, 0, width, height);

        const numBars = bufferLength || 32;
        if (barHeights.length < numBars) {
            barHeights = new Float32Array(numBars);
        }

        let hasActiveBars = false;

        if (analyser && isPlaying) {
            analyser.getByteFrequencyData(dataArray);
            for (let i = 0; i < numBars; i++) {
                const targetH = (dataArray[i] / 255) * height;
                barHeights[i] = targetH;
                if (targetH > 1) hasActiveBars = true;
            }
        } else {
            // Al pausar: las barritas bajan suavemente poco a poco
            for (let i = 0; i < numBars; i++) {
                barHeights[i] = Math.max(0, barHeights[i] - 1.2);
                if (barHeights[i] > 1) hasActiveBars = true;
            }
        }

        if (!hasActiveBars && !isPlaying) {
            // Animación idle suave en standby original
            canvasCtx.fillStyle = 'rgba(0, 255, 157, 0.15)';
            for (let i = 0; i < 32; i++) {
                const barH = 2 + Math.sin((Date.now() / 400) + (i * 0.3)) * 2;
                canvasCtx.fillRect(i * (width / 32) + 1, height - barH, (width / 32) - 2, barH);
            }
            return;
        }

        const barWidth = (width / numBars) * 1.5;
        let x = 0;

        for (let i = 0; i < numBars; i++) {
            const barHeight = barHeights[i];
            if (barHeight <= 0) {
                x += barWidth;
                continue;
            }

            if (barHeight > height * 0.75) {
                canvasCtx.fillStyle = '#ff0055'; // Pico alto (magenta/rojo)
            } else if (barHeight > height * 0.4) {
                canvasCtx.fillStyle = '#ffd700'; // Rango medio (oro)
            } else {
                canvasCtx.fillStyle = '#00ff9d'; // Frecuencias base (verde neón)
            }

            canvasCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
            x += barWidth;
        }
    }

    renderFrame();
}

/**
 * Pre-descarga la siguiente pista de la cola silenciosamente en el servidor para 0 ms de latencia.
 */
export function triggerPrefetchNextTrack() {
    if (currentQueue.length <= 1) return;
    const nextIdx = (currentIndex + 1) % currentQueue.length;

    const nextTrack = currentQueue[nextIdx];
    if (nextTrack && nextTrack.webUrl && (nextTrack.sourceType === 'web' || !nextTrack.sourceType)) {
        apiFetch('/prefetch', {
            method: 'POST',
            body: JSON.stringify({
                trackHash: nextTrack.trackHash,
                url: nextTrack.webUrl
            })
        }).then((res) => {
            if (res && res.prefetched) {
                appendLog(`[PREFETCH] Siguiente pista de la cola pre-descargada en disco: "${nextTrack.title}"`);
            }
        }).catch(() => {});
    }
}

/**
 * Actualiza el estado visual de los botones de acción de la pista en el reproductor.
 */
export function updateDeckTrackActions(track) {
    if (!track) {
        if (dom.deckBtnFav) dom.deckBtnFav.classList.remove('active');
        if (dom.deckBtnDownload) dom.deckBtnDownload.classList.remove('active');
        return;
    }

    if (dom.deckBtnFav) {
        dom.deckBtnFav.classList.toggle('active', !!track.isFavorite);
        dom.deckBtnFav.title = track.isFavorite ? 'Quitar de Favoritas' : 'Marcar como Favorita';
    }
    if (dom.deckIconFav) {
        const starIcon = track.isFavorite ? '/img/icons/star-filled.svg' : '/img/icons/star.svg';
        dom.deckIconFav.style.webkitMaskImage = `url('${starIcon}')`;
        dom.deckIconFav.style.maskImage = `url('${starIcon}')`;
    }

    const sourceState = getTrackSourceState(track);
    if (dom.deckBtnDownload) {
        dom.deckBtnDownload.classList.toggle('active', sourceState === 'OFFLINE');
        if (sourceState === 'OFFLINE') {
            dom.deckBtnDownload.title = 'Pista guardada en este dispositivo (Modo Offline listo)';
        } else if (sourceState === 'DRIVE') {
            dom.deckBtnDownload.title = 'Descargar de TokiDrive a este dispositivo';
        } else if (sourceState === 'WEB') {
            dom.deckBtnDownload.title = 'Descargar a este dispositivo para modo Offline';
        } else {
            dom.deckBtnDownload.title = 'Archivo en carpeta local de este dispositivo';
        }
    }
}

/**
 * Carga una pista en el elemento de audio HTML5 según su estado (OFFLINE, DRIVE, WEB o LOCAL).
 */
export function loadTrack(index, autoPlay = false, onTrackLoaded = null) {
    if (currentQueue.length === 0) {
        if (dom.trackTitle) dom.trackTitle.textContent = "SIN PISTAS EN COLA";
        if (dom.trackArtist) dom.trackArtist.textContent = "REPRODUCE O AÑADE UNA PLAYLIST A LA COLA";
        if (dom.trackFormat) dom.trackFormat.textContent = "VACÍO";
        if (dom.trackRate) dom.trackRate.textContent = "--";
        if (dom.progressFill) dom.progressFill.style.width = '0%';
        if (dom.currentTime) dom.currentTime.textContent = '00:00';
        if (dom.durationTime) dom.durationTime.textContent = '00:00';
        if (dom.statusIndicator) dom.statusIndicator.textContent = "STANDBY";
        updateDeckTrackActions(null);
        return;
    }

    let safeIdx = index;
    if (safeIdx < 0) safeIdx = 0;
    if (safeIdx >= currentQueue.length) safeIdx = currentQueue.length - 1;
    setCurrentIndex(safeIdx);

    const track = currentQueue[currentIndex];
    updateDeckTrackActions(track);
    const sourceState = getTrackSourceState(track);

    if (dom.trackTitle) dom.trackTitle.textContent = track.title;
    if (dom.trackArtist) dom.trackArtist.textContent = track.artist;

    if (sourceState === 'OFFLINE') {
        dom.audio.removeAttribute('crossorigin');
        track.src = URL.createObjectURL(track.file);
        dom.audio.src = track.src;
        if (dom.trackFormat) dom.trackFormat.textContent = "OFFLINE AUDIO";
        if (dom.trackRate) dom.trackRate.textContent = "OFFLINE STEREO";
        if (dom.statusIndicator) dom.statusIndicator.textContent = "READY";
        dom.audio.load();
        const currentVol = dom.volumeSlider ? (dom.volumeSlider.value / 100) : 0.8;
        setVolume(currentVol);
        if (autoPlay) playTrack();
        appendLog(`REPRODUCIENDO EN MODO OFFLINE (DESCARGADA): "${track.artist} - ${track.title}"`);
    } else if (sourceState === 'DRIVE') {
        dom.audio.crossOrigin = 'anonymous';
        const streamUrl = `${getBackendUrl()}${track.webUrl}`;
        track.src = streamUrl;
        dom.audio.src = streamUrl;
        if (dom.trackFormat) dom.trackFormat.textContent = track.format || "DRIVE AUDIO";
        if (dom.trackRate) dom.trackRate.textContent = "TOKIDRIVE STREAM";
        if (dom.statusIndicator) dom.statusIndicator.textContent = "BUFFERING";
        dom.audio.load();
        const currentVol = dom.volumeSlider ? (dom.volumeSlider.value / 100) : 0.8;
        setVolume(currentVol);
        if (autoPlay) playTrack();
        appendLog(`TRANSMITIENDO DESDE TOKIDRIVE: "${track.artist} - ${track.title}"`);
    } else if (sourceState === 'WEB') {
        dom.audio.crossOrigin = 'anonymous';
        const streamUrl = `${getBackendUrl()}/api/tokitube/stream/${track.trackHash}?url=${encodeURIComponent(track.webUrl || '')}`;
        track.src = streamUrl;
        dom.audio.src = streamUrl;
        if (dom.trackFormat) dom.trackFormat.textContent = "M4A / WEB";
        if (dom.trackRate) dom.trackRate.textContent = "WEB STREAM";
        if (dom.statusIndicator) dom.statusIndicator.textContent = "BUFFERING";
        dom.audio.load();
        const currentVol = dom.volumeSlider ? (dom.volumeSlider.value / 100) : 0.8;
        setVolume(currentVol);
        if (autoPlay) playTrack();
        appendLog(`TRANSMITIENDO EN STREAMING WEB: "${track.artist} - ${track.title}"`);
    } else { // LOCAL
        if (track.file) {
            dom.audio.removeAttribute('crossorigin');
            track.src = URL.createObjectURL(track.file);
            dom.audio.src = track.src;
            if (dom.trackFormat) dom.trackFormat.textContent = track.format || "LOCAL AUDIO";
            if (dom.trackRate) dom.trackRate.textContent = "LOCAL STEREO";
            if (dom.statusIndicator) dom.statusIndicator.textContent = "READY";
            dom.audio.load();
            const currentVol = dom.volumeSlider ? (dom.volumeSlider.value / 100) : 0.8;
            setVolume(currentVol);
            if (autoPlay) playTrack();
            appendLog(`REPRODUCIENDO DESDE CARPETA LOCAL: "${track.artist} - ${track.title}"`);
        } else if (track.webUrl) {
            dom.audio.crossOrigin = 'anonymous';
            const isDrive = (track.sourceType === 'drive' || track.webUrl.startsWith('/drive/') || track.webUrl.includes('/drive-stream/'));
            const streamUrl = isDrive
                ? `${getBackendUrl()}${track.webUrl}`
                : `${getBackendUrl()}/api/tokitube/stream/${track.trackHash}?url=${encodeURIComponent(track.webUrl)}`;
            track.src = streamUrl;
            dom.audio.src = streamUrl;
            if (dom.trackFormat) dom.trackFormat.textContent = track.format || (isDrive ? "DRIVE AUDIO" : "M4A / WEB");
            if (dom.trackRate) dom.trackRate.textContent = isDrive ? "TOKIDRIVE STREAM" : "WEB STREAM";
            if (dom.statusIndicator) dom.statusIndicator.textContent = "BUFFERING";
            dom.audio.load();
            const currentVol = dom.volumeSlider ? (dom.volumeSlider.value / 100) : 0.8;
            setVolume(currentVol);
            if (autoPlay) playTrack();
            appendLog(`TRANSMITIENDO VÍA RED: "${track.artist} - ${track.title}"`);
        } else {
            dom.audio.removeAttribute('src');
            if (dom.statusIndicator) dom.statusIndicator.textContent = "STANDBY";
            appendLog(`[ARCHIVO LOCAL NO CARGADO] Abre la carpeta con [ABRIR CARPETA] o sincronízala con TokiDrive para escucharla en todos tus dispositivos.`, true);
        }
    }

    dom.audio.loop = (repeatMode === 'one');
    if (dom.progressFill) dom.progressFill.style.width = '0%';
    if (dom.currentTime) dom.currentTime.textContent = '00:00';
    if (dom.durationTime) dom.durationTime.textContent = track.duration || '--:--';

    if (onTrackLoaded) onTrackLoaded();
    appendLog(`PISTA SELECCIONADA: [${track.artist}] - ${track.title} [${track.format}]`);

    saveStateToIDB(dom.folderDisplayTag ? dom.folderDisplayTag.textContent : '', activePlaylistId, currentIndex);
    saveQueueToIDB(currentQueue, currentIndex);
    triggerPrefetchNextTrack();
}

export function playTrack() {
    if (currentQueue.length === 0) return;
    ensureAudioContext();
    setIsPlaying(true);
    if (dom.playBtn) dom.playBtn.classList.add('active');
    if (dom.playIcon) {
        dom.playIcon.style.webkitMaskImage = "url('/img/icons/pause.svg')";
        dom.playIcon.style.maskImage = "url('/img/icons/pause.svg')";
    }
    if (dom.statusIndicator) dom.statusIndicator.textContent = "PLAYING";

    const track = currentQueue[currentIndex];
    if (dom.audio && dom.audio.src) {
        dom.audio.play().catch(e => {
            appendLog(`REPRODUCCIÓN: ${e.message}`);
        });
    }
    appendLog(`REPRODUCIENDO: ${track?.artist} - ${track?.title}`);
    triggerPrefetchNextTrack();
}

export function pauseTrack() {
    setIsPlaying(false);
    if (dom.playBtn) dom.playBtn.classList.remove('active');
    if (dom.playIcon) {
        dom.playIcon.style.webkitMaskImage = "url('/img/icons/play.svg')";
        dom.playIcon.style.maskImage = "url('/img/icons/play.svg')";
    }
    if (dom.statusIndicator) dom.statusIndicator.textContent = "PAUSED";
    if (dom.audio && dom.audio.src) {
        dom.audio.pause();
    }
    appendLog(`PAUSA: ${currentQueue[currentIndex]?.title}`);
}

export function togglePlay() {
    if (currentQueue.length === 0) {
        appendLog('ADVERTENCIA: No hay canciones en la lista activa. Abre una carpeta o busca en la red.', true);
        return;
    }
    ensureAudioContext();
    if (isPlaying) {
        pauseTrack();
    } else {
        playTrack();
    }
}

export function nextTrack(autoEnded = false, onTrackChange = null) {
    if (currentQueue.length === 0) return;

    if (repeatMode === 'one' && autoEnded) {
        dom.audio.currentTime = 0;
        playTrack();
        return;
    }

    if (currentIndex < currentQueue.length - 1) {
        loadTrack(currentIndex + 1, true, onTrackChange);
    } else if (repeatMode === 'all') {
        loadTrack(0, true, onTrackChange);
    } else {
        pauseTrack();
        dom.audio.currentTime = 0;
        if (dom.progressFill) dom.progressFill.style.width = '0%';
        if (dom.currentTime) dom.currentTime.textContent = '00:00';
    }
}

export function prevTrack(onTrackChange = null) {
    if (currentQueue.length === 0) return;
    if (dom.audio && dom.audio.currentTime > 3) {
        dom.audio.currentTime = 0;
        return;
    }

    if (currentIndex > 0) {
        loadTrack(currentIndex - 1, true, onTrackChange);
    } else {
        loadTrack(currentQueue.length - 1, true, onTrackChange);
    }
}


export function toggleRepeat() {
    if (repeatMode === 'off') {
        setRepeatMode('all');
    } else if (repeatMode === 'all') {
        setRepeatMode('one');
    } else {
        setRepeatMode('off');
    }
    updateRepeatButtonUI();
}

export function updateRepeatButtonUI() {
    if (!dom.repeatBtn) return;
    dom.repeatBtn.classList.remove('active', 'active-one');

    if (repeatMode === 'off') {
        dom.repeatBtn.title = "Repetir: Desactivado";
        if (dom.repeatIcon) {
            dom.repeatIcon.style.webkitMaskImage = "url('/img/icons/repeat.svg')";
            dom.repeatIcon.style.maskImage = "url('/img/icons/repeat.svg')";
        }
        if (dom.audio) dom.audio.loop = false;
        appendLog("MODO REPETICIÓN: DESACTIVADO");
    } else if (repeatMode === 'all') {
        dom.repeatBtn.classList.add('active');
        dom.repeatBtn.title = "Repetir: Toda la Playlist";
        if (dom.repeatIcon) {
            dom.repeatIcon.style.webkitMaskImage = "url('/img/icons/repeat.svg')";
            dom.repeatIcon.style.maskImage = "url('/img/icons/repeat.svg')";
        }
        if (dom.audio) dom.audio.loop = false;
        appendLog("MODO REPETICIÓN: TODA LA PLAYLIST (LOOP)");
    } else if (repeatMode === 'one') {
        dom.repeatBtn.classList.add('active-one');
        dom.repeatBtn.title = "Repetir: Pista Actual (1)";
        if (dom.repeatIcon) {
            dom.repeatIcon.style.webkitMaskImage = "url('/img/icons/repeat-1.svg')";
            dom.repeatIcon.style.maskImage = "url('/img/icons/repeat-1.svg')";
        }
        if (dom.audio) dom.audio.loop = true;
        appendLog("MODO REPETICIÓN: PISTA ACTUAL (LOOP 1)");
    }
}
