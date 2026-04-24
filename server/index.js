/**
 * Claudio — AI DJ Server
 * Phase 1 CLI entry point
 *
 * Usage:
 *   node server/index.js --mood "有点累"
 *   node server/index.js
 */

import 'dotenv/config';
import { Player } from './core/player.js';

// Parse --mood flag from argv
const args = process.argv.slice(2);
const moodIdx = args.indexOf('--mood');
const mood = moodIdx !== -1 ? args[moodIdx + 1] : undefined;

console.log('🎙  Claudio AI DJ starting...');
if (mood) console.log(`   Mood: ${mood}`);

const player = new Player();

player.startSession(mood).then(() => {
  console.log('[Claudio] Session complete.');
}).catch((err) => {
  console.error('[Claudio] Fatal error:', err);
  process.exit(1);
});
