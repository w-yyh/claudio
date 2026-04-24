import fetch from 'node-fetch';
import { config } from '../config.js';

const CONDITION_MAP = {
  Thunderstorm: 'thunder',
  Drizzle: 'drizzle',
  Rain: 'rain',
  Snow: 'snow',
  Clear: 'sunny',
  Clouds: 'cloudy',
};

export class WeatherAdapter {
  #apiKey;
  #base;
  #city;

  constructor() {
    this.#apiKey = config.weather.apiKey;
    this.#base = config.weather.apiUrl;
    this.#city = config.weather.city;
  }

  /**
   * Get current weather for a city.
   * @param {string} [city]  Defaults to WEATHER_CITY env
   * @returns {Promise<WeatherInfo>}
   */
  async getCurrentWeather(city) {
    const target = city ?? this.#city;

    if (!this.#apiKey) {
      console.warn('[Weather] No API key — returning placeholder weather');
      return this.#placeholder(target);
    }

    const url = `${this.#base}/weather?q=${encodeURIComponent(target)}&appid=${this.#apiKey}&units=metric&lang=zh_cn`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OpenWeather API ${res.status}`);
      const data = await res.json();

      return {
        city: data.name,
        description: data.weather?.[0]?.description ?? '',
        condition: CONDITION_MAP[data.weather?.[0]?.main] ?? 'unknown',
        temp: Math.round(data.main?.temp ?? 0),
        feelsLike: Math.round(data.main?.feels_like ?? 0),
        humidity: data.main?.humidity ?? 0,
      };
    } catch (err) {
      console.warn('[Weather] fetch error:', err.message);
      return this.#placeholder(target);
    }
  }

  #placeholder(city) {
    return {
      city,
      description: '晴（占位数据）',
      condition: 'sunny',
      temp: 22,
      feelsLike: 22,
      humidity: 50,
    };
  }
}

/**
 * @typedef {{ city: string, description: string, condition: string, temp: number, feelsLike: number, humidity: number }} WeatherInfo
 */
