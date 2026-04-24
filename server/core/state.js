import { eventBus } from './event-bus.js';

/**
 * Valid states and legal transitions for the DJ session.
 *
 *  IDLE ──► PROTO ──► PUB ──► PUSH
 *   ▲                          │
 *   └──────────── PAUSE ◄──────┘
 *        (PAUSE → PUSH to resume, PAUSE → IDLE to stop)
 */
const TRANSITIONS = {
  IDLE:  ['PROTO'],
  PROTO: ['PUB', 'IDLE'],    // IDLE = abort decision
  PUB:   ['PUSH', 'IDLE'],   // IDLE = skip before push
  PUSH:  ['PROTO', 'PAUSE', 'IDLE'],
  PAUSE: ['PUSH', 'IDLE'],
};

const DEFAULT_CONTEXT = {
  mood: null,           // string | null
  weather: null,        // WeatherInfo | null
  schedule: null,       // ScheduleSummary | null
  currentTrack: null,   // Song | null
  queue: [],            // Song[]
  djScript: null,       // string | null
  volume: 80,           // 0–100
  target: 'local',      // 'local' | 'upnp'
  upnpDevice: null,     // device info | null
};

class StateManager {
  #state = 'IDLE';
  #context = { ...DEFAULT_CONTEXT };
  #handlers = {};   // state → handler[]

  get current() {
    return this.#state;
  }

  /**
   * Transition to newState, optionally merging payload into context.
   * Throws if the transition is not legal.
   */
  transition(newState, payload = {}) {
    const allowed = TRANSITIONS[this.#state];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Illegal state transition: ${this.#state} → ${newState}. Allowed: ${allowed?.join(', ') ?? 'none'}`
      );
    }

    const prev = this.#state;
    this.#state = newState;

    if (Object.keys(payload).length) {
      this.#context = { ...this.#context, ...payload };
    }

    eventBus.emit('STATE_CHANGE', { prev, next: newState, context: this.getContext() });

    const handlers = this.#handlers[newState] ?? [];
    for (const h of handlers) h(this.getContext());
  }

  /** Register a handler that fires whenever `state` becomes active. */
  on(state, handler) {
    if (!this.#handlers[state]) this.#handlers[state] = [];
    this.#handlers[state].push(handler);
  }

  /** Deep-copy snapshot of current context. */
  getContext() {
    return { ...this.#context, queue: [...this.#context.queue] };
  }

  /** Merge partial updates into context without triggering a state change. */
  updateContext(partial) {
    this.#context = { ...this.#context, ...partial };
  }

  /** Reset to IDLE with cleared context (useful for full stop). */
  reset() {
    this.#state = 'IDLE';
    this.#context = { ...DEFAULT_CONTEXT };
    eventBus.emit('STATE_CHANGE', { prev: null, next: 'IDLE', context: this.getContext() });
  }
}

export const state = new StateManager();
