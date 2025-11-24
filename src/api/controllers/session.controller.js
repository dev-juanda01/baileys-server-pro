import fs from "fs/promises";
import SessionManager from "../../services/SessionManager.js";
import logger from "../../utils/logger.js";

class SessionController {
    /**
     * @summary Starts a new WhatsApp session or retrieves an existing one.
     * @description Initializes a session with a given ID. If the session already exists, it returns the existing session.
     * It can also be configured with a webhook URL and Meta API credentials.
     * @param {object} req - The Express request object.
     * @param {object} req.body - The request body.
     * @param {string} req.body.sessionId - The unique identifier for the session.
     * @param {string} [req.body.webhook] - Optional webhook URL for receiving message notifications.
     * @param {object} [req.body.metaConfig] - Optional configuration for the Meta API.
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
            await SessionManager.startSession(sessionId, webhook, metaConfig);
            res.status(200).json({
                success: true,
                message: "La sesión está iniciando.",
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
     * @summary Gets the status of a specific session.
     * @description Retrieves the current connection status and QR code (if any) for a given session ID.
     * @param {object} req - The Express request object.
     * @param {object} req.params - The URL parameters.
     * @param {string} req.params.sessionId - The ID of the session to check.
     * @param {object} res - The Express response object.
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
     * @summary Retrieves the QR code for a session that needs authentication.
     * @description If a session is in a 'starting' or 'pending' state, this endpoint provides the QR code
     * required to link a device. It also handles restarting a failed session if a QR is requested for it.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session.
     * @param {object} res - The Express response object.
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
            return res.status(200).json({
                success: true,
                qr: null,
                message: "La sesión ya está conectada.",
            });
        }

        if (!session.qr) {
            return res.status(200).json({
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
     * @summary Sends a text message from a specific session.
     * @description Uses an active session to send a plain text message to a specified phone number.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session to use for sending.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's phone number.
     * @param {string} req.body.message - The text message to send.
     * @param {object} res - The Express response object.
     */
    async sendMessage(req, res) {
        const { sessionId } = req.params;
        const { number, message } = req.body;

        if (!number || !message) {
            return res.status(400).json({
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
     * @summary Sends an image message from a specific session.
     * @description Uploads an image file and sends it to a specified phone number via an active session.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session.
     * @param {object} req.body - The request body from `multipart/form-data`.
     * @param {string} req.body.number - The recipient's phone number.
     * @param {string} [req.body.caption] - An optional caption for the image.
     * @param {object} req.file - The uploaded file object from Multer.
     * @param {object} res - The Express response object.
     */
    async sendImage(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path);
            return res.status(400).json({
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
     * @summary Sends a document message from a specific session.
     * @description Uploads a document file (e.g., PDF) and sends it to a specified phone number.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session.
     * @param {object} req.body - The request body from `multipart/form-data`.
     * @param {string} req.body.number - The recipient's phone number.
     * @param {object} req.file - The uploaded file object from Multer.
     * @param {object} res - The Express response object.
     */
    async sendDocument(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path);
            return res.status(400).json({
                success: false,
                message: "El número y el archivo de documento son requeridos.",
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
     * @summary Sends an audio message from a specific session.
     * @description Uploads an audio file and sends it to a specified phone number.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session.
     * @param {object} req.body - The request body from `multipart/form-data`.
     * @param {string} req.body.number - The recipient's phone number.
     * @param {object} req.file - The uploaded file object from Multer.
     * @param {object} res - The Express response object.
     */
    async sendAudio(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path);
            return res.status(400).json({
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
     * @summary Sends a video message from a specific session.
     * @description Uploads a video file and sends it to a specified phone number.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session.
     * @param {object} req.body - The request body from `multipart/form-data`.
     * @param {string} req.body.number - The recipient's phone number.
     * @param {string} [req.body.caption] - An optional caption for the video.
     * @param {object} req.file - The uploaded file object from Multer.
     * @param {object} res - The Express response object.
     */
    async sendVideo(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path);
            return res.status(400).json({
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
     * @summary Sends a message with interactive reply buttons.
     * @description This uses the Official Meta API via `OfficialWhatsappService`. The session must have
     * `metaConfig` initialized.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's phone number.
     * @param {string} req.body.text - The main message text.
     * @param {Array<object>} req.body.buttons - An array of button objects.
     * @param {object} res - The Express response object.
     */
    async sendButtonMessage(req, res) {
        const { sessionId } = req.params;
        const { number, text, footer, buttons } = req.body;

        if (
            !number ||
            !text ||
            !buttons ||
            !Array.isArray(buttons) ||
            buttons.length === 0
        ) {
            return res
                .status(400)
                .json({ success: false, message: "Datos incompletos." });
        }

        const session = SessionManager.getSession(sessionId);
        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            // Aquí podrías poner lógica para decidir si usar Baileys o Meta API
            // Por ahora usamos Baileys
            const result = await session.sendButtonMessage(
                number,
                text,
                footer,
                buttons
            );
            res.status(200).json({
                success: true,
                message: "Mensaje con botones enviado.",
                details: result,
            });
        } catch (error) {
            logger.error(
                { error },
                `Error al enviar mensaje con botones desde ${sessionId}`
            );
            res.status(500).json({
                success: false,
                message: "Error al enviar el mensaje con botones.",
                error: error.message,
            });
        }
    }

    /**
     * @summary Sends a message with an interactive list.
     * @description This uses the Official Meta API via `OfficialWhatsappService`. The session must have
     * `metaConfig` initialized.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session.
     * @param {object} req.body - The request body containing list details.
     * @param {string} req.body.number - The recipient's phone number.
     * @param {string} req.body.buttonText - The text on the button that opens the list.
     * @param {Array<object>} req.body.sections - The sections and rows of the list.
     * @param {object} res - The Express response object.
     */
    async sendListMessage(req, res) {
        const { sessionId } = req.params;
        const { number, title, text, footer, buttonText, sections } = req.body;

        // Validaciones
        if (
            !number ||
            !text ||
            !buttonText ||
            !sections ||
            !Array.isArray(sections)
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Faltan campos requeridos (number, text, buttonText, sections).",
            });
        }

        const session = SessionManager.getSession(sessionId);
        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            const result = await session.sendOfficialList(
                number,
                title,
                text,
                footer,
                buttonText,
                sections
            );

            res.status(200).json({
                success: true,
                message: "Mensaje de lista enviado vía API Oficial.",
                details: result,
            });
        } catch (error) {
            logger.error({ error }, `Error al enviar lista desde ${sessionId}`);
            res.status(500).json({
                success: false,
                message: "Error al enviar la lista.",
                error: error.message,
            });
        }
    }

    /**
     * @summary Ends a WhatsApp session.
     * @description Logs out the session, which triggers a cleanup of the session's authentication files.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session to end.
     * @param {object} res - The Express response object.
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

    /**
     * @summary Updates the metadata of an active session.
     * @description Allows for dynamically changing the `webhook` URL and/or the `metaConfig` for a session.
     * The changes are persisted to the session's `metadata.json` file.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session to update.
     * @param {object} req.body - The request body containing the updates.
     * @param {object} res - The Express response object.
     */
    async updateMetadata(req, res) {
        const { sessionId } = req.params;
        const { webhook, metaConfig } = req.body;

        if (webhook === undefined && metaConfig === undefined) {
            return res.status(400).json({
                success: false,
                message:
                    "Debe proporcionar al menos un campo para actualizar (webhook o metaConfig).",
            });
        }

        try {
            const updatedMeta = await SessionManager.updateSessionMetadata(
                sessionId,
                { webhook, metaConfig }
            );

            res.status(200).json({
                success: true,
                message:
                    "Configuración de la sesión actualizada correctamente.",
                data: {
                    webhook: updatedMeta.webhookUrl,
                    metaConfig: updatedMeta.metaConfig,
                },
            });
        } catch (error) {
            logger.error(
                { error },
                `Error al actualizar metadata de ${sessionId}`
            );

            // Diferenciamos si el error es porque no existe la sesión u otro motivo
            if (
                error.message.includes("no está activa") ||
                error.message.includes("No se encontró")
            ) {
                return res
                    .status(404)
                    .json({ success: false, message: error.message });
            }

            res.status(500).json({
                success: false,
                message: "Error interno al actualizar la configuración.",
                error: error.message,
            });
        }
    }
}

const sessionController = new SessionController();
export default sessionController;
