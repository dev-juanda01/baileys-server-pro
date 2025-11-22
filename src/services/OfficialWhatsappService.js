import logger from "../utils/logger.js";

/**
 * @class OfficialWhatsappService
 * @description Un servicio para interactuar con la API Oficial de WhatsApp Business Cloud.
 * Cada instancia está vinculada a un conjunto específico de credenciales (phoneId, token).
 */
class OfficialWhatsappService {
    /**
     * Crea una instancia del servicio oficial vinculada a una cuenta específica de Meta.
     * @param {object} metaConfig - Objeto de configuración para la API de Meta.
     * @param {string} metaConfig.phoneId - El ID del número de teléfono de Meta.
     * @param {string} metaConfig.token - El token de acceso de Meta.
     * @param {string} [metaConfig.apiVersion='v18.0'] - La versión de la Graph API a utilizar.
     * @throws {Error} Si la configuración de metaConfig está incompleta (falta phoneId o token).
     */
    constructor(metaConfig) {
        if (!metaConfig || !metaConfig.phoneId || !metaConfig.token) {
            throw new Error(
                "Configuración de Meta API incompleta (requiere phoneId y token)."
            );
        }

        this.phoneId = metaConfig.phoneId;
        this.token = metaConfig.token;
        this.apiVersion = metaConfig.apiVersion || "v18.0";
        this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
    }

    /**
     * Envía un mensaje interactivo con botones de respuesta usando la API Oficial.
     * @param {string} recipient - El número de teléfono del destinatario.
     * @param {object} body - El cuerpo del mensaje.
     * @param {string} body.text - El texto principal del mensaje.
     * @param {string} [body.footer] - Texto opcional para el pie de página.
     * @param {Array<object>} buttons - Un array de objetos de botón.
     * @param {string} buttons[].id - El ID único para el botón.
     * @param {string} buttons[].text - El texto a mostrar en el botón.
     * @returns {Promise<object>} Una promesa que se resuelve con los datos de respuesta de la API de Meta.
     * @throws {Error} Lanza un error si la llamada a la API falla.
     */
    async sendInteractiveButtons(recipient, body, buttons) {
        // Limpieza del número
        const cleanNumber = recipient.replace(/\D/g, "");

        // Construir botones
        const formattedButtons = buttons.map((btn) => ({
            type: "reply",
            reply: {
                id: btn.id,
                title: btn.text.substring(0, 20),
            },
        }));

        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanNumber,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: body.text,
                },
                ...(body.footer && { footer: { text: body.footer } }),
                action: {
                    buttons: formattedButtons,
                },
            },
        };

        try {
            const url = `${this.baseUrl}/${this.phoneId}/messages`;

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (!response.ok) {
                logger.error({ error: data }, "Error en respuesta de Meta API");
                throw new Error(
                    data.error?.message || "Error desconocido de Meta API"
                );
            }

            logger.info(
                `Mensaje oficial enviado a ${cleanNumber}. ID: ${data.messages[0].id}`
            );
            return data;
        } catch (error) {
            logger.error({ error }, "Fallo al enviar mensaje oficial");
            throw error;
        }
    }
}

export default OfficialWhatsappService;
