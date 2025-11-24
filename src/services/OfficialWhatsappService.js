import logger from "../utils/logger.js";

/**
 * @class OfficialWhatsappService
 * @description A service for interacting with the Official WhatsApp Business Cloud API.
 * Each instance is tied to a specific set of credentials (phoneId, token).
 */
class OfficialWhatsappService {
    /**
     * Creates an instance of the official service linked to a specific Meta account.
     * @param {object} metaConfig - Configuration object for the Meta API.
     * @param {string} metaConfig.phoneId - The Meta phone number ID.
     * @param {string} metaConfig.token - The Meta access token.
     * @param {string} [metaConfig.apiVersion='v18.0'] - The Graph API version to use.
     * @throws {Error} If the metaConfig is incomplete (missing phoneId or token).
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
     * Sends an interactive message with reply buttons using the Official API.
     * @param {string} recipient - The recipient's phone number.
     * @param {object} body - The message body.
     * @param {string} body.text - The main text of the message.
     * @param {string} [body.footer] - Optional footer text.
     * @param {Array<object>} buttons - An array of button objects.
     * @param {string} buttons[].id - The unique ID for the button.
     * @param {string} buttons[].text - The text to display on the button.
     * @returns {Promise<object>} A promise that resolves with the response data from the Meta API.
     * @throws {Error} Throws an error if the API call fails.
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

    /**
     * Sends an interactive list message using the Official API.
     * @param {string} recipient - The recipient's phone number.
     * @param {object} body - The main body of the list message.
     * @param {string} body.text - The primary text content of the message.
     * @param {string} body.buttonText - The text displayed on the button that opens the list.
     * @param {string} [body.title] - An optional title for the list's header.
     * @param {string} [body.footer] - Optional footer text for the message.
     * @param {Array<object>} sections - An array of section objects. Each section must have a title
     * and an array of rows. Each row must have an id, title, and optional description.
     * @example sections: [{ title: "Section 1", rows: [{ id: "row1", title: "Row 1 Title", description: "Row 1 Desc" }] }]
     * @returns {Promise<object>} A promise that resolves with the response data from the Meta API.
     * @throws {Error} Throws an error if the API call fails or if required parameters are missing.
     */
    async sendInteractiveList(recipient, body, sections) {
        const cleanNumber = recipient.replace(/\D/g, "");

        // Validación básica de Meta
        if (!body.buttonText) {
            throw new Error(
                "El 'buttonText' (texto del botón que abre la lista) es obligatorio."
            );
        }

        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanNumber,
            type: "interactive",
            interactive: {
                type: "list",
                header: {
                    type: "text",
                    text: body.title || "", // Título opcional en cabecera
                },
                body: {
                    text: body.text,
                },
                ...(body.footer && { footer: { text: body.footer } }),
                action: {
                    button: body.buttonText, // El texto del botón que despliega la lista
                    sections: sections, // [{ title: "...", rows: [{id, title, description}] }]
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
                logger.error(
                    { error: data },
                    "Error en respuesta de Meta API (Lista)"
                );
                throw new Error(
                    data.error?.message ||
                        "Error desconocido de Meta API al enviar lista"
                );
            }

            logger.info(
                `Mensaje de lista oficial enviado a ${cleanNumber}. ID: ${data.messages[0].id}`
            );
            return data;
        } catch (error) {
            logger.error({ error }, "Fallo al enviar lista oficial");
            throw error;
        }
    }
}

export default OfficialWhatsappService;
