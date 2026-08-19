import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlRoot = path.join(__dirname, '..');

// Cargar .env ubicado en server/
dotenv.config({ path: path.join(__dirname, '.env') });

import { PORT } from './config/constants.js';
import { getClientIp } from './middleware/authMiddleware.js';
import { getDb } from './db.js';

import authRoutes from './routes/authRoutes.js';
import commandRoutes from './routes/commandRoutes.js';
import statusRoutes from './routes/statusRoutes.js';
import driveRoutes from './routes/driveRoutes.js';
import dorocoroRoutes from './routes/dorocoroRoutes.js';
import { autoBanShield, exploitScannerShield, globalRateLimiter } from './middleware/securityMiddleware.js';

// Inicializar la base de datos SQLite cifrada al arrancar
getDb();

const app = express();

// Confiar en cabeceras de proxy (Nginx / Tailscale Funnel X-Forwarded-For)
app.set('trust proxy', true);

// Middlewares globales de seguridad Anti-DDoS y Blindaje
app.use(autoBanShield);
app.use(exploitScannerShield);
app.use(globalRateLimiter);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logger HTTP en consola (omitiendo peticiones de audio de TokiTube/Dorocoro para mantener la consola y el panel de admin limpios)
app.use((req, res, next) => {
  if (req.url.startsWith('/tokitube') || req.url.startsWith('/api/tokitube') || req.url.startsWith('/dorocoro') || req.url.startsWith('/api/dorocoro')) {
    return next();
  }
  const clientIp = getClientIp(req);
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] HTTP ${req.method} ${req.url} desde IP: ${clientIp}`);
  next();
});

const DRIVE_ROOT = path.join(htmlRoot, 'drive');

// Servir archivos estáticos de Drive con soporte de rangos y CORS ANTES de enrutadores API
app.use('/drive', express.static(DRIVE_ROOT, {
  setHeaders: (res) => {
    res.set('Accept-Ranges', 'bytes');
    res.set('Access-Control-Allow-Origin', '*');
  }
}));

// Enrutadores API (Soporta proxy Nginx con o sin recorte de prefijo /api)
app.use('/api/tokitube', dorocoroRoutes);
app.use('/tokitube/api', dorocoroRoutes);
app.use('/api/dorocoro', dorocoroRoutes);
app.use('/dorocoro/api', dorocoroRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api', authRoutes);
app.use('/api/command', commandRoutes);
app.use('/api/status', statusRoutes);

app.use('/command', commandRoutes);
app.use('/status', statusRoutes);
app.use('/', authRoutes);

// Servir archivos del frontend
app.use(express.static(htmlRoot, { dotfiles: 'deny' }));

// Manejador 404 para rutas inexistentes y wildcards de subdominios
app.use((req, res) => {
  res.status(404);

  // Si la petición proviene de un navegador web (HTML)
  if (req.accepts('html')) {
    return res.sendFile(path.join(htmlRoot, '404.html'));
  }

  // Si es una petición JSON/API
  if (req.accepts('json')) {
    return res.json({ success: false, error: '404: Ruta o recurso no encontrado en TokiServer.' });
  }

  // Fallback en texto plano
  res.type('txt').send('404 Not Found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`[TOKISERVER BACKEND ONLINE] Escuchando en el puerto ${PORT}`);
  console.log(`Disponible en entorno LAN: http://0.0.0.0:${PORT}`);
  console.log(`Base de datos cifrada activa (SQLCipher 4)`);
  console.log(`==================================================\n`);
});
