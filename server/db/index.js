import { getDbConnection } from './connection.js';
import { initSchema } from './schema.js';
import { runInitialSeed } from './seeders.js';
import { reloadCache } from './queries.js';

let initialized = false;

/**
 * Inicializa la base de datos SQLCipher, crea la estructura de tablas y efectúa el sembrado inicial.
 */
export function getDb() {
  const db = getDbConnection();
  if (!initialized) {
    initSchema(db);
    runInitialSeed(db);
    reloadCache();
    initialized = true;
    console.log('[SQLITE OK] Módulo de base de datos modular (SQLCipher 4) cargado e inicializado.');
  }
  return db;
}

export * from './queries.js';
