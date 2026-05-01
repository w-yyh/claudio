import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMusicStrategyMessages } from '../../server/prompts/music-strategy.js';

function makeCtx(overrides = {}) {
  return {
    env: { timePeriod: '上午', dayType: '工作日', timeISO: new Date().toISOString(), weather: null, ...overrides.env },
    work: { density: null, nextTask: null, hasDeadlineToday: false, available: false, ...overrides.work },
    personal: { mood: null, recentTrackIds: [], ...overrides.personal },
  };
}

function allContent(msgs) {
  return msgs.map((m) => m.content).join('\n');
}

describe('music-strategy prompt', () => {
  test('返回非空 messages 数组', () => {
    const msgs = buildMusicStrategyMessages(makeCtx());
    assert.ok(Array.isArray(msgs) && msgs.length > 0);
  });

  test('消息角色为 system 和 user', () => {
    const msgs = buildMusicStrategyMessages(makeCtx());
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[1].role, 'user');
  });

  test('prompt 要求严格 JSON 输出', () => {
    const msgs = buildMusicStrategyMessages(makeCtx());
    assert.ok(allContent(msgs).includes('JSON'));
  });

  test('有 mood 时 prompt 包含心情', () => {
    const msgs = buildMusicStrategyMessages(makeCtx({ personal: { mood: '焦虑', recentTrackIds: [] } }));
    assert.ok(allContent(msgs).includes('焦虑'));
  });

  test('有历史 ID 时 prompt 包含排除列表', () => {
    const msgs = buildMusicStrategyMessages(makeCtx({
      personal: { mood: null, recentTrackIds: ['12345', '67890'] },
    }));
    assert.ok(allContent(msgs).includes('12345'));
  });

  test('prompt 包含 keywords 字段说明', () => {
    const msgs = buildMusicStrategyMessages(makeCtx());
    assert.ok(allContent(msgs).includes('keywords'));
  });
});
