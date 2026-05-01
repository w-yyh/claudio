import { TickTickMCPAdapter } from '../adapters/ticktick-mcp.adapter.js';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 分钟

/**
 * SCHEDULE.JS — 日程模块
 *
 * 封装 TickTickMCPAdapter，提供高层接口：
 *  - 今日日程摘要（带 15min 缓存）
 *  - 任务密度计算
 *  - 会议前 N 分钟检测
 */
export class ScheduleModule {
  #mcp;
  #cache = null;      // { data: ScheduleSummary, fetchedAt: number }

  constructor(mcpAdapter) {
    this.#mcp = mcpAdapter ?? new TickTickMCPAdapter();
  }

  async init() {
    await this.#mcp.connect();
  }

  /**
   * 获取今日日程摘要（命中缓存时直接返回）
   * @returns {Promise<ScheduleSummary>}
   */
  async getTodaySummary() {
    if (this.#isCacheValid()) {
      return this.#cache.data;
    }

    if (!this.#mcp.isConnected) {
      return this.#emptySummary();
    }

    try {
      const tasks = await this.#mcp.getTodayTasks();
      const summary = this.#buildSummary(tasks);
      this.#cache = { data: summary, fetchedAt: Date.now() };
      return summary;
    } catch (err) {
      console.warn('[Schedule] getTodaySummary failed:', err.message);
      return this.#cache?.data ?? this.#emptySummary();
    }
  }

  /**
   * 检测 withinMinutes 分钟内是否有即将开始的任务
   * @param {number} withinMinutes
   * @returns {Promise<Task|null>}
   */
  async hasUpcomingTask(withinMinutes = 5) {
    const summary = await this.getTodaySummary();
    const now = Date.now();
    const windowMs = withinMinutes * 60 * 1000;

    return summary.tasks.find((t) => {
      const due = t.dueDate ? new Date(t.dueDate).getTime() : null;
      const start = t.startDate ? new Date(t.startDate).getTime() : null;
      const ts = start ?? due;
      return ts && ts > now && ts - now <= windowMs;
    }) ?? null;
  }

  /** 强制刷新缓存 */
  invalidateCache() {
    this.#cache = null;
  }

  // ── private ────────────────────────────────────────────────────────────────

  #isCacheValid() {
    return this.#cache && (Date.now() - this.#cache.fetchedAt) < CACHE_TTL_MS;
  }

  #buildSummary(tasks) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd   = todayStart + 86400000;

    const timedTasks = tasks
      .filter((t) => t.status !== 2)
      .filter((t) => {
        const ts = t.dueDate ? new Date(t.dueDate).getTime() : null;
        const ss = t.startDate ? new Date(t.startDate).getTime() : null;
        const d = ts ?? ss;
        return d && d >= todayStart && d < todayEnd;
      })
      .sort((a, b) => {
        const aTime = new Date(a.startDate ?? a.dueDate).getTime();
        const bTime = new Date(b.startDate ?? b.dueDate).getTime();
        return aTime - bTime;
      });

    const upcoming = timedTasks.filter((t) => {
      const ts = t.startDate ? new Date(t.startDate).getTime()
        : t.dueDate ? new Date(t.dueDate).getTime() : 0;
      return ts > Date.now();
    });

    const nextTask = upcoming[0] ?? null;

    return {
      tasks,
      taskCount: tasks.filter((t) => t.status !== 2).length,
      taskTitles: timedTasks.map((t) => t.title),
      density: this.#calcDensity(tasks.filter((t) => t.status !== 2).length),
      nextTask,
      hasDeadlineToday: timedTasks.length > 0,
    };
  }

  #calcDensity(count) {
    if (count <= 1) return 'light';
    if (count <= 3) return 'normal';
    return 'heavy';
  }

  #emptySummary() {
    return { tasks: [], taskCount: 0, taskTitles: [], density: 'light', nextTask: null, hasDeadlineToday: false };
  }
}

/**
 * @typedef {{ tasks: Task[], density: 'light'|'normal'|'heavy', nextTask: Task|null, hasDeadlineToday: boolean }} ScheduleSummary
 */
