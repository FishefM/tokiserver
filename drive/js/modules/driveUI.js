import { formatBytes, getBackendUrl, getCurrentFolderFromUrl } from './driveUtils.js';
import { getToken } from '/js/auth.js';

let activeDropdownEl = null;

export function closeActiveCardMenu() {
    if (activeDropdownEl) {
        activeDropdownEl.remove();
        activeDropdownEl = null;
    }
}

export function toggleCardMenu(btnEl, itemName) {
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

export async function renderDriveView() {
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
        const token = getToken();
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch(`${getBackendUrl()}/api/drive/list?folder=${encodeURIComponent(currentFolder)}`, { headers });
        const data = await res.json();

        if (!data.success || !data.items || data.items.length === 0) {
            grid.innerHTML = currentFolder ? 
                '<div class="empty-notice">[ ESTA CARPETA NO CONTIENE ARCHIVOS AÚN. ¡ARRASTRA Y SUELTA ARCHIVOS PARA AGREGARLOS! ]</div>' : 
                '<div class="empty-notice">[ NO HAY CARPETAS DISPONIBLES EN LA RAÍZ ]</div>';
            return;
        }

        grid.innerHTML = '';
        
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
