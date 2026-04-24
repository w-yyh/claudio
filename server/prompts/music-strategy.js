/**
 * Build the messages array for Claude to output a music selection strategy JSON.
 *
 * Output contract (strict JSON):
 * {
 *   "keywords": string[],     // 1–3 search terms for Netease
 *   "bpm_range": [number, number],
 *   "mood_tags": string[],    // descriptive tags for logging
 *   "exclude_ids": string[]   // song IDs to skip (from history)
 * }
 *
 * @param {import('./context-builder.js').DJContext} ctx
 * @returns {import('@anthropic-ai/sdk').MessageParam[]}
 */
export function buildMusicStrategyMessages(ctx) {
  const { env, work, personal } = ctx;

  const contextSummary = [
    `时段：${env.timePeriod}（${env.dayType}）`,
    env.weather ? `天气：${env.weather.description} ${env.weather.temp}°C` : '',
    personal.mood ? `心情：${personal.mood}` : '',
    work.density ? `日程密度：${work.density}` : '',
    work.nextTask ? `最近任务：${work.nextTask.title}` : '',
  ]
    .filter(Boolean)
    .join('；');

  const excludeLine =
    personal.recentTrackIds.length
      ? `排除最近播放过的歌曲 ID：${personal.recentTrackIds.slice(-10).join(', ')}`
      : '无需排除';

  const prompt = `你是一个专业的音乐推荐 AI。根据以下上下文，输出一个 JSON 格式的选歌策略。

上下文：${contextSummary}
${excludeLine}

选歌原则：
- 工作日上午/下午：节奏感适中，不分心，BPM 90–120
- 午休/傍晚：舒缓放松，BPM 60–90
- 夜间：轻柔或氛围感，BPM 50–80
- 周末：自由随性，BPM 范围宽
- 心情疲惫/低落：治愈系、慢歌、轻音乐
- 心情好/有精力：流行、轻快、节奏强

严格输出以下 JSON（不加任何其他文字）：
{
  "keywords": ["搜索词1", "搜索词2"],
  "bpm_range": [最低, 最高],
  "mood_tags": ["标签1", "标签2"],
  "exclude_ids": [${personal.recentTrackIds.slice(-10).map((id) => `"${id}"`).join(', ')}]
}`;

  return [{ role: 'user', content: prompt }];
}
