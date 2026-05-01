/**
 * 从每日推荐歌单中选最合适的歌（含品味档案）
 * @param {import('./context-builder.js').DJContext} ctx
 * @param {Array<{id:string,name:string,artist:string,reason:string}>} songs
 * @param {object} [taste] 品味档案 { topArtists, langPref, sampleSongs }
 * @returns {Array<{role: string, content: string}>}
 */
export function buildSongSelectionMessages(ctx, songs, taste = null) {
  const { env, work, personal } = ctx;

  const contextSummary = [
    `时段：${env.timePeriod}（${env.dayType}）`,
    env.weather ? `天气：${env.weather.description} ${env.weather.temp}°C` : '',
    personal.mood ? `心情：${personal.mood}` : '',
    work.available && work.taskTitles?.length ? `今日事项：${work.taskTitles.join('、')}` : '',
    work.density ? `日程密度：${work.density}（共 ${work.taskCount} 个任务）` : '',
    work.nextTask ? `最近任务：${work.nextTask.title}` : '',
  ].filter(Boolean).join('；');

  const songList = songs.map((s, i) =>
    `${i + 1}. [ID:${s.id}] ${s.name} — ${s.artist} [${s.reason || '算法推荐'}]`
  ).join('\n');

  const excludeIds = personal.recentTrackIds.slice(-10);
  const excludeLine = excludeIds.length
    ? `排除以下最近播过的 ID：${excludeIds.join(', ')}`
    : '';

  const tasteInfo = taste ? `\n用户音乐品味：偏爱歌手 ${(taste.topArtists||[]).slice(0,8).join('、')}；常听语言：中文${taste.langPref?.zh||0}% 英文${taste.langPref?.en||0}%；常听曲目：${(taste.sampleSongs||[]).slice(0,8).join('；')}` : '';

  const systemPrompt = `你是 Claudio AI DJ 的选歌助手。根据当前上下文和用户品味，从候选歌单中选出最合适的一首歌。
用户品味（重要参考）：
${tasteInfo}

选歌原则：
- 优先匹配用户常听的歌手和风格
- 有开会/组会/会议类任务：选专注、纯音乐、钢琴曲风格
- 工作日上午/下午：节奏适中、不分散注意力
- 午休/傍晚：舒缓放松
- 夜间：轻柔或氛围感
- 周末：自由随性风格
- 疲惫/低落心情：治愈、慢歌、轻音乐
- 心情好/有精力：流行、轻快、节奏感强
- 根据今日事项选：任务多急时用专注音乐，任务少时用轻松音乐
- 根据歌名、歌手风格判断是否适合当前时段和心情

严格输出以下 JSON（不要 markdown 代码块，不要其他文字）：
{
  "song_id": "选中的歌曲ID（必须是候选歌单中 [ID:xxx] 里的数字，不要用序号）",
  "reason": "一句话说明为什么选这首歌（中文）"
}`;

  const userPrompt = `当前上下文：
${contextSummary}

候选歌单（共 ${songs.length} 首）：
${songList}

${excludeLine}

请选出最适合当前时段和心情的一首歌。`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * 降级方案：生成关键词搜索策略（无每日推荐时用）
 */
export function buildMusicStrategyMessages(ctx) {
  const { env, work, personal } = ctx;

  const contextSummary = [
    `时段：${env.timePeriod}（${env.dayType}）`,
    env.weather ? `天气：${env.weather.description} ${env.weather.temp}°C` : '',
    personal.mood ? `心情：${personal.mood}` : '',
    work.available && work.taskTitles?.length ? `今日事项：${work.taskTitles.join('、')}` : '',
    work.density ? `日程密度：${work.density}（共 ${work.taskCount} 个任务）` : '',
  ].filter(Boolean).join('；');

  const excludeIds = personal.recentTrackIds.slice(-10);

  const systemPrompt = `你是一个专业的音乐推荐 AI。根据上下文，输出 JSON 选歌策略。

原则：开会前→专注/纯音乐；上午下午→节奏适中 BPM 90-120；午休傍晚→舒缓 BPM 60-90；夜间→轻柔 BPM 50-80；疲惫→治愈慢歌；精力好→流行轻快。

严格输出 JSON（不要 markdown）：
{
  "keywords": ["搜索词1", "搜索词2"],
  "bpm_range": [最低, 最高],
  "mood_tags": ["标签1", "标签2"],
  "exclude_ids": [${excludeIds.map((id) => `"${id}"`).join(', ')}]
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `上下文：${contextSummary}` },
  ];
}
