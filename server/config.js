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
  claude: {
    apiKey: require_env('CLAUDE_API_KEY'),
    modelDecision: 'claude-opus-4-6',
    modelFast: 'claude-sonnet-4-6',
  },
  fishAudio: {
    apiKey: require_env('FISH_AUDIO_KEY'),
    referenceId: optional_env('FISH_AUDIO_REFERENCE_ID'),
    apiUrl: 'https://api.fish.audio/v1/tts',
  },
  netease: {
    apiUrl: optional_env('NETEASE_API_URL', 'http://localhost:3000'),
  },
  weather: {
    apiKey: optional_env('WEATHER_API_KEY'),
    city: optional_env('WEATHER_CITY', 'Beijing'),
    apiUrl: 'https://api.openweathermap.org/data/2.5',
  },
  server: {
    port: parseInt(optional_env('PORT', '4000'), 10),
  },
};
