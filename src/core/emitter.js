/**
 * Minimal event emitter used by UI and state objects.
 */
export class Emitter {
  constructor() {
    this.events = new Map();
  }

  /**
   * Register a listener for a specific event.
   * @param {string} event
   * @param {(payload: unknown) => void} listener
   */
  on(event, listener) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event).add(listener);
  }

  /**
   * Emit an event to all listeners.
   * @param {string} event
   * @param {unknown} payload
   */
  emit(event, payload) {
    const listeners = this.events.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(payload);
    }
  }
}
