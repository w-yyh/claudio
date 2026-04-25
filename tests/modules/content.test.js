import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ContentModule } from '../../server/modules/content.js';

// 创建假 FishAudioAdapter
function makeFakeFish(returnNull = false) {
  let callCount = 0;
  return {
    get callCount() { return callCount; },
    async synthesize(text) {
      callCount++;
      if (returnNull) return null;
      return Buffer.from(`fake-mp3-for-${text}`);
    },
  };
}

describe('ContentModule', () => {
  test('synthesize 成功时返回文件路径字符串', async () => {
    const fish = makeFakeFish();
    const content = new ContentModule(fish);
    const path = await content.synthesize('测试语音');
    assert.equal(typeof path, 'string');
    assert.ok(path.endsWith('.mp3'));
  });

  test('synthesize 同一文本命中缓存，Fish API 只调用一次', async () => {
    const fish = makeFakeFish();
    const content = new ContentModule(fish);

    const p1 = await content.synthesize('缓存测试');
    const p2 = await content.synthesize('缓存测试');

    assert.equal(p1, p2, '两次返回路径应相同');
    assert.equal(fish.callCount, 1, 'Fish API 应只调用一次');
  });

  test('不同文本返回不同缓存路径', async () => {
    const fish = makeFakeFish();
    const content = new ContentModule(fish);

    const p1 = await content.synthesize('文本A');
    const p2 = await content.synthesize('文本B');

    assert.notEqual(p1, p2);
    assert.equal(fish.callCount, 2);
  });

  test('Fish 返回 null 时 synthesize 返回 null', async () => {
    const fish = makeFakeFish(true);
    const content = new ContentModule(fish);
    const path = await content.synthesize('失败测试');
    assert.equal(path, null);
  });

  test('多次 synthesize 串行执行（队列不并发）', async () => {
    const order = [];
    const fish = {
      async synthesize(text) {
        await new Promise((r) => setTimeout(r, 10));
        order.push(text);
        return Buffer.from('x');
      },
    };
    const content = new ContentModule(fish);

    // 并发提交，应按提交顺序串行完成
    await Promise.all([
      content.synthesize('第一'),
      content.synthesize('第二'),
      content.synthesize('第三'),
    ]);

    assert.deepEqual(order, ['第一', '第二', '第三']);
  });

  test('clearMemoryCache 后重新合成', async () => {
    const fish = makeFakeFish();
    const content = new ContentModule(fish);

    await content.synthesize('清缓存测试');
    content.clearMemoryCache();
    await content.synthesize('清缓存测试');

    assert.equal(fish.callCount, 2);
  });

  test('preCache 不阻塞调用方', async () => {
    const fish = makeFakeFish();
    const content = new ContentModule(fish);

    const start = Date.now();
    content.preCache('预缓存内容');  // fire-and-forget
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, 'preCache 应立即返回');
  });
});
