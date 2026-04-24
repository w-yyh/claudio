import { EventEmitter } from 'events';

/**
 * Internal event bus — thin wrapper around Node EventEmitter.
 * All server modules share this single instance for decoupled communication.
 */
class EventBus extends EventEmitter {}

export const eventBus = new EventBus();
eventBus.setMaxListeners(20);
