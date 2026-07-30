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
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('folder')) {
        return urlParams.get('folder').replace(/^\/+|\/+$/g, '');
    }
    
    if (window.location.hash) {
        return window.location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
    }

    const path = window.location.pathname.replace(/\/$/, '');
    const driveMatch = path.match(/\/drive\/(.+)/);
    if (driveMatch && driveMatch[1] && !driveMatch[1].endsWith('.html')) {
        return driveMatch[1];
    }

    return '';
}

async function renderDriveView() {
    const currentFolder = getCurrentFolderFromUrl();
    const locationEl = document.getElementById('drive-location-tag');
    const backBtnEl = document.getElementById('drive-back-btn');
    const sectionTitleEl = document.getElementById('drive-section-title');
    const grid = document.getElementById('drive-folders-grid');

    if (!grid) return;

    if (currentFolder) {
        // VISTA DE SUBDIRECTORIO / CARPETA ESPECÍFICA
        if (locationEl) locationEl.textContent = `> LOCATION: CHIMALHUACAN`;
        if (sectionTitleEl) sectionTitleEl.textContent = `🐒 ARCHIVOS Y SUBDIRECTORIOS EN /${currentFolder}`;
        
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

        grid.innerHTML = '<div class="empty-notice">[ CARGANDO ARCHIVOS DE LA CARPETA... ]</div>';

        try {
            const res = await fetch(`${getBackendUrl()}/api/drive/list?folder=${encodeURIComponent(currentFolder)}`);
            const data = await res.json();

            if (!data.success || !data.items || data.items.length === 0) {
                grid.innerHTML = '<div class="empty-notice">[ ESTA CARPETA NO CONTIENE ARCHIVOS PÚBLICOS ]</div>';
                return;
            }

            grid.innerHTML = '';
            
            // Ordenar: Carpetas primero, luego archivos
            const sortedItems = [...data.items].sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));

            sortedItems.forEach(item => {
                const card = document.createElement('a');
                const subPath = `${currentFolder}/${item.name}`;

                if (item.isDir) {
                    card.href = `?folder=${encodeURIComponent(subPath)}`;
                    card.onclick = (e) => {
                        e.preventDefault();
                        window.location.hash = `#/${subPath}`;
                    };
                    card.className = 'card dir-card';
                } else {
                    card.href = `/drive/${subPath}`;
                    card.className = 'card file-card';
                    card.setAttribute('download', '');
                }

                const iconName = item.isDir ? 'folder' : 'file-text';
                const iconPath = `/img/icons/${iconName}.svg`;
                const badgeText = item.isDir ? 'CARPETA' : formatBytes(item.size);
                const btnText = item.isDir ? '[ EXPLORAR CARPETA ]' : '[ DESCARGAR ARCHIVO ]';

                card.innerHTML = `
                    <div>
                        <div class="card-header">
                            <div class="card-icon-wrapper">
                                <span class="pixel-icon-mask" style="-webkit-mask-image: url('${iconPath}'); mask-image: url('${iconPath}');"></span>
                            </div>
                            <span class="card-route-tag">${badgeText}</span>
                        </div>
                        <h3 class="card-title">${item.name}</h3>
                        <p class="card-desc">${item.isDir ? 'Subdirectorio de archivos' : 'Archivo disponible para descarga'}</p>
                    </div>
                    <div class="card-btn">${btnText}</div>
                `;

                grid.appendChild(card);
            });

        } catch (err) {
            console.error('[DRIVE JS] Error al cargar subdirectorio:', err);
            grid.innerHTML = '<div class="empty-notice">[ ERROR DE CONEXIÓN AL LEER LA CARPETA ]</div>';
        }

    } else {
        // VISTA PRINCIPAL / ROOT DE DRIVE
        if (locationEl) locationEl.textContent = '> LOCATION: CHIMALHUACAN';
        if (sectionTitleEl) sectionTitleEl.textContent = ' 🐒 CARPETAS DE DESCARGA DISPONIBLES';
        if (backBtnEl) backBtnEl.style.display = 'none';

        grid.innerHTML = '<div class="empty-notice">[ CARGANDO CARPETAS DISPONIBLES... ]</div>';

        try {
            const res = await fetch('/config.json');
            const data = await res.json();

            if (!data || !data.driveFolders) return;

            grid.innerHTML = '';

            data.driveFolders.forEach(folder => {
                const card = document.createElement('a');
                const cleanRoute = folder.url.replace(/^\/drive\/?/, '').replace(/\/$/, '');
                
                card.href = `?folder=${encodeURIComponent(cleanRoute)}`;
                card.className = 'card';
                card.onclick = (e) => {
                    e.preventDefault();
                    window.location.hash = `#/${cleanRoute}`;
                };

                const iconName = folder.icon || 'folder';
                const iconPath = `/img/icons/${iconName}.svg`;

                card.innerHTML = `
                    <div>
                        <div class="card-header">
                            <div class="card-icon-wrapper">
                                <span class="pixel-icon-mask" style="-webkit-mask-image: url('${iconPath}'); mask-image: url('${iconPath}');"></span>
                            </div>
                            <span class="card-route-tag">${folder.url}</span>
                        </div>
                        <h3 class="card-title">${folder.name}</h3>
                        <p class="card-desc">${folder.description || 'Explorar archivos de descarga'}</p>
                    </div>
                    <div class="card-btn">[ EXPLORAR ARCHIVOS ]</div>
                `;

                grid.appendChild(card);
            });
        } catch (err) {
            console.error('[DRIVE JS] Error al cargar la vista raíz:', err);
        }
    }
}

// Escuchar cambios de navegación (Hash o Recarga)
window.addEventListener('hashchange', renderDriveView);
window.addEventListener('popstate', renderDriveView);

document.addEventListener('DOMContentLoaded', () => {
    loadNavbar('/drive');
    initParticles();
    renderDriveView();
});
