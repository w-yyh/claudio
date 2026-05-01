# Claudio — 技术文档

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                  Electron Client                    │
│  client/main.cjs ──► preload.cjs ──► index.html    │
│         (IPC)                        (WS + Render) │
└─────────────┬───────────────────────────────────────┘
              │ WebSocket ws://localhost:4000
┌─────────────▼───────────────────────────────────────┐
│                 Express + ws Server                 │
│  server/index.js                                    │
│  ├── routes/api.js      REST /api/*                 │
│  ├── routes/ws.js       WebSocket 消息路由          │
│  └── core/player.js     DJ 调度器                   │
│       ├── adapters/llm.adapter.js      LLM 决策     │
│       ├── adapters/netease.adapter.js   音乐来源     │
│       ├── adapters/weather.adapter.js   天气信息     │
│       ├── adapters/ticktick-mcp.adapter.js 日程     │
│       ├── modules/content.js            TTS 合成     │
│       ├── modules/schedule.js           日程摘要     │
│       ├── modules/ttl.js                播放时序     │
│       └── core/master.js               跨平台播放   │
└─────────────────────────────────────────────────────┘
```

---

## 状态机

```
IDLE ──► PROTO ──► PUB ──► PUSH ──► PROTO（循环）
  ▲        │        │        │
  │        ▼        ▼        ├──► PAUSE ──► PUSH
  └────────┴────────┴────────┘
         (skip / abort / reset)
```

| 状态 | 含义 |
|------|------|
| IDLE | 待机 |
| PROTO | 收集上下文（天气、日程、每日推荐） |
| PUB | LLM 生成 DJ 口白 + 选歌 |
| PUSH | 播放中（TTS 口白 → 音乐） |
| PAUSE | 暂停 |

---

## 核心流程（一完整会话）

```
用户输入心情
  │
  ├──[并行] 天气 + 日程 + 每日推荐 30首
  │
  ├── LLM 生成 DJ 口白 → 立即推送客户端（WS: DJ_SCRIPT）
  │
  ├──[并行] TTS 合成 + LLM 从歌单选歌
  │     │
  │     ├── 品味档案（taste-profile.json）融入 Prompt
  │     ├── LLM 分析每首歌的风格/节奏/时长
  │     └── 返回最合适的 song_id
  │
  ├── 获取歌曲 mp3 URL（15min 缓存）
  │
  ├── 播放 TTS 口白 → 播放音乐（ffplay -ss -volume）
  │
  └── 记录历史 → 回到 IDLE
```

---

## 品味档案 (taste-profile.json)

由 `scripts/init-taste.mjs` 生成，分析网易云听歌排行数据：

```json
{
  "topArtists": ["Rapeter", "陶喆", "GALI", ...],
  "langPref": { "zh": 69, "en": 29 },
  "totalPlays": 3354,
  "sampleSongs": ["虹桥 — Rapeter", "天天 — 陶喆", ...]
}
```

LLM 选歌 Prompt 自动载入此档案，优先推荐匹配用户品味的歌曲。

---

## LLM 适配器

支持任意 OpenAI 兼容 API。配置环境变量即可切换：

```bash
# DeepSeek
LLM_API_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# OpenAI
LLM_API_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o

# Ollama (本地)
LLM_API_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5
```

---

## 跨平台播放器

`server/core/master.js` 自动检测平台：

| 平台 | 播放器 | 暂停 | 恢复 | 音量 |
|------|--------|------|------|------|
| Windows | ffplay（`-nodisp -autoexit`） | 进程终止 + 记位置 | 重启 `-ss N` | `-volume N` |
| macOS | afplay | SIGSTOP | SIGCONT | osascript |
| Linux | mpg123 | SIGSTOP | SIGCONT | — |

`bin/ffplay.exe` 优先加载（打包时内置），否则走系统 PATH。

---

## WebSocket 协议

### 服务端 → 客户端

| 类型 | 载荷 | 触发时机 |
|------|------|----------|
| `STATE_CHANGE` | `{ prev, next, context }` | 状态转换 |
| `TRACK_UPDATE` | `{ track }` | 新曲目选中 |
| `DJ_SCRIPT` | `{ text }` | DJ 口白就绪 |
| `PROGRESS` | `{ elapsed, duration }` | 播放开始 |
| `ERROR` | `{ message }` | 异常 |

### 客户端 → 服务端

| 命令 | 载荷 | 说明 |
|------|------|------|
| `CMD_PLAY` | `{}` | 播放 |
| `CMD_PAUSE` | `{}` | 暂停 |
| `CMD_SKIP` | `{}` | 跳过当前 |
| `CMD_VOLUME` | `{ level: 0-100 }` | 调音量 |
| `CMD_MOOD` | `{ mood: string }` | 切换心情（触发新会话） |
| `CMD_SEEK` | `{ seconds: number }` | 拖拽进度 |
| `CMD_TARGET` | `{ target, deviceUrl? }` | 切换输出设备 |

**去重策略**：`lastDJScript` 和 `lastTrackId` 追踪已广播内容，同一会话不重复发送。

---

## 客户端 UI

`client/index.html` — 纯 HTML/CSS/JS，Electron 渲染。

### 视觉规范

- **背景**：`#0d0d12` 底色 + 12px 点阵网格纹理
- **强调色**：终端绿 `#00ff41`
- **字体**：JetBrains Mono / Fira Code / Courier New
- **时钟**：LED 点阵风格，60px 等宽字体
- **ON AIR**：绿色呼吸灯 + pulse 动画
- **对话流**：DJ 消息 `> ` 前缀终端风，用户消息灰色气泡
- **曲目卡**：当前播放绿色边框 + 辉光

### 交互流程

```
输入心情 → "Claudio 思考中..." spinner
  → DJ 口白立刻显示
  → "正在挑选音乐..." spinner
  → 曲目卡片
  → 进度条开始走
```

---

## 网易云 API 接口

依赖 `NeteaseCloudMusicApi`（本地 `:3000`）：

| 端点 | 用途 |
|------|------|
| `GET /recommend/songs` | 每日推荐（可匿名） |
| `GET /user/record?uid=&type=0` | 听歌排行 |
| `GET /song/url?id=` | mp3 播放链接 |
| `GET /search?keywords=` | 关键词搜索（降级用） |

`NETEASE_COOKIE` 用于个性化推荐和听歌数据。

---

## 滴答清单 MCP

连接 `https://mcp.dida365.com`，使用 `StreamableHTTPClientTransport`。

**实际使用的工具**：
- `list_undone_tasks_by_time_query` — 获取今日未完成任务
- `get_user_preference` — 获取用户时区

**日程摘要结构**：
```json
{
  "tasks": [...],
  "taskCount": 3,
  "taskTitles": ["组会", "写周报", "Code Review"],
  "density": "normal",
  "nextTask": { "title": "组会", "dueDate": "..." },
  "hasDeadlineToday": true
}
```

---

## 测试

```bash
npm test
# 11 suites, 83 tests, node:test 内置测试框架
```

覆盖模块：StateManager · EventBus · PlaybackMaster · NeteaseAdapter · WeatherAdapter · ContentModule · ScheduleModule · TTLModule · context-builder · dj-broadcast · music-strategy

---

## npm scripts

| 命令 | 说明 |
|------|------|
| `npm start` | 启动服务器 |
| `npm run dev` | 热重载开发模式 |
| `npm run desktop` | 启动 Electron 客户端 |
| `npm test` | 运行测试 |
| `npm run test:adapters` | 适配器连通性测试 |
