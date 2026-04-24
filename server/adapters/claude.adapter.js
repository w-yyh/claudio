import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { buildDJBroadcastMessages } from '../prompts/dj-broadcast.js';
import { buildMusicStrategyMessages } from '../prompts/music-strategy.js';

export class ClaudeAdapter {
  #client;

  constructor() {
    this.#client = new Anthropic({ apiKey: config.claude.apiKey });
  }

  /**
   * Raw completion — returns the first text content block.
   * @param {import('@anthropic-ai/sdk').MessageParam[]} messages
   * @param {object} options
   */
  async complete(messages, options = {}) {
    const response = await this.#client.messages.create({
      model: options.model ?? config.claude.modelDecision,
      max_tokens: options.maxTokens ?? 1024,
      messages,
      ...options.extra,
    });
    return response.content.find((b) => b.type === 'text')?.text ?? '';
  }

  /**
   * Full DJ decision: generate broadcast script + music selection strategy.
   * Uses the heavy model (opus) for quality.
   *
   * @param {import('../prompts/context-builder.js').DJContext} context
   * @returns {{ script: string, strategy: MusicStrategy }}
   */
  async getDJDecision(context) {
    const [scriptText, strategyText] = await Promise.all([
      this.complete(buildDJBroadcastMessages(context), {
        model: config.claude.modelDecision,
        maxTokens: 512,
      }),
      this.complete(buildMusicStrategyMessages(context), {
        model: config.claude.modelDecision,
        maxTokens: 512,
      }),
    ]);

    let strategy;
    try {
      // Strip possible markdown code fences
      const json = strategyText.replace(/```(?:json)?\n?/g, '').trim();
      strategy = JSON.parse(json);
    } catch {
      strategy = { keywords: [context.mood ?? '流行'], bpm_range: [80, 130], mood_tags: [], exclude_ids: [] };
    }

    return { script: scriptText.trim(), strategy };
  }

  /**
   * Quickly regenerate only the broadcast script (uses fast/sonnet model).
   * @param {import('../prompts/context-builder.js').DJContext} context
   * @param {string} reason  e.g. "user skipped" | "mood changed"
   */
  async regenerateScript(context, reason) {
    const messages = buildDJBroadcastMessages(context, { regenerationReason: reason });
    return this.complete(messages, {
      model: config.claude.modelFast,
      maxTokens: 512,
    });
  }
}
