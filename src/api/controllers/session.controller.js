import fs from "fs/promises";
import SessionManager from "../../services/SessionManager.js";
import logger from "../../utils/logger.js";

/**
 * Controller responsible for handling HTTP requests related to WhatsApp sessions.
 * Provides endpoints to start sessions, retrieve status/QR, send messages and media, and end sessions.
 * @class
 */
class SessionController {
    /**
     * Start a new WhatsApp session.
     * Expects JSON body with `sessionId` (required) and optional `webhook`.
     * Responds with 200 if session start was accepted, 400 if missing params, 500 on server error.
     *
     * @async
     * @param {import('express').Request} req - Express request object. Body: { sessionId: string, webhook?: string }
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
     * Retrieve the current status of a WhatsApp session.
     * Returns session status and QR (if available).
     *
     * @async
     * @param {import('express').Request} req - Express request object. Params: { sessionId: string }
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
     * Get the QR code for a session.
     * If the session is in a failed state it will attempt to restart and generate a new QR.
     *
     * @async
     * @param {import('express').Request} req - Express request object. Params: { sessionId: string }
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
     * Send a plain text message via a session.
     * If session is not found returns 404. Validates number and message fields.
     *
     * @async
     * @param {import('express').Request} req - Express request object. Params: { sessionId: string }, Body: { number: string, message: string }
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
     * Send an image file via a session.
     * Expects multipart form upload (file in req.file). Cleans up temporary file on completion or error.
     *
     * @async
     * @param {import('express').Request} req - Express request object. Params: { sessionId: string }, Body: { number: string, caption?: string }, File: req.file
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async sendImage(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path);
            return res
                .status(400)
                .json({
                    success: false,
                    message: "El número y el archivo de imagen son requeridos.",
                });
        }

        const session = SessionManager.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path);
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            const result = await session.sendImage(number, file.path, caption);
            res.status(200).json({
                success: true,
                message: "Imagen enviada exitosamente.",
                details: result,
            });
        } catch (error) {
            logger.error(
                { error },
                `Error al enviar imagen desde ${sessionId}`
            );
            res.status(500).json({
                success: false,
                message: "Error al enviar la imagen.",
            });
        } finally {
            await fs.unlink(file.path);
        }
    }

    /**
     * Send a document file via a session.
     * Expects multipart form upload (file in req.file). Cleans up temporary file on completion or error.
     *
     * @async
     * @param {import('express').Request} req - Express request object. Params: { sessionId: string }, Body: { number: string }, File: req.file
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async sendDocument(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path);
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "El número y el archivo de documento son requeridos.",
                });
        }

        const session = SessionManager.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path);
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            const result = await session.sendDocument(
                number,
                file.path,
                file.originalname,
                file.mimetype
            );
            res.status(200).json({
                success: true,
                message: "Documento enviado exitosamente.",
                details: result,
            });
        } catch (error) {
            logger.error(
                { error },
                `Error al enviar documento desde ${sessionId}`
            );
            res.status(500).json({
                success: false,
                message: "Error al enviar el documento.",
            });
        } finally {
            await fs.unlink(file.path);
        }
    }

    /**
     * Send an audio file via a session.
     * Expects multipart form upload (file in req.file). Cleans up temporary file on completion or error.
     *
     * @async
     * @param {import('express').Request} req - Express request object. Params: { sessionId: string }, Body: { number: string }, File: req.file
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async sendAudio(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path);
            return res
                .status(400)
                .json({
                    success: false,
                    message: "El número y el archivo de audio son requeridos.",
                });
        }

        const session = SessionManager.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path);
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            const result = await session.sendAudio(
                number,
                file.path,
                file.mimetype
            );
            res.status(200).json({
                success: true,
                message: "Audio enviado exitosamente.",
                details: result,
            });
        } catch (error) {
            logger.error({ error }, `Error al enviar audio desde ${sessionId}`);
            res.status(500).json({
                success: false,
                message: "Error al enviar el audio.",
            });
        } finally {
            await fs.unlink(file.path);
        }
    }

    /**
     * Send a video file via a session.
     * Expects multipart form upload (file in req.file). Cleans up temporary file on completion or error.
     *
     * @async
     * @param {import('express').Request} req - Express request object. Params: { sessionId: string }, Body: { number: string, caption?: string }, File: req.file
     * @param {import('express').Response} res - Express response object.
     * @returns {Promise<void>}
     */
    async sendVideo(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path);
            return res
                .status(400)
                .json({
                    success: false,
                    message: "El número y el archivo de video son requeridos.",
                });
        }

        const session = SessionManager.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path);
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            const result = await session.sendVideo(number, file.path, caption);
            res.status(200).json({
                success: true,
                message: "Video enviado exitosamente.",
                details: result,
            });
        } catch (error) {
            logger.error({ error }, `Error al enviar video desde ${sessionId}`);
            res.status(500).json({
                success: false,
                message: "Error al enviar el video.",
            });
        } finally {
            await fs.unlink(file.path);
        }
    }

    /**
     * End a WhatsApp session and remove its data.
     *
     * @async
     * @param {import('express').Request} req - Express request object. Params: { sessionId: string }
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
 * Singleton instance exported for route handlers.
 * @type {SessionController}
 */
const sessionController = new SessionController();
export default sessionController;
