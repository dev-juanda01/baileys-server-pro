import fs from "fs/promises";
import SessionService from "../../../domain/services/SessionService.js";
import logger from "../../../shared/logger.js";

class SessionController {
    /**
     * @summary Starts a new WhatsApp session.
     * @description Creates and starts a new session, either with Baileys or Meta Provider.
     * @param {object} req - El objeto de solicitud de Express.
     * @param {object} req.body - El cuerpo de la solicitud.
     * @param {string} req.body.sessionId - El identificador único para la sesión.
     * @param {string} [req.body.webhook] - La URL del webhook para recibir eventos.
     * @param {object} [req.body.metaConfig] - Specific configuration for Meta Provider.
     * @param {object} res - El objeto de respuesta de Express.
     */
    async start(req, res) {
        const { sessionId, webhook, metaConfig } = req.body;
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "The sessionId field is required.",
            });
        }

        try {
            await SessionService.startSession(sessionId, webhook, metaConfig);
            res.status(200).json({
                success: true,
                message: "The session is starting.",
                sessionId: sessionId,
            });
        } catch (error) {
            logger.error({ error }, `Error al iniciar la sesión ${sessionId}`);
            res.status(500).json({
                success: false,
                message: "Error starting the session.",
                error: error.message,
            });
        }
    }

    /**
     * @summary Gets the status of a specific session.
     * @description Returns the current status of the session, such as 'starting', 'open', 'closed', and the QR code if available.
     * @param {object} req - El objeto de solicitud de Express.
     * @param {object} req.params - Los parámetros de la ruta.
     * @param {string} req.params.sessionId - The ID of the session to query.
     * @param {object} res - El objeto de respuesta de Express.
     */
    async getStatus(req, res) {
        const { sessionId } = req.params;
        const session = SessionService.getSession(sessionId);

        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });
        }

        res.status(200).json({
            success: true,
            sessionId: session.sessionId,
            status: session.status,
            qr: session.qr,
        });
    }

    /**
     * @summary Gets the QR code for a session.
     * @description Provides the QR code in base64 format for scanning.
     * Includes logic to automatically restart a failed Baileys session.
     * @param {object} req - El objeto de solicitud de Express.
     * @param {string} req.params.sessionId - El ID de la sesión.
     * @param {object} res - El objeto de respuesta de Express.
     */
    async getQrCode(req, res) {
        const { sessionId } = req.params;
        const session = SessionService.getSession(sessionId);

        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });
        }

        // Meta Provider does not use QR
        if (!session.qr && session.constructor.name === "MetaProvider") {
            return res.status(200).json({
                success: true,
                qr: null,
                message: "Meta API session (No QR required).",
            });
        }

        // Automatic restart if Baileys died
        if (
            session.status === "max_retries_reached" &&
            typeof session.init === "function"
        ) {
            logger.info(
                `[${sessionId}] Restarting failed session from QR request.`
            );
            session.retryCount = 0;
            session.status = "starting";
            await session.init();

            return setTimeout(() => {
                res.status(200).json({
                    success: true,
                    qr: session.qr,
                    message: "Process restarted. New QR generated.",
                });
            }, 2000);
        }

        if (session.status === "open") {
            return res.status(200).json({
                success: true,
                qr: null,
                message: "The session is already connected.",
            });
        }

        if (!session.qr) {
            return res.status(200).json({
                success: true,
                qr: null,
                message: "The QR code is not available or is being generated.",
            });
        }

        res.status(200).json({
            success: true,
            qr: session.qr,
        });
    }

    /**
     * @summary Updates the configuration of an existing session.
     * @description Allows changing the webhook or the provider's configuration (metaConfig) for a session.
     * @param {object} req - El objeto de solicitud de Express.
     * @param {string} req.params.sessionId - El ID de la sesión a actualizar.
     * @param {string} [req.body.webhook] - La nueva URL del webhook.
     * @param {object} [req.body.metaConfig] - The new configuration for Meta Provider.
     * @param {object} res - El objeto de respuesta de Express.
     */
    async updateMetadata(req, res) {
        const { sessionId } = req.params;
        const { webhook, metaConfig } = req.body;

        if (webhook === undefined && metaConfig === undefined) {
            return res.status(400).json({
                success: false,
                message: "Nothing to update (send webhook or metaConfig).",
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
                message: "Configuration updated successfully.",
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
     * @summary Sends a text message to a number.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session from which the message will be sent.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's phone number (with country code).
     * @param {string} req.body.message - The content of the text message.
     * @param {object} res - The Express response object.
     */
    async sendMessage(req, res) {
        const { sessionId } = req.params;
        const { number, message } = req.body;

        if (!number || !message) {
            return res
                .status(400)
                .json({ success: false, message: "Required data is missing." });
        }

        const session = SessionService.getSession(sessionId);
        if (!session)
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });

        try {
            const result = await session.sendMessage(number, message);
            res.status(200).json({ success: true, result });
        } catch (error) {
            console.log(error);
            
            logger.error({ error }, `Error sending message ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // --------------------------------------------------------------------------------
    // MÉTODOS DE MEDIA (CORREGIDOS PARA PASAR MIMETYPE Y FILENAME)
    // --------------------------------------------------------------------------------

    /**
     * @summary Sends an image to a number.
     * @description Sends an image file with an optional caption.
     * @param {object} req - The Express request object, including the uploaded file.
     * @param {string} req.params.sessionId - The session ID.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's number.
     * @param {string} [req.body.caption] - The caption for the image.
     * @param {object} req.file - The image file uploaded by multer.
     * @param {object} res - The Express response object.
     */
    async sendImage(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Missing data (number, image).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });
        }

        try {
            const result = await session.sendImage(
                number,
                file.path,
                caption,
                file.mimetype, // IMPORTANTE: Meta necesita esto
                file.originalname // IMPORTANT: Meta needs this
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error sending image ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * @summary Sends a video to a number.
     * @description Sends a video file with an optional caption.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The session ID.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's number.
     * @param {string} [req.body.caption] - The caption for the video.
     * @param {object} req.file - The video file uploaded by multer.
     * @param {object} res - The Express response object.
     */
    async sendVideo(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Missing data (number, video).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });
        }

        try {
            // CORRECTION: mimetype and filename are passed to the provider
            const result = await session.sendVideo(
                number,
                file.path,
                caption,
                file.mimetype,
                file.originalname
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error sending video ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * @summary Sends an audio file as a voice message.
     * @description Sends an audio file. The WhatsApp client usually displays it as a voice message.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The session ID.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's number.
     * @param {object} req.file - The audio file uploaded by multer.
     * @param {object} res - The Express response object.
     */
    async sendAudio(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Missing data (number, audio).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });
        }

        try {
            const result = await session.sendAudio(
                number,
                file.path,
                file.mimetype,
                file.originalname
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error sending audio ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * @summary Sends a document to a number.
     * @description Sends any type of file as a document attachment.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The session ID.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's number.
     * @param {object} req.file - The document file uploaded by multer.
     * @param {object} res - The Express response object.
     */
    async sendDocument(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Missing data (number, document).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });
        }

        try {
            // Note: MetaProvider expects (number, path, filename, mimetype)
            // Make sure the order matches the definition in the Provider
            const result = await session.sendDocument(
                number,
                file.path,
                file.originalname, // filename
                file.mimetype // mimetype
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error sending document ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * @summary Sends a message with interactive buttons.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The session ID.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's number.
     * @param {string} req.body.text - The main text of the message.
     * @param {string} [req.body.footer] - An optional footer text.
     * @param {Array<object>} req.body.buttons - An array of button objects.
     * @param {string} req.body.buttons[].id - The button ID.
     * @param {string} req.body.buttons[].text - The text to display on the button.
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
                .json({ success: false, message: "Incomplete data." });
        }

        const session = SessionService.getSession(sessionId);
        if (!session)
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });

        try {
            const result = await session.sendButtonMessage(
                number,
                text,
                footer,
                buttons
            );
            res.status(200).json({
                success: true,
                message: "Button message sent.",
                details: result,
            });
        } catch (error) {
            logger.error(
                { error },
                `Error sending button message from ${sessionId}`
            );
            res.status(500).json({
                success: false,
                message: "Error sending the button message.",
                error: error.message,
            });
        }
    }

    /**
     * @summary Sends a message with a list of options.
     * @description This method is only compatible with the Meta API provider.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The session ID.
     * @param {object} req.body - The request body.
     * @param {string} req.body.number - The recipient's number.
     * @param {string} req.body.title - The message title.
     * @param {string} req.body.text - The body of the list message.
     * @param {string} [req.body.footer] - Optional footer text.
     * @param {string} req.body.buttonText - The text of the button that opens the list.
     * @param {Array<object>} req.body.sections - The sections and rows of the list.
     * @param {object} res - The Express response object.
     */
    async sendListMessage(req, res) {
        const { sessionId } = req.params;
        const { number, title, text, footer, buttonText, sections } = req.body;

        if (!number || !text || !buttonText || !sections) {
            return res
                .status(400)
                .json({ success: false, message: "Incomplete data." });
        }

        const session = SessionService.getSession(sessionId);
        if (!session)
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });

        try {
            if (!session.sendListMessage) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This provider (Baileys) does not support lists. Configure Meta API.",
                });
            }
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
            logger.error({ error }, `Error sending list ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * @summary Closes and deletes a session.
     * @description Closes the WhatsApp connection and removes the session data from the system.
     * @param {object} req - The Express request object.
     * @param {string} req.params.sessionId - The ID of the session to close.
     * @param {object} res - The Express response object.
     */
    /**
     * @summary Envía el template a Meta Business API para aprobación.
     * @param {object} req.body.templateData  Datos completos del template desde olimpochat.
     */
    async submitTemplate(req, res) {
        const { sessionId } = req.params;
        const { templateData } = req.body;

        if (!templateData) {
            return res.status(400).json({ success: false, message: "templateData es requerido." });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found." });
        }

        try {
            const result = await session.submitTemplate(templateData);
            res.status(200).json({ success: true, data: result });
        } catch (error) {
            logger.error({ error }, `Error submitTemplate ${sessionId}`);
            res.status(error.response?.status || 500).json({
                success: false,
                message: error.response?.data?.error?.message || error.message,
            });
        }
    }

    /**
     * @summary Elimina un template de Meta Business API.
     * @param {object} req.body.templateName  Nombre del template.
     * @param {object} req.body.templateId    meta_template_id (hsm_id), opcional.
     */
    async deleteTemplate(req, res) {
        const { sessionId } = req.params;
        const { templateName, templateId } = req.body;

        if (!templateName) {
            return res.status(400).json({ success: false, message: "templateName es requerido." });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found." });
        }

        try {
            const result = await session.deleteTemplate(templateName, templateId);
            res.status(200).json({ success: true, data: result });
        } catch (error) {
            logger.error({ error }, `Error deleteTemplate ${sessionId}`);
            res.status(error.response?.status || 500).json({
                success: false,
                message: error.response?.data?.error?.message || error.message,
            });
        }
    }

    /**
     * @summary Envía un mensaje de tipo template aprobado a un número de teléfono.
     * @param {string} req.body.number        Número destino.
     * @param {string} req.body.templateName  Nombre del template.
     * @param {string} req.body.language      Código de idioma (ej. "es").
     * @param {object} req.body.variables     Mapa posicional { "1": "Juan" }.
     */
    async sendTemplate(req, res) {
        const { sessionId } = req.params;
        const { number, templateName, language, variables } = req.body;

        if (!number || !templateName || !language) {
            return res.status(400).json({
                success: false,
                message: "number, templateName y language son requeridos.",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found." });
        }

        try {
            const result = await session.sendTemplate(number, templateName, language, variables || {});
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error sendTemplate ${sessionId}`);
            res.status(error.response?.status || 500).json({
                success: false,
                message: error.response?.data?.error?.message || error.message,
            });
        }
    }

    async end(req, res) {
        const { sessionId } = req.params;
        try {
            const result = await SessionService.deleteSession(sessionId);
            if (result)
                res.status(200).json({
                    success: true,
                    message: "Session closed successfully.",
                });
            else
                res.status(404).json({
                    success: false,
                    message: "Session not found.",
                });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new SessionController();
