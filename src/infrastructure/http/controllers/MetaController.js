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
                        if (change.value.messages) {
                            const message = change.value.messages[0];

                            // En algunos casos Meta envía contacts junto con messages
                            // Inyectamos contacts en el message para que el Mapper pueda sacar el nombre
                            if (change.value.contacts) {
                                message.contacts = change.value.contacts;
                            }

                            const phoneId =
                                change.value.metadata.phone_number_id;

                            // Buscamos sesión activa
                            const session = this.findSessionByPhoneId(phoneId);

                            if (session) {
                                // Delegamos toda la lógica al Provider (que tiene la cola)
                                // Nota: session puede ser MetaProvider o BaileysProvider
                                // Ambos deben tener el método 'onMessageReceived' o similar si queremos unificar

                                // Si es MetaProvider (nuestra nueva clase), tiene onMessageReceived.
                                if (
                                    session.constructor.name === "MetaProvider"
                                ) {
                                    session.onMessageReceived(message);
                                }
                                // Si es BaileysProvider (modo híbrido antiguo),
                                // solo debemos procesar interacciones, y BaileysProvider NO tiene lógica para recibir de Meta.
                                // En v2.0 estricta, asumimos que si llega de Meta, es una sesión MetaProvider.
                                // Si quieres mantener el soporte híbrido antiguo, aquí iría la lógica de filtrado.
                            }
                        }
                    }
                }
            }
        } catch (error) {
            logger.error({ error }, "Error Meta Webhook");
        }
    };

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
