// src/api/controllers/session.controller.js

import SessionManager from "../../services/SessionManager.js";

class SessionController {
    async start(req, res) {
        const { sessionId, webhook } = req.body; // -> Recibe la URL del webhook
        if (!sessionId) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "El campo sessionId es requerido.",
                });
        }

        try {
            await SessionManager.startSession(sessionId, webhook); // -> Pasa el webhook al manager
            res.status(200).json({
                success: true,
                message:
                    "La sesión está iniciando. Consulta el estado para obtener el código QR.",
                sessionId: sessionId,
            });
        } catch (error) {
            console.error(`Error al iniciar la sesión ${sessionId}:`, error);
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
            console.error(`Error al enviar mensaje desde ${sessionId}:`, error);
            res.status(500).json({
                success: false,
                message: "Error al enviar el mensaje.",
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
}

const sessionController = new SessionController();
export default sessionController;
