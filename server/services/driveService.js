import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config.json');

/**
 * Calcula recursivamente el tamaño en bytes de un directorio
 */
export function getFolderSize(dirPath) {
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

/**
 * Lista directorios y archivos de una carpeta en TokiDrive combinando el filesystem y config.json
 */
export function listDriveItems(safeFolder, driveRoot) {
  const targetDir = path.resolve(driveRoot, safeFolder);

  if (!targetDir.startsWith(driveRoot) || !fs.existsSync(targetDir)) {
    throw new Error('Carpeta no encontrada en TokiDrive');
  }

  let configFolders = [];
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (configData && configData.driveFolders) {
        configFolders = configData.driveFolders;
      }
    } catch (e) {}
  }

  let overallSize = 0;
  const itemsMap = new Map();

  const physicalItems = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter(item => item.name !== 'index.html' && !item.name.startsWith('.') && item.name !== 'css' && item.name !== 'js');

  physicalItems.forEach(item => {
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

    let icon = isDir ? 'folder' : 'file-text';
    let description = isDir ? 'Subdirectorio de archivos' : 'Archivo disponible para descarga';

    if (!safeFolder && isDir) {
      const cfg = configFolders.find(f => {
        const cfgClean = f.url.replace(/^\/drive\/?/, '').replace(/\/$/, '');
        return f.name.toLowerCase() === item.name.toLowerCase() || cfgClean.toLowerCase() === item.name.toLowerCase();
      });
      if (cfg) {
        if (cfg.icon) icon = cfg.icon;
        if (cfg.description) description = cfg.description;
      }
    }

    itemsMap.set(item.name.toLowerCase(), {
      name: item.name,
      isDir,
      size,
      icon,
      description,
      updatedAt: mtime
    });
  });

  if (!safeFolder) {
    configFolders.forEach(cfg => {
      const cleanRoute = cfg.url.replace(/^\/drive\/?/, '').replace(/\/$/, '');
      const folderName = cfg.name || cleanRoute;
      const key = folderName.toLowerCase();

      if (!itemsMap.has(key) && !itemsMap.has(cleanRoute.toLowerCase())) {
        const folderPath = path.join(driveRoot, cleanRoute);
        let folderSize = 0;
        if (fs.existsSync(folderPath)) {
          folderSize = getFolderSize(folderPath);
        }
        itemsMap.set(key, {
          name: folderName,
          isDir: true,
          size: folderSize,
          icon: cfg.icon || 'folder',
          description: cfg.description || 'Carpeta de archivos',
          updatedAt: new Date()
        });
      }
    });
  }

  return {
    safeFolder,
    totalSize: overallSize,
    items: Array.from(itemsMap.values())
  };
}

/**
 * Crea una nueva carpeta físicamente y actualiza config.json si es carpeta raíz
 */
export function createDriveFolder({ safeParent, safeName, subRoute, description, icon, driveRoot }) {
  const targetDir = path.resolve(driveRoot, safeParent, subRoute);

  if (!targetDir.startsWith(driveRoot)) {
    throw new Error('Acceso denegado: Ruta fuera de Drive');
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (!safeParent && fs.existsSync(CONFIG_PATH)) {
    try {
      const configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
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

      fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf8');
    } catch (cfgErr) {
      console.error('[DRIVE CONFIG UPDATE ERROR]', cfgErr);
    }
  }

  return {
    safeName,
    subRoute,
    icon
  };
}

/**
 * Renombra un archivo o carpeta en TokiDrive y actualiza config.json si aplica
 */
export function renameDriveItem({ safeFolder, safeOldName, safeNewName, driveRoot }) {
  const oldPath = path.resolve(driveRoot, safeFolder, safeOldName);
  const newPath = path.resolve(driveRoot, safeFolder, safeNewName);

  if (!oldPath.startsWith(driveRoot) || !newPath.startsWith(driveRoot)) {
    throw new Error('Acceso denegado: Ruta fuera de Drive');
  }

  if (!fs.existsSync(oldPath)) {
    const err = new Error('El elemento a renombrar no existe');
    err.statusCode = 404;
    throw err;
  }

  if (fs.existsSync(newPath)) {
    const err = new Error('Ya existe un elemento con el nuevo nombre');
    err.statusCode = 400;
    throw err;
  }

  fs.renameSync(oldPath, newPath);

  if (!safeFolder && fs.existsSync(CONFIG_PATH)) {
    try {
      const configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (configData.driveFolders) {
        const oldSlug = safeOldName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const newSlug = safeNewName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const idx = configData.driveFolders.findIndex(f => f.name === safeOldName || f.url.includes(`/${oldSlug}`));
        if (idx >= 0) {
          configData.driveFolders[idx].name = safeNewName;
          configData.driveFolders[idx].url = `/drive/${newSlug}/`;
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf8');
        }
      }
    } catch (e) {}
  }

  return { safeNewName };
}

/**
 * Elimina recursivamente un archivo o carpeta en TokiDrive y actualiza config.json si aplica
 */
export function deleteDriveItem({ safeFolder, safeName, driveRoot }) {
  const targetPath = path.resolve(driveRoot, safeFolder, safeName);

  if (!targetPath.startsWith(driveRoot)) {
    throw new Error('Acceso denegado: Ruta fuera de Drive');
  }

  if (!fs.existsSync(targetPath)) {
    const err = new Error('El elemento a eliminar no existe');
    err.statusCode = 404;
    throw err;
  }

  const stats = fs.statSync(targetPath);
  if (stats.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }

  if (!safeFolder && fs.existsSync(CONFIG_PATH)) {
    try {
      const configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (configData.driveFolders) {
        const slug = safeName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        configData.driveFolders = configData.driveFolders.filter(f => f.name !== safeName && !f.url.includes(`/${slug}`));
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf8');
      }
    } catch (e) {}
  }

  return { safeName };
}
