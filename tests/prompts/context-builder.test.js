import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDJContext } from '../../server/prompts/context-builder.js';

describe('context-builder', () => {
  test('buildDJContext 返回三维度结构', async () => {
    const ctx = await buildDJContext({ mood: '平静' });
    assert.ok(ctx.env, 'env 维度存在');
    assert.ok(ctx.work, 'work 维度存在');
    assert.ok(ctx.personal, 'personal 维度存在');
  });

  test('mood 正确传入 personal.mood', async () => {
    const ctx = await buildDJContext({ mood: '有点累' });
    assert.equal(ctx.personal.mood, '有点累');
  });

  test('无 mood 时 personal.mood 为 null', async () => {
    const ctx = await buildDJContext();
    assert.equal(ctx.personal.mood, null);
  });

  test('env.timePeriod 是有效时段字符串', async () => {
    const ctx = await buildDJContext();
    const valid = ['早晨', '上午', '午休', '下午', '傍晚', '夜间'];
    assert.ok(valid.includes(ctx.env.timePeriod), `invalid timePeriod: ${ctx.env.timePeriod}`);
  });

  test('env.dayType 是工作日或周末', async () => {
    const ctx = await buildDJContext();
    assert.ok(['工作日', '周末'].includes(ctx.env.dayType));
  });

  test('weather 数据被传入 env.weather', async () => {
    const weather = { city: 'Beijing', temp: 20, description: '晴', condition: 'sunny', feelsLike: 19, humidity: 45 };
    const ctx = await buildDJContext({ weather });
    assert.deepEqual(ctx.env.weather, weather);
  });

  test('无 schedule 时 work.available 为 false', async () => {
    const ctx = await buildDJContext();
    assert.equal(ctx.work.available, false);
  });

  test('传入 schedule 时 work.available 为 true', async () => {
    const schedule = { density: 'light', nextTask: null, hasDeadlineToday: false, tasks: [] };
    const ctx = await buildDJContext({ schedule });
    assert.equal(ctx.work.available, true);
    assert.equal(ctx.work.density, 'light');
  });

  test('personal.recentTrackIds 是数组', async () => {
    const ctx = await buildDJContext();
    assert.ok(Array.isArray(ctx.personal.recentTrackIds));
  });
});
