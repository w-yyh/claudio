import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDJBroadcastMessages } from '../../server/prompts/dj-broadcast.js';

function makeCtx(overrides = {}) {
  return {
    env: { timePeriod: '上午', dayType: '工作日', timeISO: new Date().toISOString(), weather: null, ...overrides.env },
    work: { density: null, nextTask: null, hasDeadlineToday: false, available: false, ...overrides.work },
    personal: { mood: null, recentTrackIds: [], ...overrides.personal },
  };
}

describe('dj-broadcast prompt', () => {
  test('返回非空 messages 数组', () => {
    const msgs = buildDJBroadcastMessages(makeCtx());
    assert.ok(Array.isArray(msgs) && msgs.length > 0);
  });

  test('消息角色为 user', () => {
    const msgs = buildDJBroadcastMessages(makeCtx());
    assert.equal(msgs[0].role, 'user');
  });

  test('prompt 包含时段信息', () => {
    const msgs = buildDJBroadcastMessages(makeCtx());
    assert.ok(msgs[0].content.includes('上午'));
  });

  test('有 mood 时 prompt 包含心情', () => {
    const msgs = buildDJBroadcastMessages(makeCtx({ personal: { mood: '很开心', recentTrackIds: [] } }));
    assert.ok(msgs[0].content.includes('很开心'));
  });

  test('有天气时 prompt 包含天气描述', () => {
    const weather = { city: 'Shanghai', description: '小雨', temp: 18, feelsLike: 16, humidity: 80 };
    const msgs = buildDJBroadcastMessages(makeCtx({ env: { timePeriod: '下午', dayType: '周末', weather } }));
    assert.ok(msgs[0].content.includes('小雨'));
  });

  test('有 regenerationReason 时 prompt 包含重新生成说明', () => {
    const msgs = buildDJBroadcastMessages(makeCtx(), { regenerationReason: '用户跳过' });
    assert.ok(msgs[0].content.includes('用户跳过'));
  });

  test('有日程时 prompt 包含日程密度', () => {
    const ctx = makeCtx({ work: { density: 'heavy', nextTask: null, hasDeadlineToday: true, available: true } });
    const msgs = buildDJBroadcastMessages(ctx);
    assert.ok(msgs[0].content.includes('heavy'));
  });

  test('有 nextTask 时 prompt 包含任务标题', () => {
    const ctx = makeCtx({
      work: { density: 'normal', nextTask: { title: '周报', dueDate: '2025-04-25T18:00:00Z' }, hasDeadlineToday: false, available: true },
    });
    const msgs = buildDJBroadcastMessages(ctx);
    assert.ok(msgs[0].content.includes('周报'));
  });
});
