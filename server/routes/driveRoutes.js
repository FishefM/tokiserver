import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import {
  listDriveItems,
  createDriveFolder,
  renameDriveItem,
  deleteDriveItem
} from '../services/driveService.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DRIVE_ROOT = path.resolve(__dirname, '..', '..', 'drive');

// Configuración de almacenamiento para Multer (Soporta estructura de carpetas)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const rawFolder = (req.body.folder || req.query.folder || '').toString().trim();
    const safeFolder = rawFolder.replace(/\.\./g, '').replace(/^\/+/, '');

    if (!safeFolder) {
      return cb(new Error('No está permitido subir archivos a la raíz de Drive. Entra a una subcarpeta primero.'));
    }

    const targetDir = path.resolve(DRIVE_ROOT, safeFolder);

    if (!targetDir.startsWith(DRIVE_ROOT)) {
      return cb(new Error('Acceso denegado: Ruta fuera del directorio de Drive'));
    }

    let relativePaths = [];
    if (req.body.relativePaths) {
      try {
        relativePaths = JSON.parse(req.body.relativePaths);
      } catch (e) {
        if (Array.isArray(req.body.relativePaths)) {
          relativePaths = req.body.relativePaths;
        }
      }
    }

    if (typeof req._fileIndex === 'undefined') {
      req._fileIndex = 0;
    }

    const itemRelativePath = relativePaths[req._fileIndex] || file.originalname || '';
    req._fileIndex++;

    const rawPath = itemRelativePath.replace(/\\/g, '/');
    const relativeDir = path.dirname(rawPath);

    let finalDir = targetDir;
    if (relativeDir && relativeDir !== '.') {
      const safeRelative = relativeDir.replace(/\.\./g, '').replace(/^\/+/, '');
      finalDir = path.resolve(targetDir, safeRelative);
    }

    if (!finalDir.startsWith(targetDir)) {
      return cb(new Error('Acceso denegado: Intento de escape de directorio en subcarpeta'));
    }

    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }
    cb(null, finalDir);
  },
  filename: (req, file, cb) => {
    let relativePaths = [];
    if (req.body.relativePaths) {
      try {
        relativePaths = JSON.parse(req.body.relativePaths);
      } catch (e) {}
    }
    const idx = Math.max(0, (req._fileIndex || 1) - 1);
    const itemRelativePath = relativePaths[idx] || file.originalname || '';
    const rawPath = itemRelativePath.replace(/\\/g, '/');
    const safeName = path.basename(rawPath).replace(/[\/\\]/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10 GB max limit por archivo
});

// POST /api/drive/upload (Subida de archivos y recreación de estructuras de carpetas)
router.post('/upload', (req, res) => {
  if (req.socket) {
    req.socket.setTimeout(0);
  }

  upload.array('files')(req, res, (err) => {
    if (err) {
      if (err.message !== 'Request aborted') {
        console.error('[DRIVE UPLOAD ERROR]', err);
      }
      return res.status(400).json({ success: false, error: err.message || 'Error al procesar la subida del archivo' });
    }

    const targetFolder = (req.query.folder || req.body.folder || '').toString().trim();
    const safeFolder = targetFolder.replace(/\.\./g, '').replace(/^\/+/, '');
    const targetDir = path.resolve(DRIVE_ROOT, safeFolder);

    if (req.body.emptyDirs && targetDir.startsWith(DRIVE_ROOT)) {
      try {
        const emptyDirs = typeof req.body.emptyDirs === 'string' ? JSON.parse(req.body.emptyDirs) : req.body.emptyDirs;
        if (Array.isArray(emptyDirs)) {
          for (const dirPath of emptyDirs) {
            const safeDir = String(dirPath).replace(/\.\./g, '').replace(/^\/+/, '');
            const fullEmptyDir = path.resolve(targetDir, safeDir);
            if (fullEmptyDir.startsWith(targetDir) && !fs.existsSync(fullEmptyDir)) {
              fs.mkdirSync(fullEmptyDir, { recursive: true });
            }
          }
        }
      } catch (e) {
        console.error('[DRIVE EMPTY DIRS ERROR]', e);
      }
    }

    if ((!req.files || req.files.length === 0) && !req.body.emptyDirs) {
      return res.status(400).json({ success: false, error: 'No se enviaron archivos ni carpetas para subir' });
    }

    const uploadedFiles = req.files ? req.files.map(f => f.filename) : [];
    res.json({
      success: true,
      message: `${uploadedFiles.length} archivo(s) y carpetas procesadas exitosamente`,
      files: uploadedFiles,
      folder: targetFolder
    });
  });
});

// GET /api/drive/list?folder=... (Obtener contenido de la carpeta)
router.get('/list', (req, res) => {
  try {
    const rawFolder = (req.query.folder || '').toString().trim();
    const safeFolder = rawFolder.replace(/\.\./g, '').replace(/^\/+/, '');
    const data = listDriveItems(safeFolder, DRIVE_ROOT);

    res.json({
      success: true,
      folder: data.safeFolder,
      totalSize: data.totalSize,
      items: data.items
    });
  } catch (err) {
    console.error('[DRIVE LIST API ERROR]', err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error al leer el directorio de archivos' });
  }
});

// POST /api/drive/create-folder (Crear nueva carpeta)
router.post('/create-folder', (req, res) => {
  try {
    const rawParent = (req.body.parentFolder || req.query.parentFolder || '').toString().trim();
    const rawName = (req.body.folderName || req.body.name || '').toString().trim();
    const rawUrl = (req.body.url || '').toString().trim();
    const icon = (req.body.icon || 'folder').toString().trim();
    const description = (req.body.description || '').toString().trim();

    if (!rawName) {
      return res.status(400).json({ success: false, error: 'El nombre de la carpeta es obligatorio' });
    }

    const safeParent = rawParent.replace(/\.\./g, '').replace(/^\/+/, '');
    const safeName = rawName.replace(/[\/\\]/g, '_').replace(/\.\./g, '').trim();

    if (!safeName) {
      return res.status(400).json({ success: false, error: 'Nombre de carpeta inválido' });
    }

    let subRoute = safeName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (rawUrl) {
      const cleanUrl = rawUrl.replace(/^\/drive\/?/, '').replace(/\/$/, '');
      if (cleanUrl) subRoute = cleanUrl.replace(/[\/\\]/g, '_').replace(/\.\./g, '');
    }

    const result = createDriveFolder({
      safeParent,
      safeName,
      subRoute,
      description,
      icon,
      driveRoot: DRIVE_ROOT
    });

    res.json({
      success: true,
      message: `Carpeta "${result.safeName}" creada exitosamente`,
      folder: result.safeName,
      url: `/drive/${result.subRoute}/`,
      icon: result.icon
    });
  } catch (err) {
    console.error('[DRIVE CREATE FOLDER ERROR]', err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error interno al crear la carpeta' });
  }
});

// POST /api/drive/rename (Renombrar archivo o carpeta)
router.post('/rename', (req, res) => {
  try {
    const rawFolder = (req.body.folder || '').toString().trim();
    const oldName = (req.body.oldName || '').toString().trim();
    const newName = (req.body.newName || '').toString().trim();

    if (!oldName || !newName) {
      return res.status(400).json({ success: false, error: 'El nombre actual y nuevo nombre son requeridos' });
    }

    const safeFolder = rawFolder.replace(/\.\./g, '').replace(/^\/+/, '');
    const safeOldName = oldName.replace(/[\/\\]/g, '_').replace(/\.\./g, '').trim();
    const safeNewName = newName.replace(/[\/\\]/g, '_').replace(/\.\./g, '').trim();

    const result = renameDriveItem({
      safeFolder,
      safeOldName,
      safeNewName,
      driveRoot: DRIVE_ROOT
    });

    res.json({ success: true, message: `Elemento renombrado a "${result.safeNewName}"` });
  } catch (err) {
    console.error('[DRIVE RENAME ERROR]', err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error al renombrar el elemento' });
  }
});

// POST /api/drive/delete (Eliminar archivo o carpeta)
router.post('/delete', (req, res) => {
  try {
    const rawFolder = (req.body.folder || '').toString().trim();
    const name = (req.body.name || '').toString().trim();

    if (!name) {
      return res.status(400).json({ success: false, error: 'El nombre del elemento es requerido' });
    }

    const safeFolder = rawFolder.replace(/\.\./g, '').replace(/^\/+/, '');
    const safeName = name.replace(/[\/\\]/g, '_').replace(/\.\./g, '').trim();

    const result = deleteDriveItem({
      safeFolder,
      safeName,
      driveRoot: DRIVE_ROOT
    });

    res.json({ success: true, message: `Elemento "${result.safeName}" eliminado exitosamente` });
  } catch (err) {
    console.error('[DRIVE DELETE ERROR]', err);
    res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error al eliminar el elemento' });
  }
});

export default router;
