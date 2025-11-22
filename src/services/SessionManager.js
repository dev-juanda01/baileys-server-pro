import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import WhatsappSession from "./WhatsappSession.js";
import logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSIONS_DIR = path.join(__dirname, "..", "..", "sessions");

class SessionManager {
    /**
     * Manages the lifecycle of WhatsApp sessions (create, restore, close).
     * It uses the file system to persist session information, allowing for recovery after a server restart.
     */
    constructor() {
        this.sessions = new Map();
    }

    /**
     * Starts a new session or restarts an existing one if it has failed.
     * If a session with the given ID already exists and has reached max retries,
     * this method will reset its state and attempt to re-initialize it.
     * @param {string} sessionId - The unique identifier for the session.
     * @param {string} [webhookUrl] - The webhook URL for notifications for this session.
     * @param {object} [metaConfig] - Configuration for the Meta API (e.g., { phoneId, token }).
     * @returns {Promise<WhatsappSession>} The session instance.
     */
    async startSession(sessionId, webhookUrl, metaConfig = null) {
        if (this.sessions.has(sessionId)) {
            const existingSession = this.sessions.get(sessionId);
            logger.warn(
                `La sesión ${sessionId} ya existe con estado: ${existingSession.status}`
            );

            if (existingSession.status === "max_retries_reached") {
                logger.info(
                    `[${sessionId}] La sesión está en estado fallido. Reiniciando desde 'start'`
                );

                // Actualizamos la config en memoria si se provee una nueva
                if (metaConfig) existingSession.metaConfig = metaConfig;
                if (webhookUrl) existingSession.webhookUrl = webhookUrl;

                existingSession.retryCount = 0;
                existingSession.status = "starting";
                await existingSession.init();
            }

            return existingSession;
        }

        logger.info(`Iniciando nueva sesión: ${sessionId}`);

        const sessionDir = path.join(SESSIONS_DIR, sessionId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const metadataPath = path.join(sessionDir, "metadata.json");
        const metadata = {
            sessionId: sessionId,
            webhookUrl: webhookUrl || null,
            metaConfig: metaConfig || null, // { phoneId, token, accountId }
            createdAt: new Date().toISOString(),
        };

        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        const session = new WhatsappSession(sessionId, webhookUrl, metaConfig);
        await session.init();

        this.sessions.set(sessionId, session);
        return session;
    }

    /**
     * Restores all saved sessions from the sessions directory upon application startup.
     * It reads the `metadata.json` files to recreate each session with its original configuration.
     */
    restoreSessions() {
        logger.info("Restaurando sesiones persistentes...");
        if (!fs.existsSync(SESSIONS_DIR)) {
            logger.warn("No hay directorio de sesiones para restaurar.");
            return;
        }

        const sessionFolders = fs.readdirSync(SESSIONS_DIR);

        for (const sessionId of sessionFolders) {
            const metadataPath = path.join(
                SESSIONS_DIR,
                sessionId,
                "metadata.json"
            );
            if (fs.existsSync(metadataPath)) {
                try {
                    const metadata = JSON.parse(
                        fs.readFileSync(metadataPath, "utf-8")
                    );
                    const hasMeta = !!metadata.metaConfig;

                    logger.info(
                        `✅ Restaurando sesión: ${
                            metadata.sessionId
                        } | Webhook: ${
                            metadata.webhookUrl ? "Si" : "No"
                        } | Meta API: ${hasMeta ? "Si" : "No"}`
                    );

                    this.startSession(
                        metadata.sessionId,
                        metadata.webhookUrl,
                        metadata.metaConfig
                    );
                } catch (error) {
                    logger.error(
                        { error },
                        `Error al restaurar la sesión desde ${sessionId}`
                    );
                }
            }
        }
    }

    /**
     * Gets an active session by its ID.
     * @param {string} sessionId - The ID of the session to retrieve.
     * @returns {WhatsappSession|undefined} The session instance or undefined if not found.
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    /**
     * Gracefully closes an active session by logging it out.
     * @param {string} sessionId - The ID of the session to close.
     * @returns {Promise<boolean>} True if the session was found and logout was initiated, false otherwise.
     */
    async endSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            logger.info(`Cerrando sesión: ${sessionId}`);
            await session.logout();
            return true;
        }
        return false;
    }

    /**
     * Updates the configuration (metadata) of an active session.
     * This modifies both the in-memory configuration and the `metadata.json` file on disk.
     * @param {string} sessionId - The ID of the session to update.
     * @param {object} updates - An object containing the updates. Can include `webhook` and/or `metaConfig`.
     * @returns {Promise<object>} The newly saved metadata.
     */
    async updateSessionMetadata(sessionId, updates) {
        const session = this.sessions.get(sessionId);

        if (!session) {
            throw new Error(
                "La sesión no está activa. Iníciela primero para actualizar su configuración."
            );
        }

        session.updateConfig(updates.webhook, updates.metaConfig);

        const sessionDir = path.join(SESSIONS_DIR, sessionId);
        const metadataPath = path.join(sessionDir, "metadata.json");

        if (fs.existsSync(metadataPath)) {
            try {
                const currentMetadata = JSON.parse(
                    fs.readFileSync(metadataPath, "utf-8")
                );

                const newMetadata = {
                    ...currentMetadata,
                    webhookUrl:
                        updates.webhook !== undefined
                            ? updates.webhook
                            : currentMetadata.webhookUrl,
                    metaConfig:
                        updates.metaConfig !== undefined
                            ? updates.metaConfig
                            : currentMetadata.metaConfig,
                    updatedAt: new Date().toISOString(),
                };

                fs.writeFileSync(
                    metadataPath,
                    JSON.stringify(newMetadata, null, 2)
                );
                logger.info(`[${sessionId}] Metadata actualizada en disco.`);

                return newMetadata;
            } catch (error) {
                logger.error(
                    { error },
                    `Error al escribir metadata para ${sessionId}`
                );
                throw new Error("Error al guardar la configuración en disco.");
            }
        } else {
            throw new Error(
                "No se encontró el archivo de metadata para esta sesión."
            );
        }
    }
}

const sessionManager = new SessionManager();
export default sessionManager;
