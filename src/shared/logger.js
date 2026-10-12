import pino from "pino";
import { prettyFactory } from "pino-pretty";
import { Writable } from "stream";
import logBroadcaster from "./logBroadcaster.js";

// Most of the ~20 existing logger.info/warn/error(...) call sites across the
// codebase already prefix their message with the sessionId in brackets, e.g.
// `[${sessionId}] [Meta] Mensaje recibido, encolando.` — reuse that exact
// convention to route each line to the right dashboard log viewer without
// touching any of those call sites.
const SESSION_PREFIX_RE = /^\[([^\]]+)\]\s*/;

// IMPORTANT: pino-pretty's DEFAULT export is `build`, the Transform stream
// meant to be driven by pino.transport()'s worker-thread message protocol
// ('message'/'unknown' events) — piping raw NDJSON into it directly just
// passes lines through unprettified. The named `prettyFactory` export is the
// actual synchronous "log line -> pretty string" formatter, which is what we
// need here since we're intentionally staying in-process (so this same
// process can also re-read the stream for the dashboard's live log tab,
// something pino.transport()'s worker thread would make impossible).
const prettify = prettyFactory({
    colorize: true,
    translateTime: "SYS:dd-mm-yyyy HH:MM:ss",
    ignore: "pid,hostname",
    messageFormat: "{msg}",
});

const prettyStream = new Writable({
    write(chunk, _encoding, callback) {
        process.stdout.write(prettify(chunk.toString()));
        callback();
    },
});

// Second destination, fed the exact same raw NDJSON pino writes to
// `prettyStream` above (that's what pino.multistream() does) — parsed here
// just to mirror every log line to the dashboard's live "ver tráfico" tab,
// completely independent of what the terminal shows.
const broadcastStream = new Writable({
    write(chunk, _encoding, callback) {
        try {
            const line = JSON.parse(chunk.toString());
            const match = SESSION_PREFIX_RE.exec(line.msg || "");
            const sessionId = match ? match[1] : null;
            const msg = match ? line.msg.slice(match[0].length) : line.msg;

            logBroadcaster.publish(sessionId, {
                time: line.time,
                level: line.level,
                msg,
            });
        } catch {
            // Malformed/partial line — never let a broadcasting hiccup take
            // down actual logging.
        }
        callback();
    },
});

// Creates the main logger instance, writing the same line to both
// destinations (terminal + dashboard broadcaster).
//
// IMPORTANT: the multistream object must be pino's SECOND positional
// argument. pino(singleArg) only auto-detects singleArg as a stream when it
// has a `.writable`/`._writableState` property (a real Node stream) — the
// plain duck-typed object returned by pino.multistream() has neither, so
// passed alone it's silently treated as `opts` instead, and pino falls back
// to process.stdout directly (bypassing both of our streams entirely).
const logger = pino(
    {},
    pino.multistream([{ stream: prettyStream }, { stream: broadcastStream }])
);

// Exports the singleton logger instance so it can be imported and used throughout the application.
export default logger;
