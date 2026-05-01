// 测试预加载脚本 — 通过 node --import 在所有测试模块评估前注入假环境变量
// 这样 server/config.js 的 require_env() 不会因缺 key 而崩溃
process.env.LLM_API_KEY      = 'test-llm-key';
process.env.LLM_API_URL      = 'https://api.deepseek.com/v1';
process.env.LLM_MODEL        = 'deepseek-chat';
process.env.FISH_AUDIO_KEY   = 'test-fish-key';
process.env.NETEASE_API_URL  = 'http://localhost:3000';
process.env.WEATHER_API_KEY  = 'test-weather-key';
process.env.WEATHER_CITY     = 'TestCity';
process.env.TICKTICK_API_TOKEN = 'test-ticktick-token';
process.env.PORT             = '4001';
