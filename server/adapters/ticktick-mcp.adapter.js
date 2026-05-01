import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../config.js';

/**
 * TICKTICK-MCP.ADAPTER.JS — 滴答清单 MCP 客户端封装
 *
 * 连接方式：Streamable HTTP（https://mcp.dida365.com）
 * 认证：Bearer Token（环境变量 TICKTICK_API_TOKEN）
 *
 * 使用前需在滴答清单网页版创建 API 口令：
 *   头像 → 设置 → 账户与安全 → API 口令
 */
export class TickTickMCPAdapter {
  #client = null;
  #connected = false;
  #availableTools = [];
  #timezone = 'Asia/Shanghai';

  async connect() {
    if (this.#connected) return;

    const token = config.ticktick.apiToken;
    if (!token) {
      console.warn('[TickTick] TICKTICK_API_TOKEN not set — schedule unavailable');
      return;
    }

    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(config.ticktick.mcpUrl),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${token}` },
          },
        }
      );

      this.#client = new Client({ name: 'claudio', version: '0.1.0' });
      await this.#client.connect(transport);

      const { tools } = await this.#client.listTools();
      this.#availableTools = tools.map((t) => t.name);
      this.#connected = true;

      console.log('[TickTick] MCP connected. Tools:', this.#availableTools.join(', '));

      // 获取用户时区
      try {
        const r = await this.#callTool('get_user_preference', {});
        if (r?.time_zone) this.#timezone = r.time_zone;
      } catch {}
    } catch (err) {
      console.warn('[TickTick] MCP connect failed:', err.message);
      this.#connected = false;
    }
  }

  get isConnected() { return this.#connected; }

  /**
   * 获取今日未完成任务
   * @returns {Promise<Task[]>}
   */
  async getTodayTasks() {
    const raw = await this.#callTool('list_undone_tasks_by_time_query', {
      query_command: 'today',
    });
    return this.#normalizeTasks(raw);
  }

  /**
   * 获取所有项目/清单
   * @returns {Promise<Project[]>}
   */
  async getProjects() {
    const raw = await this.#callTool('list_projects', {});
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
    }));
  }

  async disconnect() {
    if (this.#client) {
      await this.#client.close().catch(() => {});
      this.#connected = false;
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  async #callTool(name, args) {
    if (!this.#connected) return null;

    try {
      const result = await this.#client.callTool({ name, arguments: args });
      const raw = result?.content?.[0]?.text;
      if (!raw) return null;

      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[TickTick] tool '${name}' failed:`, err.message);
      return null;
    }
  }

  /**
   * 将 MCP 返回的任务数据标准化为 Task[]
   * 处理单个对象 / 数组两种格式，snake_case → camelCase
   */
  #normalizeTasks(raw) {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];

    return arr.map((t) => ({
      id: t.id,
      projectId: t.project_id,
      title: t.title,
      content: t.content ?? t.desc ?? '',
      startDate: t.start_date ?? null,
      dueDate: t.due_date ?? null,
      priority: t.priority ?? 0,
      status: t.status ?? 0,
      tags: Array.isArray(t.tags) ? t.tags : [],
      completedTime: t.completed_time ?? null,
      isAllDay: t.is_all_day ?? false,
      kind: t.kind,
    }));
  }
}

/**
 * @typedef {{ id: string, projectId: string, title: string, content: string, startDate?: string, dueDate?: string, priority: number, status: number, tags: string[], completedTime?: string, isAllDay: boolean, kind: string }} Task
 * @typedef {{ id: string, name: string, color: string }} Project
 */
