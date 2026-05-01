import { Router } from 'express';
import { readFile } from 'fs/promises';
import { state } from '../core/state.js';
import { UPnPModule } from '../modules/upnp.js';

const router = Router();

/** GET /api/state — 当前状态快照 */
router.get('/state', (_req, res) => {
  res.json({ state: state.current, context: state.getContext() });
});

/** POST /api/play — 开始/恢复播放 */
router.post('/play', (req, res) => {
  res.json({ ok: true, action: 'play' });
  // 实际播放由 WebSocket CMD_PLAY 触发，此处仅 ACK
});

/** POST /api/mood — 更新心情（触发重新决策） */
router.post('/mood', (req, res) => {
  const { mood } = req.body ?? {};
  if (!mood) return res.status(400).json({ error: 'mood required' });
  state.updateContext({ mood });
  res.json({ ok: true, mood });
});

/** GET /api/devices — UPnP 设备列表 */
router.get('/devices', (req, res) => {
  const upnp = req.app.locals.upnp;
  const devices = upnp ? upnp.knownDevices : [];
  res.json({ devices });
});

/** POST /api/devices/scan — 触发 UPnP 重新扫描 */
router.post('/devices/scan', async (req, res) => {
  const upnp = req.app.locals.upnp;
  if (!upnp) return res.json({ devices: [] });
  const devices = await upnp.scan();
  res.json({ devices });
});

/** GET /api/health */
router.get('/health', (_req, res) => {
  res.json({ ok: true, state: state.current });
});

/** GET /api/upnp-file — 为 UPnP 设备提供本地文件 */
router.get('/upnp-file', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).send('Missing name');

  const fileMap = UPnPModule.getFileMap();
  const filePath = fileMap.get(name);

  if (!filePath) {
    // 也尝试直接以路径查找
    return res.status(404).send('File not found in UPnP mapping');
  }

  try {
    const content = await readFile(filePath);
    res.type('audio/mpeg').send(content);
  } catch {
    res.status(404).send('File not found');
  }
});

export { router as apiRouter };
