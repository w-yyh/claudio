import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WeatherAdapter } from '../../server/adapters/weather.adapter.js';

function okJson(data) {
  return { ok: true, status: 200, json: async () => data };
}

function makeWeatherResponse(main = 'Clear', desc = '晴', temp = 22.4) {
  return okJson({
    name: 'Beijing',
    weather: [{ main, description: desc }],
    main: { temp, feels_like: temp - 1, humidity: 45 },
  });
}

describe('WeatherAdapter', () => {
  test('正常返回天气信息', async () => {
    const adapter = new WeatherAdapter(async () => makeWeatherResponse());
    const info = await adapter.getCurrentWeather('Beijing');
    assert.equal(info.city, 'Beijing');
    assert.equal(info.condition, 'sunny');
    assert.equal(info.temp, 22);
    assert.equal(typeof info.humidity, 'number');
  });

  test('API 失败时返回占位数据而非抛出', async () => {
    const adapter = new WeatherAdapter(async () => ({ ok: false, status: 401 }));
    const info = await adapter.getCurrentWeather('Beijing');
    assert.equal(typeof info.temp, 'number');
    assert.ok(info.description.includes('占位'));
  });

  test('网络异常时返回占位数据而非抛出', async () => {
    const adapter = new WeatherAdapter(async () => { throw new Error('Network Error'); });
    const info = await adapter.getCurrentWeather('Beijing');
    assert.equal(typeof info.temp, 'number');
  });

  test('condition 映射 Rain → rain', async () => {
    const adapter = new WeatherAdapter(async () => makeWeatherResponse('Rain', '中雨', 16));
    const info = await adapter.getCurrentWeather('Shanghai');
    assert.equal(info.condition, 'rain');
  });

  test('condition 映射 Snow → snow', async () => {
    const adapter = new WeatherAdapter(async () => makeWeatherResponse('Snow', '小雪', 0));
    const info = await adapter.getCurrentWeather('Harbin');
    assert.equal(info.condition, 'snow');
  });

  test('未知 condition 返回 unknown', async () => {
    const adapter = new WeatherAdapter(async () => makeWeatherResponse('Tornado', '龙卷风', 25));
    const info = await adapter.getCurrentWeather('Test');
    assert.equal(info.condition, 'unknown');
  });

  test('temp 取整', async () => {
    const adapter = new WeatherAdapter(async () => makeWeatherResponse('Clear', '晴', 22.7));
    const info = await adapter.getCurrentWeather('X');
    assert.equal(info.temp, 23);
  });
});
