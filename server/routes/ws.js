import { WebSocketServer } from 'ws';
import { state } from '../core/state.js';
import { eventBus } from '../core/event-bus.js';

/**
 * WebSocket 消息协议
 *
 * 服务端 → 客户端：
 *   STATE_CHANGE  { prev, next, context }
 *   TRACK_UPDATE  { track }
 *   DJ_SCRIPT     { text }
 *   PROGRESS      { elapsed, duration }
 *   DEVICE_LIST   { devices }
 *   ERROR         { message }
 *
 * 客户端 → 服务端：
 *   CMD_PLAY    {}
 *   CMD_PAUSE   {}
 *   CMD_SKIP    {}
 *   CMD_VOLUME  { level }
 *   CMD_MOOD    { mood }
 *   CMD_TARGET  { target, deviceUrl? }
 */
export function setupWebSocket(server, player, upnp) {
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  // ── 广播工具 ──────────────────────────────────────────────────────────────
  function broadcast(type, payload = {}) {
    const msg = JSON.stringify({ type, ...payload });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  // ── 内部事件 → 广播 ───────────────────────────────────────────────────────
  let lastDJScript = '';
  let lastTrackId = '';

  eventBus.on('STATE_CHANGE', ({ prev, next, context }) => {
    broadcast('STATE_CHANGE', { prev, next, context });
    if (context.currentTrack && context.currentTrack.id !== lastTrackId) {
      lastTrackId = context.currentTrack.id;
      broadcast('TRACK_UPDATE', { track: context.currentTrack });
    }
    if (context.djScript && context.djScript !== lastDJScript) {
      lastDJScript = context.djScript;
      broadcast('DJ_SCRIPT', { text: context.djScript });
    }
  });

  eventBus.on('DJ_SCRIPT_READY', ({ text }) => {
    if (text && text !== lastDJScript) {
      lastDJScript = text;
      broadcast('DJ_SCRIPT', { text });
    }
  });

  eventBus.on('PLAYBACK_STARTED', () => {
    broadcast('PROGRESS', { elapsed: 0, duration: state.getContext().currentTrack?.duration ?? 0 });
  });

  eventBus.on('UPNP_FALLBACK', () => {
    broadcast('ERROR', { message: 'UPnP 设备断联，已切换到本地播放' });
  });

  // ── 客户端连接 ────────────────────────────────────────────────────────────
  wss.on('connection', (ws) => {
    clients.add(ws);

    // 发送当前状态快照给新连接的客户端
    ws.send(JSON.stringify({
      type: 'STATE_CHANGE',
      prev: null,
      next: state.current,
      context: state.getContext(),
    }));

    if (upnp) {
      ws.send(JSON.stringify({ type: 'DEVICE_LIST', devices: upnp.knownDevices }));
    }

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' })); return; }

      try {
        await handleCommand(msg, player, upnp, broadcast);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return wss;
}

async function handleCommand(msg, player, upnp, broadcast) {
  switch (msg.type) {
    case 'CMD_PLAY':
      if (state.current === 'IDLE') {
        player.startSession(state.getContext().mood).catch(console.error);
      } else if (state.current === 'PAUSE') {
        await player.resume();
      }
      break;

    case 'CMD_PAUSE':
      await player.pause();
      break;

    case 'CMD_SKIP':
      await player.skip();
      break;

    case 'CMD_VOLUME': {
      const level = Number(msg.level);
      if (!isNaN(level)) {
        state.updateContext({ volume: level });
        await player.setVolume(level);
      }
      break;
    }

    case 'CMD_SEEK': {
      const secs = Number(msg.seconds);
      if (!isNaN(secs) && secs >= 0) {
        await player.seekTo(secs);
      }
      break;
    }

    case 'CMD_MOOD':
      if (msg.mood) {
        state.updateContext({ mood: msg.mood });
        if (state.current === 'IDLE') {
          player.startSession(msg.mood).catch(console.error);
        }
      }
      break;

    case 'CMD_TARGET':
      if (msg.target === 'local' || msg.target === 'upnp') {
        const deviceUrl = msg.deviceUrl ?? null;
        state.updateContext({ target: msg.target, upnpDevice: deviceUrl });
        player.setTarget(msg.target, msg.target === 'upnp' ? upnp : null, deviceUrl);
      }
      break;

    case 'CMD_SCAN_DEVICES':
      if (upnp) {
        const devices = await upnp.scan();
        broadcast('DEVICE_LIST', { devices });
      }
      break;

    default:
      throw new Error(`Unknown command: ${msg.type}`);
  }
}
