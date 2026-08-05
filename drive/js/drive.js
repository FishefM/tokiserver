// TokiDrive Main Module (Orquestador principal de TokiDrive)
import { renderDriveView, toggleCardMenu, closeActiveCardMenu } from './modules/driveUI.js';
import { initDragAndDrop } from './modules/driveUpload.js';
import { initCreateFolderModal, initActionModals, triggerRename, triggerDelete } from './modules/driveModals.js';

// Exponer funciones necesarias en window para controladores inline HTML (onclick, etc.)
window.toggleCardMenu = toggleCardMenu;
window.triggerRename = triggerRename;
window.triggerDelete = triggerDelete;

// Event listeners globales de cierre de menús contextuales
document.addEventListener('click', (e) => {
    if (!e.target.closest('.card-menu-dropdown') && !e.target.closest('.btn-card-menu')) {
        closeActiveCardMenu();
    }
});

// Escuchar cambios de navegación (Hash / Historial SPA)
window.addEventListener('hashchange', renderDriveView);
window.addEventListener('popstate', renderDriveView);

// Inicialización de TokiDrive al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.loadNavbar === 'function') {
        window.loadNavbar('/drive');
    }
    if (typeof window.initParticles === 'function') {
        window.initParticles();
    }
    renderDriveView();
    initDragAndDrop();
    initCreateFolderModal();
    initActionModals();
});
