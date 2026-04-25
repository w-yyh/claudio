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

      // 发现可用 tools
      const { tools } = await this.#client.listTools();
      this.#availableTools = tools.map((t) => t.name);
      this.#connected = true;

      console.log('[TickTick] MCP connected. Tools:', this.#availableTools.join(', '));
    } catch (err) {
      console.warn('[TickTick] MCP connect failed:', err.message);
      this.#connected = false;
    }
  }

  get isConnected() { return this.#connected; }

  /**
   * 获取今日有 dueDate 的任务
   * @returns {Promise<Task[]>}
   */
  async getTodayTasks() {
    return this.#callTool(
      ['get_today_tasks', 'getTodayTasks', 'list_today_tasks'],
      {},
      []
    );
  }

  /**
   * 获取指定时间范围内的任务
   * @param {string} startISO
   * @param {string} endISO
   * @returns {Promise<Task[]>}
   */
  async getTasksInRange(startISO, endISO) {
    return this.#callTool(
      ['get_tasks_in_range', 'getTasksInRange', 'list_tasks'],
      { startDate: startISO, endDate: endISO },
      []
    );
  }

  /**
   * 获取所有项目/清单
   * @returns {Promise<Project[]>}
   */
  async getProjects() {
    return this.#callTool(
      ['get_projects', 'getProjects', 'list_projects'],
      {},
      []
    );
  }

  async disconnect() {
    if (this.#client) {
      await this.#client.close().catch(() => {});
      this.#connected = false;
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * 按优先级尝试 toolNames 列表，调用第一个匹配的 tool
   */
  async #callTool(toolNames, args, fallback) {
    if (!this.#connected) return fallback;

    const name = toolNames.find((n) => this.#availableTools.includes(n));
    if (!name) {
      console.warn('[TickTick] None of tools found:', toolNames.join(', '),
        '— available:', this.#availableTools.join(', '));
      return fallback;
    }

    try {
      const result = await this.#client.callTool({ name, arguments: args });
      // MCP tool 返回值通常在 content[0].text（JSON 字符串）
      const raw = result?.content?.[0]?.text ?? result?.content;
      if (!raw) return fallback;

      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : (parsed.tasks ?? parsed.items ?? fallback);
    } catch (err) {
      console.warn(`[TickTick] tool '${name}' failed:`, err.message);
      return fallback;
    }
  }
}

/**
 * @typedef {{ id: string, title: string, content: string, startDate?: string, dueDate?: string, priority: 0|1|3|5, tags: string[], projectId: string }} Task
 * @typedef {{ id: string, name: string, color: string }} Project
 */
