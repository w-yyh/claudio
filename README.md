# Claudio — AI DJ

> AI 驱动的私人电台 DJ。结合日程、天气、心情和你的音乐品味，每日推荐中智能选歌 + 合成电台播报。

---

## 功能

- **上下文感知选歌** — 融合当前时段、天气、滴答清单日程、用户心情、听歌品味档案，由 LLM 决策
- **AI DJ 口白** — LLM 生成 30-60 秒自然播报（Fish Audio TTS 合成语音，可降级）
- **网易云每日推荐** — 读取每日推荐歌单，LLM 分析每首歌的风格和节奏后选择最合适的
- **品味档案** — 分析你的听歌排行，提取偏爱歌手和语言偏好，融入选歌决策
- **Electron 桌面客户端** — 赛博极简暗色 UI，终端风格对话流，进度条拖拽
- **WebSocket 实时控制** — 播放/暂停/跳过/拖拽进度/调音量/切换心情
- **UPnP 家庭音响** — 自动扫描 DLNA 设备推流，断联自动降级本地播放
- **滴答清单日程** — 通过 MCP 协议读取今日任务，影响音乐风格选择
- **跨平台** — Windows / macOS / Linux 均支持本地播放

---

## 快速开始

### 1. 环境要求

- Node.js 18+
- ffmpeg（Windows 需安装，macOS 自带 afplay，Linux 需 mpg123）

### 2. 安装

```bash
git clone https://github.com/w-yyh/claudio.git
cd claudio
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

| 变量 | 必填 | 说明 |
|------|------|------|
| `LLM_API_KEY` | ✅ | LLM API Key（DeepSeek / OpenAI 等） |
| `LLM_API_URL` | ❌ | 默认 `https://api.deepseek.com/v1` |
| `LLM_MODEL` | ❌ | 默认 `deepseek-chat` |
| `FISH_AUDIO_KEY` | ❌ | Fish Audio TTS Key（不填则用默认口白文字） |
| `NETEASE_API_URL` | ❌ | 默认 `http://localhost:3000` |
| `NETEASE_COOKIE` | ❌ | 浏览器登录网易云后复制 `MUSIC_U`（启用个性化推荐） |
| `WEATHER_API_KEY` | ❌ | OpenWeather API Key（留空用占位数据） |
| `TICKTICK_API_TOKEN` | ❌ | 滴答清单 API 口令（留空则不读取日程） |

### 4. 启动网易云 API（另开终端）

```bash
npx NeteaseCloudMusicApi   # 默认 http://localhost:3000
```

### 5. 分析品味档案（可选）

```bash
node scripts/init-taste.mjs
```

### 6. 运行

```bash
# CLI 模式
npm start -- --mood "有点累"

# 服务器模式
npm start               # → http://localhost:4000

# 桌面客户端（另开终端）
npm run desktop          # → Electron 窗口
```

---

## 架构

```
用户输入（心情）
     │
     ▼
Player（调度器）
  ├── WeatherAdapter     → OpenWeather API
  ├── ScheduleModule     → 滴答清单 MCP (https://mcp.dida365.com)
  ├── LLMAdapter         → DeepSeek / OpenAI / 任意兼容 API
  ├── ContentModule      → Fish Audio TTS，串行队列 + 文件缓存
  ├── NeteaseAdapter     → 每日推荐 + 关键词搜索 + 播放 URL
  ├── TasteProfile       → 听歌排行分析，偏好融入 LLM Prompt
  ├── TTLModule          → 歌曲剩余30秒时预生成下一段 DJ 词
  └── PlaybackMaster     → ffplay(Windows) / afplay(macOS) / mpg123(Linux)
                           └── UPnP SOAP (家庭音响)
  └── bin/               → 本地 ffplay 二进制（打包时自带）

HTTP + WebSocket Server (Express + ws)
├── REST  /api/*
└── WS    ws://localhost:4000

Electron Client (client/)
├── main.cjs             → 无边框透明窗口
├── preload.cjs          → IPC 桥接
└── index.html           → 赛博暗色 UI
```

---

## 测试

```bash
npm test   # 83 个单元测试
```

---

## WebSocket 协议

**服务端 → 客户端**

| 类型 | 说明 |
|------|------|
| `STATE_CHANGE` | 状态机转换 + 完整 context |
| `TRACK_UPDATE` | 当前播放曲目 |
| `DJ_SCRIPT` | DJ 口白文案 |
| `PROGRESS` | 播放进度 |
| `ERROR` | 错误信息 |

**客户端 → 服务端**

| 命令 | 参数 |
|------|------|
| `CMD_PLAY` | — |
| `CMD_PAUSE` | — |
| `CMD_SKIP` | — |
| `CMD_VOLUME` | `{ level: 0-100 }` |
| `CMD_MOOD` | `{ mood: string }` |
| `CMD_TARGET` | `{ target: "local"\|"upnp", deviceUrl? }` |
| `CMD_SEEK` | `{ seconds: number }` |

---

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/state` | 当前状态快照 |
| POST | `/api/mood` | `{ mood }` 更新心情 |
| GET | `/api/devices` | UPnP 设备列表 |
| POST | `/api/devices/scan` | 重新扫描设备 |
| GET | `/api/upnp-file` | UPnP 本地文件服务 |

---

## 项目结构

```
claudio/
├── server/
│   ├── index.js              # 服务入口（HTTP + WS + CLI）
│   ├── config.js             # 统一配置
│   ├── core/
│   │   ├── player.js         # DJ 调度器（主流程）
│   │   ├── master.js         # 跨平台播放器
│   │   ├── state.js          # 全局状态机
│   │   └── event-bus.js      # 内部事件中枢
│   ├── adapters/
│   │   ├── llm.adapter.js    # OpenAI 兼容 LLM
│   │   ├── netease.adapter.js
│   │   ├── fish-audio.adapter.js
│   │   ├── weather.adapter.js
│   │   └── ticktick-mcp.adapter.js
│   ├── modules/
│   │   ├── content.js        # TTS 队列 + 缓存
│   │   ├── schedule.js       # 日程摘要 + 缓存
│   │   ├── ttl.js            # 播放时序控制
│   │   └── upnp.js           # UPnP/DLNA 推流
│   ├── prompts/
│   │   ├── context-builder.js
│   │   ├── dj-broadcast.js
│   │   └── music-strategy.js
│   └── routes/
│       ├── api.js
│       └── ws.js
├── client/                   # Electron 桌面客户端
│   ├── main.cjs
│   ├── preload.cjs
│   └── index.html
├── bin/                      # 本地二进制（ffplay）
├── data/                     # 播放历史 / 品味档案 / TTS 缓存
│   ├── history.json
│   └── taste-profile.json
├── tests/                    # 83 个单元测试
├── scripts/
│   └── init-taste.mjs        # 品味分析脚本
└── .env.example
```

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 18+ (ESM) |
| LLM | DeepSeek / OpenAI / 任意兼容 API |
| TTS | Fish Audio（可选降级） |
| 音乐 | NeteaseCloudMusicApi |
| 天气 | OpenWeather |
| 日程 | 滴答清单 MCP |
| 桌面 | Electron |
| 播放 | ffplay / afplay / mpg123 |
| 音响 | UPnP / DLNA (node-ssdp + SOAP) |
| 服务器 | Express + ws |
| 测试 | node:test（内置） |

---

## License

MIT
