import { writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { state } from './state.js';
import { eventBus } from './event-bus.js';
import { ClaudeAdapter } from '../adapters/claude.adapter.js';
import { NeteaseAdapter } from '../adapters/netease.adapter.js';
import { FishAudioAdapter } from '../adapters/fish-audio.adapter.js';
import { WeatherAdapter } from '../adapters/weather.adapter.js';
import { buildDJContext } from '../prompts/context-builder.js';

const execFileAsync = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '../../data');

export class Player {
  #claude;
  #netease;
  #fish;
  #weather;

  constructor() {
    this.#claude = new ClaudeAdapter();
    this.#netease = new NeteaseAdapter();
    this.#fish = new FishAudioAdapter();
    this.#weather = new WeatherAdapter();
  }

  /**
   * Run a full DJ session: context → AI decision → TTS → music.
   * @param {string} [mood]
   */
  async startSession(mood) {
    state.reset();
    state.transition('PROTO', { mood });

    // ── 1. Build context ────────────────────────────────────────────────────
    let weather = null;
    try {
      weather = await this.#weather.getCurrentWeather();
    } catch (err) {
      console.warn('[Player] Weather fetch failed:', err.message);
    }

    const ctx = await buildDJContext({ mood, weather });
    state.updateContext({ weather });

    // ── 2. Claude DJ decision ───────────────────────────────────────────────
    console.log('[Player] Requesting DJ decision from Claude...');
    let script = '';
    let strategy = { keywords: [mood ?? '流行'], bpm_range: [80, 120], mood_tags: [], exclude_ids: [] };

    try {
      state.transition('PUB');
      const decision = await this.#claude.getDJDecision(ctx);
      script = decision.script;
      strategy = decision.strategy;
      state.updateContext({ djScript: script });
      console.log('\n── DJ Script ──────────────────────────────────────');
      console.log(script);
      console.log('──────────────────────────────────────────────────\n');
    } catch (err) {
      console.error('[Player] Claude failed:', err.message);
      script = `好的，${mood ? `感受到你${mood}的心情，` : ''}来一首歌放松一下。`;
      state.updateContext({ djScript: script });
    }

    // ── 3. TTS synthesis ────────────────────────────────────────────────────
    let ttsPath = null;
    try {
      const buffer = await this.#fish.synthesize(script);
      if (buffer) {
        ttsPath = join(DATA_DIR, `dj_${Date.now()}.mp3`);
        await writeFile(ttsPath, buffer);
        console.log(`[Player] TTS saved → ${ttsPath}`);
      }
    } catch (err) {
      console.warn('[Player] TTS failed, skipping DJ voice:', err.message);
    }

    // ── 4. Search & select track ────────────────────────────────────────────
    let track = null;
    const keywords = strategy.keywords?.[0] ?? (mood ?? '流行');
    try {
      const results = await this.#netease.search(keywords, 10);
      const filtered = results.filter((s) => !strategy.exclude_ids?.includes(s.id));
      track = filtered[0] ?? results[0] ?? null;
    } catch (err) {
      console.warn('[Player] Netease search failed:', err.message);
    }

    if (!track) {
      console.error('[Player] No track found. Session aborted.');
      state.transition('IDLE');
      return;
    }

    state.transition('PUSH', { currentTrack: track, queue: [track] });
    console.log(`[Player] Selected: ${track.name} — ${track.artist}`);

    // ── 5. Get playable URL ──────────────────────────────────────────────────
    let trackUrl = null;
    try {
      const urlInfo = await this.#netease.getTrackUrl(track.id);
      trackUrl = urlInfo.url;
    } catch (err) {
      console.warn('[Player] Could not get track URL:', err.message);
    }

    // ── 6. Play ─────────────────────────────────────────────────────────────
    await this.#play(ttsPath, trackUrl, track);

    // ── 7. Log history ───────────────────────────────────────────────────────
    await this.#appendHistory({ ...track, playedAt: new Date().toISOString(), mood, script });

    state.transition('IDLE');
    eventBus.emit('SESSION_COMPLETE', { track, script });
  }

  async skip() {
    if (state.current === 'PUSH') {
      state.transition('IDLE');
      eventBus.emit('SKIPPED');
    }
  }

  async nextTrack() {
    if (state.current === 'PUSH') {
      state.transition('PROTO');
      // Re-run music selection only (no new DJ script)
      // Simplified: just restart session
      await this.startSession(state.getContext().mood);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  async #play(ttsPath, trackUrl, track) {
    // Play TTS first, then music
    if (ttsPath) {
      await this.#playFile(ttsPath).catch((e) => console.warn('[Player] TTS play error:', e.message));
    }

    if (trackUrl) {
      console.log(`[Player] Now playing: ${track.name} — ${track.artist}`);
      console.log(`         URL: ${trackUrl}`);
      await this.#playFile(trackUrl).catch((e) => console.warn('[Player] Music play error:', e.message));
    } else {
      console.log(`[Player] No playable URL for "${track.name}". Skipping audio.`);
    }
  }

  #playFile(pathOrUrl) {
    return new Promise((resolve) => {
      const proc = execFile('afplay', [pathOrUrl], (err) => {
        if (err && err.code !== 'SIGTERM') {
          console.warn('[Player] afplay exited:', err.message);
        }
        resolve();
      });

      // Expose proc for potential skip implementation
      this._currentProc = proc;
    });
  }

  async #appendHistory(entry) {
    try {
      const path = join(DATA_DIR, 'history.json');
      const raw = await readFile(path, 'utf-8').catch(() => '[]');
      const arr = JSON.parse(raw);
      arr.push(entry);
      await writeFile(path, JSON.stringify(arr.slice(-200), null, 2));
    } catch (err) {
      console.warn('[Player] History write failed:', err.message);
    }
  }
}
