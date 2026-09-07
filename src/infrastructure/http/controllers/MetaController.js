import SessionService from "../../../domain/services/SessionService.js";
import logger from "../../../shared/logger.js";

class MetaController {
    verify = (req, res) => {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];
        const MY_VERIFY_TOKEN =
            process.env.META_VERIFY_TOKEN || "baileys_pro_verify_token";

        if (mode === "subscribe" && token === MY_VERIFY_TOKEN)
            res.status(200).send(challenge);
        else res.sendStatus(403);
    };

    handleIncoming = async (req, res) => {
        res.sendStatus(200);
        const body = req.body;

        try {
            if (body.object === "whatsapp_business_account") {
                for (const entry of body.entry) {
                    for (const change of entry.changes) {

                        // Mensajes entrantes de usuarios
                        if (change.value.messages) {
                            const message = change.value.messages[0];

                            if (change.value.contacts) {
                                message.contacts = change.value.contacts;
                            }

                            const phoneId = change.value.metadata.phone_number_id;
                            const session = this.findSessionByPhoneId(phoneId);

                            if (session && session.constructor.name === "MetaProvider") {
                                session.onMessageReceived(message);
                            }
                        }

                        // Cambios de estado de templates HSM
                        if (change.field === "message_template_status_update") {
                            const session = this.findSessionByAccountId(entry.id);
                            if (session) {
                                session.onTemplateStatusUpdate(change.value);
                            } else {
                                logger.warn(
                                    `[MetaWebhook] template_status_update sin sesión para accountId: ${entry.id}`
                                );
                            }
                        }
                    }
                }
            }
        } catch (error) {
            logger.error({ error }, "Error Meta Webhook");
        }
    };

    /**
     * Busca la sesión activa cuyo metaConfig.accountId coincide con el WABA ID del evento.
     * @param {string} accountId  entry.id del payload de Meta (WABA ID).
     */
    findSessionByAccountId(accountId) {
        for (const session of SessionService.sessions.values()) {
            if (session.config?.accountId === accountId) return session;
        }
        return null;
    }

    findSessionByPhoneId(phoneId) {
        for (const session of SessionService.sessions.values()) {
            // Buscar en MetaProvider
            if (session.config && session.config.phoneId === phoneId)
                return session;
            // Buscar en BaileysProvider (si tiene config híbrida)
            if (session.metaConfig && session.metaConfig.phoneId === phoneId)
                return session;
        }
        return null;
    }
}

export default new MetaController();
