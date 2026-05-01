import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { eventBus } from './event-bus.js';

const PLATFORM = process.platform;
const __dir = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dir, '../../bin');

function playerBinary() {
  if (PLATFORM === 'darwin') return 'afplay';
  if (PLATFORM === 'win32') return playerBinaryName('ffplay.exe');
  return 'mpg123';
}

function playerBinaryName(name) {
  // 优先从项目 bin/ 目录找
  const local = join(BIN_DIR, name);
  if (existsSync(local)) return local;
  // 否则信任 PATH
  return name;
}

function playerArgs(pathOrUrl, seekSeconds = 0, volume = 70) {
  if (PLATFORM === 'win32') {
    const args = ['-nodisp', '-autoexit', '-volume', String(volume)];
    if (seekSeconds > 0) args.push('-ss', String(seekSeconds));
    args.push('-i', pathOrUrl);
    return args;
  }
  return [pathOrUrl];
}

/**
 * MASTER.JS — 播放目标抽象（跨平台）
 *
 * 统一暴露 play / pause / resume / setVolume / stop 接口，
 * 内部根据 target 分发到 local 或 upnp。
 *
 * 平台支持：
 *   macOS  — afplay + SIGSTOP/SIGCONT 暂停 + osascript 音量
 *   Linux  — mpg123 + SIGSTOP/SIGCONT 暂停
 *   Windows — ffplay + 进程重启恢复暂停 + 音量提示
 */
export class PlaybackMaster {
  #target = 'local';
  #upnp = null;
  #currentProc = null;
  #currentMedia = null;
  #startedAt = null;
  #elapsedMs = 0;
  #paused = false;
  #upnpDeviceUrl = null;
  #volume = 70;

  setTarget(target, upnpModule = null, deviceUrl = null) {
    this.#target = target;
    this.#upnp = upnpModule;
    this.#upnpDeviceUrl = deviceUrl;
  }

  get target() {
    return this.#target;
  }

  /**
   * 播放本地文件（TTS mp3 等）
   */
  async playFile(filePath) {
    await this.stop();
    this.#currentMedia = { type: 'file', path: filePath };
    this.#startedAt = Date.now();
    this.#elapsedMs = 0;
    this.#paused = false;

    if (this.#target === 'upnp' && this.#upnp) {
      return this.#upnp.playLocal(filePath).catch((err) => {
        console.warn('[Master] UPnP playLocal failed, falling back to local:', err.message);
        return this.#playLocal(filePath);
      });
    }
    return this.#playLocal(filePath);
  }

  /**
   * 播放远程 URL（网易云 mp3 链接）
   */
  async playUrl(url, meta = {}) {
    await this.stop();
    this.#currentMedia = { type: 'url', path: url };
    this.#startedAt = Date.now();
    this.#elapsedMs = 0;
    this.#paused = false;

    if (this.#target === 'upnp' && this.#upnp) {
      return this.#upnp.playUrl(this.#upnpDeviceUrl, url).catch((err) => {
        console.warn('[Master] UPnP failed, falling back to local:', err.message);
        eventBus.emit('UPNP_FALLBACK');
        this.#target = 'local';
        return this.#playLocal(url);
      });
    }
    return this.#playLocal(url);
  }

  async pause() {
    if (!this.#currentProc) return;
    this.#paused = true;

    if (PLATFORM === 'win32') {
      if (this.#startedAt) {
        this.#elapsedMs += Date.now() - this.#startedAt;
        this.#startedAt = null;
      }
      this.#currentProc.kill('SIGTERM');
      this.#currentProc = null;
      eventBus.emit('PLAYBACK_PAUSED');
    } else {
      this.#currentProc.kill('SIGSTOP');
    }
  }

  async resume() {
    if (PLATFORM === 'win32') {
      if (this.#currentMedia && this.#paused) {
        this.#startedAt = Date.now();
        this.#paused = false;
        return this.#playLocal(this.#currentMedia.path, this.#elapsedMs / 1000);
      }
    } else {
      if (this.#currentProc && this.#paused) {
        this.#currentProc.kill('SIGCONT');
        this.#paused = false;
      }
    }
  }

  async stop() {
    this.#paused = false;
    if (this.#currentProc) {
      this.#currentProc.kill('SIGTERM');
      this.#currentProc = null;
    }
    this.#currentMedia = null;
    this.#elapsedMs = 0;
    this.#startedAt = null;
  }

  /**
   * Seek 到指定秒数，停止当前播放并从头跳到新位置
   */
  async seekTo(seconds) {
    const sec = Math.max(0, seconds);
    if (this.#currentProc) {
      this.#currentProc.kill('SIGTERM');
      this.#currentProc = null;
    }
    this.#elapsedMs = sec * 1000;
    this.#startedAt = Date.now();
    this.#paused = false;

    if (this.#currentMedia) {
      return this.#playLocal(this.#currentMedia.path, sec);
    }
  }

  async setVolume(level) {
    if (this.#target === 'upnp' && this.#upnp) {
      return this.#upnp.setVolume(this.#upnpDeviceUrl, level).catch(() => {});
    }

    const clamped = Math.max(0, Math.min(100, level));
    // 存下来，下次播放时传给 ffplay -volume
    this.#volume = clamped;

    if (PLATFORM === 'darwin') {
      const { execFile } = await import('child_process');
      return new Promise((resolve) => {
        execFile('osascript', ['-e', `set volume output volume ${clamped}`], () => resolve());
      });
    }
  }

  get volume() { return this.#volume ?? 70; }

  // ── private ─────────────────────────────────────────────────────────────

  #playLocal(pathOrUrl, seekSeconds = 0) {
    return new Promise((resolve) => {
      const binary = playerBinary();
      const args = playerArgs(pathOrUrl, seekSeconds, this.#volume ?? 70);

      const proc = spawn(binary, args, { stdio: 'ignore' });

      proc.on('error', (err) => {
        if (err.code === 'ENOENT') {
          const hints = {
            win32: 'Install ffmpeg: https://ffmpeg.org/download.html (ensure ffplay is in PATH)',
            darwin: 'afplay is built into macOS — if missing, check system integrity',
            linux: 'Install mpg123: sudo apt install mpg123',
          };
          console.warn(`[Master] "${binary}" not found. ${hints[PLATFORM] || 'Please install it.'}`);
        } else {
          console.warn('[Master] player error:', err.message);
        }
        this.#currentProc = null;
        resolve();
      });

      proc.on('exit', () => {
        if (!this.#paused) {
          this.#currentProc = null;
          this.#currentMedia = null;
          this.#elapsedMs = 0;
        }
        resolve();
      });

      this.#currentProc = proc;
      eventBus.emit('PLAYBACK_STARTED', { pathOrUrl });
    });
  }
}
