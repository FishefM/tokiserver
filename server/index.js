import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT } from './config/constants.js';
import { getClientIp } from './middleware/authMiddleware.js';
import { getDb } from './db.js';

import authRoutes from './routes/authRoutes.js';
import commandRoutes from './routes/commandRoutes.js';
import statusRoutes from './routes/statusRoutes.js';
import driveRoutes from './routes/driveRoutes.js';
import dorocoroRoutes from './routes/dorocoroRoutes.js';
import { geoIpFilter } from './middleware/geoMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlRoot = path.join(__dirname, '..');

// Inicializar la base de datos SQLite cifrada al arrancar
getDb();

const app = express();

// Confiar en cabeceras de proxy (Nginx X-Forwarded-For)
app.set('trust proxy', true);

// Middlewares globales
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de Seguridad: Bloqueo de escaneos de bots, exploits y rutas sensibles
const BLOCKED_PATTERNS = [
  /^\/\.env/i,
  /^\/\.git/i,
  /^\/\.ssh/i,
  /^\/\.vscode/i,
  /^\/\.yarn/i,
  /^\/server\//i,
  /^\/node_modules\//i,
  /\.(php|asp|aspx|jsp|cgi|exe|sql|db|key|pem|env|bak|old|swp|lock|yaml|yml|sh|py|config|ini)$/i,
  /^\/(package\.json|package-lock\.json|config\.json|tsconfig\.json)$/i
];

app.use((req, res, next) => {
  const reqPath = req.path;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(reqPath)) {
      return res.status(403).send('Forbidden');
    }
  }
  next();
});

// Middleware de Geolocalización (GeoIP): Restringir acceso público solo a México (MX)
app.use(geoIpFilter);

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`[TOKISERVER BACKEND ONLINE] Escuchando en el puerto ${PORT}`);
  console.log(`Disponible en entorno LAN: http://0.0.0.0:${PORT}`);
  console.log(`Base de datos cifrada activa (SQLCipher 4)`);
  console.log(`==================================================\n`);
});
