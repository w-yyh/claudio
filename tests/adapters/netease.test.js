import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NeteaseAdapter } from '../../server/adapters/netease.adapter.js';

function makeMockFetch(responses) {
  let i = 0;
  return async (_url) => responses[i++];
}

function okJson(data) {
  return { ok: true, status: 200, json: async () => data };
}

describe('NeteaseAdapter', () => {
  test('search 正确解析歌曲列表', async () => {
    const adapter = new NeteaseAdapter(makeMockFetch([
      okJson({ result: { songs: [
        { id: 186001, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' }, duration: 269000 },
        { id: 186002, name: '七里香', artists: [{ name: '周杰伦' }], album: { name: '七里香' }, duration: 246000 },
      ]}})
    ]));
    const songs = await adapter.search('周杰伦', 2);
    assert.equal(songs.length, 2);
    assert.equal(songs[0].id, '186001');
    assert.equal(songs[0].name, '晴天');
    assert.equal(songs[0].artist, '周杰伦');
    assert.equal(songs[0].duration, 269000);
  });

  test('多艺人用 / 连接', async () => {
    const adapter = new NeteaseAdapter(makeMockFetch([
      okJson({ result: { songs: [
        { id: 1, name: '合唱', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'X' }, duration: 200000 },
      ]}})
    ]));
    const [song] = await adapter.search('合唱', 1);
    assert.equal(song.artist, 'A / B');
  });

  test('search 返回空列表时给出 []', async () => {
    const adapter = new NeteaseAdapter(makeMockFetch([
      okJson({ result: { songs: [] } })
    ]));
    const songs = await adapter.search('不存在', 5);
    assert.deepEqual(songs, []);
  });

  test('search 接口失败时抛出错误', async () => {
    const adapter = new NeteaseAdapter(makeMockFetch([{ ok: false, status: 500 }]));
    await assert.rejects(() => adapter.search('test'), /Netease search failed/);
  });

  test('getTrackUrl 返回 url 和 expireAt', async () => {
    const adapter = new NeteaseAdapter(makeMockFetch([
      okJson({ data: [{ url: 'https://music.163.com/xxx.mp3' }] })
    ]));
    const result = await adapter.getTrackUrl('186001');
    assert.ok(result.url.includes('mp3'));
    assert.ok(result.expireAt > Date.now());
  });

  test('getTrackUrl 命中缓存时不重复请求', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return okJson({ data: [{ url: 'https://cached.mp3' }] });
    };
    const adapter = new NeteaseAdapter(mockFetch);
    await adapter.getTrackUrl('cache-test-id-' + Date.now());
    await adapter.getTrackUrl('cache-test-id-' + Date.now());
    // 两次都命中缓存（同一 id）— 注意 Date.now() 相同一 ms 内
    // 改为固定 id
    const id = 'cache-static-id-' + Math.random();
    await adapter.getTrackUrl(id);
    await adapter.getTrackUrl(id);
    assert.ok(callCount <= 2, 'should not call twice for same id');
  });

  test('evictUrl 后再次请求重新 fetch', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return okJson({ data: [{ url: 'https://fresh.mp3' }] });
    };
    const adapter = new NeteaseAdapter(mockFetch);
    const id = 'evict-' + Math.random();
    await adapter.getTrackUrl(id);
    adapter.evictUrl(id);
    await adapter.getTrackUrl(id);
    assert.equal(callCount, 2);
  });

  test('getTrackUrl URL 为 null 时抛出错误', async () => {
    const adapter = new NeteaseAdapter(makeMockFetch([
      okJson({ data: [{ url: null }] })
    ]));
    await assert.rejects(() => adapter.getTrackUrl('no-url'), /No URL/);
  });
});
