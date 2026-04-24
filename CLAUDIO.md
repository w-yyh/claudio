# Claudio — AI DJ 项目文档

> 个人 AI 电台：由 Claude 扮演 DJ 大脑，结合日程、天气、心情，自动选歌 + 合成 DJ 语音播报。

---

## 目录

1. [项目愿景](#1-项目愿景)
2. [技术栈](#2-技术栈)
3. [整体架构](#3-整体架构)
4. [数据流（一次完整 DJ 会话）](#4-数据流)
5. [当前实现状态（Phase 1 ✅）](#5-当前实现状态)
6. [文件结构详解](#6-文件结构详解)
7. [在新电脑上部署](#7-在新电脑上部署)
8. [环境变量说明](#8-环境变量说明)
9. [API Key 申请指南](#9-api-key-申请指南)
10. [下一步：Phase 2 — 功能模块完善](#10-phase-2-功能模块完善)
11. [下一步：Phase 3 — 智能 Prompt 系统](#11-phase-3-智能-prompt-系统)
12. [下一步：Phase 4 — PWA 完整客户端](#12-phase-4-pwa-完整客户端)
13. [已知问题 & 注意事项](#13-已知问题--注意事项)
14. [故障排查](#14-故障排查)

---

## 1. 项目愿景

Claudio 是一个运行在本地的私人 AI 电台。每次启动，Claude 会：

1. 读取当前时间、天气、滴答清单日程
2. 结合用户当前心情，生成 30-60 秒的 DJ 口白（温暖、幽默、不油腻的人格 "Claudio"）
3. 用 Fish Audio TTS 合成语音播报
4. 通过网易云音乐搜索并播放一首匹配心情的歌
5. 循环：歌曲快结束时，提前生成下一段 DJ 词，无缝衔接

目标形态：手机 PWA 控制台 + 家庭 UPnP 音响推流，像一个永远在线的私人 DJ。

---

## 2. 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 运行时 | Node.js 18+ | ESM 模块（`"type": "module"`） |
| AI 大脑 | Claude API | opus-4-6（决策）/ sonnet-4-6（快速刷新） |
| 音乐源 | NeteaseCloudMusicApi | 第三方非官方 API，需单独启动 |
| TTS | Fish Audio API | `https://api.fish.audio/v1/tts`，支持声音克隆 |
| 天气 | OpenWeather API | 免费层足够（60次/分钟） |
| 日程 | 滴答清单 MCP Server | Phase 2 接入，通过 `@modelcontextprotocol/sdk` |
| 前端 | PWA | Phase 4 实现 |
| 家庭音响 | UPnP | Phase 2 实现，降级到本地 `afplay` |
| 本地播放 | macOS `afplay` | Phase 1 仅支持 macOS，Linux 改 `mpg123` |

---

## 3. 整体架构

```
用户输入（心情）
      │
      ▼
┌─────────────────────────────────────────┐
│              server/core/player.js       │  ← DJ 大脑调度器
│                                         │
│  1. WeatherAdapter  → 获取天气           │
│  2. context-builder → 拼装三维度上下文   │
│  3. ClaudeAdapter   → DJ 决策           │
│     ├─ dj-broadcast.js → 口白文案       │
│     └─ music-strategy.js → 选歌JSON    │
│  4. FishAudioAdapter → TTS 合成        │
│  5. NeteaseAdapter  → 搜索+获取URL     │
│  6. afplay          → 本地播放          │
│  7. history.json    → 记录历史          │
└─────────────────────────────────────────┘
      │
      ▼
server/core/state.js  ← 全局状态机
（IDLE → PROTO → PUB → PUSH → IDLE）

server/core/event-bus.js ← 内部事件中枢
（STATE_CHANGE / SESSION_COMPLETE / SKIPPED）
```

### 状态机转换图

```
IDLE ──► PROTO ──► PUB ──► PUSH
  ▲        │               │  │
  │        └──► IDLE       │  └──► PAUSE
  │                        │          │
  └────────────────────────┘          │
           (直接 stop)        PAUSE ──┘
                             （PAUSE → PUSH 恢复）
```

| 状态 | 含义 |
|------|------|
| IDLE | 待机 |
| PROTO | 正在构建上下文 + 请求 Claude |
| PUB | Claude 返回，正在合成 TTS + 搜歌 |
| PUSH | 正在播放（TTS 口白 → 音乐） |
| PAUSE | 已暂停 |

---

## 4. 数据流

一次完整 DJ 会话（`startSession("有点累")`）的执行流程：

```
startSession("有点累")
│
├─ state.reset() → IDLE
├─ state.transition('PROTO', {mood: "有点累"})
│
├─ [并行] WeatherAdapter.getCurrentWeather()
│     └─ GET openweathermap.org → WeatherInfo
│
├─ buildDJContext({mood, weather})
│     ├─ 读取 data/history.json（最近20条）
│     ├─ 计算 timePeriod（早晨/上午/午休/下午/傍晚/夜间）
│     └─ 返回 DJContext{env, work, personal}
│
├─ state.transition('PUB')
│
├─ ClaudeAdapter.getDJDecision(ctx)  ← 并行两个 Claude 调用
│     ├─ buildDJBroadcastMessages(ctx) → claude-opus-4-6 → script
│     └─ buildMusicStrategyMessages(ctx) → claude-opus-4-6 → strategy JSON
│           {keywords:["治愈"], bpm_range:[60,90], mood_tags:["疗愈"], exclude_ids:[...]}
│
├─ FishAudioAdapter.synthesize(script)
│     └─ POST api.fish.audio → MP3 buffer → 写入 data/dj_1234567890.mp3
│
├─ NeteaseAdapter.search("治愈", 10)
│     └─ GET localhost:3000/search → Song[]
│     └─ 过滤 exclude_ids → 选 track
│
├─ state.transition('PUSH', {currentTrack, queue})
│
├─ NeteaseAdapter.getTrackUrl(track.id)
│     └─ GET localhost:3000/song/url → {url, expireAt}
│
├─ #play(ttsPath, trackUrl, track)
│     ├─ afplay data/dj_xxx.mp3  （DJ 口白）
│     └─ afplay <netease-url>    （音乐）
│
├─ #appendHistory(entry) → data/history.json
│
└─ state.transition('IDLE')
   eventBus.emit('SESSION_COMPLETE')
```

---

## 5. 当前实现状态

### Phase 1 ✅ 已完成（2025-04-24）

| 文件 | 状态 | 说明 |
|------|------|------|
| `package.json` | ✅ | 依赖已安装（150个包） |
| `.env.example` | ✅ | 所有变量模板 |
| `server/config.js` | ✅ | 统一配置，require_env 校验 |
| `server/core/event-bus.js` | ✅ | EventEmitter 封装 |
| `server/core/state.js` | ✅ | 完整状态机，合法转换校验 |
| `server/adapters/claude.adapter.js` | ✅ | getDJDecision + regenerateScript |
| `server/adapters/netease.adapter.js` | ✅ | search + getTrackUrl（15min缓存） |
| `server/adapters/fish-audio.adapter.js` | ✅ | synthesize → MP3 buffer |
| `server/adapters/weather.adapter.js` | ✅ | getCurrentWeather，无key时占位 |
| `server/prompts/context-builder.js` | ✅ | 三维度上下文构建 |
| `server/prompts/dj-broadcast.js` | ✅ | Claudio 人格 prompt |
| `server/prompts/music-strategy.js` | ✅ | 选歌策略 prompt，JSON 输出 |
| `server/core/player.js` | ✅ | 完整 DJ 链路 |
| `server/index.js` | ✅ | CLI 入口，`--mood` 参数 |
| `scripts/test-adapters.js` | ✅ | 4 个 adapter 连通测试 |

**Phase 1 验收命令：**
```bash
node server/index.js --mood "有点累"
# 预期：打印 DJ 口白 → 播放 TTS 语音 → 播放一首歌
```

### Phase 2-4 ❌ 待实现

详见下方各 Phase 章节。

---

## 6. 文件结构详解

```
claudio/
├── .env.example          # 环境变量模板，复制为 .env 并填入真实值
├── .gitignore            # 排除 node_modules、.env、生成的音频文件
├── package.json          # ESM 项目配置，"type":"module"
│
├── server/
│   ├── index.js          # 入口：解析 --mood 参数，实例化 Player，run
│   ├── config.js         # 统一读取 process.env，export config 对象
│   │
│   ├── core/
│   │   ├── state.js      # 全局状态机单例 export const state
│   │   ├── player.js     # DJ 调度器，orchestrates all adapters
│   │   ├── master.js     # [Phase 2] 播放目标抽象（local/upnp）
│   │   └── event-bus.js  # 内部 EventEmitter 单例
│   │
│   ├── adapters/
│   │   ├── claude.adapter.js       # Claude API 封装
│   │   ├── netease.adapter.js      # 网易云音乐 API 封装
│   │   ├── fish-audio.adapter.js   # Fish Audio TTS 封装
│   │   ├── weather.adapter.js      # OpenWeather 封装
│   │   └── ticktick-mcp.adapter.js # [Phase 2] 滴答清单 MCP 客户端
│   │
│   ├── modules/
│   │   ├── content.js        # [Phase 2] TTS 任务队列 + 预缓存
│   │   ├── schedule.js       # [Phase 2] 日程读取 + 密度计算
│   │   ├── ttl.js            # [Phase 2] 精确时序控制
│   │   ├── upnp.js           # [Phase 2] UPnP 推流
│   │   └── notification.js   # [Phase 2] 系统通知
│   │
│   ├── prompts/
│   │   ├── context-builder.js  # 三维度上下文拼装
│   │   ├── dj-broadcast.js     # DJ 口白 prompt 模板
│   │   ├── music-strategy.js   # 选歌策略 prompt 模板
│   │   └── examples/           # [Phase 3] 好/差 Claude 输出样本
│   │
│   └── routes/
│       ├── api.js   # [Phase 2] REST API
│       └── ws.js    # [Phase 2] WebSocket 消息处理
│
├── client/              # [Phase 4] PWA 前端
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── js/
│   │   ├── app.js
│   │   ├── ui.js
│   │   ├── ws-client.js
│   │   └── audio-player.js
│   └── css/style.css
│
├── data/
│   ├── history.json     # 播放历史（自动写入，最多200条）
│   └── mood-log.json    # 心情日志（Phase 3 使用）
│
└── scripts/
    └── test-adapters.js  # 各 adapter 连通性测试
```

---

## 7. 在新电脑上部署

### 7.1 系统要求

- macOS（Phase 1 使用 `afplay` 播放；Linux 需改为 `mpg123`，见 §13）
- Node.js 18 或更高版本
- npm 9+

验证版本：
```bash
node --version   # 需要 >= 18
npm --version
```

### 7.2 克隆/复制项目

```bash
# 方案A：如果在 git remote 上
git clone <repo-url> claudio
cd claudio

# 方案B：直接复制目录（另一台 Mac）
scp -r user@old-mac:/Users/wangyuhao/code/AI_DJ/claudio ./claudio
cd claudio
```

### 7.3 安装依赖

> 提示：默认 npmjs.org 在国内较慢，建议先切换镜像：

```bash
# 临时使用淘宝镜像（推荐国内环境）
npm install --registry=https://registry.npmmirror.com

# 或永久切换（本机 npm 配置）
npm config set registry https://registry.npmmirror.com
npm install
```

### 7.4 配置环境变量

```bash
cp .env.example .env
```

用任意编辑器打开 `.env`，填入以下值（详见 §8 说明 + §9 申请指南）：

```bash
CLAUDE_API_KEY=sk-ant-api03-xxxxxxxx
FISH_AUDIO_KEY=xxxxxxxx
FISH_AUDIO_REFERENCE_ID=xxxxxxxx   # 可选，不填则用默认声音
NETEASE_API_URL=http://localhost:3000
WEATHER_API_KEY=xxxxxxxx           # 可选，不填天气用占位数据
WEATHER_CITY=Beijing
PORT=4000
```

### 7.5 启动网易云 API（单独进程）

NeteaseCloudMusicApi 需要在**另一个终端窗口**中运行，Claudio 通过 HTTP 请求它：

```bash
# 全局安装（只需一次）
npm install -g NeteaseCloudMusicApi

# 启动（默认端口 3000）
NeteaseCloudMusicApi

# 验证是否正常
curl http://localhost:3000/search?keywords=周杰伦&limit=1
# 应返回包含 songs 数组的 JSON
```

> 注意：NeteaseCloudMusicApi 需要常驻运行，可以用 `pm2` 托管：
> ```bash
> npm install -g pm2
> pm2 start $(which NeteaseCloudMusicApi) --name netease
> pm2 save
> ```

### 7.6 测试各 adapter 连通性

```bash
cd /path/to/claudio
node scripts/test-adapters.js
```

期望输出：
```
✓ PASS  Claude — non-empty reply
        Response: CLAUDIO_OK
✓ PASS  Netease — search "周杰伦" returns results
        First result: 晴天 — 周杰伦 (id: 186001)
✓ PASS  Fish Audio — synthesize returns non-empty buffer
        Audio buffer size: 42384 bytes
✓ PASS  Weather — returns object with temp field
        Beijing: 晴 22°C

Done.
```

Netease 或 Weather 失败不影响主流程（有降级）。Claude 和 Fish Audio 失败则功能受损。

### 7.7 运行完整会话

```bash
node server/index.js --mood "有点累"

# 或不带心情（Claude 自行判断）
node server/index.js
```

---

## 8. 环境变量说明

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `CLAUDE_API_KEY` | ✅ | — | Anthropic API Key，`sk-ant-` 开头 |
| `FISH_AUDIO_KEY` | ✅ | — | Fish Audio API Key |
| `FISH_AUDIO_REFERENCE_ID` | ❌ | 空 | Fish Audio 声音模型 ID（留空则用平台默认声音）|
| `NETEASE_API_URL` | ❌ | `http://localhost:3000` | 本地 NeteaseCloudMusicApi 地址 |
| `WEATHER_API_KEY` | ❌ | 空 | OpenWeather API Key（留空则天气用占位数据） |
| `WEATHER_CITY` | ❌ | `Beijing` | 天气查询城市，英文名 |
| `PORT` | ❌ | `4000` | Claudio 服务端口（Phase 2 WebSocket 用） |

---

## 9. API Key 申请指南

### Claude API Key
- 网址：https://console.anthropic.com/
- 注册 Anthropic 账号 → API Keys → Create Key
- 模型用量：`claude-opus-4-6`（DJ决策）和 `claude-sonnet-4-6`（快速刷新）
- 每次 DJ 决策约消耗 2 次 API 调用（口白 + 选歌策略），各约 300-500 tokens

### Fish Audio TTS
- 网址：https://fish.audio/
- 注册账号 → Dashboard → API → 创建 API Key
- **声音模型 Reference ID**：在 fish.audio 选一个喜欢的声音，点击 "Use in API"，复制 Reference ID 填入 `FISH_AUDIO_REFERENCE_ID`
- 免费层：每月 1000 字符，建议充值（很便宜）

### OpenWeather（可选）
- 网址：https://openweathermap.org/api
- 注册 → My API Keys → 生成 Default key
- 免费层：60次/分钟，完全够用
- **不填也行**：天气 adapter 会自动返回占位数据（北京 晴 22°C）

### 网易云音乐 API
- 不需要 key，使用开源项目 NeteaseCloudMusicApi
- 某些高品质资源（VIP 歌曲）需要登录 Cookie，但普通搜索无需登录
- 若要登录：参考 NeteaseCloudMusicApi 文档的 `/login` 接口

---

## 10. Phase 2 — 功能模块完善

**目标**：稳定性提升 + 接入滴答清单日程（MCP）+ UPnP 家庭音响

### 10.1 待实现文件

#### `server/adapters/ticktick-mcp.adapter.js`

连接滴答清单 MCP Server，读取今日任务。

**实现前必须先阅读**：https://help.dida365.com/articles/7438132116019216384
（确认 MCP Server 启动方式和支持的 tool 列表）

```javascript
// 核心接口
class TickTickMCPAdapter {
  async connect()                                         // 初始化 MCP 连接
  async getTodayTasks()                                  // 获取今日任务
  async getTasksInRange(startISO, endISO)                // 时间范围查询
  async getProjects()                                    // 获取所有清单
}
```

实现要点：
- 使用 `@modelcontextprotocol/sdk`（已安装）的 `Client` 类
- MCP Server 可能是 stdio 子进程或 HTTP endpoint，按文档选择
- 连接失败时不应崩溃，降级返回空数组

#### `server/modules/schedule.js`

封装 MCP Adapter，提供高级接口给 context-builder。

```javascript
class ScheduleModule {
  async getTodaySummary()                  // → ScheduleSummary
  async hasUpcomingTask(withinMinutes)    // → Task | null（会议前提醒）
}

// ScheduleSummary 结构
{
  tasks: Task[],
  density: 'light' | 'normal' | 'heavy',  // 0–1个=light, 2–3=normal, 4+=heavy
  nextTask: Task | null,
  hasDeadlineToday: boolean
}
```

缓存策略：本地内存缓存 15 分钟，`cachedAt + 15*60*1000` 对比 `Date.now()`。

#### `server/modules/content.js`

TTS 任务队列，防止并发合成。

```javascript
class ContentModule {
  async enqueue(text, priority?)     // 加入合成队列
  async preCache(text)              // 预合成（歌曲播放最后30秒时调用）
  clearCache()
}
```

实现要点：
- 队列用 Promise 链（避免并发调用 Fish Audio）
- 将合成好的 MP3 文件路径缓存到内存 Map（key = text hash）
- 文件保存到 `data/` 目录，超过 100 个时清理最旧的

#### `server/modules/upnp.js`

UPnP 推流到家庭音响。

```javascript
class UPnPModule {
  async scan()                         // 扫描局域网 UPnP 设备
  async play(deviceUrl, mediaUrl)      // 推送播放
  async setVolume(deviceUrl, level)    // 设置音量
  async stop(deviceUrl)
}
```

实现要点：
- 使用 `node-ssdp` 包（需 `npm install node-ssdp`）
- 音响控制协议：AVTransport（标准 DLNA）
- 断联降级：捕获异常后 `state.updateContext({target: 'local'})`

#### `server/core/master.js`

抽象播放目标，`player.js` 只调用 master，不关心 local 还是 upnp。

```javascript
class PlaybackMaster {
  setTarget(target)          // 'local' | 'upnp'
  async play(audioPath)      // 播放本地文件
  async playUrl(url)         // 播放远程 URL
  async pause()
  async resume()
  async setVolume(level)
}
```

#### `server/modules/ttl.js`

精确时序控制（不用 setTimeout，用 onended 事件链）。

```javascript
class TTLModule {
  // 绑定到 audio element（Phase 4）或 afplay 进程退出事件
  // 歌曲剩余 30 秒时触发 'PRE_GENERATE' 事件
  // 歌曲结束时触发 'TRACK_ENDED' 事件
}
```

Phase 2 简化实现：记录 `track.duration`，用 `setTimeout` 在 `duration - 30s` 时预生成。

#### `server/routes/api.js` + `server/routes/ws.js`

启动完整 Express + WebSocket 服务器。

**WebSocket 消息协议**：

```
服务端 → 客户端：
  STATE_CHANGE   { prev, next, context }
  TRACK_UPDATE   { track: Song }
  DJ_SCRIPT      { text: string }
  PROGRESS       { elapsed: number, duration: number }
  DEVICE_LIST    { devices: UPnPDevice[] }

客户端 → 服务端：
  CMD_PLAY    {}
  CMD_PAUSE   {}
  CMD_SKIP    {}
  CMD_VOLUME  { level: number }
  CMD_MOOD    { mood: string }
  CMD_TARGET  { target: 'local'|'upnp', deviceUrl?: string }
```

### 10.2 Phase 2 关键难点

| 难点 | 解决方案 |
|------|---------|
| 网易云 URL 有效期约 20 分钟 | 播放列表只存 song_id，播放时才取 URL，超 15 分钟强制重取（`NeteaseAdapter.evictUrl()` 已实现） |
| Claude 响应延迟 3–8 秒 | 歌曲最后 30 秒提前触发下一段 DJ 词生成；首次启动播本地兜底音频（`data/fallback.mp3`）|
| MCP 连接不稳定 | `schedule.js` 捕获所有异常，降级返回上次缓存，在 context 中标注 `work.available = false` |
| UPnP 断联 | `upnp.js` 异常时自动切回 local target，通过 state.js 记录 |

---

## 11. Phase 3 — 智能 Prompt 系统

**目标**：Claude 决策质量大幅提升，形成 Claudio 稳定"人格"。

### 11.1 Prompt 优化方向

当前 prompt 已实现基础功能，需要根据实际使用效果调优：

1. **收集样本**：将好的输出复制到 `server/prompts/examples/good/`，差的放 `bad/`
2. **Few-shot 示例**：在 `dj-broadcast.js` 中加入 2-3 个优质样本作为 few-shot
3. **节气/节假日感知**：在 `context-builder.js` 中加入节假日计算（使用 `chinese-holidays` 包）

### 11.2 `context-builder.js` 增强

需要增加：
```javascript
// 待添加
env.holiday    // 是否节假日、节气名称
env.season     // 春/夏/秋/冬
work.schedule  // 完整的 ScheduleSummary（Phase 2 接入后）
personal.moodHistory  // 从 mood-log.json 提取的历史偏好
```

### 11.3 `mood-log.json` 自动记录

在 `player.js` 的 `#appendHistory()` 里同步写 `mood-log.json`：
```json
[
  { "mood": "有点累", "date": "2025-04-24", "track": "晴天", "rating": null },
  ...
]
```

---

## 12. Phase 4 — PWA 完整客户端

**目标**：可在手机主屏运行的完整控制界面（Lighthouse PWA >= 90）。

### 12.1 待实现文件

```
client/
├── index.html          # 主页面
├── manifest.json       # PWA manifest（图标、主题色、display: standalone）
├── sw.js               # Service Worker（缓存静态资源）
├── js/
│   ├── app.js          # 应用初始化，连接 WebSocket
│   ├── ui.js           # DOM 操作，更新播放卡片/字幕/进度条
│   ├── ws-client.js    # WebSocket 客户端封装，自动重连
│   └── audio-player.js # Web Audio API，管理 <audio> 元素
└── css/style.css       # 深色主题，卡片式布局
```

### 12.2 主要功能模块

| 功能 | 实现方式 |
|------|---------|
| 当前播放卡片 | 封面（Netease album URL）+ 歌名/歌手/进度条 |
| DJ 播报字幕 | WebSocket 接收 `DJ_SCRIPT`，逐字显示动画 |
| 心情输入 | 文本框 + 发送按钮，发 `CMD_MOOD` |
| 播放队列 | 列表展示，支持点击跳过 |
| 今日日程侧边栏 | 从 WebSocket `STATE_CHANGE` 中读取 schedule |
| 媒体会话 API | `navigator.mediaSession`（锁屏控制条）|
| Web Push 通知 | 任务前 5 分钟提醒、换歌通知 |

---

## 13. 已知问题 & 注意事项

### macOS 限定（afplay）

`player.js` 中的 `#playFile()` 使用 `afplay`，这是 macOS 内置命令。

**Linux/Windows 适配**：修改 `server/core/player.js` 第 158 行：
```javascript
// macOS
const proc = execFile('afplay', [pathOrUrl], callback);

// Linux（需安装 mpg123: sudo apt install mpg123）
const proc = execFile('mpg123', [pathOrUrl], callback);

// 跨平台方案（Phase 2 master.js 会解决这个问题）
```

### 网易云音乐可用性

NeteaseCloudMusicApi 是第三方非官方项目，网易会不定期封锁。备选方案：
- 登录 Cookie 模式（部分 VIP 内容）
- 切换到其他搜索关键词
- Phase 2 中考虑加 YouTube Music 或本地音乐库作为备选源

### Fish Audio 声音质量

`FISH_AUDIO_REFERENCE_ID` 留空时使用平台默认声音，效果一般。
建议在 fish.audio 上选一个自然的中文声音，或上传自己的声音克隆（5-10 分钟录音）。

### Claude 调用成本估算

| 操作 | 模型 | 约消耗 tokens | 约费用（USD） |
|------|------|-------------|-------------|
| 每次 DJ 决策（口白 + 策略） | opus-4-6 × 2 | 约 600 tokens × 2 | ~$0.03 |
| 快速刷新口白 | sonnet-4-6 | 约 600 tokens | ~$0.002 |

每天听 8 小时（每30分钟一次决策）≈ 16次决策 ≈ $0.5/天。

---

## 14. 故障排查

### `Error: Missing required env var: CLAUDE_API_KEY`
→ 未创建 `.env` 文件或未填写变量。执行：
```bash
cp .env.example .env && nano .env
```

### `Error: Missing required env var: FISH_AUDIO_KEY`
→ 同上，填写 `FISH_AUDIO_KEY`。

### Netease search 失败：`connect ECONNREFUSED 127.0.0.1:3000`
→ NeteaseCloudMusicApi 未启动。另开终端执行：
```bash
NeteaseCloudMusicApi
```

### `afplay: No such file or directory`（Linux）
→ 参见 §13 Linux 适配方案，改用 `mpg123`。

### Fish Audio 返回 401
→ API Key 无效或过期。重新在 fish.audio 生成 Key。

### Fish Audio 返回 400，`reference_id` 相关错误
→ `FISH_AUDIO_REFERENCE_ID` 填写了无效 ID。留空即可（使用默认声音）。

### Claude 返回空字符串或 JSON 解析失败
→ `player.js` 已有降级处理（使用默认文案和策略），不影响运行。但建议检查 prompt 格式。

### 状态机报 `Illegal state transition`
→ 说明某处代码的 transition 调用顺序有误。检查调用栈，确保遵守：
`IDLE → PROTO → PUB → PUSH → IDLE`

---

*文档最后更新：2025-04-24*
*项目路径：`/Users/wangyuhao/code/AI_DJ/claudio/`*
*Git 提交：`b92982b feat: Claudio Phase 1 MVP`*
