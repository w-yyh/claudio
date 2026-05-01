import 'dotenv/config';

function require_env(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional_env(key, fallback = '') {
  return process.env[key] ?? fallback;
}

export const config = {
  llm: {
    apiKey: require_env('LLM_API_KEY'),
    apiUrl: optional_env('LLM_API_URL', 'https://api.deepseek.com/v1'),
    model: optional_env('LLM_MODEL', 'deepseek-chat'),
  },
  fishAudio: {
    apiKey: require_env('FISH_AUDIO_KEY'),
    referenceId: optional_env('FISH_AUDIO_REFERENCE_ID'),
    apiUrl: 'https://api.fish.audio/v1/tts',
  },
  netease: {
    apiUrl: optional_env('NETEASE_API_URL', 'http://localhost:3000'),
    cookie: optional_env('NETEASE_COOKIE'),
  },
  weather: {
    apiKey: optional_env('WEATHER_API_KEY'),
    city: optional_env('WEATHER_CITY', 'Beijing'),
    apiUrl: 'https://api.openweathermap.org/data/2.5',
  },
  ticktick: {
    apiToken: optional_env('TICKTICK_API_TOKEN'),
    mcpUrl: optional_env('TICKTICK_MCP_URL', 'https://mcp.dida365.com'),
  },
  upnp: {
    scanTimeoutMs: parseInt(optional_env('UPNP_SCAN_TIMEOUT', '5000'), 10),
  },
  server: {
    port: parseInt(optional_env('PORT', '4000'), 10),
  },
};
