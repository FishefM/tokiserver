import 'dotenv/config';
import crypto from 'crypto';
import { getDb, saveUserPassword, getUserAsync } from '../db.js';

// Inicializar la conexión a la base de datos SQLCipher
getDb();

const [username, newPassword] = process.argv.slice(2);

if (!username || !newPassword) {
  console.log('\n❌ Uso del script:');
  console.log('   node scripts/set-password.js <usuario> <nueva_contraseña>\n');
  console.log('Ejemplo:');
  console.log('   node scripts/set-password.js Yucef "MiClave123"\n');
  process.exit(1);
}

async function run() {
  try {
    const user = await getUserAsync(username);
    if (!user) {
      console.log(`❌ Error: El usuario "${username}" no existe en la base de datos.`);
      process.exit(1);
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(newPassword, salt, 10000, 64, 'sha512').toString('hex');
    
    saveUserPassword(username, salt, hash, (err) => {
      if (err) {
        console.log(`❌ Error al actualizar la base de datos:`, err);
        process.exit(1);
      }
      console.log(`\n==================================================`);
      console.log(`✅ ¡Contraseña actualizada exitosamente en SQLCipher!`);
      console.log(`> Usuario: ${user.username}`);
      console.log(`> Nueva Contraseña: ${newPassword}`);
      console.log(`==================================================\n`);
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Error al consultar la base de datos:', err);
    process.exit(1);
  }
}

run();
