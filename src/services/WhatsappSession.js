import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

import logger from "../utils/logger.js";
import SessionManager from "./SessionManager.js";

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
     * Handles incoming WhatsApp messages and sends them to the webhook if configured.
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
            `[${this.sessionId}] Mensaje recibido de ${msg.key.remoteJid}`
        );

        const payload = {
            sessionId: this.sessionId,
            timestamp: new Date().toISOString(),
            message: {
                id: msg.key.id,
                from: msg.key.remoteJid,
                text:
                    msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    "",
            },
        };

        try {
            await fetch(this.webhookUrl, {
                method: "POST",
                body: JSON.stringify(payload),
                headers: { "Content-Type": "application/json" },
            });
            logger.info(
                `[${this.sessionId}] Webhook enviado a ${this.webhookUrl}`
            );
        } catch (error) {
            logger.error(
                { error },
                `[${this.sessionId}] Error al enviar el webhook`
            );
        }
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
     * Actually sends a WhatsApp text message using the socket.
     * @param {string} number - Recipient's phone number or JID.
     * @param {string} message - Text message to send.
     * @returns {Promise<object>} Baileys sendMessage result.
     * @private
     */
    async _performSendMessage(number, message) {
        const jid = number.includes("@s.whatsapp.net")
            ? number
            : `${number}@s.whatsapp.net`;
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
