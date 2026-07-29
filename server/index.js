import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PORT } from './config/constants.js';
import { getClientIp } from './middleware/authMiddleware.js';
import { getDb } from './db.js';

import authRoutes from './routes/authRoutes.js';
import commandRoutes from './routes/commandRoutes.js';
import statusRoutes from './routes/statusRoutes.js';

// Inicializar la base de datos SQLite cifrada al arrancar
getDb();

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

// Enrutadores API (Soporta proxy Nginx con o sin recorte de prefijo /api)
app.use('/api', authRoutes);
app.use('/', authRoutes);

app.use('/api/command', commandRoutes);
app.use('/command', commandRoutes);

app.use('/api/status', statusRoutes);
app.use('/status', statusRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`[TOKISERVER BACKEND ONLINE] Escuchando en el puerto ${PORT}`);
  console.log(`Disponible en entorno LAN: http://0.0.0.0:${PORT}`);
  console.log(`Base de datos cifrada activa (SQLCipher 4)`);
  console.log(`==================================================\n`);
});
