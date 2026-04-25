import { execFile } from 'child_process';
import { eventBus } from './event-bus.js';

/**
 * MASTER.JS — 播放目标抽象
 *
 * 统一暴露 play / pause / resume / setVolume 接口，
 * 内部根据 target 分发到 local（afplay）或 upnp。
 */
export class PlaybackMaster {
  #target = 'local';   // 'local' | 'upnp'
  #upnp = null;        // UPnPModule 实例（Phase 2 注入）
  #currentProc = null; // afplay 子进程引用

  setTarget(target, upnpModule = null) {
    this.#target = target;
    this.#upnp   = upnpModule;
  }

  get target() { return this.#target; }

  /**
   * 播放本地文件（TTS mp3 等）
   * @param {string} filePath
   */
  async playFile(filePath) {
    if (this.#target === 'upnp' && this.#upnp) {
      return this.#upnp.playLocal(filePath).catch(() => this.#playLocal(filePath));
    }
    return this.#playLocal(filePath);
  }

  /**
   * 播放远程 URL（网易云 mp3 链接）
   * @param {string} url
   * @param {{ duration?: number }} [meta]
   */
  async playUrl(url, meta = {}) {
    if (this.#target === 'upnp' && this.#upnp) {
      return this.#upnp.playUrl(url).catch((err) => {
        console.warn('[Master] UPnP failed, falling back to local:', err.message);
        eventBus.emit('UPNP_FALLBACK');
        this.#target = 'local';
        return this.#playLocal(url);
      });
    }
    return this.#playLocal(url, meta);
  }

  async pause() {
    if (this.#currentProc) {
      this.#currentProc.kill('SIGSTOP');
    }
  }

  async resume() {
    if (this.#currentProc) {
      this.#currentProc.kill('SIGCONT');
    }
  }

  async stop() {
    if (this.#currentProc) {
      this.#currentProc.kill('SIGTERM');
      this.#currentProc = null;
    }
  }

  async setVolume(level) {
    if (this.#target === 'upnp' && this.#upnp) {
      return this.#upnp.setVolume(level).catch(() => {});
    }
    // local: macOS osascript
    const clamped = Math.max(0, Math.min(100, level));
    return new Promise((resolve) => {
      execFile('osascript', ['-e', `set volume output volume ${clamped}`], () => resolve());
    });
  }

  // ── private ─────────────────────────────────────────────────────────────

  #playLocal(pathOrUrl) {
    return new Promise((resolve) => {
      const proc = execFile(
        process.platform === 'darwin' ? 'afplay' : 'mpg123',
        [pathOrUrl],
        (err) => {
          if (err && err.code !== 'SIGTERM' && err.signal !== 'SIGTERM') {
            console.warn('[Master] player exited:', err.message);
          }
          this.#currentProc = null;
          resolve();
        }
      );
      this.#currentProc = proc;
      eventBus.emit('PLAYBACK_STARTED', { pathOrUrl });
    });
  }
}
