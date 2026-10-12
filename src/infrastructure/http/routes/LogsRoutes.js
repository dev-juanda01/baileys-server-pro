import { Router } from "express";
import { requireDashboardApi } from "../middlewares/dashboardAuth.js";
import logBroadcaster from "../../../shared/logBroadcaster.js";

const router = Router();

// Dashboard-only — these lines can contain phone numbers and message text,
// same sensitivity level as everything else behind requireDashboardApi.
router.use(requireDashboardApi);

/**
 * @swagger
 * tags:
 *   - name: Logs
 *     description: Transmisión en vivo (Server-Sent Events) del log de cada sesión, para verlo en el dashboard igual que en la terminal.
 */

/**
 * @swagger
 * /api/logs/stream:
 *   get:
 *     summary: Transmite en vivo las líneas de log de una sesión (o de todas)
 *     description: >
 *       Server-Sent Events. Sin `session`, transmite el tráfico de TODAS las
 *       líneas mezclado (canal "*"). Al conectar, reproduce primero el buffer
 *       reciente (hasta 300 líneas) para que la pestaña no abra en blanco.
 *     tags: [Logs]
 *     parameters:
 *       - in: query
 *         name: session
 *         schema: { type: string }
 *         required: false
 *         description: sessionId a filtrar. Omitir para ver el tráfico de todas las sesiones.
 *     responses:
 *       '200':
 *         description: text/event-stream
 *       '401':
 *         description: No autenticado en el dashboard.
 */
router.get("/stream", (req, res) => {
    const sessionId = req.query.session ? String(req.query.session) : null;
    const channel = sessionId || "*";

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // Disable response buffering on common reverse proxies (nginx) so
        // lines actually arrive in real time instead of batched.
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const send = (entry) => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    // Replay recent history first so opening the tab mid-conversation isn't
    // just a blank screen.
    logBroadcaster.getRecent(channel).forEach(send);

    logBroadcaster.on(channel, send);

    // Reverse proxies / browsers tend to kill idle connections — a periodic
    // comment keeps this one alive without polluting the actual log stream.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

    req.on("close", () => {
        clearInterval(heartbeat);
        logBroadcaster.off(channel, send);
    });
});

export default router;
