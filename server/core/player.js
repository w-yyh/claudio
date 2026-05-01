import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { state } from './state.js';
import { eventBus } from './event-bus.js';
import { PlaybackMaster } from './master.js';
import { LLMAdapter } from '../adapters/llm.adapter.js';
import { NeteaseAdapter } from '../adapters/netease.adapter.js';
import { WeatherAdapter } from '../adapters/weather.adapter.js';
import { ContentModule } from '../modules/content.js';
import { ScheduleModule } from '../modules/schedule.js';
import { TTLModule } from '../modules/ttl.js';
import { buildDJContext } from '../prompts/context-builder.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '../../data');

await mkdir(DATA_DIR, { recursive: true }).catch(() => {});

export class Player {
  #llm;
  #netease;
  #weather;
  #content;
  #schedule;
  #ttl;
  #master;
  #taste = null;

  constructor({ scheduleModule, fishAdapter } = {}) {
    this.#llm      = new LLMAdapter();
    this.#netease  = new NeteaseAdapter();
    this.#weather  = new WeatherAdapter();
    this.#content  = new ContentModule(fishAdapter);
    this.#schedule = scheduleModule ?? new ScheduleModule();
    this.#ttl      = new TTLModule();
    this.#master   = new PlaybackMaster();

    // 加载品味档案
    this.#loadTaste();

    // 歌曲剩余 30 秒时预生成下一段 DJ 词
    this.#ttl.on('PRE_GENERATE', () => this.#preGenerateNext());
    // TTL 兜底结束事件（正常由 master 播完触发，此处双保险）
    this.#ttl.on('TRACK_ENDED', () => {
      if (state.current === 'PUSH') {
        this.startSession(state.getContext().mood).catch(console.error);
      }
    });
  }

  async #loadTaste() {
    try {
      const raw = await readFile(join(DATA_DIR, 'taste-profile.json'), 'utf-8');
      this.#taste = JSON.parse(raw);
      console.log('[Player] Taste profile loaded:', this.#taste.topArtists?.slice(0,5).join(', '));
    } catch { /* 品味档案可选 */ }
  }

  async init() {
    await this.#schedule.init();
  }

  setTarget(target, upnpModule = null, deviceUrl = null) {
    this.#master.setTarget(target, upnpModule, deviceUrl);
    state.updateContext({ target, upnpDevice: deviceUrl });
  }

  /**
   * 完整 DJ 会话：上下文 → Claude 决策 → TTS → 选歌 → 播放
   * @param {string} [mood]
   */
  async startSession(mood) {
    this.#ttl.stop();
    state.reset();
    state.transition('PROTO', { mood });

    // ── 1. 并行获取天气、日程、每日推荐 ────────────────────────────────
    const [weather, schedule, dailySongs] = await Promise.allSettled([
      this.#weather.getCurrentWeather(),
      this.#schedule.getTodaySummary(),
      this.#netease.getRecommendSongs().catch(() => []),
    ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : null)));

    const ctx = await buildDJContext({ mood, weather, schedule });
    state.updateContext({ weather });

    // ── 2. LLM 生成 DJ 口白（立即推送）─────────────────────────────────
    state.transition('PUB');

    let script = `好的，${mood ? `感受到你${mood}的心情，` : ''}来一首歌放松一下。`;

    try {
      console.log('[Player] Generating DJ script...');
      const djMsg = await this.#llm.complete(
        (await import('../prompts/dj-broadcast.js')).buildDJBroadcastMessages(ctx),
        { maxTokens: 512 }
      );
      script = djMsg.trim();
      console.log('\n── DJ Script ──────────────────────────────────────');
      console.log(script);
      console.log('──────────────────────────────────────────────────\n');
    } catch (err) {
      console.error('[Player] LLM script failed (using fallback):', err.message);
    }

    // 立即推送 DJ 口白到客户端
    state.updateContext({ djScript: script });
    eventBus.emit('DJ_SCRIPT_READY', { text: script });

    // ── 3. TTS + 选歌（并行）──────────────────────────────────────────`
    const ttsTask = this.#content.synthesize(script);

    // ── 4. 选歌 ──────────────────────────────────────────────────────
    const songs = dailySongs ?? [];
    let track = null;

    if (songs.length > 0) {
      // 每日推荐可用 → LLM 从歌单中选
      console.log(`[Player] Selecting from ${songs.length} daily recommendations...`);
      const songList = songs.slice(0, 30).map((s) => ({
        id: s.id,
        name: s.name,
        artist: s.artist,
        reason: s.reason ?? '',
      }));
      try {
        const pick = await this.#llm.selectSong(ctx, songList, this.#taste);
        console.log('[Player] LLM pick result:', JSON.stringify(pick));
        if (pick.songId) {
          const sid = String(pick.songId);
          track = songList.find((s) => s.id === sid) ?? null;
          // 容错：LLM 可能返回序号而非 ID
          if (!track && /^\d+$/.test(sid) && Number(sid) <= songList.length) {
            track = songList[Number(sid) - 1] ?? null;
          }
          if (track) {
            const full = songs.find((s) => String(s.id) === String(track.id));
            if (full) track.duration = full.duration;
            console.log(`[Player] LLM picked: ${track.name} — ${track.artist} (${pick.reason})`);
          } else {
            console.warn('[Player] LLM picked unknown song_id:', pick.songId);
          }
        }
      } catch (err) {
        console.warn('[Player] Song selection failed:', err.message);
      }
    }

    if (!track) {
      // 降级：关键词搜索
      console.log('[Player] Falling back to keyword search...');
      const keywords = strategy.keywords?.[0] ?? (mood ?? '流行');
      const tracks = await this.#netease.search(keywords, 10).catch(() => []);
      const filtered = tracks.filter((s) => !strategy.exclude_ids?.includes(s.id));
      track = filtered[0] ?? tracks[0] ?? null;
    }

    if (!track) {
      console.error('[Player] No track found. Returning to IDLE.');
      state.transition('IDLE');
      return;
    }

    // ── 5. 等待 TTS 完成 ────────────────────────────────────────────
    const ttsPath = await ttsTask.catch(() => null);

    state.transition('PUSH', { currentTrack: track });
    console.log(`[Player] ▶ ${track.name} — ${track.artist}`);

    // ── 6. 获取播放 URL ─────────────────────────────────────────────
    let trackUrl = null;
    try {
      const urlInfo = await this.#netease.getTrackUrl(track.id);
      trackUrl = urlInfo.url;
    } catch (err) {
      console.warn('[Player] URL fetch failed:', err.message);
    }

    // ── 7. 播放 ─────────────────────────────────────────────────────
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

    // ── 8. 历史记录 ─────────────────────────────────────────────────
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

  async seekTo(seconds) {
    if (state.current === 'PUSH') {
      await this.#master.seekTo(seconds);
    }
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
      const script = await this.#llm.regenerateScript(djCtx, '自动循环');
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
