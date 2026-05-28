import fs from "fs/promises";
import axios from "axios";
import logger from "../../../shared/logger.js";
import { normalizeMetaMessage } from "../../../shared/mappers/MessageMapper.js";
import { sendEmailAlert } from "../../../shared/notification.js";

const MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/aac": ".aac",
    "audio/opus": ".opus",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        ".docx",
};

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

        this.webhookQueue = [];
        this.isProcessingWebhookQueue = false;
        this.maxWebhookRetries = 3;
    }

    async init() {
        logger.info(`[${this.sessionId}] [Meta] Provider inicializado.`);
    }

    // --- RECEPCIÓN DE MENSAJES (WEBHOOK) ---
    async onMessageReceived(metaMsg) {
        if (!this.webhookUrl) return;
        logger.info(`[${this.sessionId}] [Meta] Mensaje recibido, encolando.`);
        this.webhookQueue.push({ rawMessage: metaMsg, retryCount: 0 });
        this.processWebhookQueue();
    }

    async processWebhookQueue() {
        if (this.isProcessingWebhookQueue || this.webhookQueue.length === 0)
            return;
        this.isProcessingWebhookQueue = true;

        while (this.webhookQueue.length > 0) {
            const job = this.webhookQueue.shift();
            const metaMsg = job.rawMessage;

            try {
                const baileysFormatMsg = normalizeMetaMessage(metaMsg);
                const extractedData = this._extractMessageData(baileysFormatMsg);

                if (extractedData.media) {
                    const mediaId = extractedData.media;
                    const base64Media = await this.downloadMedia(mediaId);
                    if (base64Media) extractedData.media = base64Media;
                    else
                        throw new Error(
                            `Fallo descarga media Meta ID: ${mediaId}`
                        );
                }

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

                await axios.post(this.webhookUrl, payload);
                logger.info(`[${this.sessionId}] [Meta] Webhook enviado OK.`);
            } catch (error) {
                const status = error.response?.status;
                if (status >= 400 && status < 500) {
                    logger.error(
                        `[${this.sessionId}] Webhook usuario 4xx. Descartando.`
                    );
                    continue;
                }

                job.retryCount++;
                if (job.retryCount >= this.maxWebhookRetries) {
                    logger.error(
                        `[${this.sessionId}] Fallo final webhook. Error: ${error.message}`
                    );
                    sendEmailAlert(
                        `Fallo Webhook Meta ${this.sessionId}`,
                        error.message
                    );
                } else {
                    logger.warn(
                        `[${this.sessionId}] Reintentando webhook (${job.retryCount})...`
                    );
                    this.webhookQueue.unshift(job);
                    setTimeout(() => {
                        this.isProcessingWebhookQueue = false;
                        this.processWebhookQueue();
                    }, 5000);
                    return;
                }
            }
        }
        this.isProcessingWebhookQueue = false;
    }

    async downloadMedia(mediaId) {
        const r1 = await axios.get(`${this.baseUrl}/${mediaId}`, {
            headers: { Authorization: `Bearer ${this.config.token}` },
        });
        const r2 = await axios.get(r1.data.url, {
            headers: { Authorization: `Bearer ${this.config.token}` },
            responseType: "arraybuffer",
        });
        return Buffer.from(r2.data).toString("base64");
    }

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

    async uploadMedia(filePath, mimetype, filename) {
        try {
            const fileBuffer = await fs.readFile(filePath);

            let finalMime = mimetype;
            if (!finalMime || finalMime === "application/octet-stream") {
                finalMime = this._detectMimeTypeFromBuffer(fileBuffer);
            }
            if (!finalMime) finalMime = "application/octet-stream";

            let finalFilename = filename || "file";
            const correctExt = MIME_EXTENSIONS[finalMime];
            if (correctExt && !finalFilename.toLowerCase().endsWith(correctExt)) {
                finalFilename = `${finalFilename}${correctExt}`;
            }

            logger.info(`[MetaUpload] Subiendo: ${finalFilename} (${finalMime})`);

            const formData = new FormData();
            formData.append("messaging_product", "whatsapp");
            const blob = new Blob([fileBuffer], { type: finalMime });
            formData.append("file", blob, finalFilename);

            const url = `${this.baseUrl}/${this.config.phoneId}/media`;

            const response = await axios.post(url, formData, {
                headers: { Authorization: `Bearer ${this.config.token}` },
            });

            return response.data.id;
        } catch (error) {
            console.error("META ERROR [uploadMedia]:");
            console.error(error.response?.data);
            console.error(error.response?.status);
            console.error(error.message);
            throw error;
        }
    }

    _detectMimeTypeFromBuffer(buffer) {
        const header = buffer.subarray(0, 4).toString("hex").toUpperCase();
        if (header.startsWith("FFD8FF")) return "image/jpeg";
        if (header.startsWith("89504E47")) return "image/png";
        if (header.startsWith("47494638")) return "image/gif";
        if (header.startsWith("52494646") && header.endsWith("57454250"))
            return "image/webp";
        if (header.startsWith("25504446")) return "application/pdf";
        if (header.startsWith("66747970")) return "video/mp4";
        if (header.startsWith("494433") || header.startsWith("FFF3"))
            return "audio/mpeg";
        if (header.startsWith("4F676753")) return "audio/ogg";
        return null;
    }

    // --- MÉTODOS DE ENVÍO PÚBLICOS ---

    async sendMessage(number, message) {
        return this._sendPayload(number, {
            type: "text",
            text: { body: message },
        });
    }

    async sendImage(number, filePath, caption, mimetype, filename) {
        const mediaId = await this.uploadMedia(filePath, mimetype, filename);
        return this._sendPayload(number, {
            type: "image",
            image: { id: mediaId, caption: caption },
        });
    }

    async sendVideo(number, filePath, caption, mimetype, filename) {
        const mediaId = await this.uploadMedia(filePath, mimetype, filename);
        return this._sendPayload(number, {
            type: "video",
            video: { id: mediaId, caption: caption },
        });
    }

    async sendAudio(number, filePath, mimetype, filename) {
        const mediaId = await this.uploadMedia(filePath, mimetype, filename);
        return this._sendPayload(number, {
            type: "audio",
            audio: { id: mediaId },
        });
    }

    async sendDocument(number, filePath, filename, mimetype) {
        const mediaId = await this.uploadMedia(filePath, mimetype, filename);
        return this._sendPayload(number, {
            type: "document",
            document: { id: mediaId, filename: filename },
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

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${this.config.token}`,
                    "Content-Type": "application/json",
                },
            });
            return response.data;
        } catch (error) {
            console.error("META ERROR [_sendPayload]:");
            console.error(error.response?.data);
            console.error(error.response?.status);
            console.error(error.message);
            throw error;
        }
    }

    async logout() {
        this.status = "close";
    }
}

export default MetaProvider;
