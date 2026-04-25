# 🎙 Claudio — AI DJ

> 让 Claude 做你的私人 DJ。结合日程、天气、心情，自动选歌 + 合成电台播报。

---

## ✨ 功能

- **上下文感知选歌** — 融合当前时段、天气、滴答清单日程、用户心情，由 Claude 决策
- **AI DJ 口白** — Claude 生成 30-60 秒自然播报，Fish Audio TTS 合成语音
- **网易云音乐** — 搜索并串流播放，URL 自动刷新
- **WebSocket 实时控制** — 播放/暂停/跳过/换歌/调音量/切换心情
- **UPnP 家庭音响** — 自动扫描 DLNA 设备推流，断联自动降级本地播放
- **滴答清单日程** — 通过 MCP 协议读取今日任务，会议前5分钟提醒
- **83 个单元测试** — 覆盖状态机、TTS 队列、日程缓存、时序控制等核心模块

---

## 架构

```
用户输入（心情）
     │
     ▼
Player（调度器）
  ├── WeatherAdapter     → OpenWeather API
  ├── ScheduleModule     → 滴答清单 MCP (https://mcp.dida365.com)
  ├── ClaudeAdapter      → claude-opus-4-6 (决策) / claude-sonnet-4-6 (快速刷新)
  ├── ContentModule      → Fish Audio TTS，串行队列 + 文件缓存
  ├── NeteaseAdapter     → NeteaseCloudMusicApi（本地运行）
  ├── TTLModule          → 歌曲剩余30秒时预生成下一段 DJ 词
  └── PlaybackMaster     → afplay (本地) / UPnP SOAP (家庭音响)

HTTP + WebSocket Server (Express + ws)
└── REST  /api/*
└── WS    ws://localhost:4000
```

### 状态机

```
IDLE ──► PROTO ──► PUB ──► PUSH ──► IDLE（循环）
           │                 │
           └──► IDLE       PAUSE ◄──► PUSH
```

---

## 快速开始

### 1. 环境要求

- Node.js 18+（推荐 20+）
- macOS（本地播放使用 `afplay`；Linux 改 `mpg123`，见配置说明）

### 2. 克隆 & 安装

```bash
git clone https://github.com/w-yyh/claudio.git
cd claudio

# 国内推荐使用镜像加速
npm install --registry=https://registry.npmmirror.com
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

| 变量 | 必填 | 说明 |
|------|------|------|
| `CLAUDE_API_KEY` | ✅ | Anthropic API Key，[获取地址](https://console.anthropic.com/) |
| `FISH_AUDIO_KEY` | ✅ | Fish Audio API Key，[获取地址](https://fish.audio/) |
| `FISH_AUDIO_REFERENCE_ID` | ❌ | TTS 声音模型 ID（留空用默认声音）|
| `NETEASE_API_URL` | ❌ | 默认 `http://localhost:3000` |
| `WEATHER_API_KEY` | ❌ | OpenWeather API Key（留空用占位数据）|
| `TICKTICK_API_TOKEN` | ❌ | 滴答清单 API 口令（留空则不读取日程）|

> **滴答清单 API 口令**：网页版 → 头像 → 设置 → 账户与安全 → API 口令

### 4. 启动网易云 API（另开终端）

```bash
npm install -g NeteaseCloudMusicApi
NeteaseCloudMusicApi   # 默认监听 :3000
```

### 5. 运行

```bash
# CLI 模式（一次性播放）
node server/index.js --mood "有点累"

# 服务器模式（HTTP + WebSocket）
node server/index.js
# → http://localhost:4000
# → ws://localhost:4000
```

---

## 测试

```bash
npm test
```

```
ℹ tests 83
ℹ pass 83
ℹ fail 0
```

覆盖模块：StateManager · EventBus · PlaybackMaster · NeteaseAdapter · WeatherAdapter · ContentModule · ScheduleModule · TTLModule · 三组 Prompt 模板

---

## WebSocket 协议

**服务端 → 客户端**

| 类型 | 说明 |
|------|------|
| `STATE_CHANGE` | 状态机转换 + 完整 context |
| `TRACK_UPDATE` | 当前播放曲目 |
| `DJ_SCRIPT` | DJ 口白文案 |
| `PROGRESS` | 播放进度 |
| `DEVICE_LIST` | UPnP 设备列表 |
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

---

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/state` | 当前状态快照 |
| POST | `/api/mood` | `{ mood }` 更新心情 |
| GET | `/api/devices` | UPnP 设备列表 |
| POST | `/api/devices/scan` | 重新扫描设备 |

---

## 项目结构

```
claudio/
├── server/
│   ├── index.js              # 服务入口（HTTP + WS + CLI 模式）
│   ├── config.js             # 统一配置
│   ├── core/
│   │   ├── player.js         # DJ 调度器（主流程）
│   │   ├── master.js         # 播放目标抽象（local / UPnP）
│   │   ├── state.js          # 全局状态机
│   │   └── event-bus.js      # 内部事件中枢
│   ├── adapters/
│   │   ├── claude.adapter.js
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
├── tests/                    # 83 个单元测试
├── scripts/
│   └── test-adapters.js      # 各 adapter 连通性测试
├── data/                     # 播放历史、心情日志
├── .env.example
└── CLAUDIO.md                # 完整技术文档
```

---

## 实现进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | CLI MVP：Claude + TTS + 网易云 + 本地播放 | ✅ 完成 |
| Phase 2 | WebSocket 服务器 + UPnP + 滴答清单 MCP + 单元测试 | ✅ 完成 |
| Phase 3 | Prompt 调优 + few-shot + 节假日感知 | 🚧 计划中 |
| Phase 4 | PWA 客户端（锁屏控制 / 字幕 / 队列可视化）| 🚧 计划中 |

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 18+ (ESM) |
| AI | Claude API (`claude-opus-4-6` / `claude-sonnet-4-6`) |
| TTS | [Fish Audio](https://fish.audio/) |
| 音乐 | [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) |
| 天气 | [OpenWeather](https://openweathermap.org/api) |
| 日程 | 滴答清单 MCP (`@modelcontextprotocol/sdk`) |
| 音响 | UPnP / DLNA (`node-ssdp` + SOAP) |
| 服务器 | Express + ws |
| 测试 | `node:test`（内置，无需额外依赖）|

---

## License

MIT
