// src/services/WhatsappSession.js

import pino from "pino";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import logger from "../utils/logger.js";
import SessionManager from "./SessionManager.js"; // -> 1. Importar SessionManager para poder limpiar la sesión del map

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WhatsappSession {
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
    }

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

    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        this.status = connection || this.status;

        if (qr) this.qr = qr;

        logger.info(
            `[${this.sessionId}] Actualización de conexión: ${this.status}`
        );
        console.log(lastDisconnect);
        

        if (connection === "close") {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            logger.warn(
                `[${this.sessionId}] Conexión cerrada, motivo: ${statusCode}, reconectando: ${shouldReconnect}`
            );

            if (shouldReconnect) {
                this.startReconnecting();
            } else {
                // -> 2. Si es un logout permanente, llamamos a la función de limpieza
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
        }
    }

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

        logger.warn(
            `[${this.sessionId}] Reintentando conexión... Intento #${
                this.retryCount
            }. Esperando ${Math.round(totalDelay / 1000)} segundos.`
        );

        setTimeout(() => this.init(), totalDelay);
    }

    async sendMessage(number, message) {
        if (this.status !== "open") {
            throw new Error("La sesión de WhatsApp no está abierta.");
        }

        const jid = number.includes("@s.whatsapp.net")
            ? number
            : `${number}@s.whatsapp.net`;
        return this.sock.sendMessage(jid, { text: message });
    }

    // -> 3. Nuevo método para borrar la sesión del disco y de la memoria
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

    // -> 4. El logout ahora solo cierra la conexión. La limpieza la maneja 'connection.update'
    async logout() {
        if (this.sock) {
            await this.sock.logout();
        }
    }
}

export default WhatsappSession;
