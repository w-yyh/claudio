import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Load recent history for dedup (last N tracks).
 * Returns [] gracefully if file unreadable.
 */
async function loadRecentHistory(n = 20) {
  try {
    const raw = await readFile(join(__dir, '../../data/history.json'), 'utf-8');
    const arr = JSON.parse(raw);
    return arr.slice(-n);
  } catch {
    return [];
  }
}

/**
 * Determine time-of-day label.
 * @param {Date} now
 */
function getTimePeriod(now) {
  const h = now.getHours();
  if (h >= 5 && h < 9) return '早晨';
  if (h >= 9 && h < 12) return '上午';
  if (h >= 12 && h < 14) return '午休';
  if (h >= 14 && h < 18) return '下午';
  if (h >= 18 && h < 21) return '傍晚';
  return '夜间';
}

function getDayType(now) {
  const day = now.getDay();
  return day === 0 || day === 6 ? '周末' : '工作日';
}

/**
 * Build the three-dimension DJ context for prompts.
 *
 * @param {{
 *   mood?: string,
 *   weather?: import('../adapters/weather.adapter.js').WeatherInfo,
 *   schedule?: object,
 * }} input
 * @returns {Promise<DJContext>}
 */
export async function buildDJContext({ mood, weather, schedule } = {}) {
  const now = new Date();
  const history = await loadRecentHistory();

  return {
    // Dimension 1: Objective environment
    env: {
      timePeriod: getTimePeriod(now),
      dayType: getDayType(now),
      timeISO: now.toISOString(),
      weather: weather ?? null,
    },
    // Dimension 2: Work state (from TickTick / schedule)
    work: {
      density: schedule?.density ?? null,
      nextTask: schedule?.nextTask ?? null,
      hasDeadlineToday: schedule?.hasDeadlineToday ?? false,
      available: !!schedule,
    },
    // Dimension 3: Personal input
    personal: {
      mood: mood ?? null,
      recentTrackIds: history.map((h) => h.id).filter(Boolean),
    },
  };
}

/**
 * @typedef {{
 *   env: { timePeriod: string, dayType: string, timeISO: string, weather: object|null },
 *   work: { density: string|null, nextTask: object|null, hasDeadlineToday: boolean, available: boolean },
 *   personal: { mood: string|null, recentTrackIds: string[] }
 * }} DJContext
 */
