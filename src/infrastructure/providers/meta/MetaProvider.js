import logger from "../../../shared/logger.js";
import { normalizeMetaMessage } from "../../../shared/mappers/MessageMapper.js";
import { sendEmailAlert } from "../../../shared/notification.js";

class MetaProvider {
    constructor(sessionId, webhookUrl, metaConfig) {
        this.sessionId = sessionId;
        this.webhookUrl = webhookUrl;
        this.config = metaConfig;
        this.status = "open";
        this.qr = null;

        this.baseUrl = `https://graph.facebook.com/${
            this.config.apiVersion || "v18.0"
        }`;

        // --- SISTEMA DE COLAS ---
        this.webhookQueue = [];
        this.isProcessingWebhookQueue = false;
        this.maxWebhookRetries = 3;
    }

    async init() {
        logger.info(
            `[${this.sessionId}] [Meta] Provider inicializado con sistema de colas.`
        );
    }

    /**
     * Recibe el mensaje crudo de Meta desde el controlador y lo encola.
     */
    async onMessageReceived(metaMsg) {
        if (!this.webhookUrl) return;

        logger.info(`[${this.sessionId}] [Meta] Mensaje recibido, encolando.`);

        const job = {
            rawMessage: metaMsg,
            retryCount: 0,
        };

        this.webhookQueue.push(job);
        this.processWebhookQueue();
    }

    /**
     * Procesa la cola de mensajes de Meta uno por uno.
     * Normaliza -> Descarga Media -> Envía al Webhook del Usuario.
     */
    async processWebhookQueue() {
        if (this.isProcessingWebhookQueue || this.webhookQueue.length === 0)
            return;
        this.isProcessingWebhookQueue = true;

        while (this.webhookQueue.length > 0) {
            const job = this.webhookQueue.shift();
            const metaMsg = job.rawMessage;

            try {
                // 1. Normalizar Mensaje
                const baileysFormatMsg = normalizeMetaMessage(metaMsg);
                const extractedData =
                    this._extractMessageData(baileysFormatMsg);

                // 2. Descargar Media si existe (Lógica de reintento implícita en la cola)
                if (extractedData.media) {
                    const mediaId = extractedData.media;
                    const base64Media = await this.downloadMedia(mediaId);

                    if (base64Media) {
                        extractedData.media = base64Media;
                    } else {
                        throw new Error(
                            `Fallo descarga media Meta ID: ${mediaId}`
                        );
                    }
                }

                // 3. Construir Payload final
                const payload = {
                    sessionId: this.sessionId,
                    timestamp: new Date().toISOString(),
                    source: "meta_cloud_api",
                    message: {
                        id: baileysFormatMsg.key.id,
                        from: baileysFormatMsg.key.remoteJid,
                        senderName: metaMsg.contacts?.[0]?.profile?.name || "",
                        ...extractedData,
                    },
                };

                // 4. Enviar al Webhook del Usuario
                const response = await fetch(this.webhookUrl, {
                    method: "POST",
                    body: JSON.stringify(payload),
                    headers: { "Content-Type": "application/json" },
                });

                if (!response.ok) {
                    // Si el error es 5xx, lanzamos error para reintentar.
                    // Si es 4xx, es permanente, no lanzamos error para descartarlo (pero logueamos).
                    if (response.status >= 400 && response.status < 500) {
                        logger.error(
                            `[${this.sessionId}] Webhook usuario respondió ${response.status}. Descartando.`
                        );
                    } else {
                        throw new Error(
                            `Webhook usuario respondió ${response.status}`
                        );
                    }
                } else {
                    logger.info(
                        `[${this.sessionId}] [Meta] Webhook enviado exitosamente.`
                    );
                }
            } catch (error) {
                job.retryCount++;

                if (job.retryCount >= this.maxWebhookRetries) {
                    logger.error(
                        `[${this.sessionId}] [Meta] Fallo final tras ${job.retryCount} intentos. Mensaje descartado. Error: ${error.message}`
                    );
                    sendEmailAlert(
                        `Fallo Webhook Meta ${this.sessionId}`,
                        error.message
                    );
                } else {
                    logger.warn(
                        `[${this.sessionId}] [Meta] Error procesando/enviando (${job.retryCount}/${this.maxWebhookRetries}). Re-encolando en 5s. Error: ${error.message}`
                    );
                    this.webhookQueue.unshift(job); // Devolver a la cola

                    // Pausa antes de reintentar para no saturar
                    setTimeout(() => {
                        this.isProcessingWebhookQueue = false;
                        this.processWebhookQueue();
                    }, 5000);
                    return; // Salimos del bucle actual
                }
            }
        }

        this.isProcessingWebhookQueue = false;
    }

    /**
     * Descarga un archivo multimedia de Meta.
     * Nota: Ya no necesita su propio bucle de reintentos porque el processWebhookQueue maneja el reintento global.
     */
    async downloadMedia(mediaId) {
        try {
            const urlInfo = `${this.baseUrl}/${mediaId}`;
            const responseInfo = await fetch(urlInfo, {
                headers: { Authorization: `Bearer ${this.config.token}` },
            });

            if (!responseInfo.ok)
                throw new Error("Error obteniendo URL de media");
            const dataInfo = await responseInfo.json();

            const responseMedia = await fetch(dataInfo.url, {
                headers: { Authorization: `Bearer ${this.config.token}` },
            });

            if (!responseMedia.ok) throw new Error("Error descargando binario");

            const buffer = await responseMedia.arrayBuffer();
            return Buffer.from(buffer).toString("base64");
        } catch (error) {
            // Lanzamos el error para que la cola lo capture y reintente
            throw error;
        }
    }

    // --- HELPER DE EXTRACCIÓN (Movido desde el controller) ---
    _extractMessageData(normalizedMsg) {
        const msg = normalizedMsg.message;
        const typeKey = Object.keys(msg)[0];

        let data = {
            type: typeKey,
            text: null,
            media: null,
            mimetype: null,
            fileName: null,
            payload: null,
        };

        if (typeKey === "conversation") data.text = msg.conversation;
        else if (typeKey === "extendedTextMessage")
            data.text = msg.extendedTextMessage.text;
        else if (typeKey === "imageMessage") {
            data.type = "imageMessage";
            data.text = msg.imageMessage.caption;
            data.mimetype = msg.imageMessage.mimetype;
            data.media = msg.imageMessage.metaId;
        } else if (typeKey === "videoMessage") {
            data.type = "videoMessage";
            data.text = msg.videoMessage.caption;
            data.mimetype = "video/mp4";
            data.media = msg.videoMessage.metaId;
        } else if (typeKey === "documentMessage") {
            data.type = "documentMessage";
            data.text = msg.documentMessage.caption;
            data.mimetype = msg.documentMessage.mimetype;
            data.fileName = msg.documentMessage.fileName;
            data.media = msg.documentMessage.metaId;
        } else if (typeKey === "audioMessage") {
            data.type = "audioMessage";
            data.mimetype = msg.audioMessage.mimetype;
            data.media = msg.audioMessage.metaId;
        } else if (typeKey === "templateButtonReplyMessage") {
            data.type = "button_reply";
            data.text = msg.templateButtonReplyMessage.selectedDisplayText;
            data.payload = msg.templateButtonReplyMessage.selectedId;
        } else if (typeKey === "listResponseMessage") {
            data.type = "list_reply";
            data.text = msg.listResponseMessage.title;
            data.payload =
                msg.listResponseMessage.singleSelectReply.selectedRowId;
        }

        return data;
    }

    // --- MÉTODOS DE ENVÍO (Sin cambios) ---
    async sendMessage(number, message) {
        return this._sendPayload(number, {
            type: "text",
            text: { body: message },
        });
    }
    async sendImage(number, filePath, caption) {
        return this._sendPayload(number, {
            type: "image",
            image: { link: filePath, caption: caption },
        });
    }
    async sendDocument(number, filePath, fileName) {
        return this._sendPayload(number, {
            type: "document",
            document: { link: filePath, filename: fileName },
        });
    }
    async sendAudio(number, filePath) {
        return this._sendPayload(number, {
            type: "audio",
            audio: { link: filePath },
        });
    }
    async sendVideo(number, filePath, caption) {
        return this._sendPayload(number, {
            type: "video",
            video: { link: filePath, caption: caption },
        });
    }

    async sendButtonMessage(number, text, footer, buttons) {
        const formattedButtons = buttons.map((btn) => ({
            type: "reply",
            reply: { id: btn.id, title: btn.text.substring(0, 20) },
        }));
        return this._sendPayload(number, {
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: text },
                ...(footer && { footer: { text: footer } }),
                action: { buttons: formattedButtons },
            },
        });
    }

    async sendListMessage(number, title, text, footer, buttonText, sections) {
        return this._sendPayload(number, {
            type: "interactive",
            interactive: {
                type: "list",
                header: { type: "text", text: title },
                body: { text: text },
                footer: { text: footer },
                action: { button: buttonText, sections: sections },
            },
        });
    }

    async _sendPayload(recipient, body) {
        const cleanNumber = recipient.replace(/\D/g, "");
        const url = `${this.baseUrl}/${this.config.phoneId}/messages`;
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanNumber,
            ...body,
        };
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.error?.message || "Error Meta API");
        return data;
    }

    async logout() {
        this.status = "close";
    }
}

export default MetaProvider;
