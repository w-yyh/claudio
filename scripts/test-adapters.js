/**
 * Claudio adapter connectivity test suite.
 *
 * Run: node scripts/test-adapters.js
 *
 * Each adapter is tested independently. Prints PASS / FAIL per adapter.
 * Requires a valid .env file in the project root.
 */

import 'dotenv/config';
import { ClaudeAdapter } from '../server/adapters/claude.adapter.js';
import { NeteaseAdapter } from '../server/adapters/netease.adapter.js';
import { FishAudioAdapter } from '../server/adapters/fish-audio.adapter.js';
import { WeatherAdapter } from '../server/adapters/weather.adapter.js';

const PASS = '\x1b[32m✓ PASS\x1b[0m';
const FAIL = '\x1b[31m✗ FAIL\x1b[0m';

async function run(name, fn) {
  try {
    await fn();
    console.log(`${PASS}  ${name}`);
  } catch (err) {
    console.log(`${FAIL}  ${name}`);
    console.log(`        ${err.message}`);
  }
}

// ── Claude ───────────────────────────────────────────────────────────────────
await run('Claude — non-empty reply', async () => {
  const claude = new ClaudeAdapter();
  const reply = await claude.complete([
    { role: 'user', content: 'Reply with exactly: CLAUDIO_OK' },
  ], { model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6', maxTokens: 32 });

  if (!reply || reply.trim().length === 0) throw new Error('Empty reply from Claude');
  console.log(`        Response: ${reply.trim().slice(0, 80)}`);
});

// ── Netease ──────────────────────────────────────────────────────────────────
await run('Netease — search "周杰伦" returns results', async () => {
  const netease = new NeteaseAdapter();
  const songs = await netease.search('周杰伦', 5);
  if (!Array.isArray(songs) || songs.length === 0) throw new Error('No songs returned');
  if (!songs[0].id) throw new Error('Song missing id field');
  console.log(`        First result: ${songs[0].name} — ${songs[0].artist} (id: ${songs[0].id})`);
});

// ── Fish Audio ───────────────────────────────────────────────────────────────
await run('Fish Audio — synthesize returns non-empty buffer', async () => {
  const fish = new FishAudioAdapter();
  const buf = await fish.synthesize('这是一段测试语音。');
  if (!buf) throw new Error('synthesize returned null — check FISH_AUDIO_KEY and FISH_AUDIO_REFERENCE_ID');
  if (buf.length === 0) throw new Error('Buffer is empty');
  console.log(`        Audio buffer size: ${buf.length} bytes`);
});

// ── Weather ──────────────────────────────────────────────────────────────────
await run('Weather — returns object with temp field', async () => {
  const weather = new WeatherAdapter();
  const info = await weather.getCurrentWeather();
  if (typeof info.temp !== 'number') throw new Error(`temp field missing or not a number: ${JSON.stringify(info)}`);
  console.log(`        ${info.city}: ${info.description} ${info.temp}°C`);
});

console.log('\nDone.');
