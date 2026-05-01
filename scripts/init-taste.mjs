/**
 * Claudio 品味分析脚本
 *
 * 用法：
 *   1. 启动 NeteaseCloudMusicApi：npx NeteaseCloudMusicApi
 *   2. 在 .env 中设置 NETEASE_COOKIE（浏览器登录后从 Cookie 复制 MUSIC_U）
 *   3. 运行：node scripts/init-taste.mjs
 *
 * 生成 data/taste-profile.json，供选歌时自动参考。
 */
import 'dotenv/config';
import fetch from 'node-fetch';
import { writeFile } from 'fs/promises';

const BASE = 'http://localhost:3000';
const cookie = process.env.NETEASE_COOKIE || '';

async function api(path) {
  const opts = {};
  if (cookie) opts.headers = { Cookie: cookie };
  return fetch(`${BASE}${path}`, opts).then(r => r.json());
}

// 验证登录
const s = await api('/login/status');
const uid = s?.data?.profile?.userId;
if (!uid) {
  console.log('未登录。请在 .env 中设置 NETEASE_COOKIE');
  console.log('获取方式：浏览器登录 music.163.com → F12 → Cookies → MUSIC_U');
  process.exit(1);
}
console.log(`用户: ${s.data.profile.nickname}\n`);

// 听歌排行
const rec = await api(`/user/record?uid=${uid}&type=0`);
const songs = (rec?.allData || rec?.weekData || []).slice(0, 50);
const totalPlays = songs.reduce((sum, s) => sum + s.playCount, 0);

console.log('=== TOP 15 ===');
songs.slice(0, 15).forEach((s, i) => {
  const name = s.song?.name || '?';
  const artist = (s.song?.ar || []).map(a => a.name).join('/');
  console.log(`${i + 1}. ${name} — ${artist} (${s.playCount}次)`);
});

// 偏好分析
const artistFreq = {};
songs.forEach(s => {
  (s.song?.ar || []).forEach(a => {
    artistFreq[a.name] = (artistFreq[a.name] || 0) + s.playCount;
  });
});
const topArtists = Object.entries(artistFreq)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);

let zh = 0, en = 0, kr = 0, jp = 0;
songs.forEach(s => {
  const t = s.song?.name + (s.song?.ar || []).map(a => a.name).join('');
  if (/[\u4e00-\u9fff]/.test(t)) zh += s.playCount;
  else if (/[\uac00-\ud7af]/.test(t)) kr += s.playCount;
  else if (/[\u3040-\u30ff]/.test(t)) jp += s.playCount;
  else en += s.playCount;
});

console.log('\n=== 品味分析 ===');
console.log(`总播放: ${totalPlays}`);
console.log(`偏爱歌手: ${topArtists.map(([n, c]) => `${n}(${c})`).join(', ')}`);
console.log(`语言: 中文${Math.round(zh / totalPlays * 100)}% 英文${Math.round(en / totalPlays * 100)}%`);

const profile = {
  topArtists: topArtists.map(([n]) => n),
  langPref: { zh: Math.round(zh / totalPlays * 100), en: Math.round(en / totalPlays * 100) },
  totalPlays,
  sampleSongs: songs.slice(0, 20).map(s =>
    `${s.song?.name} — ${(s.song?.ar || []).map(a => a.name).join('/')}`
  ),
};
await writeFile('data/taste-profile.json', JSON.stringify(profile, null, 2));
console.log('\n品味档案已保存 → data/taste-profile.json');
