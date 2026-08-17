/**
 * geoMiddleware.js - Control de Acceso por Geolocalización (GeoIP)
 * Restringe las solicitudes públicas provenientes de internet únicamente a México (MX)
 * mientras permite siempre el tráfico interno de LAN y de la red privada de Tailscale.
 */

import geoip from 'geoip-lite';
import { getClientIp } from './authMiddleware.js';

// Lista de países permitidos (estrictamente México 'MX')
const ALLOWED_COUNTRIES = ['MX'];
const GEO_FILTER_ENABLED = true;

/**
 * Verifica si una IP pertenece a un rango privado, local o de la red Tailscale (100.64.0.0/10).
 */
function isPrivateOrTailscaleIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.includes('Localhost') || ip.includes('Desconocida')) {
    return true;
  }

  // Rango CGNAT / Tailscale (100.64.0.0 - 100.127.255.255)
  if (ip.startsWith('100.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      const secondOctet = parseInt(parts[1], 10);
      if (secondOctet >= 64 && secondOctet <= 127) {
        return true;
      }
    }
  }

  // Rangos de red local estándar (RFC 1918)
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return true;
  }

  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Middleware para bloquear solicitudes públicas fuera de las regiones permitidas.
 */
export function geoIpFilter(req, res, next) {
  if (!GEO_FILTER_ENABLED) {
    return next();
  }

  const clientIp = getClientIp(req);

  // Las IPs de Tailscale y red local siempre tienen acceso irrestricto
  if (isPrivateOrTailscaleIp(clientIp)) {
    return next();
  }

  // Consultar geolocalización para IPs públicas de internet
  try {
    const geo = geoip.lookup(clientIp);
    const country = geo ? geo.country : null;

    if (country && ALLOWED_COUNTRIES.includes(country)) {
      return next();
    }

    const time = new Date().toLocaleTimeString();
    console.warn(`[${time}] [GEO BLOCK] Peticion bloqueada desde ${country || 'Pais Desconocido'} (IP: ${clientIp}) -> ${req.method} ${req.url}`);

    return res.status(403).json({
      success: false,
      error: `ACCESO RESTRINGIDO: TokiServer solo acepta conexiones publicas desde ${ALLOWED_COUNTRIES.join(', ')}.`
    });
  } catch (err) {
    console.error('[GEOIP ERROR]', err);
    return next();
  }
}
