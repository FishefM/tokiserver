import sqlite3 from '@journeyapps/sqlcipher';
import path from 'path';
import fs from 'fs';
import { DATA_DIR } from '../config/constants.js';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'tokiserver.sqlite');
let dbInstance = null;

/**
 * Retorna la instancia de conexión única a SQLCipher.
 */
export function getDbConnection() {
  if (dbInstance) return dbInstance;

  const dbPassword = process.env.DB_PASSWORD;
  if (!dbPassword) {
    console.warn('[SQLITE ALERTA] Variable DB_PASSWORD no definida en .env / PM2. Utilizando clave por defecto.');
  }

  const secretKey = dbPassword || 'tokiserver_db_secret_key_2026';
  dbInstance = new sqlite3.Database(DB_PATH);

  dbInstance.serialize(() => {
    dbInstance.run(`PRAGMA key = '${secretKey.replace(/'/g, "''")}'`);
    dbInstance.run('PRAGMA journal_mode = WAL');
  });

  return dbInstance;
}
