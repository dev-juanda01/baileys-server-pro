// src/api/controllers/session.controller.js
import SessionManager from "../../services/SessionManager.js";
import logger from "../../utils/logger.js";

/**
 * SessionController
 * Handles WhatsApp session lifecycle: start, status, QR code retrieval, sending messages, and ending sessions.
 */
class SessionController {
    /**
     * Start a new WhatsApp session.
     * @async
     * @param {import('express').Request} req - Express request object. Requires sessionId and optional webhook in body.
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async start(req, res) {
        const { sessionId, webhook } = req.body;
        if (!sessionId) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "El campo sessionId es requerido.",
                });
        }

        try {
            await SessionManager.startSession(sessionId, webhook);
            res.status(200).json({
                success: true,
                message:
                    "La sesión está iniciando. Consulta el estado para obtener el código QR.",
                sessionId: sessionId,
            });
        } catch (error) {
            logger.error({ error }, `Error al iniciar la sesión ${sessionId}`);
            res.status(500).json({
                success: false,
                message: "Error al iniciar la sesión.",
                error: error.message,
            });
        }
    }

    /**
     * Get the status of a WhatsApp session.
     * @async
     * @param {import('express').Request} req - Express request object. Requires sessionId in params.
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async getStatus(req, res) {
        const { sessionId } = req.params;
        const session = SessionManager.getSession(sessionId);

        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        res.status(200).json({
            success: true,
            sessionId: session.sessionId,
            status: session.status,
            qr: session.qr,
        });
    }

    /**
     * Get the QR code for a WhatsApp session.
     * If session failed, it will restart and generate a new QR.
     * @async
     * @param {import('express').Request} req - Express request object. Requires sessionId in params.
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async getQrCode(req, res) {
        const { sessionId } = req.params;
        const session = SessionManager.getSession(sessionId);

        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        // If session failed, restart it here.
        if (session.status === "max_retries_reached") {
            logger.info(
                `[${sessionId}] Solicitud de QR para sesión fallida. Reiniciando desde 'qr'`
            );
            
            session.retryCount = 0;
            session.status = "starting";
            await session.init();

            setTimeout(() => {
                res.status(200).json({
                    success: true,
                    qr: session.qr,
                    message:
                        "Proceso de conexión reiniciado. Nuevo QR generado.",
                });
            }, 2000);
            return;
        }

        if (session.status === "open") {
            return res
                .status(200)
                .json({
                    success: true,
                    qr: null,
                    message: "La sesión ya está conectada.",
                });
        }

        if (!session.qr) {
            return res
                .status(200)
                .json({
                    success: true,
                    qr: null,
                    message:
                        "El código QR no está disponible o está siendo generado.",
                });
        }

        res.status(200).json({
            success: true,
            qr: session.qr,
        });
    }

    /**
     * Send a text message using a WhatsApp session.
     * @async
     * @param {import('express').Request} req - Express request object. Requires sessionId in params and number/message in body.
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async sendMessage(req, res) {
        const { sessionId } = req.params;
        const { number, message } = req.body;

        if (!number || !message) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "Los campos number y message son requeridos.",
                });
        }

        const session = SessionManager.getSession(sessionId);

        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            const result = await session.sendMessage(number, message);
            res.status(200).json({
                success: true,
                message: "Mensaje enviado exitosamente.",
                details: result,
            });
        } catch (error) {
            logger.error(
                { error },
                `Error al enviar mensaje desde ${sessionId}`
            );
            res.status(500).json({
                success: false,
                message: "Error al enviar el mensaje.",
                error: error.message,
            });
        }
    }

    /**
     * End a WhatsApp session and delete its data.
     * @async
     * @param {import('express').Request} req - Express request object. Requires sessionId in params.
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async end(req, res) {
        const { sessionId } = req.params;
        const result = await SessionManager.endSession(sessionId);

        if (result) {
            res.status(200).json({
                success: true,
                message: "Sesión cerrada exitosamente.",
            });
        } else {
            res.status(404).json({
                success: false,
                message: "Sesión no encontrada.",
            });
        }
    }
}

/**
 * Instance of SessionController to be used in routes.
 * @type {SessionController}
 */
const sessionController = new SessionController();
export default sessionController;
