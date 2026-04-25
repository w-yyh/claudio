import { writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { state } from './state.js';
import { eventBus } from './event-bus.js';
import { PlaybackMaster } from './master.js';
import { ClaudeAdapter } from '../adapters/claude.adapter.js';
import { NeteaseAdapter } from '../adapters/netease.adapter.js';
import { WeatherAdapter } from '../adapters/weather.adapter.js';
import { ContentModule } from '../modules/content.js';
import { ScheduleModule } from '../modules/schedule.js';
import { TTLModule } from '../modules/ttl.js';
import { buildDJContext } from '../prompts/context-builder.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '../../data');

export class Player {
  #claude;
  #netease;
  #weather;
  #content;
  #schedule;
  #ttl;
  #master;

  constructor({ scheduleModule, fishAdapter } = {}) {
    this.#claude   = new ClaudeAdapter();
    this.#netease  = new NeteaseAdapter();
    this.#weather  = new WeatherAdapter();
    this.#content  = new ContentModule(fishAdapter);
    this.#schedule = scheduleModule ?? new ScheduleModule();
    this.#ttl      = new TTLModule();
    this.#master   = new PlaybackMaster();

    // 歌曲剩余 30 秒时预生成下一段 DJ 词
    this.#ttl.on('PRE_GENERATE', () => this.#preGenerateNext());
    // TTL 兜底结束事件（正常由 master 播完触发，此处双保险）
    this.#ttl.on('TRACK_ENDED', () => {
      if (state.current === 'PUSH') {
        this.startSession(state.getContext().mood).catch(console.error);
      }
    });
  }

  async init() {
    await this.#schedule.init();
  }

  setTarget(target, upnpModule = null) {
    this.#master.setTarget(target, upnpModule);
    state.updateContext({ target });
  }

  /**
   * 完整 DJ 会话：上下文 → Claude 决策 → TTS → 选歌 → 播放
   * @param {string} [mood]
   */
  async startSession(mood) {
    this.#ttl.stop();
    state.reset();
    state.transition('PROTO', { mood });

    // ── 1. 并行获取天气 & 日程 ────────────────────────────────────────────
    const [weather, schedule] = await Promise.allSettled([
      this.#weather.getCurrentWeather(),
      this.#schedule.getTodaySummary(),
    ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : null)));

    const ctx = await buildDJContext({ mood, weather, schedule });
    state.updateContext({ weather });

    // ── 2. Claude DJ 决策 ────────────────────────────────────────────────
    state.transition('PUB');

    let script = `好的，${mood ? `感受到你${mood}的心情，` : ''}来一首歌放松一下。`;
    let strategy = { keywords: [mood ?? '流行'], bpm_range: [80, 120], mood_tags: [], exclude_ids: [] };

    try {
      console.log('[Player] Requesting DJ decision...');
      const decision = await this.#claude.getDJDecision(ctx);
      script   = decision.script;
      strategy = decision.strategy;
      console.log('\n── DJ Script ──────────────────────────────────────');
      console.log(script);
      console.log('──────────────────────────────────────────────────\n');
    } catch (err) {
      console.error('[Player] Claude failed (using fallback):', err.message);
    }
    state.updateContext({ djScript: script });

    // ── 3. TTS 合成（并行进行选歌）────────────────────────────────────────
    const keywords = strategy.keywords?.[0] ?? (mood ?? '流行');

    const [ttsPath, tracks] = await Promise.allSettled([
      this.#content.synthesize(script),
      this.#netease.search(keywords, 10),
    ]).then((results) => [
      results[0].status === 'fulfilled' ? results[0].value : null,
      results[1].status === 'fulfilled' ? results[1].value : [],
    ]);

    // ── 4. 选歌 ─────────────────────────────────────────────────────────
    const filtered = tracks.filter((s) => !strategy.exclude_ids?.includes(s.id));
    const track = filtered[0] ?? tracks[0] ?? null;

    if (!track) {
      console.error('[Player] No track found. Returning to IDLE.');
      state.transition('IDLE');
      return;
    }

    state.transition('PUSH', { currentTrack: track, queue: filtered.slice(0, 5) });
    console.log(`[Player] ▶ ${track.name} — ${track.artist}`);

    // ── 5. 获取播放 URL ──────────────────────────────────────────────────
    let trackUrl = null;
    try {
      const urlInfo = await this.#netease.getTrackUrl(track.id);
      trackUrl = urlInfo.url;
    } catch (err) {
      console.warn('[Player] URL fetch failed:', err.message);
    }

    // ── 6. 播放 ──────────────────────────────────────────────────────────
    if (ttsPath) {
      await this.#master.playFile(ttsPath).catch((e) => console.warn('[Player] TTS play error:', e.message));
    }

    if (trackUrl) {
      this.#ttl.start(track.duration || 240000);
      await this.#master.playUrl(trackUrl, { duration: track.duration })
        .catch((e) => console.warn('[Player] Music play error:', e.message));
    } else {
      console.log(`[Player] No URL for "${track.name}"`);
    }

    this.#ttl.stop();

    // ── 7. 历史记录 ──────────────────────────────────────────────────────
    await this.#appendHistory({ ...track, playedAt: new Date().toISOString(), mood, script });

    state.transition('IDLE');
    eventBus.emit('SESSION_COMPLETE', { track, script });
  }

  async skip() {
    this.#ttl.stop();
    await this.#master.stop();
    if (state.current === 'PUSH' || state.current === 'PUB') {
      state.transition('IDLE');
    }
    eventBus.emit('SKIPPED');
  }

  async pause() {
    if (state.current === 'PUSH') {
      await this.#master.pause();
      state.transition('PAUSE');
    }
  }

  async resume() {
    if (state.current === 'PAUSE') {
      await this.#master.resume();
      state.transition('PUSH');
    }
  }

  async setVolume(level) {
    state.updateContext({ volume: level });
    await this.#master.setVolume(level);
  }

  async nextTrack() {
    if (state.current === 'PUSH') {
      await this.skip();
      await this.startSession(state.getContext().mood);
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  async #preGenerateNext() {
    const ctx = state.getContext();
    const mood = ctx.mood;
    try {
      console.log('[Player] Pre-generating next DJ script...');
      const djCtx = await buildDJContext({ mood });
      const script = await this.#claude.regenerateScript(djCtx, '自动循环');
      if (script) this.#content.preCache(script);
    } catch { /* 预生成失败不影响当前播放 */ }
  }

  async #appendHistory(entry) {
    try {
      const path = join(DATA_DIR, 'history.json');
      const raw = await readFile(path, 'utf-8').catch(() => '[]');
      const arr = JSON.parse(raw);
      arr.push(entry);
      await writeFile(path, JSON.stringify(arr.slice(-200), null, 2));
    } catch { /* 忽略历史写入失败 */ }
  }
}
