import express from 'express';
import { getClientIp } from '../middleware/authMiddleware.js';
import { getMinecraftStatus, getCorekeeperStatus } from '../services/systemService.js';

const router = express.Router();

// GET /api/status
router.get('/', async (req, res) => {
  const clientIp = getClientIp(req);
  const mcStatus = await getMinecraftStatus();
  const ckStatus = await getCorekeeperStatus();

  res.json({
    status: 'ONLINE',
    service: 'Tokiserver Admin Backend',
    clientIp,
    minecraft: mcStatus,
    corekeeper: ckStatus,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

export default router;
