import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DRIVE_ROOT = path.resolve(__dirname, '..', '..', 'drive');

// Configuración de almacenamiento para Multer
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

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/[\/\\]/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB max limit por archivo
});

// POST /api/drive/upload (Soporta múltiples archivos y especificación de carpeta objetivo)
router.post('/upload', (req, res) => {
  if (req.socket) {
    req.socket.setTimeout(0); // Evitar timeout prematuro en conexiones móviles/LAN
  }

  upload.array('files')(req, res, (err) => {
    if (err) {
      if (err.message !== 'Request aborted') {
        console.error('[DRIVE UPLOAD ERROR]', err);
      }
      return res.status(400).json({ success: false, error: err.message || 'Error al procesar la subida del archivo' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No se enviaron archivos para subir' });
    }

    const uploadedFiles = req.files.map(f => f.filename);
    const targetFolder = (req.query.folder || req.body.folder || '').toString().trim();
    res.json({
      success: true,
      message: `${uploadedFiles.length} archivo(s) subido(s) exitosamente`,
      files: uploadedFiles,
      folder: targetFolder
    });
  });
});

// POST /api/drive/create-folder (Creación de subdirectorios y carpetas raíz)
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

    // Calcular sub-directorio físico
    let subRoute = safeName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (rawUrl) {
      const cleanUrl = rawUrl.replace(/^\/drive\/?/, '').replace(/\/$/, '');
      if (cleanUrl) subRoute = cleanUrl.replace(/[\/\\]/g, '_').replace(/\.\./g, '');
    }

    const targetDir = path.resolve(DRIVE_ROOT, safeParent, subRoute);

    if (!targetDir.startsWith(DRIVE_ROOT)) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: Ruta fuera de Drive' });
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Si la carpeta se crea en la raíz (/drive), registrar también en config.json
    if (!safeParent) {
      const configPath = path.resolve(__dirname, '..', '..', 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (!configData.driveFolders) configData.driveFolders = [];

          const formattedUrl = `/drive/${subRoute}/`;

          const existingIdx = configData.driveFolders.findIndex(f => f.url === formattedUrl || f.url === `/drive/${subRoute}`);
          const folderObj = {
            name: safeName,
            url: formattedUrl,
            description: description || `Carpeta de ${safeName}`,
            icon: icon || 'folder'
          };

          if (existingIdx >= 0) {
            configData.driveFolders[existingIdx] = folderObj;
          } else {
            configData.driveFolders.push(folderObj);
          }

          fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
        } catch (cfgErr) {
          console.error('[DRIVE CONFIG UPDATE ERROR]', cfgErr);
        }
      }
    }

    res.json({
      success: true,
      message: `Carpeta "${safeName}" creada exitosamente`,
      folder: safeName,
      url: `/drive/${subRoute}/`,
      icon: icon
    });
  } catch (err) {
    console.error('[DRIVE CREATE FOLDER ERROR]', err);
    res.status(500).json({ success: false, error: 'Error interno al crear la carpeta' });
  }
});

function getFolderSize(dirPath) {
  let totalSize = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'index.html' || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += getFolderSize(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          totalSize += stats.size;
        } catch (e) {}
      }
    }
  } catch (e) {}
  return totalSize;
}

// GET /api/drive/list?folder=pvz
router.get('/list', (req, res) => {
  try {
    // Sanitizar la ruta para evitar directory traversal
    const rawFolder = (req.query.folder || '').toString().trim();
    const safeFolder = rawFolder.replace(/\.\./g, '').replace(/^\/+/, '');
    const targetDir = path.resolve(DRIVE_ROOT, safeFolder);

    if (!targetDir.startsWith(DRIVE_ROOT) || !fs.existsSync(targetDir)) {
      return res.status(404).json({ success: false, error: 'Carpeta no encontrada en TokiDrive' });
    }

    let overallSize = 0;

    const items = fs.readdirSync(targetDir, { withFileTypes: true })
      .filter(item => item.name !== 'index.html' && !item.name.startsWith('.'))
      .map(item => {
        const itemPath = path.join(targetDir, item.name);
        const isDir = item.isDirectory();
        let size = 0;
        let mtime = new Date();
        try {
          if (isDir) {
            size = getFolderSize(itemPath);
          } else {
            const stats = fs.statSync(itemPath);
            size = stats.size;
            mtime = stats.mtime;
          }
        } catch (e) {}

        overallSize += size;

        return {
          name: item.name,
          isDir,
          size,
          updatedAt: mtime
        };
      });

    res.json({
      success: true,
      folder: safeFolder,
      totalSize: overallSize,
      items
    });
  } catch (err) {
    console.error('[DRIVE API ERROR]', err);
    res.status(500).json({ success: false, error: 'Error al leer el directorio de archivos' });
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

    const oldPath = path.resolve(DRIVE_ROOT, safeFolder, safeOldName);
    const newPath = path.resolve(DRIVE_ROOT, safeFolder, safeNewName);

    if (!oldPath.startsWith(DRIVE_ROOT) || !newPath.startsWith(DRIVE_ROOT)) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: Ruta fuera de Drive' });
    }

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ success: false, error: 'El elemento a renombrar no existe' });
    }

    if (fs.existsSync(newPath)) {
      return res.status(400).json({ success: false, error: 'Ya existe un elemento con el nuevo nombre' });
    }

    fs.renameSync(oldPath, newPath);

    // Si es carpeta raíz, actualizar config.json
    if (!safeFolder) {
      const configPath = path.resolve(__dirname, '..', '..', 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (configData.driveFolders) {
            const oldSlug = safeOldName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            const newSlug = safeNewName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            const idx = configData.driveFolders.findIndex(f => f.name === safeOldName || f.url.includes(`/${oldSlug}`));
            if (idx >= 0) {
              configData.driveFolders[idx].name = safeNewName;
              configData.driveFolders[idx].url = `/drive/${newSlug}/`;
              fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
            }
          }
        } catch (e) {}
      }
    }

    res.json({ success: true, message: `Elemento renombrado a "${safeNewName}"` });
  } catch (err) {
    console.error('[DRIVE RENAME ERROR]', err);
    res.status(500).json({ success: false, error: 'Error al renombrar el elemento' });
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

    const targetPath = path.resolve(DRIVE_ROOT, safeFolder, safeName);

    if (!targetPath.startsWith(DRIVE_ROOT)) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: Ruta fuera de Drive' });
    }

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, error: 'El elemento a eliminar no existe' });
    }

    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }

    // Si es carpeta raíz, eliminar de config.json
    if (!safeFolder) {
      const configPath = path.resolve(__dirname, '..', '..', 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (configData.driveFolders) {
            const slug = safeName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            configData.driveFolders = configData.driveFolders.filter(f => f.name !== safeName && !f.url.includes(`/${slug}`));
            fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
          }
        } catch (e) {}
      }
    }

    res.json({ success: true, message: `Elemento "${safeName}" eliminado exitosamente` });
  } catch (err) {
    console.error('[DRIVE DELETE ERROR]', err);
    res.status(500).json({ success: false, error: 'Error al eliminar el elemento' });
  }
});

export default router;

