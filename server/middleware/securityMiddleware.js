/**
 * securityMiddleware.js - Módulo de Protección Anti-DDoS, Rate Limiting y Blindaje de Servidor
 * Protege a TokiServer contra ataques de denegación de servicio, spam de yt-dlp y escáneres maliciosos.
 */

import rateLimit from 'express-rate-limit';
import { getClientIp } from './authMiddleware.js';

// Lista en memoria de IPs en "cárcel" temporal por escaneos maliciosos repetidos
const bannedIps = new Map(); // ip -> timestamp de expiración de ban
const violationCounts = new Map(); // ip -> { count, firstViolation }

/**
 * Verifica si una IP es de la red local o Tailscale para no aplicar limitaciones excesivas al anfitrión.
 */
function isInternalOrTailscaleIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.includes('Localhost') || ip.includes('Desconocida')) {
    return true;
  }
  if (ip.startsWith('100.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      const second = parseInt(parts[1], 10);
      if (second >= 64 && second <= 127) return true;
    }
  }
  return ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
}

/**
 * Middleware para bloquear inmediatamente IPs que están en la lista negra temporal (Jail).
 */
export function autoBanShield(req, res, next) {
  const clientIp = getClientIp(req);
  if (isInternalOrTailscaleIp(clientIp)) {
    return next();
  }

  const now = Date.now();
  if (bannedIps.has(clientIp)) {
    const banExpires = bannedIps.get(clientIp);
    if (now < banExpires) {
      return res.status(403).send('Forbidden - IP temporalmente bloqueada por actividad sospechosa.');
    } else {
      bannedIps.delete(clientIp);
      violationCounts.delete(clientIp);
    }
  }
  next();
}

// Patrones de archivos y rutas de exploits que ningún cliente legítimo debe solicitar
export const BLOCKED_EXPLOIT_PATTERNS = [
  /^\/\.env/i,
  /^\/\.git/i,
  /^\/\.ssh/i,
  /^\/\.vscode/i,
  /^\/\.yarn/i,
  /^\/node_modules\//i,
  /\.(php|asp|aspx|jsp|cgi|sql|db|key|pem|env|bak|old|swp|yaml|yml|sh|py|ini)$/i,
  /^\/(package\.json|package-lock\.json|tsconfig\.json)$/i,
  /^\/(actuator|kibana|_cat|debug|swagger|openapi|graphql|___proxy_subdomain)/i
];

/**
 * Middleware de detección de escaneos y auto-ban tras infracciones consecutivas.
 */
export function exploitScannerShield(req, res, next) {
  const clientIp = getClientIp(req);
  if (isInternalOrTailscaleIp(clientIp)) {
    return next();
  }

  const reqPath = req.path || '';

  for (const pattern of BLOCKED_EXPLOIT_PATTERNS) {
    if (pattern.test(reqPath)) {
      const now = Date.now();
      let record = violationCounts.get(clientIp) || { count: 0, firstViolation: now };

      // Reiniciar contador si la primera infracción ocurrió hace más de 5 minutos
      if (now - record.firstViolation > 5 * 60 * 1000) {
        record = { count: 0, firstViolation: now };
      }

      record.count += 1;
      violationCounts.set(clientIp, record);

      console.warn(`[EXPLOIT SCANNER] IP externa ${clientIp} intentó acceder a "${reqPath}" (coincidió con regla ${pattern}). Infracciones: ${record.count}/15`);

      // Si supera 15 intentos de exploit sospechosos en 5 minutos, banear por 15 minutos
      if (record.count >= 15) {
        bannedIps.set(clientIp, now + 15 * 60 * 1000);
        console.warn(`[AUTO-BAN JAIL] IP ${clientIp} bloqueada por 15 minutos tras ${record.count} intentos de exploit.`);
      }

      return res.status(403).send('Forbidden');
    }
  }
  next();
}

/**
 * Limitador Global Anti-DDoS (Protege todo el tráfico HTTP contra ataques de saturación).
 * Permite hasta 300 peticiones por minuto por IP (amplio para streaming y navegación).
 */
export const globalRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => isInternalOrTailscaleIp(getClientIp(req)),
  message: {
    success: false,
    error: 'DEMASIADAS SOLICITUDES: Has superado el limite de trafico por minuto. Espera un momento.'
  }
});

/**
 * Limitador para Búsquedas Web (Evita saturar el CPU del servidor con llamadas a yt-dlp).
 * Permite hasta 40 búsquedas por minuto por IP.
 */
export const searchRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => isInternalOrTailscaleIp(getClientIp(req)),
  message: {
    success: false,
    error: 'BUSQUEDAS LIMITADAS: Has realizado muchas busquedas en poco tiempo. Espera unos segundos.'
  }
});

/**
 * Limitador para Encolar Canciones en la Jam (Evita que un bot inunde la cola con spam).
 * Permite hasta 30 canciones añadidas por minuto por IP.
 */
export const jamQueueRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => isInternalOrTailscaleIp(getClientIp(req)),
  message: {
    success: false,
    error: 'COLA LIMITADA: Estas agregando canciones demasiado rapido. Espera unos segundos.'
  }
});
