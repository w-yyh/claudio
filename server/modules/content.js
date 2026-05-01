import { createHash } from 'crypto';
import { writeFile, unlink, readdir, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FishAudioAdapter } from '../adapters/fish-audio.adapter.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = join(__dir, '../../data');
const MAX_CACHED_FILES = 50;

await mkdir(AUDIO_DIR, { recursive: true }).catch(() => {});

/**
 * CONTENT.JS — TTS 任务队列 + 音频缓存
 *
 * - 串行队列：防止并发合成（Fish Audio 有速率限制）
 * - 文件缓存：按文本 MD5 缓存，避免重复合成
 * - 预缓存：歌曲播放最后 30 秒时提前合成下一段 DJ 词
 */
export class ContentModule {
  #fish;
  #queue = Promise.resolve();   // 串行队列
  #cache = new Map();           // textHash → filePath

  constructor(fishAdapter) {
    this.#fish = fishAdapter ?? new FishAudioAdapter();
  }

  /**
   * 合成 TTS 并返回文件路径（队列化，防并发）
   * @param {string} text
   * @returns {Promise<string|null>}  mp3 文件路径，失败时返回 null
   */
  async synthesize(text) {
    const hash = this.#hash(text);

    if (this.#cache.has(hash)) {
      return this.#cache.get(hash);
    }

    // 加入串行队列
    const task = this.#queue.then(() => this.#doSynthesize(text, hash));
    this.#queue = task.catch(() => {}); // 队列不因单次失败而停止
    return task;
  }

  /**
   * 预缓存：fire-and-forget，提前合成下一段 DJ 词
   * @param {string} text
   */
  preCache(text) {
    this.synthesize(text).catch(() => {});
  }

  /**
   * 清空内存缓存（不删文件）
   */
  clearMemoryCache() {
    this.#cache.clear();
  }

  /**
   * 清理磁盘上的旧 TTS 文件（保留最新 MAX_CACHED_FILES 个）
   */
  async cleanupOldFiles() {
    try {
      const files = (await readdir(AUDIO_DIR))
        .filter((f) => f.startsWith('dj_') && f.endsWith('.mp3'))
        .map((f) => ({ name: f, path: join(AUDIO_DIR, f) }));

      if (files.length <= MAX_CACHED_FILES) return;

      // 按文件名排序（dj_<timestamp>.mp3），删最旧的
      files.sort((a, b) => a.name.localeCompare(b.name));
      const toDelete = files.slice(0, files.length - MAX_CACHED_FILES);
      await Promise.all(toDelete.map((f) => unlink(f.path).catch(() => {})));
    } catch {
      // 忽略清理失败
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  async #doSynthesize(text, hash) {
    try {
      const buffer = await this.#fish.synthesize(text);
      if (!buffer) return null;

      const filePath = join(AUDIO_DIR, `dj_${Date.now()}.mp3`);
      await writeFile(filePath, buffer);
      this.#cache.set(hash, filePath);

      // 定期清理
      this.cleanupOldFiles().catch(() => {});

      return filePath;
    } catch (err) {
      console.warn('[Content] TTS synthesis failed:', err.message);
      return null;
    }
  }

  #hash(text) {
    return createHash('md5').update(text).digest('hex');
  }
}
