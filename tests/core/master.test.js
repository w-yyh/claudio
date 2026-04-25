import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackMaster } from '../../server/core/master.js';

describe('PlaybackMaster', () => {
  test('默认 target 为 local', () => {
    const m = new PlaybackMaster();
    assert.equal(m.target, 'local');
  });

  test('setTarget 修改 target', () => {
    const m = new PlaybackMaster();
    m.setTarget('upnp');
    assert.equal(m.target, 'upnp');
  });

  test('setTarget 回到 local', () => {
    const m = new PlaybackMaster();
    m.setTarget('upnp');
    m.setTarget('local');
    assert.equal(m.target, 'local');
  });

  test('upnp target 时 playUrl 调用 upnp.playUrl', async () => {
    const m = new PlaybackMaster();
    let called = false;
    const fakeUpnp = { playUrl: async () => { called = true; } };
    m.setTarget('upnp', fakeUpnp);
    await m.playUrl('https://example.com/track.mp3');
    assert.equal(called, true);
  });

  test('upnp.playUrl 失败时降级到 local', async () => {
    const m = new PlaybackMaster();
    const fakeUpnp = { playUrl: async () => { throw new Error('UPnP error'); } };
    m.setTarget('upnp', fakeUpnp);

    // 模拟 afplay/mpg123 不存在但不抛出（ENOENT 被忽略）
    // 只需验证 target 自动降级到 local
    await m.playUrl('https://example.com/track.mp3').catch(() => {});
    assert.equal(m.target, 'local');
  });
});
