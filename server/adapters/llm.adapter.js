import fetch from 'node-fetch';
import { config } from '../config.js';
import { buildDJBroadcastMessages } from '../prompts/dj-broadcast.js';
import {
  buildMusicStrategyMessages,
  buildSongSelectionMessages,
} from '../prompts/music-strategy.js';

/**
 * LLM Adapter — OpenAI 兼容 API 通用适配器
 *
 * 支持 DeepSeek / OpenAI / Groq / Ollama / OpenRouter 等
 * 通过配置 LLM_API_URL / LLM_API_KEY / LLM_MODEL 切换服务商
 */
export class LLMAdapter {
  /**
   * 调用 OpenAI 兼容的 chat completions 接口
   * @param {Array<{role: string, content: string}>} messages
   * @param {{ model?: string, maxTokens?: number }} [options]
   * @returns {Promise<string>} 返回 assistant 文本
   */
  async complete(messages, options = {}) {
    const url = `${config.llm.apiUrl}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? config.llm.model,
        messages,
        max_tokens: options.maxTokens ?? 512,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Full DJ decision: generate broadcast script + music selection strategy
   * @param {import('../prompts/context-builder.js').DJContext} context
   * @returns {{ script: string, strategy: MusicStrategy }}
   */
  async getDJDecision(context) {
    const [scriptText, strategyText] = await Promise.all([
      this.complete(buildDJBroadcastMessages(context), { maxTokens: 512 }),
      this.complete(buildMusicStrategyMessages(context), { maxTokens: 512 }),
    ]);

    let strategy;
    try {
      const json = strategyText.replace(/```(?:json)?\n?/g, '').trim();
      strategy = JSON.parse(json);
    } catch {
      strategy = {
        keywords: [context.mood ?? '流行'],
        bpm_range: [80, 130],
        mood_tags: [],
        exclude_ids: [],
      };
    }

    return { script: scriptText.trim(), strategy };
  }

  /**
   * 从候选歌单中选择最合适的歌
   * @param {import('../prompts/context-builder.js').DJContext} context
   * @param {Array<{id:string,name:string,artist:string,reason:string}>} songs
   * @returns {{ songId: string|null, reason: string }}
   */
  async selectSong(context, songs, taste = null) {
    try {
      const text = await this.complete(
        buildSongSelectionMessages(context, songs, taste),
        { maxTokens: 256 }
      );
      const json = JSON.parse(text.replace(/```(?:json)?\n?/g, '').trim());
      return { songId: json.song_id ?? null, reason: json.reason ?? '' };
    } catch (err) {
      console.warn('[LLM] selectSong error:', err.message);
      return { songId: null, reason: '' };
    }
  }
  /**
   * Quickly regenerate only the broadcast script
   * @param {import('../prompts/context-builder.js').DJContext} context
   * @param {string} reason  e.g. "user skipped" | "mood changed"
   */
  async regenerateScript(context, reason) {
    const messages = buildDJBroadcastMessages(context, { regenerationReason: reason });
    return this.complete(messages, { maxTokens: 512 });
  }
}
