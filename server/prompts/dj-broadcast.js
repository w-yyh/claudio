/**
 * Build the messages array for Claude to generate a Claudio DJ broadcast script.
 *
 * Output contract: a 30–60 second spoken monologue in natural Chinese,
 * warm and witty, with Claudio's personality.
 *
 * @param {import('./context-builder.js').DJContext} ctx
 * @param {{ regenerationReason?: string }} [opts]
 * @returns {import('@anthropic-ai/sdk').MessageParam[]}
 */
export function buildDJBroadcastMessages(ctx, opts = {}) {
  const { env, work, personal } = ctx;

  const weatherDesc = env.weather
    ? `${env.weather.city} 今天${env.weather.description}，${env.weather.temp}°C，体感${env.weather.feelsLike}°C`
    : '（天气数据暂不可用）';

  const scheduleDesc = work.available
    ? [
        `今日日程密度：${work.density ?? '未知'}`,
        work.nextTask ? `下一个任务：「${work.nextTask.title}」（${work.nextTask.dueDate ?? '未定时间'}）` : '今日暂无计划任务',
        work.hasDeadlineToday ? '⚠️ 今天有 deadline。' : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '（日程数据暂不可用）';

  const moodLine = personal.mood ? `用户当前心情：${personal.mood}` : '用户未告知心情';

  const regenerationNote = opts.regenerationReason
    ? `\n\n[注意：此次是重新生成，原因：${opts.regenerationReason}。请给出与上次明显不同的风格。]`
    : '';

  const systemPrompt = `你是 Claudio，一个有品位、温暖幽默、不油腻的 AI 电台 DJ。
你的播报是在用户开始听歌前播出的 DJ 口白，风格像一个好朋友在跟你聊天，顺便推荐一首歌。
语言：中文。
时长要求：朗读时长 30–60 秒（约 80–160 字）。
禁止：不要用"大家好"、"各位听众"、"欢迎收听"等广播腔开头；不要过度热情；不要明确说出"接下来这首歌叫做XXX"（让音乐本身开口）。
必须包含：对当前时间/天气/心情/日程的自然提及，以及一句引导听歌的过渡语。`;

  const userPrompt = `当前上下文：
- 时间：${env.timePeriod}，${env.dayType}
- 天气：${weatherDesc}
- 日程：
${scheduleDesc}
- 心情：${moodLine}

请生成一段 Claudio 风格的 DJ 口白。${regenerationNote}`;

  return [
    { role: 'user', content: `[系统设定]\n${systemPrompt}\n\n[任务]\n${userPrompt}` },
  ];
}
