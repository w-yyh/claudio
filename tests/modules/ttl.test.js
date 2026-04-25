import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TTLModule } from '../../server/modules/ttl.js';

describe('TTLModule', () => {
  let ttl;

  beforeEach(() => {
    ttl = new TTLModule();
  });

  test('start 后 elapsed 应 >= 0', (_, done) => {
    ttl.start(5000);
    setTimeout(() => {
      assert.ok(ttl.elapsed >= 0);
      ttl.stop();
      done();
    }, 20);
  });

  test('remaining = duration - elapsed（近似）', (_, done) => {
    const dur = 2000;
    ttl.start(dur);
    setTimeout(() => {
      const sum = ttl.elapsed + ttl.remaining;
      assert.ok(Math.abs(sum - dur) < 100, `sum ${sum} should be ~${dur}`);
      ttl.stop();
      done();
    }, 50);
  });

  test('PRE_GENERATE 在 duration - 30s 后触发', (_, done) => {
    // 短歌曲：200ms 总时长，PRE_GENERATE 应在 duration < 30s 时立即触发
    let fired = false;
    ttl.on('PRE_GENERATE', () => { fired = true; });
    ttl.start(200); // 200ms < 30s，立即触发
    setTimeout(() => {
      assert.equal(fired, true);
      ttl.stop();
      done();
    }, 50);
  });

  test('TRACK_ENDED 在 duration 后触发', (_, done) => {
    let fired = false;
    ttl.on('TRACK_ENDED', () => { fired = true; });
    ttl.start(100);
    setTimeout(() => {
      assert.equal(fired, true);
      done();
    }, 200);
  });

  test('stop 后 TRACK_ENDED 不触发', (_, done) => {
    let fired = false;
    ttl.on('TRACK_ENDED', () => { fired = true; });
    ttl.start(100);
    ttl.stop();  // 立即停止
    setTimeout(() => {
      assert.equal(fired, false);
      done();
    }, 200);
  });

  test('stop 后 elapsed 为 0', () => {
    ttl.start(5000);
    ttl.stop();
    assert.equal(ttl.elapsed, 0);
  });

  test('重复 start 重置计时', (_, done) => {
    let endCount = 0;
    ttl.on('TRACK_ENDED', () => endCount++);
    ttl.start(50);
    ttl.start(50); // 重置
    setTimeout(() => {
      assert.equal(endCount, 1, '重置后只应触发一次');
      done();
    }, 150);
  });
});
