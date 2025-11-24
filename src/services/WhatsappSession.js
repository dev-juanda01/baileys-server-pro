import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

import logger from "../utils/logger.js";
import SessionManager from "./SessionManager.js";
import { sendEmailAlert } from "../utils/notification.js";
import OfficialWhatsappService from "./OfficialWhatsappService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @class WhatsappSession
 * @description Represents an individual WhatsApp session. It manages the connection, authentication,
 * outgoing and incoming message queues (webhooks), and reconnection logic.
 * It can operate in a hybrid mode, utilizing `OfficialWhatsappService` for certain features.
 */
class WhatsappSession {
    /**
     * Creates a new WhatsappSession instance.
     * @param {string} sessionId - A unique identifier for the session.
     * @param {string|null} [webhookUrl=null] - An optional webhook URL to notify of incoming messages.
     * @param {object|null} [metaConfig=null] - Optional configuration for the Meta Cloud API { phoneId, token, apiVersion }.
     */
    constructor(sessionId, webhookUrl = null, metaConfig = null) {
        this.sessionId = sessionId;
        this.sock = null;
        this.status = "starting";
        this.qr = null;
        this.logger = pino({ level: "silent" });
        this.authPath = path.join(
            __dirname,
            "..",
            "..",
            "sessions",
            this.sessionId
        );
        this.retryCount = 0;
        this.maxRetry = 5;
        this.webhookUrl = webhookUrl;

        // Colas de procesamiento
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.webhookQueue = [];
        this.isProcessingWebhookQueue = false;
        this.maxWebhookRetries = 3;

        // Configuración e Instancia de la API Oficial (Híbrido)
        this.metaConfig = metaConfig;
        this.officialService = null;

        if (
            this.metaConfig &&
            this.metaConfig.phoneId &&
            this.metaConfig.token
        ) {
            try {
                this.officialService = new OfficialWhatsappService(
                    this.metaConfig
                );
                // Usamos un log de consola simple aquí para no saturar el logger principal si no es crítico
                // o puedes usar this.logger.info
            } catch (error) {
                logger.error(
                    { error },
                    `[${this.sessionId}] Error al instanciar OfficialWhatsappService`
                );
            }
        }
    }

    /**
     * Initializes the WhatsApp socket connection and authentication state.
     * It sets up event handlers for the connection, messages, and credentials.
     * @returns {Promise<void>} A promise that resolves when initialization is complete.
     */
    async init() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(
                this.authPath
            );
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: this.logger,
                browser: ["OlimpoCRM", "Chrome", "111.0.0.0"],
            });

            this.sock.ev.on("messages.upsert", (m) => this.handleMessages(m));

            this.sock.ev.on(
                "connection.update",
                this.handleConnectionUpdate.bind(this)
            );

            this.sock.ev.on("creds.update", saveCreds);

            if (this.officialService) {
                logger.info(
                    `[${this.sessionId}] Servicio Oficial de Meta activo.`
                );
            }
        } catch (error) {
            logger.error(
                { error },
                `[${this.sessionId}] Error al inicializar la sesión`
            );
            this.status = "error";
        }
    }

    /**
     * Handles incoming WhatsApp messages.
     * It filters out messages from the user themselves and messages without content,
     * then queues them to be processed and sent to the webhook.
     * @param {object} m - The 'messages.upsert' event object from Baileys.
     * @returns {Promise<void>} A promise that resolves once the message is queued.
     */
    async handleMessages(m) {
        if (!this.webhookUrl) return;

        const msg = m.messages[0];

        if (msg.key.fromMe || !msg.message) {
            return;
        }

        logger.info(
            `[${this.sessionId}] Mensaje recibido de ${msg.key.remoteJid}, encolando para procesamiento.`
        );

        // Solo encolamos el mensaje crudo. El procesamiento pesado (descarga) ocurre en la cola.
        const job = {
            rawMessage: msg,
            retryCount: 0,
        };
        this.webhookQueue.push(job);

        this.processWebhookQueue();
    }

    /**
     * Handles connection status updates.
     * Manages QR code generation, reconnection logic in case of disconnection,
     * and session cleanup in case of a permanent logout.
     * @param {object} update - The 'connection.update' event object from Baileys.
     */
    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        this.status = connection || this.status;
        if (qr) this.qr = qr;

        logger.info(
            `[${this.sessionId}] Actualización de conexión: ${this.status}`
        );

        if (connection === "close") {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            logger.warn(
                `[${this.sessionId}] Conexión cerrada, motivo: ${statusCode}, reconectando: ${shouldReconnect}`
            );

            if (shouldReconnect) {
                this.startReconnecting();
            } else {
                logger.warn(
                    `[${this.sessionId}] Sesión cerrada permanentemente (logout). Limpiando archivos...`
                );
                this.cleanup();
            }
        } else if (connection === "open") {
            logger.info(
                `[${this.sessionId}] ¡Conexión establecida exitosamente!`
            );
            this.retryCount = 0;
            this.qr = null;
            this.processMessageQueue();
            this.processWebhookQueue();
        }
    }

    /**
     * Updates the session's configuration in memory.
     * Allows for dynamic changes to the webhook URL and Meta API configuration.
     * @param {string} [newWebhookUrl] - The new URL for the webhook.
     * @param {object} [newMetaConfig] - The new configuration for the Meta API.
     */
    updateConfig(newWebhookUrl, newMetaConfig) {
        if (newWebhookUrl !== undefined) {
            this.webhookUrl = newWebhookUrl;
            this.logger.info(
                `[${this.sessionId}] Webhook actualizado en memoria.`
            );
        }

        if (newMetaConfig !== undefined) {
            this.metaConfig = newMetaConfig;

            // Si hay nueva configuración de Meta, reinicializamos el servicio
            if (
                this.metaConfig &&
                this.metaConfig.phoneId &&
                this.metaConfig.token
            ) {
                try {
                    // Asumiendo que importaste OfficialWhatsappService al inicio del archivo
                    // Si no, asegúrate de tener: import OfficialWhatsappService from "./OfficialWhatsappService.js";
                    this.officialService = new OfficialWhatsappService(
                        this.metaConfig
                    );
                    this.logger.info(
                        `[${this.sessionId}] Servicio Oficial de Meta actualizado y reinicializado.`
                    );
                } catch (error) {
                    this.logger.error(
                        `[${this.sessionId}] Error al actualizar servicio Meta: ${error.message}`
                    );
                }
            } else {
                this.officialService = null; // Si mandan null, desactivamos el servicio
            }
        }
    }

    /**
     * Starts the reconnection process using an exponential backoff and jitter strategy.
     * It aborts if the maximum number of retries is reached.
     */
    startReconnecting() {
        this.retryCount++;

        if (this.retryCount > this.maxRetry) {
            logger.error(
                `[${this.sessionId}] Se ha alcanzado el número máximo de reintentos (${this.maxRetry}). Abortando.`
            );
            this.status = "max_retries_reached";
            return;
        }

        const baseDelay = 5000;
        const exponentialDelay = baseDelay * Math.pow(2, this.retryCount - 1);
        const jitter = Math.random() * 2000;
        const totalDelay = Math.min(exponentialDelay + jitter, 300000);

        logger.info(
            `[${this.sessionId}] Reintentando conexión... Intento #${
                this.retryCount
            }. Esperando ${Math.round(totalDelay / 1000)} segundos.`
        );

        setTimeout(() => this.init(), totalDelay);
    }

    /**
     * Sends a text message. If the session is not connected, it queues the message.
     * @param {string} number - Recipient's phone number (with country code).
     * @param {string} message - Text message to send.
     * @returns {Promise<object>} An object indicating success or queued status.
     */
    async sendMessage(number, message) {
        logger.info(
            `[${this.sessionId}] Solicitud para enviar mensaje. Estado actual: "${this.status}"`
        );

        if (this.status !== "open" || this.isProcessingQueue) {
            this.messageQueue.push({ number, message });

            const reason = this.isProcessingQueue
                ? "Cola en proceso"
                : "Conexión no disponible";

            logger.warn(
                `[${this.sessionId}] Mensaje para ${number} encolado. Causa: ${reason}. Pendientes: ${this.messageQueue.length}`
            );

            return {
                success: true,
                status: "queued",
                message: "El mensaje ha sido encolado y se enviará en orden.",
            };
        }

        return this._performSendMessage(number, message);
    }

    /**
     * Sends a message with an image.
     * @param {string} recipient - Recipient's JID or phone number.
     * @param {string} filePath - The local path to the image file.
     * @param {string} [caption=""] - Optional caption for the image.
     * @returns {Promise<object>} The result of the Baileys message sending.
     */
    async sendImage(recipient, filePath, caption = "") {
        logger.info(
            `[${this.sessionId}] Solicitud para enviar imagen a ${recipient}. Estado: "${this.status}"`
        );
        if (this.status !== "open") {
            throw new Error(
                "La sesión de WhatsApp no está abierta para enviar imágenes."
            );
        }

        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;

        const message = {
            image: { url: filePath },
            caption: caption,
        };

        return this.sock.sendMessage(jid, message);
    }

    /**
     * Sends a message with a document.
     * @param {string} recipient - Recipient's JID or phone number.
     * @param {string} filePath - The local path to the document file.
     * @param {string} [fileName='document'] - Optional file name.
     * @param {string} [mimetype='application/octet-stream'] - Optional MIME type.
     * @returns {Promise<object>} The result of the Baileys message sending.
     */
    async sendDocument(
        recipient,
        filePath,
        fileName,
        mimetype = "application/octet-stream"
    ) {
        logger.info(
            `[${this.sessionId}] Solicitud para enviar documento a ${recipient}. Estado: "${this.status}"`
        );
        if (this.status !== "open") {
            throw new Error(
                "La sesión de WhatsApp no está abierta para enviar documentos."
            );
        }

        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;

        const message = {
            document: { url: filePath },
            mimetype: mimetype,
            fileName: fileName || "document",
        };

        return this.sock.sendMessage(jid, message);
    }

    /**
     * Sends an audio message.
     * @param {string} recipient - Recipient's JID or phone number.
     * @param {string} filePath - The local path to the audio file.
     * @param {string} [mimetype='audio/mpeg'] - Optional MIME type.
     * @returns {Promise<object>} The result of the Baileys message sending.
     */
    async sendAudio(recipient, filePath, mimetype = "audio/mpeg") {
        logger.info(
            `[${this.sessionId}] Solicitud para enviar audio a ${recipient}. Estado: "${this.status}"`
        );
        if (this.status !== "open") {
            throw new Error(
                "La sesión de WhatsApp no está abierta para enviar audio."
            );
        }
        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;

        const message = {
            audio: { url: filePath },
            mimetype: mimetype,
        };
        return this.sock.sendMessage(jid, message);
    }

    /**
     * Sends a video message.
     * @param {string} recipient - Recipient's JID or phone number.
     * @param {string} filePath - The local path to the video file.
     * @param {string} [caption=""] - Optional caption.
     * @returns {Promise<object>} The result of the Baileys message sending.
     */
    async sendVideo(recipient, filePath, caption = "") {
        logger.info(
            `[${this.sessionId}] Solicitud para enviar video a ${recipient}. Estado: "${this.status}"`
        );
        if (this.status !== "open") {
            throw new Error(
                "La sesión de WhatsApp no está abierta para enviar video."
            );
        }
        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;

        const message = {
            video: { url: filePath },
            caption: caption,
        };
        return this.sock.sendMessage(jid, message);
    }

    /**
     * Sends buttons using the Official Meta API.
     * This delegates the task to `OfficialWhatsappService` and requires the session
     * to have been initialized with `metaConfig`.
     * @param {string} recipient - The recipient's number.
     * @param {string} text - The main text of the message.
     * @param {string} footer - The footer text.
     * @param {Array<object>} buttons - An array of button objects [{id, text}].
     * @returns {Promise<object>} The result from the Meta API.
     */
    async sendButtonMessage(recipient, text, footer, buttons) {
        if (!this.officialService) {
            throw new Error(
                "Esta sesión no tiene inicializado el servicio de Meta API Oficial. Verifique que se haya enviado la configuración (metaConfig) al iniciar la sesión."
            );
        }

        logger.info(
            `[${this.sessionId}] Delegando envío de botones a OfficialWhatsappService.`
        );

        return await this.officialService.sendInteractiveButtons(
            recipient,
            { text, footer },
            buttons
        );
    }

    async sendOfficialList(
        recipient,
        title,
        text,
        footer,
        buttonText,
        sections
    ) {
        if (!this.officialService) {
            throw new Error(
                "Esta sesión no tiene inicializado el servicio de Meta API Oficial. Configure 'metaConfig' al iniciar la sesión."
            );
        }

        logger.info(
            `[${this.sessionId}] Delegando envío de lista a OfficialWhatsappService.`
        );

        return await this.officialService.sendInteractiveList(
            recipient,
            { title, text, footer, buttonText },
            sections
        );
    }

    /**
     * Performs the actual sending of a text message using the Baileys socket.
     * @param {string} number - Recipient's phone number or JID.
     * @param {string} message - Text message to send.
     * @private
     * @returns {Promise<object>} Baileys sendMessage result.
     */
    async _performSendMessage(number, message) {
        const jid = number.includes("@") ? number : `${number}@s.whatsapp.net`;
        return this.sock.sendMessage(jid, { text: message });
    }

    /**
     * Processes the outgoing message queue.
     * It sends messages in FIFO (First-In, First-Out) order when the connection is open.
     * @returns {Promise<void>} A promise that resolves when the queue processing is complete
     * or has been paused.
     */
    async processMessageQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        logger.info(
            `[${this.sessionId}] Iniciando procesamiento de cola. Mensajes pendientes: ${this.messageQueue.length}`
        );

        while (this.messageQueue.length > 0) {
            const job = this.messageQueue.shift();
            try {
                await this._performSendMessage(job.number, job.message);
                logger.info(
                    `[${this.sessionId}] Mensaje encolado enviado a ${job.number}. Pendientes: ${this.messageQueue.length}`
                );

                await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (error) {
                logger.error(
                    { error },
                    `[${this.sessionId}] Error al enviar mensaje encolado a ${job.number}. Se re-encolará.`
                );

                this.messageQueue.unshift(job);
                break;
            }
        }

        this.isProcessingQueue = false;
        logger.info(`[${this.sessionId}] Procesamiento de cola finalizado.`);
    }

    /**
     * Processes the webhook queue for incoming messages.
     * It builds a standardized payload, downloads media files if necessary,
     * and sends the payload to the configured webhook URL.
     * Implements a retry logic for failures and email alerts for critical failures.
     * @returns {Promise<void>} A promise that resolves when the queue processing is complete
     * or has been paused.
     */
    async processWebhookQueue() {
        if (this.isProcessingWebhookQueue || this.webhookQueue.length === 0) {
            return;
        }

        this.isProcessingWebhookQueue = true;
        logger.info(
            `[${this.sessionId}] Iniciando procesamiento de cola de webhooks. Pendientes: ${this.webhookQueue.length}`
        );

        while (this.webhookQueue.length > 0) {
            const job = this.webhookQueue.shift(); // Saca el job { rawMessage, retryCount }
            const msg = job.rawMessage;
            let payload;

            try {
                const messageType = Object.keys(msg.message).find(
                    (key) => key !== "messageContextInfo"
                );
                payload = {
                    sessionId: this.sessionId,
                    timestamp: new Date().toISOString(),
                    message: {
                        id: msg.key.id,
                        from: msg.key.remoteJid,
                        senderName: msg.pushName,
                        type: messageType,
                        text: null,
                        media: null,
                        mimetype: null,
                        fileName: null,
                    },
                };

                let buffer;
                switch (messageType) {
                    case "conversation":
                        payload.message.text = msg.message.conversation;
                        break;
                    case "extendedTextMessage":
                        payload.message.text =
                            msg.message.extendedTextMessage.text;
                        break;
                    case "imageMessage":
                        payload.message.text = msg.message.imageMessage.caption;
                        payload.message.mimetype =
                            msg.message.imageMessage.mimetype;
                        buffer = await downloadMediaMessage(msg, "buffer");
                        payload.message.media = buffer.toString("base64");
                        break;
                    case "videoMessage":
                        payload.message.text = msg.message.videoMessage.caption;
                        payload.message.mimetype =
                            msg.message.videoMessage.mimetype;
                        buffer = await downloadMediaMessage(msg, "buffer");
                        payload.message.media = buffer.toString("base64");
                        break;
                    case "audioMessage":
                        payload.message.mimetype =
                            msg.message.audioMessage.mimetype;
                        buffer = await downloadMediaMessage(msg, "buffer");
                        payload.message.media = buffer.toString("base64");
                        break;
                    case "documentMessage":
                        payload.message.mimetype =
                            msg.message.documentMessage.mimetype;
                        payload.message.fileName =
                            msg.message.documentMessage.fileName;
                        buffer = await downloadMediaMessage(msg, "buffer");
                        payload.message.media = buffer.toString("base64");
                        break;
                    case "stickerMessage":
                        payload.message.mimetype =
                            msg.message.stickerMessage.mimetype;
                        buffer = await downloadMediaMessage(msg, "buffer");
                        payload.message.media = buffer.toString("base64");
                        break;
                    default:
                        payload.message.type = "unsupported";
                }

                const response = await fetch(this.webhookUrl, {
                    method: "POST",
                    body: JSON.stringify(payload),
                    headers: { "Content-Type": "application/json" },
                });

                if (response.ok) {
                    logger.info(
                        `[${this.sessionId}] Webhook encolado enviado. Pendientes: ${this.webhookQueue.length}`
                    );
                    await new Promise((resolve) => setTimeout(resolve, 500));
                } else if (response.status >= 400 && response.status < 500) {
                    const errorMsg = `[${this.sessionId}] Error permanente al enviar webhook (Status: ${response.status}). Mensaje descartado.`;
                    logger.error(errorMsg);

                    sendEmailAlert(
                        `Fallo permanente de Webhook (${this.sessionId}) - Mensaje Descartado`,
                        `<p>Un mensaje de la sesión <strong>${
                            this.sessionId
                        }</strong> fue descartado permanentemente.</p>
                         <p>El servidor del webhook respondió con un código de error <strong>${
                             response.status
                         }</strong>, lo que indica que el mensaje no debe ser reintentado.</p>
                         <p><strong>Destino:</strong> ${this.webhookUrl}</p>
                         <hr>
                         <p><strong>Payload Descartado:</strong></p>
                         <pre>${JSON.stringify(payload, null, 2)}</pre>`
                    );
                } else {
                    throw new Error(
                        `Webhook server returned status ${response.status}`
                    );
                }
            } catch (error) {
                job.retryCount++;

                if (job.retryCount >= this.maxWebhookRetries) {
                    logger.error(
                        { error: error.message },
                        `[${this.sessionId}] Fallo al procesar/enviar webhook después de ${this.maxWebhookRetries} intentos. Mensaje descartado.`
                    );

                    sendEmailAlert(
                        `Fallo Crítico de Webhook (${this.sessionId}) - Mensaje Descartado tras ${this.maxWebhookRetries} reintentos`,
                        `<p>Un mensaje de la sesión <strong>${
                            this.sessionId
                        }</strong> fue descartado permanentemente después de ${
                            this.maxWebhookRetries
                        } reintentos fallidos.</p>
                         <p>La causa pudo ser un error de descarga de media o que el servidor del webhook está caído.</p>
                         <p><strong>Destino:</strong> ${this.webhookUrl}</p>
                         <p><strong>Último Error:</strong> ${error.message}</p>
                         <hr>
                         <p><strong>Mensaje Original Descartado:</strong></p>
                         <pre>${JSON.stringify(job.rawMessage, null, 2)}</pre>`
                    );
                } else {
                    logger.warn(
                        { error: error.message },
                        `[${
                            this.sessionId
                        }] Error al procesar/enviar webhook, re-encolando. Intento ${
                            job.retryCount
                        }/${
                            this.maxWebhookRetries
                        }. Se reintentará en 10s. Pendientes: ${
                            this.webhookQueue.length + 1
                        }`
                    );
                    this.webhookQueue.unshift(job);

                    setTimeout(() => {
                        this.isProcessingWebhookQueue = false;
                        this.processWebhookQueue();
                    }, 10000);
                    return;
                }
            }
        }

        this.isProcessingWebhookQueue = false;
        logger.info(
            `[${this.sessionId}] Procesamiento de cola de webhooks finalizado.`
        );
    }

    /**
     * Cleans up the session's authentication files from the disk.
     * This method is called when the session is permanently closed (logout).
     * @returns {Promise<void>} A promise that resolves when cleanup is done.
     */
    async cleanup() {
        this.status = "close";
        try {
            await fs.rm(this.authPath, { recursive: true, force: true });
            SessionManager.sessions.delete(this.sessionId);
            logger.info(
                `[${this.sessionId}] Archivos de sesión eliminados correctamente.`
            );
        } catch (error) {
            logger.error(
                { error },
                `[${this.sessionId}] Error al limpiar la carpeta de sesión`
            );
        }
    }

    /**
     * Logs out of the WhatsApp session and closes the socket.
     * @returns {Promise<void>} A promise that resolves upon logout.
     */
    async logout() {
        if (this.sock) {
            await this.sock.logout();
        }
    }
}

export default WhatsappSession;
