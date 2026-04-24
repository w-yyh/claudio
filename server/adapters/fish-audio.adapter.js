import fetch from 'node-fetch';
import { config } from '../config.js';

export class FishAudioAdapter {
  #apiKey;
  #apiUrl;
  #referenceId;

  constructor() {
    this.#apiKey = config.fishAudio.apiKey;
    this.#apiUrl = config.fishAudio.apiUrl;
    this.#referenceId = config.fishAudio.referenceId;
  }

  /**
   * Synthesize text to speech using Fish Audio TTS API.
   * @param {string} text
   * @param {string} [referenceId]  Override default voice model
   * @returns {Promise<Buffer|null>}  MP3 audio buffer, or null on failure
   */
  async synthesize(text, referenceId) {
    const voiceId = referenceId || this.#referenceId;

    const body = {
      text,
      format: 'mp3',
      mp3_bitrate: 128,
      ...(voiceId ? { reference_id: voiceId } : {}),
    };

    try {
      const res = await fetch(this.#apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[FishAudio] TTS failed ${res.status}: ${errText}`);
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      return buffer;
    } catch (err) {
      console.error('[FishAudio] synthesize error:', err.message);
      return null;
    }
  }
}
