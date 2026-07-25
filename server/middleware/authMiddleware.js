import { verifySession } from '../auth.js';

// Extraer y limpiar dirección IP del cliente
export function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || req.ip;
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  if (ip === '::1') {
    ip = '127.0.0.1 (Localhost)';
  }
  return ip || 'IP Desconocida';
}

// Middleware de autenticación para requerir sesión válida en rutas protegidas
export function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.slice(7)
    : req.headers['x-auth-token'];

  const session = verifySession(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'NO_AUTORIZADO: Debes iniciar sesión en la pestaña de admin.',
      sessionExpired: true
    });
  }

  req.user = session.username;
  req.token = token;
  next();
}
