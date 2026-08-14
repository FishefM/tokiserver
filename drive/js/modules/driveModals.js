import { getBackendUrl, getCurrentFolderFromUrl } from './driveUtils.js';
import { renderDriveView, closeActiveCardMenu } from './driveUI.js';
import { getToken } from '/js/auth.js';

let currentItemTargetName = '';

export function triggerRename(itemName) {
    closeActiveCardMenu();
    currentItemTargetName = itemName;

    const modal = document.getElementById('rename-item-modal');
    const input = document.getElementById('rename-item-input');
    if (input) input.value = itemName;
    if (modal) modal.style.display = 'flex';
    if (input) input.focus();
}

export function triggerDelete(itemName) {
    closeActiveCardMenu();
    currentItemTargetName = itemName;

    const modal = document.getElementById('delete-item-modal');
    const nameTag = document.getElementById('delete-item-name-tag');
    if (nameTag) nameTag.textContent = itemName;
    if (modal) modal.style.display = 'flex';
}

export function initCreateFolderModal() {
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
                const token = getToken();
                const res = await fetch(`${getBackendUrl()}/api/drive/create-folder`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
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

export function initActionModals() {
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
                const token = getToken();
                const res = await fetch(`${getBackendUrl()}/api/drive/rename`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
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
                const token = getToken();
                const res = await fetch(`${getBackendUrl()}/api/drive/delete`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
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
