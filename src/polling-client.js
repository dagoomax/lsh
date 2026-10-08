'use strict';

const platformStatus = require('./platform-status');

// Base class for integration clients that poll a device or cloud API on a
// timer. Every polling client used to hand-roll the same loop, and several
// got a piece of it wrong (polling stopped forever after one failed first
// poll; overlapping polls racing on shared state; the platform-bar badge
// never set, or never set back to false). This does that part once:
//
//   - the schedule survives failures: each next poll is scheduled after the
//     previous one settles, success or not
//   - polls never overlap — a poll still in flight makes the next one skip
//   - platformStatus is false until the first successful poll, then tracks
//     every poll's real outcome
//   - consecutive failures back off exponentially (capped), so a dead cloud
//     API isn't hammered every few seconds; the first success resets it
//
// Subclass:
//   class FooClient extends PollingClient {
//     constructor(config, store, sensorRegistry) {
//       super({ statusKey: 'foo', logTag: 'Foo' });
//       …
//     }
//     async start() {
//       …validate config, registerDevice()…
//       await this.startPolling(30_000);
//     }
//     async _pollImpl(initial) { …fetch, store.update()…; throw on failure }
//   }
//
// _pollImpl must throw when the poll didn't really work — including a 200
// response that doesn't contain the data you expected. Returning normally is
// what marks the platform connected.
class PollingClient {
  constructor({ statusKey, logTag, maxBackoffMs = 15 * 60 * 1000 }) {
    this._statusKey = statusKey;
    this._logTag = logTag;
    this._maxBackoffMs = maxBackoffMs;
    this._intervalMs = null;
    this._timer = null;
    this._polling = false;
    this._failures = 0;
    this._stopped = true;
  }

  // Runs the first poll and resolves once it settles (never rejects — a
  // failed first poll is logged and retried on schedule).
  async startPolling(intervalMs) {
    this._intervalMs = intervalMs;
    this._stopped = false;
    platformStatus.set(this._statusKey, false);
    await this._tick(true);
  }

  stopPolling() {
    this._stopped = true;
    clearTimeout(this._timer);
    this._timer = null;
  }

  stop() {
    this.stopPolling();
  }

  // Delay before the next poll: the normal interval, doubled per consecutive
  // failure, capped at maxBackoffMs (but never below the normal interval).
  _nextDelay() {
    if (!this._failures) return this._intervalMs;
    const cap = Math.max(this._intervalMs, this._maxBackoffMs);
    return Math.min(this._intervalMs * 2 ** this._failures, cap);
  }

  async _tick(initial = false) {
    try {
      await this._poll(initial);
    } finally {
      if (!this._stopped) {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._tick(), this._nextDelay());
        this._timer.unref?.();
      }
    }
  }

  // Guarded single poll. Safe to call directly (e.g. a "refresh now" route).
  async _poll(initial = false) {
    if (this._polling) {
      console.warn(`[${this._logTag}] Skipping poll — previous one still in flight`);
      return;
    }
    this._polling = true;
    try {
      await this._pollImpl(initial);
      if (this._failures) console.log(`[${this._logTag}] Poll recovered after ${this._failures} failure(s)`);
      this._failures = 0;
      platformStatus.set(this._statusKey, true);
    } catch (err) {
      this._failures++;
      platformStatus.set(this._statusKey, false);
      const retry = Math.round(this._nextDelay() / 1000);
      console.error(`[${this._logTag}] ${initial ? 'Initial poll' : 'Poll'} failed (retry in ${retry}s): ${err.message}`);
    } finally {
      this._polling = false;
    }
  }

  // eslint-disable-next-line no-unused-vars
  async _pollImpl(initial) {
    throw new Error(`${this.constructor.name} must implement _pollImpl()`);
  }
}

module.exports = PollingClient;
