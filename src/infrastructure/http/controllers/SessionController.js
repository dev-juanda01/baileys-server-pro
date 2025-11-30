import fs from "fs/promises";
import SessionService from "../../../domain/services/SessionService.js";
import logger from "../../../shared/logger.js";

/**
 * @class SessionController
 * @description Handles all HTTP requests related to session management, status, and messaging.
 * It acts as the main interface between the API routes and the underlying SessionService.
 */
class SessionController {
    /**
     * Starts a new session based on the provided configuration (Baileys or Meta).
     * @param {object} req - The Express request object.
     * @param {object} res - The Express response object.
     */
    async start(req, res) {
        const { sessionId, webhook, metaConfig } = req.body;
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "El campo sessionId es requerido.",
            });
        }

        try {
            // Delegate session creation to the service layer.
            await SessionService.startSession(sessionId, webhook, metaConfig);
            res.status(200).json({
                success: true,
                message: "La sesión está iniciando.", // "The session is starting."
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
     * Retrieves the current status of a specific session.
     * @param {object} req - The Express request object.
     * @param {object} res - The Express response object.
     */
    async getStatus(req, res) {
        const { sessionId } = req.params;
        const session = SessionService.getSession(sessionId);

        // If the session doesn't exist in memory, return a 404 error.
        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        // Return the session's ID, current status, and QR code if available.
        res.status(200).json({
            success: true,
            sessionId: session.sessionId,
            status: session.status,
            qr: session.qr,
        });
    }

    /**
     * Retrieves the QR code for a Baileys session.
     * Includes logic to restart a failed session upon request.
     * @param {object} req - The Express request object.
     * @param {object} res - The Express response object.
     */
    async getQrCode(req, res) {
        const { sessionId } = req.params;
        const session = SessionService.getSession(sessionId);

        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        // If the provider is Meta, it doesn't use a QR code for authentication.
        if (!session.qr && session.constructor.name === "MetaProvider") {
            return res.status(200).json({
                success: true,
                qr: null,
                message: "Sesión de Meta API (No requiere QR).",
            });
        }

        // Special logic to restart a Baileys session that has failed after max retries.
        if (session.status === "max_retries_reached" && session.init) {
            logger.info(
                `[${sessionId}] Reiniciando sesión fallida desde QR request.`
            );
            session.retryCount = 0;
            session.status = "starting";
            await session.init();

            // Wait a moment for the new QR code to be generated.
            return setTimeout(() => {
                res.status(200).json({
                    success: true,
                    qr: session.qr,
                    message: "Proceso reiniciado. Nuevo QR generado.",
                });
            }, 2000);
        }

        // If the session is already open, there's no QR code to show.
        if (session.status === "open") {
            return res.status(200).json({
                success: true,
                qr: null,
                message: "La sesión ya está conectada.",
            });
        }

        // If the QR code isn't available yet (e.g., during startup).
        if (!session.qr) {
            return res.status(200).json({
                success: true,
                qr: null,
                message:
                    "El código QR no está disponible o está siendo generado.",
            });
        }

        // Return the available QR code.
        res.status(200).json({
            success: true,
            qr: session.qr,
        });
    }

    /**
     * Updates the session's configuration (like webhook URL or Meta config) on the fly.
     * @param {object} req - The Express request object.
     * @param {object} res - The Express response object.
     */
    async updateMetadata(req, res) {
        const { sessionId } = req.params;
        const { webhook, metaConfig } = req.body;

        if (webhook === undefined && metaConfig === undefined) {
            return res.status(400).json({
                success: false,
                message: "Nada que actualizar (envíe webhook o metaConfig).",
            });
        }

        try {
            const result = await SessionService.updateSession(
                sessionId,
                webhook,
                metaConfig
            );

            res.status(200).json({
                success: true,
                message: "Configuración actualizada correctamente.",
                data: result,
            });
        } catch (error) {
            if (error.message.includes("no existe")) {
                return res
                    .status(404)
                    .json({ success: false, message: error.message });
            }

            logger.error({ error }, `Error actualizando metadata ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Sends a plain text message.
     * @param {object} req - The Express request object.
     * @param {object} res - The Express response object.
     */
    async sendMessage(req, res) {
        const { sessionId } = req.params;
        const { number, message } = req.body;

        if (!number || !message) {
            return res
                .status(400)
                .json({ success: false, message: "Faltan datos requeridos." });
        }

        // Retrieve the session and check if it exists.
        const session = SessionService.getSession(sessionId);
        if (!session)
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });

        // Delegate the message sending to the session's provider.
        try {
            const result = await session.sendMessage(number, message);
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando mensaje ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Sends an image message from an uploaded file.
     * @param {object} req - The Express request object, including the uploaded file.
     * @param {object} res - The Express response object.
     */
    async sendImage(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            // Clean up the uploaded file if validation fails.
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Faltan datos (number, image).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            // Clean up the uploaded file if the session is not found.
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            const result = await session.sendImage(number, file.path, caption);
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando imagen ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            // Ensure the temporary uploaded file is deleted after the operation.
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * Sends a document from an uploaded file.
     * @param {object} req - The Express request object, including the uploaded file.
     * @param {object} res - The Express response object.
     */
    async sendDocument(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        // Validate required inputs.
        if (!number || !file) {
            // Clean up the uploaded file if validation fails.
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Faltan datos (number, document).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            // Clean up the uploaded file if the session is not found.
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            // Delegate sending to the provider, passing file details.
            const result = await session.sendDocument(
                number,
                file.path,
                file.originalname,
                file.mimetype
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando documento ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            // Ensure the temporary file is always deleted.
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * Sends an audio file from an upload.
     * @param {object} req - The Express request object, including the uploaded file.
     * @param {object} res - The Express response object.
     */
    async sendAudio(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        // Validate required inputs.
        if (!number || !file) {
            // Clean up the uploaded file if validation fails.
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Faltan datos (number, audio).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            // Clean up the uploaded file if the session is not found.
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            // Delegate sending to the provider.
            const result = await session.sendAudio(
                number,
                file.path,
                file.mimetype
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando audio ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            // Ensure the temporary file is always deleted.
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * Sends a video from an uploaded file.
     * @param {object} req - The Express request object, including the uploaded file.
     * @param {object} res - The Express response object.
     */
    async sendVideo(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        // Validate required inputs.
        if (!number || !file) {
            // Clean up the uploaded file if validation fails.
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Faltan datos (number, video).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            // Clean up the uploaded file if the session is not found.
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            // Delegate sending to the provider.
            const result = await session.sendVideo(number, file.path, caption);
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando video ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            // Ensure the temporary file is always deleted.
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * Sends a message with interactive buttons. This works for both Baileys (native buttons)
     * and Meta (template-style buttons), as the provider abstracts the implementation.
     * @param {object} req - The Express request object.
     * @param {object} res - The Express response object.
     */
    async sendButtonMessage(req, res) {
        const { sessionId } = req.params;
        const { number, text, footer, buttons } = req.body;

        // Validate required fields.
        if (!number || !text || !buttons || !Array.isArray(buttons)) {
            return res
                .status(400)
                .json({ success: false, message: "Datos incompletos." });
        }

        const session = SessionService.getSession(sessionId);
        if (!session)
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });

        try {
            // Delegate sending to the provider.
            const result = await session.sendButtonMessage(
                number,
                text,
                footer,
                buttons
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando botones ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Sends a message with an interactive list. This is typically only supported
     * by the Meta provider.
     * @param {object} req - The Express request object.
     * @param {object} res - The Express response object.
     */
    async sendListMessage(req, res) {
        const { sessionId } = req.params;
        const { number, title, text, footer, buttonText, sections } = req.body;

        // Validate required fields.
        if (!number || !text || !buttonText || !sections) {
            return res
                .status(400)
                .json({ success: false, message: "Datos incompletos." });
        }

        const session = SessionService.getSession(sessionId);
        if (!session)
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });

        try {
            // Check if the provider supports this method before calling it.
            if (!session.sendListMessage) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Este proveedor (Baileys) no soporta listas. Configure Meta API.",
                });
            }

            // Delegate sending to the provider.
            const result = await session.sendListMessage(
                number,
                title,
                text,
                footer,
                buttonText,
                sections
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando lista ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Ends a session, logging it out and deleting all associated files.
     * @param {object} req - The Express request object.
     * @param {object} res - The Express response object.
     */
    async end(req, res) {
        const { sessionId } = req.params;
        try {
            // Delegate session deletion to the service.
            const result = await SessionService.deleteSession(sessionId);
            if (result)
                res.status(200).json({
                    success: true,
                    message: "Sesión cerrada.",
                });
            else
                res.status(404).json({
                    success: false,
                    message: "Sesión no encontrada.",
                });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new SessionController();
