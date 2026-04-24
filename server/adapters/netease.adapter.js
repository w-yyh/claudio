import fetch from 'node-fetch';
import { config } from '../config.js';

const URL_CACHE = new Map(); // songId → { url, fetchedAt }
const URL_TTL_MS = 15 * 60 * 1000; // 15 minutes (Netease URLs valid ~20 min)

export class NeteaseAdapter {
  #base;

  constructor() {
    this.#base = config.netease.apiUrl.replace(/\/$/, '');
  }

  /**
   * Search songs by keyword.
   * @param {string} keywords
   * @param {number} limit
   * @returns {Promise<Song[]>}
   */
  async search(keywords, limit = 10) {
    const url = `${this.#base}/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Netease search failed: ${res.status}`);

    const data = await res.json();
    const songs = data?.result?.songs ?? [];
    return songs.map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: s.artists?.map((a) => a.name).join(' / ') ?? 'Unknown',
      album: s.album?.name ?? '',
      duration: s.duration ?? 0, // ms
    }));
  }

  /**
   * Get playable MP3 URL for a song. Caches per TTL to avoid re-fetching.
   * @param {string} songId
   * @returns {Promise<{ url: string, expireAt: number }>}
   */
  async getTrackUrl(songId) {
    const cached = URL_CACHE.get(songId);
    if (cached && Date.now() - cached.fetchedAt < URL_TTL_MS) {
      return { url: cached.url, expireAt: cached.fetchedAt + URL_TTL_MS };
    }

    const res = await fetch(`${this.#base}/song/url?id=${songId}`);
    if (!res.ok) throw new Error(`Netease song/url failed: ${res.status}`);

    const data = await res.json();
    const urlEntry = data?.data?.[0];
    if (!urlEntry?.url) throw new Error(`No URL returned for song ${songId}`);

    const fetchedAt = Date.now();
    URL_CACHE.set(songId, { url: urlEntry.url, fetchedAt });
    return { url: urlEntry.url, expireAt: fetchedAt + URL_TTL_MS };
  }

  /** Evict a URL from cache (force re-fetch next time). */
  evictUrl(songId) {
    URL_CACHE.delete(songId);
  }
}

/**
 * @typedef {{ id: string, name: string, artist: string, album: string, duration: number }} Song
 */
