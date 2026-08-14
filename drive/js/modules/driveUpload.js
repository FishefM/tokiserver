import { formatBytes, getBackendUrl, getCurrentFolderFromUrl } from './driveUtils.js';
import { renderDriveView } from './driveUI.js';
import { getToken } from '/js/auth.js';

let statusBoxHideTimeout = null;

export async function parseDroppedItems(dataTransferItems) {
    const fileResults = [];
    const emptyDirResults = [];
    const queue = [];

    for (let i = 0; i < dataTransferItems.length; i++) {
        const item = dataTransferItems[i];
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry) {
                queue.push(entry);
            } else {
                const file = item.getAsFile();
                if (file) fileResults.push({ file, path: file.name });
            }
        }
    }

    while (queue.length > 0) {
        const entry = queue.shift();
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
            if (file) {
                const cleanPath = entry.fullPath ? entry.fullPath.replace(/^\/+/, '') : file.name;
                fileResults.push({ file, path: cleanPath });
            }
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const readEntriesBatch = () => new Promise((resolve) => dirReader.readEntries(resolve, () => resolve([])));
            let entries = await readEntriesBatch();
            let hasChildren = false;
            while (entries && entries.length > 0) {
                hasChildren = true;
                for (const subEntry of entries) {
                    queue.push(subEntry);
                }
                entries = await readEntriesBatch();
            }
            if (!hasChildren) {
                const cleanPath = entry.fullPath ? entry.fullPath.replace(/^\/+/, '') : entry.name;
                emptyDirResults.push(cleanPath);
            }
        }
    }
    return { files: fileResults, emptyDirs: emptyDirResults };
}

export function uploadFiles(fileInputPayload) {
    if (!fileInputPayload) return;

    let fileItems = [];
    let emptyDirs = [];

    if (fileInputPayload.files && Array.isArray(fileInputPayload.files)) {
        fileItems = fileInputPayload.files;
        emptyDirs = fileInputPayload.emptyDirs || [];
    } else if (Array.isArray(fileInputPayload) || fileInputPayload instanceof FileList) {
        fileItems = Array.from(fileInputPayload);
    } else {
        return;
    }

    if (fileItems.length === 0 && emptyDirs.length === 0) return;

    const currentFolder = getCurrentFolderFromUrl();
    const statusBox = document.getElementById('upload-status-box');
    const statusText = document.getElementById('upload-status-text');
    const progressFill = document.getElementById('upload-progress-fill');

    if (!currentFolder) {
        if (statusBoxHideTimeout) clearTimeout(statusBoxHideTimeout);
        if (statusBox) statusBox.style.display = 'block';
        if (statusText) statusText.textContent = '[ ERROR ] NO SE PUEDEN SUBIR ARCHIVOS EN LA RAÍZ. ENTRA A UNA SUBCARPETA PRIMERO.';
        if (progressFill) {
            progressFill.style.background = 'var(--red-alert)';
            progressFill.style.width = '100%';
        }
        statusBoxHideTimeout = setTimeout(() => {
            if (statusBox) statusBox.style.display = 'none';
            if (progressFill) progressFill.style.background = 'linear-gradient(90deg, var(--green), var(--magenta-neon))';
            statusBoxHideTimeout = null;
        }, 5000);
        return;
    }

    if (statusBoxHideTimeout) {
        clearTimeout(statusBoxHideTimeout);
        statusBoxHideTimeout = null;
    }

    if (statusBox) statusBox.style.display = 'block';
    if (progressFill) {
        progressFill.style.background = 'linear-gradient(90deg, var(--green), var(--magenta-neon))';
        progressFill.style.width = '0%';
    }

    const normalizedList = [];
    let totalSizeBytes = 0;

    for (let i = 0; i < fileItems.length; i++) {
        const item = fileItems[i];
        if (item.file && item.path) {
            normalizedList.push(item);
            totalSizeBytes += item.file.size;
        } else if (item instanceof File) {
            const relPath = item.webkitRelativePath || item.name;
            normalizedList.push({ file: item, path: relPath });
            totalSizeBytes += item.size;
        }
    }

    const formattedTotal = formatBytes(totalSizeBytes);
    if (statusText) {
        statusText.textContent = `[ SUBIENDO ${normalizedList.length} ARCHIVO(S) (${formattedTotal})... 0% ]`;
    }

    const formData = new FormData();
    formData.append('folder', currentFolder);

    const relativePaths = normalizedList.map(item => item.path);
    formData.append('relativePaths', JSON.stringify(relativePaths));

    if (emptyDirs && emptyDirs.length > 0) {
        formData.append('emptyDirs', JSON.stringify(emptyDirs));
    }

    for (let i = 0; i < normalizedList.length; i++) {
        formData.append('files', normalizedList[i].file, normalizedList[i].file.name);
    }

    const xhr = new XMLHttpRequest();
    const uploadUrl = `${getBackendUrl()}/api/drive/upload?folder=${encodeURIComponent(currentFolder)}`;

    xhr.timeout = 0;

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (statusText) statusText.textContent = `[ SUBIENDO ${normalizedList.length} ARCHIVO(S) (${formattedTotal})... ${percent}% ]`;
        }
    });

    const handleFailure = (msg) => {
        if (statusText) statusText.textContent = `[ ERROR ] ${msg}`;
        if (progressFill) {
            progressFill.style.background = 'var(--red-alert)';
            progressFill.style.width = '100%';
        }
        statusBoxHideTimeout = setTimeout(() => {
            if (statusBox) statusBox.style.display = 'none';
            if (progressFill) progressFill.style.background = 'linear-gradient(90deg, var(--green), var(--magenta-neon))';
            statusBoxHideTimeout = null;
        }, 10000);
    };

    xhr.addEventListener('load', () => {
        let response = {};
        try {
            response = JSON.parse(xhr.responseText);
        } catch (err) {}

        if (xhr.status >= 200 && xhr.status < 300 && response.success) {
            if (progressFill) progressFill.style.width = '100%';
            if (statusText) statusText.textContent = `[ ÉXITO ] ${response.message || 'Archivos y carpetas subidos exitosamente'}`;
            
            renderDriveView();

            statusBoxHideTimeout = setTimeout(() => {
                if (statusBox) statusBox.style.display = 'none';
                statusBoxHideTimeout = null;
            }, 4000);
        } else {
            handleFailure(response.error || `Error del servidor HTTP ${xhr.status}`);
        }
    });

    xhr.addEventListener('abort', () => handleFailure('La subida fue cancelada por el navegador o se cortó la conexión'));
    xhr.addEventListener('timeout', () => handleFailure('Tiempo de espera agotado en el cliente'));
    xhr.addEventListener('error', () => handleFailure(`Error de conexión o red al transferir archivo (${xhr.status || 'Red'})`));

    const fileInput = document.getElementById('file-input-hidden');

    xhr.addEventListener('loadend', () => {
        if (fileInput) fileInput.value = '';
    });

    xhr.open('POST', uploadUrl, true);
    const token = getToken();
    if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
}

export function initDragAndDrop() {
    const fileInput = document.getElementById('file-input-hidden');
    const dropZone = document.getElementById('upload-drop-card');
    const overlay = document.getElementById('drag-drop-overlay');
    const targetFolderTag = document.getElementById('drag-target-folder-name');

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                uploadFiles(fileInput.files);
            }
        });
    }

    if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drag-active');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-active');
            }, false);
        });
    }

    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        const currentFolder = getCurrentFolderFromUrl();
        if (targetFolderTag) {
            targetFolderTag.textContent = currentFolder ? `> DESTINO: /DRIVE/${currentFolder.toUpperCase()}` : '> DESTINO: /DRIVE (RAÍZ)';
        }
        if (overlay) overlay.classList.add('active');
    });

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            if (overlay) overlay.classList.remove('active');
        }
    });

    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (overlay) overlay.classList.remove('active');

        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            const parsedData = await parseDroppedItems(e.dataTransfer.items);
            if (parsedData && (parsedData.files.length > 0 || parsedData.emptyDirs.length > 0)) {
                uploadFiles(parsedData);
            }
        } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadFiles(e.dataTransfer.files);
        }
    });
}
