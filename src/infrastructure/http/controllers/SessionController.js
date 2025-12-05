import fs from "fs/promises";
import SessionService from "../../../domain/services/SessionService.js";
import logger from "../../../shared/logger.js";

class SessionController {
    /**
     * Iniciar nueva sesión
     */
    async start(req, res) {
        const { sessionId, webhook, metaConfig } = req.body;
        if (!sessionId) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "El campo sessionId es requerido.",
                });
        }

        try {
            await SessionService.startSession(sessionId, webhook, metaConfig);
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
     * Obtener estado de la sesión
     */
    async getStatus(req, res) {
        const { sessionId } = req.params;
        const session = SessionService.getSession(sessionId);

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
     * Obtener QR (con soporte para reinicio de Baileys)
     */
    async getQrCode(req, res) {
        const { sessionId } = req.params;
        const session = SessionService.getSession(sessionId);

        if (!session) {
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        // Meta Provider no usa QR
        if (!session.qr && session.constructor.name === "MetaProvider") {
            return res.status(200).json({
                success: true,
                qr: null,
                message: "Sesión de Meta API (No requiere QR).",
            });
        }

        // Reinicio automático si Baileys murió
        if (
            session.status === "max_retries_reached" &&
            typeof session.init === "function"
        ) {
            logger.info(
                `[${sessionId}] Reiniciando sesión fallida desde QR request.`
            );
            session.retryCount = 0;
            session.status = "starting";
            await session.init();

            return setTimeout(() => {
                res.status(200).json({
                    success: true,
                    qr: session.qr,
                    message: "Proceso reiniciado. Nuevo QR generado.",
                });
            }, 2000);
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
     * Actualizar Metadata (Webhook/Config)
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
     * Enviar Mensaje de Texto
     */
    async sendMessage(req, res) {
        const { sessionId } = req.params;
        const { number, message } = req.body;

        if (!number || !message) {
            return res
                .status(400)
                .json({ success: false, message: "Faltan datos requeridos." });
        }

        const session = SessionService.getSession(sessionId);
        if (!session)
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });

        try {
            const result = await session.sendMessage(number, message);
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando mensaje ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // --------------------------------------------------------------------------------
    // MÉTODOS DE MEDIA (CORREGIDOS PARA PASAR MIMETYPE Y FILENAME)
    // --------------------------------------------------------------------------------

    /**
     * Enviar Imagen
     */
    async sendImage(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Faltan datos (number, image).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            const result = await session.sendImage(
                number,
                file.path,
                caption,
                file.mimetype, // IMPORTANTE: Meta necesita esto
                file.originalname // IMPORTANTE: Meta necesita esto
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando imagen ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * Enviar Video (CORREGIDO: Pasando los 5 parámetros)
     */
    async sendVideo(req, res) {
        const { sessionId } = req.params;
        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Faltan datos (number, video).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            // CORRECCIÓN: Se pasan mimetype y filename al provider
            const result = await session.sendVideo(
                number,
                file.path,
                caption,
                file.mimetype,
                file.originalname
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando video ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * Enviar Audio
     */
    async sendAudio(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Faltan datos (number, audio).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
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
            logger.error({ error }, `Error enviando audio ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * Enviar Documento
     */
    async sendDocument(req, res) {
        const { sessionId } = req.params;
        const { number } = req.body;
        const file = req.file;

        if (!number || !file) {
            if (file) await fs.unlink(file.path).catch(() => {});
            return res.status(400).json({
                success: false,
                message: "Faltan datos (number, document).",
            });
        }

        const session = SessionService.getSession(sessionId);
        if (!session) {
            await fs.unlink(file.path).catch(() => {});
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });
        }

        try {
            // Nota: MetaProvider espera (number, path, filename, mimetype)
            // Asegúrate que el orden coincida con la definición en el Provider
            const result = await session.sendDocument(
                number,
                file.path,
                file.originalname, // filename
                file.mimetype // mimetype
            );
            res.status(200).json({ success: true, result });
        } catch (error) {
            logger.error({ error }, `Error enviando documento ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            await fs.unlink(file.path).catch(() => {});
        }
    }

    /**
     * Enviar Botones
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

        const session = SessionService.getSession(sessionId);
        if (!session)
            return res
                .status(404)
                .json({ success: false, message: "Sesión no encontrada." });

        try {
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
     * Enviar Lista
     */
    async sendListMessage(req, res) {
        const { sessionId } = req.params;
        const { number, title, text, footer, buttonText, sections } = req.body;

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
            if (!session.sendListMessage) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Este proveedor (Baileys) no soporta listas. Configure Meta API.",
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
            logger.error({ error }, `Error enviando lista ${sessionId}`);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Cerrar Sesión
     */
    async end(req, res) {
        const { sessionId } = req.params;
        try {
            const result = await SessionService.deleteSession(sessionId);
            if (result)
                res.status(200).json({
                    success: true,
                    message: "Sesión cerrada exitosamente.",
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
