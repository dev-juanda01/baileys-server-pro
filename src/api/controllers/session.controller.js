import fs from "fs/promises";
import SessionManager from "../../services/SessionManager.js";
import logger from "../../utils/logger.js";

class SessionController {
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
