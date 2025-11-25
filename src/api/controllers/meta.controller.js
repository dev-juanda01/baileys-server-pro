import SessionManager from "../../services/SessionManager.js";
import logger from "../../utils/logger.js";

class MetaController {
    /**
     * Endpoint para la verificación del Webhook (GET)
     */
    verify = (req, res) => {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        const MY_VERIFY_TOKEN =
            process.env.META_VERIFY_TOKEN || "baileys_pro_verify_token";

        if (mode && token) {
            if (mode === "subscribe" && token === MY_VERIFY_TOKEN) {
                logger.info("Webhook de Meta verificado correctamente.");
                res.status(200).send(challenge);
            } else {
                res.sendStatus(403);
            }
        } else {
            res.sendStatus(400);
        }
    };

    /**
     * Endpoint para recibir eventos (POST)
     */
    handleIncoming = async (req, res) => {
        const body = req.body;

        // Responder rápido a Meta para que no reintente
        res.sendStatus(200);

        try {
            if (body.object === "whatsapp_business_account") {
                for (const entry of body.entry) {
                    for (const change of entry.changes) {
                        // Procesamos solo si hay mensajes
                        if (change.value.messages) {
                            const message = change.value.messages[0];
                            const phoneId =
                                change.value.metadata.phone_number_id;

                            const session = this.findSessionByPhoneId(phoneId);

                            if (session && session.webhookUrl) {
                                await this.forwardToUserWebhook(
                                    session,
                                    message
                                );
                            }
                        }
                    }
                }
            }
        } catch (error) {
            logger.error({ error }, "Error procesando evento de Meta");
        }
    };

    /**
     * Busca en las sesiones activas cual tiene configurado este phoneId
     */
    findSessionByPhoneId(phoneId) {
        for (const session of SessionManager.sessions.values()) {
            if (session.metaConfig && session.metaConfig.phoneId === phoneId) {
                return session;
            }
        }
        return null;
    }

    /**
     * Convierte el formato de Meta al formato unificado y lo envía al webhook del usuario.
     * AHORA FILTRA ESTRICTAMENTE SOLO INTERACCIONES.
     */
    async forwardToUserWebhook(session, metaMsg) {
        // -> 1. FILTRO CRÍTICO: Ignorar todo lo que NO sea una interacción.
        // Los textos, imágenes, audios, etc., ya los maneja Baileys.
        // Si dejamos pasar esto, tendríamos mensajes duplicados.
        if (metaMsg.type !== "interactive") {
            return;
        }

        // -> 2. Construcción del Payload
        const payload = {
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            source: "meta_cloud_api", // Bandera para identificar el origen
            message: {
                id: metaMsg.id,
                from: metaMsg.from,
                senderName: "", // Meta no suele enviar el pushName aquí
                type: null, // Se llenará abajo
                text: null,
                payload: null, // Aquí va el ID del botón
            },
        };

        // Extraer respuesta de Botón o Lista
        const interactive = metaMsg.interactive;

        if (interactive.type === "button_reply") {
            payload.message.type = "button_reply";
            payload.message.text = interactive.button_reply.title;
            payload.message.payload = interactive.button_reply.id;
        } else if (interactive.type === "list_reply") {
            payload.message.type = "list_reply";
            payload.message.text = interactive.list_reply.title;
            payload.message.payload = interactive.list_reply.id;
        } else {
            // Si es un tipo interactivo desconocido, ignoramos
            return;
        }

        // -> 3. Enviar al webhook del usuario
        try {
            await fetch(session.webhookUrl, {
                method: "POST",
                body: JSON.stringify(payload),
                headers: { "Content-Type": "application/json" },
            });
            logger.info(
                `[${session.sessionId}] Interacción Meta (${payload.message.type}) enviada al webhook.`
            );
        } catch (error) {
            logger.error(
                `[${session.sessionId}] Error enviando webhook de Meta al usuario.`
            );
        }
    }
}

export default new MetaController();
