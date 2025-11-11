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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Represents a WhatsApp session, manages connection, authentication, message queue, and webhook integration.
 */
class WhatsappSession {
    /**
     * Create a new WhatsappSession instance.
     * @param {string} sessionId - Unique session identifier.
     * @param {string|null} [webhookUrl=null] - Optional webhook URL for incoming messages.
     */
    constructor(sessionId, webhookUrl = null) {
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

        this.messageQueue = [];
        this.isProcessingQueue = false;

        this.webhookQueue = [];
        this.isProcessingWebhookQueue = false;
        this.maxWebhookRetries = 3; // Límite de reintentos para el webhook
    }

    /**
     * Initializes the WhatsApp socket connection and authentication state.
     * @returns {Promise<void>}
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
        } catch (error) {
            logger.error(
                { error },
                `[${this.sessionId}] Error al inicializar la sesión`
            );
            this.status = "error";
        }
    }

    /**
     * Handles incoming WhatsApp messages, queues them for webhook processing.
     * @param {object} m - Baileys message upsert event object.
     * @returns {Promise<void>}
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

        // Simplemente encola el mensaje crudo. El procesamiento se hará en la cola.
        const job = {
            rawMessage: msg,
            retryCount: 0,
        };
        this.webhookQueue.push(job);

        // Inicia el procesador de la cola (no lo esperamos)
        this.processWebhookQueue();
    }

    /**
     * Handles connection updates, manages QR code, reconnection logic, and session cleanup.
     * @param {object} update - Baileys connection update event object.
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
     * Starts the reconnection process with exponential backoff and jitter.
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
     * Sends a WhatsApp text message. If not connected, queues the message.
     * @param {string} number - Recipient's phone number (with country code).
     * @param {string} message - Text message to send.
     * @returns {Promise<object>} Result object indicating success or queue status.
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
     * Sends an image message. If not connected, throws an error.
     * @param {string} recipient - Recipient's phone number (with country code) or JID.
     * @param {string} filePath - The local path to the image file.
     * @param {string} [caption=""] - Optional caption for the image.
     * @returns {Promise<object>} A promise that resolves with the Baileys message object.
     * @throws {Error} If the session is not 'open'.
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
     * Sends a document message. If not connected, throws an error.
     * @param {string} recipient - Recipient's phone number (with country code) or JID.
     * @param {string} filePath - The local path to the document file.
     * @param {string} [fileName='document'] - Optional file name for the document.
     * @param {string} [mimetype='application/octet-stream'] - Optional MIME type for the document.
     * @returns {Promise<object>} A promise that resolves with the Baileys message object.
     * @throws {Error} If the session is not 'open'.
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
     * Actually sends a WhatsApp text message using the socket.
     * @param {string} number - Recipient's phone number or JID.
     * @param {string} message - Text message to send.
     * @returns {Promise<object>} Baileys sendMessage result.
     * @private
     */
    async _performSendMessage(number, message) {
        const jid = number.includes("@") ? number : `${number}@s.whatsapp.net`;
        return this.sock.sendMessage(jid, { text: message });
    }

    /**
     * Processes the message queue, sending messages in order when connected.
     * @returns {Promise<void>}
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
     * Processes the webhook queue, sending payloads in order to the webhook URL.
     * @returns {Promise<void>}
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

                // -> 2. ENVÍO AL WEBHOOK
                const response = await fetch(this.webhookUrl, {
                    method: "POST",
                    body: JSON.stringify(payload),
                    headers: { "Content-Type": "application/json" },
                    // signal: AbortSignal.timeout(5000) // 5s timeout (Requiere Node v17.3.0+)
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
                    // Error temporal (5xx)
                    throw new Error(
                        `Webhook server returned status ${response.status}`
                    );
                }
            } catch (error) {
                // -> 3. MANEJO DE REINTENTOS (PARA DESCARGA O ENVÍO)
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
     * Cleans up session files and removes the session from SessionManager.
     * @returns {Promise<void>}
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
     * Logs out from WhatsApp and closes the socket.
     * @returns {Promise<void>}
     */
    async logout() {
        if (this.sock) {
            await this.sock.logout();
        }
    }
}

export default WhatsappSession;