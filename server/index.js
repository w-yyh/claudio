/**
 * Claudio — AI DJ Server
 * Phase 2: Express HTTP + WebSocket 服务器
 *
 * 支持两种启动模式：
 *   服务器模式（默认）：node server/index.js
 *   CLI 模式：        node server/index.js --mood "有点累"
 */

import 'dotenv/config';
import { createServer } from 'http';
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { Player } from './core/player.js';
import { UPnPModule } from './modules/upnp.js';
import { apiRouter } from './routes/api.js';
import { setupWebSocket } from './routes/ws.js';
import { state } from './core/state.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const moodIdx = args.indexOf('--mood');
const cliMood = moodIdx !== -1 ? args[moodIdx + 1] : undefined;
const cliMode = moodIdx !== -1;

// ── 初始化模块 ───────────────────────────────────────────────────────────────
const upnp   = new UPnPModule();
const player = new Player();
await player.init();

if (cliMode) {
  // ── CLI 模式：直接播一次退出 ─────────────────────────────────────────────
  console.log('🎙  Claudio CLI mode');
  if (cliMood) console.log(`   Mood: ${cliMood}`);
  await player.startSession(cliMood);
  console.log('[Claudio] Done.');
  process.exit(0);
}

// ── 服务器模式 ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(join(__dir, '../client')));

// 将共享资源注入 app.locals（路由可用 req.app.locals 访问）
app.locals.upnp   = upnp;
app.locals.player = player;

app.use('/api', apiRouter);

const httpServer = createServer(app);
const wss = setupWebSocket(httpServer, player, upnp);

httpServer.listen(config.server.port, () => {
  console.log(`🎙  Claudio server running on http://localhost:${config.server.port}`);
  console.log(`   WebSocket: ws://localhost:${config.server.port}`);
  console.log('   Press Ctrl+C to stop.');
});

// 启动时后台扫描 UPnP 设备
upnp.scan().then((devices) => {
  if (devices.length) {
    console.log(`[UPnP] Found ${devices.length} device(s):`, devices.map((d) => d.friendlyName).join(', '));
  }
}).catch(() => {});

// 优雅退出
process.on('SIGINT', async () => {
  console.log('\n[Claudio] Shutting down...');
  await player.skip().catch(() => {});
  httpServer.close(() => process.exit(0));
});
