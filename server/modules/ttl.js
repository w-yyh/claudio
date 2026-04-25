import { EventEmitter } from 'events';

/**
 * TTL.JS — 精确播放时序控制
 *
 * 基于 track.duration 计算关键时间点，通过 setTimeout 触发：
 *   - PRE_GENERATE：歌曲剩余 PRE_GENERATE_SECS 秒时，提前生成下一段 DJ 词
 *   - TRACK_ENDED：歌曲结束（降级方案，正常情况由 master 播放完成回调触发）
 *
 * Phase 4 中可改为监听 <audio> onended 事件链，精度更高。
 */
export class TTLModule extends EventEmitter {
  static PRE_GENERATE_SECS = 30;

  #timer = null;
  #endTimer = null;
  #startedAt = null;
  #duration = 0;

  /**
   * 开始计时
   * @param {number} durationMs  曲目总时长（毫秒）
   */
  start(durationMs) {
    this.stop();
    this.#duration = durationMs;
    this.#startedAt = Date.now();

    const preMs = durationMs - TTLModule.PRE_GENERATE_SECS * 1000;

    if (preMs > 0) {
      this.#timer = setTimeout(() => {
        this.emit('PRE_GENERATE');
      }, preMs);
    } else {
      // 歌曲太短，立即触发预生成
      setImmediate(() => this.emit('PRE_GENERATE'));
    }

    this.#endTimer = setTimeout(() => {
      this.emit('TRACK_ENDED');
    }, durationMs);
  }

  /**
   * 停止所有计时器（跳过/暂停时调用）
   */
  stop() {
    if (this.#timer)    { clearTimeout(this.#timer);    this.#timer = null; }
    if (this.#endTimer) { clearTimeout(this.#endTimer); this.#endTimer = null; }
    this.#startedAt = null;
  }

  /**
   * 当前已播放的毫秒数（估算）
   */
  get elapsed() {
    if (!this.#startedAt) return 0;
    return Math.min(Date.now() - this.#startedAt, this.#duration);
  }

  /**
   * 剩余毫秒数
   */
  get remaining() {
    return Math.max(0, this.#duration - this.elapsed);
  }
}
