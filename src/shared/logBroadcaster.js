import { EventEmitter } from "events";

// How many recent lines to keep per channel so a dashboard tab opened mid
// -conversation isn't just a blank screen — replayed once on subscribe.
const MAX_BUFFER_PER_CHANNEL = 300;

/**
 * In-memory pub/sub for mirroring the server's log output to the dashboard
 * in real time (Server-Sent Events), per session — "ver el tráfico como
 * está en la terminal" but in the browser, filtered to one línea at a time.
 *
 * Sessions publish under their own sessionId; every entry is also re-emitted
 * on the special "*" channel so a "todas las conexiones" view is possible
 * without extra plumbing. Pure in-process EventEmitter — no new dependency,
 * no change needed to the ~20 existing `logger.info/warn/error` call sites
 * across the codebase (see logger.js, which taps the raw log stream instead
 * of requiring every call site to publish explicitly).
 */
class LogBroadcaster extends EventEmitter {
    constructor() {
        super();
        // Every active SSE connection for every session adds a listener here
        // — well above Node's default-11 warning threshold under normal use.
        this.setMaxListeners(0);
        this.buffers = new Map();
    }

    /**
     * @param {string|null} sessionId - null/undefined routes to the "general"
     *   channel (e.g. server-level logs with no specific línea attached).
     * @param {{time: number, level: number|string, msg: string}} entry
     */
    publish(sessionId, entry) {
        const channel = sessionId || "general";
        const payload = { sessionId: channel, ...entry };

        this._appendTo(channel, payload);
        this.emit(channel, payload);

        // Also mirror into the wildcard channel so a "todas las conexiones"
        // view can replay recent history across every línea at once.
        this._appendTo("*", payload);
        this.emit("*", payload);
    }

    _appendTo(channel, payload) {
        let buffer = this.buffers.get(channel);
        if (!buffer) {
            buffer = [];
            this.buffers.set(channel, buffer);
        }
        buffer.push(payload);
        if (buffer.length > MAX_BUFFER_PER_CHANNEL) buffer.shift();
    }

    /**
     * @param {string} channel - A sessionId, "general", or "*" for everything.
     * @returns {Array<object>} Recent entries already published on that channel.
     */
    getRecent(channel) {
        return this.buffers.get(channel) || [];
    }
}

export default new LogBroadcaster();
