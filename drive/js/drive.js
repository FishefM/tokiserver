// Módulo de Navegación Dinámica para TokiDrive (SPA / 0 Archivos extra requeridos)

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const getBackendUrl = () => {
    const port = window.location.port;
    if (port && port !== '80' && port !== '443') {
        return `http://${window.location.hostname}:3000`;
    }
    return '';
};

// Determinar la carpeta actual basada en la URL (Query string, Hash o Path)
function getCurrentFolderFromUrl() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('folder')) {
            return decodeURIComponent(urlParams.get('folder')).replace(/^\/+|\/+$/g, '');
        }
        
        if (window.location.hash) {
            const rawHash = window.location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
            return decodeURIComponent(rawHash);
        }

        const path = window.location.pathname.replace(/\/$/, '');
        const driveMatch = path.match(/\/drive\/(.+)/);
        if (driveMatch && driveMatch[1] && !driveMatch[1].endsWith('.html')) {
            return decodeURIComponent(driveMatch[1]);
        }
    } catch (e) {}

    return '';
}

async function renderDriveView() {
    const currentFolder = getCurrentFolderFromUrl();
    const locationEl = document.getElementById('drive-location-tag');
    const backBtnEl = document.getElementById('drive-back-btn');
    const sectionTitleEl = document.getElementById('drive-section-title');
    const grid = document.getElementById('drive-folders-grid');
    const uploadHintEl = document.getElementById('upload-target-hint');
    const uploadCardEl = document.getElementById('upload-drop-card');

    if (uploadCardEl) {
        uploadCardEl.style.display = currentFolder ? 'flex' : 'none';
    }

    if (uploadHintEl) {
        uploadHintEl.textContent = currentFolder ? `Se guardarán en /${currentFolder}` : 'Subida desactivada en la raíz';
    }

    if (!grid) return;

    if (currentFolder) {
        if (locationEl) locationEl.textContent = `> LOCATION: CHIMALHUACAN / ${currentFolder.toUpperCase()}`;
        if (sectionTitleEl) {
            sectionTitleEl.innerHTML = `<span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/folder.svg'); mask-image: url('/img/icons/folder.svg');"></span> ARCHIVOS Y SUBDIRECTORIOS EN /${currentFolder}`;
        }
        if (backBtnEl) {
            const parts = currentFolder.split('/');
            parts.pop();
            const parentFolder = parts.join('/');
            backBtnEl.style.display = 'inline-flex';
            backBtnEl.href = parentFolder ? `?folder=${encodeURIComponent(parentFolder)}` : '/drive/';
            backBtnEl.onclick = (e) => {
                e.preventDefault();
                if (parentFolder) {
                    window.location.hash = `#/${parentFolder}`;
                } else {
                    window.location.href = '/drive/';
                }
            };
        }
    } else {
        if (locationEl) locationEl.textContent = '> LOCATION: CHIMALHUACAN';
        if (sectionTitleEl) {
            sectionTitleEl.innerHTML = `<span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/folder.svg'); mask-image: url('/img/icons/folder.svg');"></span> CARPETAS DE DESCARGA DISPONIBLES`;
        }
        if (backBtnEl) backBtnEl.style.display = 'none';
    }

    grid.innerHTML = '<div class="empty-notice">[ CARGANDO CONTENIDO... ]</div>';

    try {
        const res = await fetch(`${getBackendUrl()}/api/drive/list?folder=${encodeURIComponent(currentFolder)}`);
        const data = await res.json();

        if (!data.success || !data.items || data.items.length === 0) {
            grid.innerHTML = currentFolder ? 
                '<div class="empty-notice">[ ESTA CARPETA NO CONTIENE ARCHIVOS AÚN. ¡ARRASTRA Y SUELTA ARCHIVOS PARA AGREGARLOS! ]</div>' : 
                '<div class="empty-notice">[ NO HAY CARPETAS DISPONIBLES EN LA RAÍZ ]</div>';
            return;
        }

        grid.innerHTML = '';
        
        // Ordenar: Carpetas primero, luego archivos
        const sortedItems = [...data.items].sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));

        sortedItems.forEach(item => {
            const card = document.createElement('a');
            const subPath = currentFolder ? `${currentFolder}/${item.name}` : item.name;
            const escapedName = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const iconName = item.icon || (item.isDir ? 'folder' : 'file-text');
            const iconPath = `/img/icons/${iconName}.svg`;

            if (item.isDir) {
                card.href = `?folder=${encodeURIComponent(subPath)}`;
                card.onclick = (e) => {
                    e.preventDefault();
                    window.location.hash = `#/${subPath}`;
                };
                card.className = 'card dir-card';

                card.innerHTML = `
                    <div>
                        <div class="card-header">
                            <div class="card-icon-wrapper">
                                <span class="pixel-icon-mask" style="-webkit-mask-image: url('${iconPath}'); mask-image: url('${iconPath}');"></span>
                            </div>
                            <div class="card-header-actions">
                                <span class="card-route-tag">${formatBytes(item.size)}</span>
                                <button type="button" class="btn-card-menu" title="Opciones" onclick="event.preventDefault(); event.stopPropagation(); toggleCardMenu(this, '${escapedName}');">
                                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/more-vertical.svg'); mask-image: url('/img/icons/more-vertical.svg');"></span>
                                </button>
                            </div>
                        </div>
                        <h3 class="card-title">${item.name}</h3>
                        <p class="card-desc">${item.description || 'Subdirectorio de archivos'}</p>
                    </div>
                    <div class="card-btn">${currentFolder ? '[ EXPLORAR CARPETA ]' : '[ EXPLORAR ARCHIVOS ]'}</div>
                `;
            } else {
                card.href = `/drive/${subPath}`;
                card.className = 'card file-card';
                card.setAttribute('download', '');

                card.innerHTML = `
                    <div>
                        <div class="card-header file-header">
                            <div class="card-header-actions" style="margin-left: auto;">
                                <span class="card-route-tag">${formatBytes(item.size)}</span>
                                <button type="button" class="btn-card-menu" title="Opciones" onclick="event.preventDefault(); event.stopPropagation(); toggleCardMenu(this, '${escapedName}');">
                                    <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/more-vertical.svg'); mask-image: url('/img/icons/more-vertical.svg');"></span>
                                </button>
                            </div>
                        </div>
                        <h3 class="card-title" style="margin-top: 6px; margin-bottom: 20px;">${item.name}</h3>
                    </div>
                    <div class="card-btn">[ DESCARGAR ARCHIVO ]</div>
                `;
            }

            grid.appendChild(card);
        });

    } catch (err) {
        console.error('[DRIVE JS] Error al cargar contenido:', err);
        grid.innerHTML = '<div class="empty-notice">[ ERROR DE CONEXIÓN AL LEER EL SERVIDOR ]</div>';
    }
}

// ==================================================
// LÓGICA DE SUBIDA Y DRAG & DROP DE ARCHIVOS Y CARPETAS
// ==================================================

let statusBoxHideTimeout = null;

// Extrae recursivamente todos los archivos de ítems o carpetas arrastradas manteniendo la estructura relativa
async function parseDroppedItems(dataTransferItems) {
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

function uploadFiles(fileInputPayload) {
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

    // Normalizar lista de ítems a objetos { file, path }
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

    // IMPORTANTE: Enviar relativePaths y emptyDirs ANTES de los archivos en FormData
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

    xhr.timeout = 0; // Sin límite de tiempo en el cliente

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
    xhr.send(formData);
}

function initDragAndDrop() {
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

    // Estilos visuales de Hover en DropCard local
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

    // Manejador único de Drag & Drop Global en window
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

function initCreateFolderModal() {
    const openBtn = document.getElementById('btn-open-create-folder');
    const closeBtn = document.getElementById('btn-close-folder-modal');
    const modal = document.getElementById('create-folder-modal');
    const form = document.getElementById('create-folder-form');
    const nameInput = document.getElementById('new-folder-name');
    const urlInput = document.getElementById('new-folder-url');
    const descInput = document.getElementById('new-folder-desc');
    const iconInput = document.getElementById('selected-icon-input');
    const iconGrid = document.getElementById('icon-picker-grid');
    const locationHint = document.getElementById('create-folder-location-hint');

    const availableIcons = [
        'folder', 'gamepad', 'car', 'zap', 'movie', 
        'book-open', 'device-laptop', 'notes', 'sliders', 
        'lock', 'eye', 'user', 'search'
    ];

    // Renderizar grid de íconos disponibles
    if (iconGrid) {
        iconGrid.innerHTML = '';
        availableIcons.forEach(iconName => {
            const item = document.createElement('div');
            item.className = `icon-picker-item${iconName === 'folder' ? ' selected' : ''}`;
            item.dataset.icon = iconName;
            item.title = iconName;
            item.innerHTML = `<span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/${iconName}.svg'); mask-image: url('/img/icons/${iconName}.svg');"></span>`;
            
            item.addEventListener('click', () => {
                iconGrid.querySelectorAll('.icon-picker-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                if (iconInput) iconInput.value = iconName;
            });

            iconGrid.appendChild(item);
        });
    }

    // Auto-generar sugerencia de URL según el nombre ingresado
    if (nameInput && urlInput) {
        nameInput.addEventListener('input', () => {
            const currentFolder = getCurrentFolderFromUrl();
            const cleanSlug = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            const parentPrefix = currentFolder ? `/drive/${currentFolder}/` : '/drive/';
            urlInput.value = cleanSlug ? `${parentPrefix}${cleanSlug}/` : '';
        });
    }

    function openModal() {
        const currentFolder = getCurrentFolderFromUrl();
        if (locationHint) {
            locationHint.textContent = currentFolder ? `> DESTINO: /DRIVE/${currentFolder.toUpperCase()}` : '> DESTINO: /DRIVE (RAÍZ)';
        }
        if (nameInput) nameInput.value = '';
        if (urlInput) urlInput.value = '';
        if (descInput) descInput.value = '';
        if (iconInput) iconInput.value = 'folder';

        if (iconGrid) {
            iconGrid.querySelectorAll('.icon-picker-item').forEach(el => {
                el.classList.toggle('selected', el.dataset.icon === 'folder');
            });
        }

        if (modal) modal.style.display = 'flex';
        if (nameInput) nameInput.focus();
    }

    function closeModal() {
        if (modal) modal.style.display = 'none';
    }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const folderName = (nameInput ? nameInput.value : '').trim();
            const folderUrl = (urlInput ? urlInput.value : '').trim();
            const folderDesc = (descInput ? descInput.value : '').trim();
            const folderIcon = (iconInput ? iconInput.value : 'folder').trim();

            if (!folderName) return;

            const currentFolder = getCurrentFolderFromUrl();
            const statusBox = document.getElementById('upload-status-box');
            const statusText = document.getElementById('upload-status-text');

            closeModal();

            if (statusBox) statusBox.style.display = 'block';
            if (statusText) statusText.textContent = `[ CREANDO CARPETA "${folderName.toUpperCase()}"... ]`;

            try {
                const res = await fetch(`${getBackendUrl()}/api/drive/create-folder`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        parentFolder: currentFolder,
                        folderName: folderName,
                        url: folderUrl,
                        description: folderDesc,
                        icon: folderIcon
                    })
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    if (statusText) statusText.textContent = `[ ÉXITO ] ${data.message || 'Carpeta creada'}`;
                    renderDriveView();
                    setTimeout(() => {
                        if (statusBox) statusBox.style.display = 'none';
                    }, 3500);
                } else {
                    if (statusText) statusText.textContent = `[ ERROR ] ${data.error || 'No se pudo crear la carpeta'}`;
                    setTimeout(() => {
                        if (statusBox) statusBox.style.display = 'none';
                    }, 5000);
                }
            } catch (err) {
                console.error('[DRIVE CREATE FOLDER ERROR]', err);
                if (statusText) statusText.textContent = '[ ERROR ] ERROR DE CONEXIÓN AL CREAR CARPETA';
                setTimeout(() => {
                    if (statusBox) statusBox.style.display = 'none';
                }, 5000);
            }
        });
    }
}

// ==================================================
// GESTIÓN DE MENÚ Y ACCIONES (RENOMBRAR / ELIMINAR)
// ==================================================
let activeDropdownEl = null;
let currentItemTargetName = '';

function closeActiveCardMenu() {
    if (activeDropdownEl) {
        activeDropdownEl.remove();
        activeDropdownEl = null;
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.card-menu-dropdown') && !e.target.closest('.btn-card-menu')) {
        closeActiveCardMenu();
    }
});

function toggleCardMenu(btnEl, itemName) {
    if (activeDropdownEl && activeDropdownEl.dataset.targetName === itemName) {
        closeActiveCardMenu();
        return;
    }

    closeActiveCardMenu();

    const cardHeader = btnEl.closest('.card-header');
    if (!cardHeader) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'card-menu-dropdown';
    dropdown.dataset.targetName = itemName;

    const safeItemName = (itemName || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

    dropdown.innerHTML = `
        <button type="button" class="menu-item-btn" onclick="event.preventDefault(); event.stopPropagation(); triggerRename('${safeItemName}');">
            <span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/edit.svg'); mask-image: url('/img/icons/edit.svg'); width: 14px; height: 14px;"></span>
            [ RENOMBRAR ]
        </button>
        <button type="button" class="menu-item-btn danger" onclick="event.preventDefault(); event.stopPropagation(); triggerDelete('${safeItemName}');">
            <span class="pixel-icon-mask red" style="-webkit-mask-image: url('/img/icons/trash.svg'); mask-image: url('/img/icons/trash.svg'); width: 14px; height: 14px;"></span>
            [ ELIMINAR ]
        </button>
    `;

    cardHeader.appendChild(dropdown);
    activeDropdownEl = dropdown;
}

function triggerRename(itemName) {
    closeActiveCardMenu();
    currentItemTargetName = itemName;

    const modal = document.getElementById('rename-item-modal');
    const input = document.getElementById('rename-item-input');
    if (input) input.value = itemName;
    if (modal) modal.style.display = 'flex';
    if (input) input.focus();
}

function triggerDelete(itemName) {
    closeActiveCardMenu();
    currentItemTargetName = itemName;

    const modal = document.getElementById('delete-item-modal');
    const nameTag = document.getElementById('delete-item-name-tag');
    if (nameTag) nameTag.textContent = itemName;
    if (modal) modal.style.display = 'flex';
}

function initActionModals() {
    const renameModal = document.getElementById('rename-item-modal');
    const renameForm = document.getElementById('rename-item-form');
    const renameInput = document.getElementById('rename-item-input');
    const closeRenameBtn = document.getElementById('btn-close-rename-modal');

    const deleteModal = document.getElementById('delete-item-modal');
    const confirmDeleteBtn = document.getElementById('btn-confirm-delete');
    const closeDeleteBtn = document.getElementById('btn-close-delete-modal');

    if (closeRenameBtn) {
        closeRenameBtn.addEventListener('click', () => {
            if (renameModal) renameModal.style.display = 'none';
        });
    }

    if (closeDeleteBtn) {
        closeDeleteBtn.addEventListener('click', () => {
            if (deleteModal) deleteModal.style.display = 'none';
        });
    }

    if (renameModal) {
        renameModal.addEventListener('click', (e) => {
            if (e.target === renameModal) renameModal.style.display = 'none';
        });
    }

    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) deleteModal.style.display = 'none';
        });
    }

    if (renameForm) {
        renameForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = (renameInput ? renameInput.value : '').trim();
            if (!newName || newName === currentItemTargetName) {
                if (renameModal) renameModal.style.display = 'none';
                return;
            }

            const currentFolder = getCurrentFolderFromUrl();
            const statusBox = document.getElementById('upload-status-box');
            const statusText = document.getElementById('upload-status-text');

            if (renameModal) renameModal.style.display = 'none';
            if (statusBox) statusBox.style.display = 'block';
            if (statusText) statusText.textContent = `[ RENOMBRANDO "${currentItemTargetName.toUpperCase()}" A "${newName.toUpperCase()}"... ]`;

            try {
                const res = await fetch(`${getBackendUrl()}/api/drive/rename`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        folder: currentFolder,
                        oldName: currentItemTargetName,
                        newName: newName
                    })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    if (statusText) statusText.textContent = `[ ÉXITO ] ${data.message || 'Renombrado exitosamente'}`;
                    renderDriveView();
                    setTimeout(() => {
                        if (statusBox) statusBox.style.display = 'none';
                    }, 3500);
                } else {
                    if (statusText) statusText.textContent = `[ ERROR ] ${data.error || 'No se pudo renombrar'}`;
                    setTimeout(() => {
                        if (statusBox) statusBox.style.display = 'none';
                    }, 5000);
                }
            } catch (err) {
                console.error('[DRIVE RENAME ERROR]', err);
                if (statusText) statusText.textContent = '[ ERROR ] ERROR DE CONEXIÓN AL RENOMBRAR';
                setTimeout(() => {
                    if (statusBox) statusBox.style.display = 'none';
                }, 5000);
            }
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            const currentFolder = getCurrentFolderFromUrl();
            const statusBox = document.getElementById('upload-status-box');
            const statusText = document.getElementById('upload-status-text');

            if (deleteModal) deleteModal.style.display = 'none';
            if (statusBox) statusBox.style.display = 'block';
            if (statusText) statusText.textContent = `[ ELIMINANDO "${currentItemTargetName.toUpperCase()}"... ]`;

            try {
                const res = await fetch(`${getBackendUrl()}/api/drive/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        folder: currentFolder,
                        name: currentItemTargetName
                    })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    if (statusText) statusText.textContent = `[ ÉXITO ] ${data.message || 'Eliminado exitosamente'}`;
                    renderDriveView();
                    setTimeout(() => {
                        if (statusBox) statusBox.style.display = 'none';
                    }, 3500);
                } else {
                    if (statusText) statusText.textContent = `[ ERROR ] ${data.error || 'No se pudo eliminar'}`;
                    setTimeout(() => {
                        if (statusBox) statusBox.style.display = 'none';
                    }, 5000);
                }
            } catch (err) {
                console.error('[DRIVE DELETE ERROR]', err);
                if (statusText) statusText.textContent = '[ ERROR ] ERROR DE CONEXIÓN AL ELIMINAR';
                setTimeout(() => {
                    if (statusBox) statusBox.style.display = 'none';
                }, 5000);
            }
        });
    }
}

// Escuchar cambios de navegación (Hash o Recarga)
window.addEventListener('hashchange', renderDriveView);
window.addEventListener('popstate', renderDriveView);

document.addEventListener('DOMContentLoaded', () => {
    loadNavbar('/drive');
    initParticles();
    renderDriveView();
    initDragAndDrop();
    initCreateFolderModal();
    initActionModals();
});


