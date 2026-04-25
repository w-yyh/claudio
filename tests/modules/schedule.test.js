import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ScheduleModule } from '../../server/modules/schedule.js';

// 伪造 MCP Adapter
function makeMockMCP(tasks = [], connected = true) {
  return {
    isConnected: connected,
    async connect() {},
    async getTodayTasks() { return tasks; },
  };
}

function makeTask(dueOffsetMs = 60 * 60 * 1000, extra = {}) {
  const due = new Date(Date.now() + dueOffsetMs).toISOString();
  return { id: `task-${Math.random()}`, title: '测试任务', content: '', dueDate: due, priority: 1, tags: [], projectId: 'p1', ...extra };
}

describe('ScheduleModule', () => {
  test('MCP 未连接时返回空摘要', async () => {
    const s = new ScheduleModule(makeMockMCP([], false));
    const summary = await s.getTodaySummary();
    assert.deepEqual(summary.tasks, []);
    assert.equal(summary.density, 'light');
    assert.equal(summary.nextTask, null);
  });

  test('0 个任务 → density = light', async () => {
    const s = new ScheduleModule(makeMockMCP([]));
    const summary = await s.getTodaySummary();
    assert.equal(summary.density, 'light');
  });

  test('1 个任务 → density = light', async () => {
    const s = new ScheduleModule(makeMockMCP([makeTask()]));
    const summary = await s.getTodaySummary();
    assert.equal(summary.density, 'light');
  });

  test('2 个任务 → density = normal', async () => {
    const s = new ScheduleModule(makeMockMCP([makeTask(), makeTask()]));
    const summary = await s.getTodaySummary();
    assert.equal(summary.density, 'normal');
  });

  test('4 个任务 → density = heavy', async () => {
    const tasks = Array.from({ length: 4 }, () => makeTask());
    const s = new ScheduleModule(makeMockMCP(tasks));
    const summary = await s.getTodaySummary();
    assert.equal(summary.density, 'heavy');
  });

  test('nextTask 是最近一个未完成有时间的任务', async () => {
    const soon = makeTask(30 * 60 * 1000, { title: '即将到来' });
    const later = makeTask(2 * 60 * 60 * 1000, { title: '稍后任务' });
    const s = new ScheduleModule(makeMockMCP([later, soon]));
    const summary = await s.getTodaySummary();
    assert.equal(summary.nextTask?.title, '即将到来');
  });

  test('hasUpcomingTask: 5 分钟内有任务时返回任务对象', async () => {
    const urgent = makeTask(3 * 60 * 1000, { title: '紧急任务' }); // 3分钟后
    const s = new ScheduleModule(makeMockMCP([urgent]));
    const task = await s.hasUpcomingTask(5);
    assert.equal(task?.title, '紧急任务');
  });

  test('hasUpcomingTask: 超过窗口时返回 null', async () => {
    const far = makeTask(10 * 60 * 1000, { title: '远的任务' }); // 10分钟后
    const s = new ScheduleModule(makeMockMCP([far]));
    const task = await s.hasUpcomingTask(5); // 只看5分钟内
    assert.equal(task, null);
  });

  test('缓存 15 分钟内不重复调用 MCP', async () => {
    let callCount = 0;
    const mcp = {
      isConnected: true,
      async connect() {},
      async getTodayTasks() { callCount++; return []; },
    };
    const s = new ScheduleModule(mcp);
    await s.getTodaySummary();
    await s.getTodaySummary();
    assert.equal(callCount, 1, '缓存命中，MCP 应只调用一次');
  });

  test('invalidateCache 后重新调用 MCP', async () => {
    let callCount = 0;
    const mcp = {
      isConnected: true,
      async connect() {},
      async getTodayTasks() { callCount++; return []; },
    };
    const s = new ScheduleModule(mcp);
    await s.getTodaySummary();
    s.invalidateCache();
    await s.getTodaySummary();
    assert.equal(callCount, 2);
  });

  test('hasDeadlineToday: 今日有截止任务时为 true', async () => {
    const task = makeTask(1 * 60 * 60 * 1000); // 1 小时后
    const s = new ScheduleModule(makeMockMCP([task]));
    const summary = await s.getTodaySummary();
    assert.equal(summary.hasDeadlineToday, true);
  });
});
