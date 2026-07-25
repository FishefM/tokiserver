import express from 'express';
import { loginUser, logoutUser, changePassword } from '../auth.js';
import { getClientIp, requireAuth } from '../middleware/authMiddleware.js';
import { logAudit } from '../services/auditService.js';

const router = express.Router();

// POST /api/login
router.post('/login', (req, res) => {
  const clientIp = getClientIp(req);
  const { username, password } = req.body;
  const result = loginUser(username, password);

  if (result.success) {
    console.log(`[AUDIT LOGIN] Inicio de sesión exitoso: ${result.username} desde IP: ${clientIp}`);
    logAudit(clientIp, 'LOGIN', true, 'Inicio de sesión exitoso', result.username);
    return res.json(result);
  } else {
    console.warn(`[AUDIT LOGIN FALLO] Intento fallido para usuario "${username}" desde IP: ${clientIp}`);
    logAudit(clientIp, 'LOGIN_FAILED', false, result.error, username || 'DESCONOCIDO');
    return res.status(401).json(result);
  }
});

// POST /api/logout
router.post('/logout', requireAuth, (req, res) => {
  const clientIp = getClientIp(req);
  logoutUser(req.token);
  logAudit(clientIp, 'LOGOUT', true, 'Cierre de sesión', req.user);
  res.json({ success: true, message: 'Sesión cerrada correctamente' });
});

// GET /api/me
router.get('/me', requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    username: req.user
  });
});

// POST /api/change-password
router.post('/change-password', requireAuth, (req, res) => {
  const clientIp = getClientIp(req);
  const { currentPassword, newPassword } = req.body;
  const result = changePassword(req.user, currentPassword, newPassword);

  if (result.success) {
    console.log(`[AUDIT PASSWORD_CHANGE] ${req.user} cambió su contraseña desde IP: ${clientIp}`);
    logAudit(clientIp, 'CHANGE_PASSWORD', true, 'Contraseña actualizada', req.user);
    return res.json(result);
  } else {
    console.warn(`[AUDIT PASSWORD_CHANGE FALLO] ${req.user} falló al cambiar contraseña desde IP: ${clientIp}`);
    logAudit(clientIp, 'CHANGE_PASSWORD_FAILED', false, result.error, req.user);
    return res.status(400).json(result);
  }
});

export default router;
