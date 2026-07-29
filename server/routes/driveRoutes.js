import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DRIVE_ROOT = path.join(__dirname, '..', '..', 'drive');

// GET /api/drive/list?folder=pvz
router.get('/list', (req, res) => {
  try {
    // Sanitizar la ruta para evitar directory traversal
    const rawFolder = (req.query.folder || '').toString().trim();
    const safeFolder = rawFolder.replace(/\.\./g, '').replace(/^\/+/, '');
    const targetDir = path.join(DRIVE_ROOT, safeFolder);

    if (!targetDir.startsWith(DRIVE_ROOT) || !fs.existsSync(targetDir)) {
      return res.status(404).json({ success: false, error: 'Carpeta no encontrada en TokiDrive' });
    }

    const items = fs.readdirSync(targetDir, { withFileTypes: true })
      .filter(item => item.name !== 'index.html' && !item.name.startsWith('.'))
      .map(item => {
        const itemPath = path.join(targetDir, item.name);
        let size = 0;
        let mtime = new Date();
        try {
          const stats = fs.statSync(itemPath);
          size = stats.size;
          mtime = stats.mtime;
        } catch (e) {}

        return {
          name: item.name,
          isDir: item.isDirectory(),
          size,
          updatedAt: mtime
        };
      });

    res.json({
      success: true,
      folder: safeFolder,
      items
    });
  } catch (err) {
    console.error('[DRIVE API ERROR]', err);
    res.status(500).json({ success: false, error: 'Error al leer el directorio de archivos' });
  }
});

export default router;
