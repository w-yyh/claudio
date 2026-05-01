import fetch from 'node-fetch';
import { config } from '../config.js';

const URL_CACHE = new Map();
const URL_TTL_MS = 15 * 60 * 1000;

export class NeteaseAdapter {
  #base;
  #fetch;
  #uid = null;
  #cookie = '';

  constructor(fetchFn) {
    this.#base  = config.netease.apiUrl.replace(/\/$/, '');
    this.#fetch = fetchFn ?? fetch;
    this.#cookie = config.netease.cookie ?? '';
  }

  #authFetch(url) {
    const opts = {};
    if (this.#cookie) opts.headers = { Cookie: this.#cookie };
    return this.#fetch(url, opts);
  }

  // ── Auth ─────────────────────────────────────────────────────────────

  /** 检查登录状态，返回 { uid, nickname } 或 null */
  async getLoginStatus() {
    try {
      const res = await this.#authFetch(`${this.#base}/login/status`);
      const d = await res.json();
      const profile = d?.data?.profile;
      if (profile?.userId) {
        this.#uid = profile.userId;
        return { uid: profile.userId, nickname: profile.nickname };
      }
      return null;
    } catch { return null; }
  }

  /** 生成二维码登录 key 和 qr 图片 URL */
  async createQRLogin() {
    // 1. 获取 key
    const kRes = await this.#fetch(`${this.#base}/login/qr/key`);
    const kData = await kRes.json();
    const key = kData?.data?.unikey;
    if (!key) throw new Error('Failed to get QR key');

    // 2. 生成二维码
    const qRes = await this.#fetch(
      `${this.#base}/login/qr/create?key=${key}&qrimg=true`
    );
    const qData = await qRes.json();
    return {
      key,
      qrUrl: qData?.data?.qrimg ?? null,
    };
  }

  /** 检查二维码是否被扫过 */
  async checkQRLogin(key) {
    const res = await this.#fetch(`${this.#base}/login/qr/check?key=${key}`);
    const d = await res.json();
    if (d.code === 803) {
      // 登录成功
      return { status: 'ok', cookie: d.cookie };
    }
    if (d.code === 800) return { status: 'expired' };
    if (d.code === 801) return { status: 'waiting' };
    if (d.code === 802) return { status: 'scanned' };
    return { status: 'unknown', code: d.code };
  }

  /** 手机号登录 */
  async loginCellphone(phone, password) {
    const res = await this.#fetch(
      `${this.#base}/login/cellphone?phone=${phone}&password=${encodeURIComponent(password)}`
    );
    const d = await res.json();
    if (d.code === 200) {
      this.#uid = d.account?.id;
      return this.#uid;
    }
    throw new Error(d.message || 'Login failed');
  }

  get uid() { return this.#uid; }

  // ── Playlists ──────────────────────────────────────────────────────

  /** 获取用户歌单列表 */
  async getUserPlaylists(uid) {
    const res = await this.#fetch(`${this.#base}/user/playlist?uid=${uid}`);
    const d = await res.json();
    return (d?.playlist ?? []).map((p) => ({
      id: String(p.id),
      name: p.name,
      trackCount: p.trackCount,
      creator: p.creator?.nickname,
      subscribed: p.subscribed,
    }));
  }

  /** 获取歌单内歌曲 */
  async getPlaylistSongs(playlistId, limit = 500) {
    const res = await this.#fetch(
      `${this.#base}/playlist/track/all?id=${playlistId}&limit=${limit}`
    );
    const d = await res.json();
    const songs = d?.songs ?? [];
    return songs.map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar ?? []).map((a) => a.name).join(' / '),
      album: s.al?.name ?? '',
      duration: s.dt ?? 0,
    }));
  }

  /** 获取所有歌单的所有歌曲（去重） */
  async getAllPlaylistSongs(uid) {
    const playlists = await this.getUserPlaylists(uid);
    const seen = new Set();
    const all = [];

    for (const pl of playlists) {
      try {
        const songs = await this.getPlaylistSongs(pl.id, 200);
        for (const s of songs) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            s.playlist = pl.name;
            all.push(s);
          }
        }
      } catch { /* skip problematic playlist */ }
    }

    return all;
  }

  /** 获取每日推荐歌曲（带推荐理由） */
  async getRecommendSongs() {
    const res = await this.#authFetch(`${this.#base}/recommend/songs`);
    const d = await res.json();
    const songs = d?.data?.dailySongs ?? [];
    return songs.map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar ?? []).map((a) => a.name).join(' / '),
      album: s.al?.name ?? '',
      duration: s.dt ?? 0,
      reason: s.reason ?? s.recommendReason ?? '',
    }));
  }

  // ── Search ──────────────────────────────────────────────────────────

  async search(keywords, limit = 10) {
    const url = `${this.#base}/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`;
    const res = await this.#fetch(url);
    if (!res.ok) throw new Error(`Netease search failed: ${res.status}`);

    const data = await res.json();
    const songs = data?.result?.songs ?? [];
    return songs.map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: s.artists?.map((a) => a.name).join(' / ') ?? 'Unknown',
      album: s.album?.name ?? '',
      duration: s.duration ?? 0,
    }));
  }

  async getTrackUrl(songId) {
    const cached = URL_CACHE.get(songId);
    if (cached && Date.now() - cached.fetchedAt < URL_TTL_MS) {
      return { url: cached.url, expireAt: cached.fetchedAt + URL_TTL_MS };
    }

    const res = await this.#fetch(`${this.#base}/song/url?id=${songId}`);
    if (!res.ok) throw new Error(`Netease song/url failed: ${res.status}`);

    const data = await res.json();
    const urlEntry = data?.data?.[0];
    if (!urlEntry?.url) throw new Error(`No URL returned for song ${songId}`);

    const fetchedAt = Date.now();
    URL_CACHE.set(songId, { url: urlEntry.url, fetchedAt });
    return { url: urlEntry.url, expireAt: fetchedAt + URL_TTL_MS };
  }

  evictUrl(songId) {
    URL_CACHE.delete(songId);
  }
}
