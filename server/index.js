import express from 'express';
import cors from 'cors';
import { PORT, LOGS_DIR } from './config/constants.js';
import { getClientIp } from './middleware/authMiddleware.js';

import authRoutes from './routes/authRoutes.js';
import commandRoutes from './routes/commandRoutes.js';
import statusRoutes from './routes/statusRoutes.js';

const app = express();

// Confiar en cabeceras de proxy (Nginx X-Forwarded-For)
app.set('trust proxy', true);

// Middlewares globales
app.use(cors());
app.use(express.json());

// Logger HTTP en consola
app.use((req, res, next) => {
  const clientIp = getClientIp(req);
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] HTTP ${req.method} ${req.url} desde IP: ${clientIp}`);
  next();
});

// Enrutadores API
app.use('/api', authRoutes);
app.use('/api/command', commandRoutes);
app.use('/api/status', statusRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`[TOKISERVER BACKEND ONLINE] Escuchando en el puerto ${PORT}`);
  console.log(`Disponible en entorno LAN: http://0.0.0.0:${PORT}`);
  console.log(`Directorio de logs diarios activado en: ${LOGS_DIR}`);
  console.log(`==================================================\n`);
});
