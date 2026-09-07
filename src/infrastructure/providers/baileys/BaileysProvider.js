import fs from "fs/promises";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

import logger from "../../../shared/logger.js";
import { sendEmailAlert } from "../../../shared/notification.js";

/**
 * @class BaileysProvider
 * @description Manages a WhatsApp session using the Baileys library. It handles connection,
 * authentication, message receiving, and sending, with built-in queueing and retry mechanisms.
 */
class BaileysProvider {
    /**
     * @constructor
     * @param {string} sessionId - The unique identifier for the session.
     * @param {string} webhookUrl - The URL to send webhook events to for incoming messages.
     * @param {string} sessionDir - The directory path to store session authentication files.
     * @param {Function} onCleanup - A callback function to execute when the session is terminated (e.g., logged out).
     */
    constructor(sessionId, webhookUrl, sessionDir, onCleanup) {
        this.sessionId = sessionId;
        this.sock = null;
        this.status = "starting"; // Initial status
        this.qr = null;
        this.logger = pino({ level: "silent" }); // Use a silent pino logger for Baileys internal logs

        // The session directory path is received from the repository/service.
        this.authPath = sessionDir;

        // Retry mechanism for connection issues.
        this.retryCount = 0;
        this.maxRetry = 5;
        this.webhookUrl = webhookUrl;
        this.onCleanup = onCleanup; // Callback to the service for cleanup.

        // Queues to handle outgoing messages and incoming webhooks, ensuring they are processed in order.
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.webhookQueue = [];
        this.isProcessingWebhookQueue = false;
        this.maxWebhookRetries = 3;
    }

    /**
     * Initializes the Baileys socket connection.
     * It sets up multi-file authentication, fetches the latest Baileys version,
     * and configures the socket with event handlers.
     */
    async init() {
        try {
            // Set up authentication using session files stored in the specified path.
            const { state, saveCreds } = await useMultiFileAuthState(
                this.authPath
            );
            // Fetch the latest version of Baileys to ensure compatibility.
            const { version } = await fetchLatestBaileysVersion();

            // Create the socket instance with authentication, browser info, and event handlers.
            this.sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false, // We handle the QR code manually.
                logger: this.logger,
                browser: ["OlimpoCRM", "Chrome", "111.0.0.0"],
            });

            // Register event listeners for core socket events.
            this.sock.ev.on("messages.upsert", (m) => this.handleMessages(m));
            this.sock.ev.on(
                "connection.update",
                this.handleConnectionUpdate.bind(this)
            );
            // Save credentials whenever they are updated.
            this.sock.ev.on("creds.update", saveCreds);
        } catch (error) {
            logger.error({ error }, `[${this.sessionId}] Error Init Baileys`);
            this.status = "error";
        }
    }

    /**
     * Handles incoming messages ("messages.upsert" event).
     * It filters out self-sent messages and adds the incoming message to a queue for webhook processing.
     * @param {object} m - The message upsert event object from Baileys.
     */
    async handleMessages(m) {
        if (!this.webhookUrl) return;
        const msg = m.messages[0];
        if (msg.key.fromMe || !msg.message) return;

        logger.info(`[${this.sessionId}] Mensaje recibido, encolando.`);
        // Create a job for the webhook queue with retry tracking.
        const job = { rawMessage: msg, retryCount: 0 };
        this.webhookQueue.push(job);
        this.processWebhookQueue();
    }

    /**
     * Handles updates to the connection state.
     * This is the core logic for managing the session's lifecycle, including QR code generation,
     * reconnection, and cleanup on logout.
     * @param {object} update - The connection update event object from Baileys.
     */
    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        this.status = connection || this.status;
        if (qr) this.qr = qr;

        logger.info(`[${this.sessionId}] Conexión: ${this.status}`);

        if (connection === "close") {
            // Determine the reason for disconnection.
            const statusCode = lastDisconnect.error?.output?.statusCode;
            // Reconnect unless the reason is a permanent logout.
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                this.startReconnecting();
            } else {
                // If logged out, trigger the cleanup process via the callback.
                logger.warn(`[${this.sessionId}] Logout.`);
                if (this.onCleanup) this.onCleanup();
            }
        } else if (connection === "open") {
            // When the connection is successfully opened, reset retry count and process any queued items.
            this.retryCount = 0;
            this.qr = null;
            this.processMessageQueue();
            this.processWebhookQueue();
        }
    }

    /**
     * Manages the reconnection process with an exponential backoff strategy.
     * If the maximum number of retries is exceeded, the status is updated, and reconnection stops.
     */
    startReconnecting() {
        this.retryCount++;
        if (this.retryCount > this.maxRetry) {
            // If max retries are reached, stop attempting to reconnect.
            this.status = "max_retries_reached";
            logger.error(
                `[${this.sessionId}] Max retries reached. Stopping reconnection.`
            );
            return;
        }
        // Calculate delay with exponential backoff.
        setTimeout(() => this.init(), 5000 * Math.pow(2, this.retryCount - 1));
    }

    async sendMessage(number, message) {
        if (this.status !== "open" || this.isProcessingQueue) {
            this.messageQueue.push({ number, message });
            return { success: true, status: "queued", message: "Encolado" };
        }
        return this._performSendMessage(number, message);
    }

    /**
     * Performs the actual sending of a text message via the socket.
     * @param {string} number - The recipient's phone number.
     * @param {string} message - The text message to send.
     * @private
     */
    async _performSendMessage(number, message) {
        const jid = number.includes("@") ? number : `${number}@s.whatsapp.net`;
        return this.sock.sendMessage(jid, { text: message });
    }

    /**
     * Sends an image message.
     * @param {string} recipient - The recipient's JID.
     * @param {string} filePath - A public URL to the image file.
     * @param {string} [caption=""] - The caption for the image.
     */
    async sendImage(recipient, filePath, caption = "") {
        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;
        return this.sock.sendMessage(jid, {
            image: { url: filePath },
            caption,
        });
    }

    /**
     * Sends a document message.
     * @param {string} recipient - The recipient's JID.
     * @param {string} filePath - A public URL to the document file.
     * @param {string} fileName - The name to display for the document.
     * @param {string} [mimetype="application/octet-stream"] - The MIME type of the document.
     */
    async sendDocument(
        recipient,
        filePath,
        fileName,
        mimetype = "application/octet-stream"
    ) {
        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;
        return this.sock.sendMessage(jid, {
            document: { url: filePath },
            mimetype,
            fileName,
        });
    }

    /**
     * Sends an audio message.
     * @param {string} recipient - The recipient's JID.
     * @param {string} filePath - A public URL to the audio file.
     * @param {string} [mimetype="audio/mpeg"] - The MIME type of the audio.
     */
    async sendAudio(recipient, filePath, mimetype = "audio/mpeg") {
        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;
        return this.sock.sendMessage(jid, {
            audio: { url: filePath },
            mimetype,
        });
    }

    /**
     * Sends a video message.
     * @param {string} recipient - The recipient's JID.
     * @param {string} filePath - A public URL to the video file.
     * @param {string} [caption=""] - The caption for the video.
     */
    async sendVideo(recipient, filePath, caption = "") {
        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;
        return this.sock.sendMessage(jid, {
            video: { url: filePath },
            caption,
        });
    }

    /**
     * Sends a message with native buttons (not template buttons).
     * @param {string} recipient - The recipient's JID.
     * @param {string} text - The main text of the message.
     * @param {string} footer - The footer text.
     * @param {Array<object>} buttons - An array of button objects, each with an `id` and `text`.
     */
    async sendButtonMessage(recipient, text, footer, buttons) {
        const jid = recipient.includes("@")
            ? recipient
            : `${recipient}@s.whatsapp.net`;
        const formattedButtons = buttons.map((btn) => ({
            buttonId: btn.id,
            buttonText: { displayText: btn.text },
            type: 1,
        }));
        return this.sock.sendMessage(jid, {
            text: text,
            footer: footer || "",
            buttons: formattedButtons,
            headerType: 1,
        });
    }

    /**
     * Throws an error for list messages, as they are not reliably supported in recent Baileys versions for standard accounts.
     */
    async sendListMessage() {
        throw new Error(
            "Envío de listas no soportado en Baileys. Use Meta API."
        );
    }

    /**
     * Processes the queue of outgoing messages.
     * It sends messages one by one, with a small delay, to avoid being rate-limited.
     * If a message fails to send, it's put back at the front of the queue.
     */
    async processMessageQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;
        this.isProcessingQueue = true;
        
        // Process all jobs in the queue.
        while (this.messageQueue.length > 0) {
            const job = this.messageQueue.shift();
            try {
                // Attempt to send the message and wait for a short period.
                await this._performSendMessage(job.number, job.message);
                await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (error) {
                this.messageQueue.unshift(job);
                break;
            }
        }
        this.isProcessingQueue = false;
    }

    /**
     * Processes the queue of incoming messages to be sent as webhooks.
     * It constructs a standardized payload, handles media downloads, and sends it to the configured webhook URL.
     * Implements a retry mechanism for failed webhook deliveries.
     */
    async processWebhookQueue() {
        // Ensure the queue is not already being processed and is not empty.
        if (this.isProcessingWebhookQueue || this.webhookQueue.length === 0)
            return;
        this.isProcessingWebhookQueue = true;

        while (this.webhookQueue.length > 0) {
            const job = this.webhookQueue.shift();
            const msg = job.rawMessage;
            let payload;
            try {
                // Determine the message type (e.g., "conversation", "imageMessage").
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

                // Download media if the message contains it and convert to base64.
                let buffer;
                if (
                    [
                        "imageMessage",
                        "videoMessage",
                        "audioMessage",
                        "documentMessage",
                        "stickerMessage",
                    ].includes(messageType)
                ) {
                    buffer = await downloadMediaMessage(msg, "buffer");
                    payload.message.media = buffer.toString("base64");
                }
                // Extract text content based on the message type.
                if (messageType === "conversation")
                    payload.message.text = msg.message.conversation;
                if (messageType === "extendedTextMessage")
                    payload.message.text = msg.message.extendedTextMessage.text;
                // TODO: Map other fields like captions, file names, etc.

                // Send the payload to the webhook URL.
                const response = await fetch(this.webhookUrl, {
                    method: "POST",
                    body: JSON.stringify(payload),
                    headers: { "Content-Type": "application/json" },
                });

                if (!response.ok) {
                    throw new Error(`Webhook status: ${response.status}`);
                }

                logger.info(
                    `[${this.sessionId}] Webhook enviado exitosamente. Status: ${response.status}`
                );
            } catch (error) {
                job.retryCount++;
                // If retries are left, add the job back to the queue for a later attempt.
                if (job.retryCount < this.maxWebhookRetries) {
                    this.webhookQueue.unshift(job);
                    setTimeout(() => {
                        this.isProcessingWebhookQueue = false;
                        this.processWebhookQueue();
                    }, 5000);
                    return;
                } else {
                    // If all retries fail, send an email alert.
                    logger.error(
                        `[${this.sessionId}] Webhook failed after ${this.maxWebhookRetries} retries. Error: ${error.message}`
                    );
                    sendEmailAlert(
                        `Fallo Webhook ${this.sessionId}`,
                        error.message
                    );
                }
            }
        }
        this.isProcessingWebhookQueue = false;
    }

    /**
     * Gracefully logs out the session from WhatsApp Web.
     */
    async logout() {
        try {
            // Intentamos enviar el logout, pero si la conexión ya está cerrada
            // (que es el caso del error 428), ignoramos el error para permitir
            // que el sistema continúe limpiando la sesión.
            if (this.sock) {
                await this.sock.logout();
            }
        } catch (error) {
            // Solo logueamos como debug/warn, no detenemos el proceso
            // Esto evita que el error "Connection Closed" detenga la eliminación de archivos
            logger.debug(
                `[${this.sessionId}] Logout falló (posiblemente ya desconectado): ${error.message}`
            );
        }
    }
}

export default BaileysProvider;
