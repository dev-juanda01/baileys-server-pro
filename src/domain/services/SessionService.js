import BaileysProvider from "../../infrastructure/providers/baileys/BaileysProvider.js";
import MetaProvider from "../../infrastructure/providers/meta/MetaProvider.js";
import SessionRepository from "../../infrastructure/repositories/FileSessionRepository.js";
import logger from "../../shared/logger.js";

/**
 * @class SessionService
 * @description Manages the lifecycle of WhatsApp sessions, acting as a high-level service
 * that orchestrates different providers (Baileys, Meta) and storage.
 */
class SessionService {
    /**
     * @constructor
     * @description Initializes the service by creating a map to hold active sessions in memory.
     */
    constructor() {
        this.sessions = new Map();
    }

    /**
     * Starts or retrieves a session based on the provided configuration.
     * It uses a strategy pattern to decide whether to use the Baileys (legacy) provider
     * or the Meta (official API) provider.
     * @param {string} sessionId - The unique identifier for the session.
     * @param {string} webhookUrl - The URL for sending webhook events.
     * @param {object|null} metaConfig - Configuration for the Meta provider (phoneId, token).
     * @returns {Promise<BaileysProvider|MetaProvider>} The initialized session provider instance.
     */
    async startSession(sessionId, webhookUrl, metaConfig = null) {
        // 1. Check if the session already exists in memory.
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            // If it's a failed Baileys session, attempt to restart it.
            if (
                session instanceof BaileysProvider &&
                session.status === "max_retries_reached"
            ) {
                session.retryCount = 0;
                session.status = "starting";
                await session.init();
            }
            return session;
        }

        logger.info(`Iniciando sesión: ${sessionId}`);

        // 2. Persist the session's configuration metadata to the file system.
        SessionRepository.saveMetadata(sessionId, {
            sessionId,
            webhookUrl,
            metaConfig,
        });

        // 3. Provider Factory (Strategy Pattern): Choose the provider based on configuration.
        let provider;
        const sessionDir = SessionRepository.getSessionDir(sessionId);

        // If Meta API configuration is provided, use the MetaProvider.
        if (metaConfig && metaConfig.phoneId && metaConfig.token) {
            logger.info(`[${sessionId}] Estrategia: API OFICIAL (Meta)`);
            provider = new MetaProvider(sessionId, webhookUrl, metaConfig);
        } else {
            // Otherwise, fall back to the Baileys (legacy) provider.
            logger.info(`[${sessionId}] Estrategia: BAILEYS (Legacy)`);

            // Pass a cleanup callback to the provider. This allows the provider
            // to request its own deletion if a non-recoverable error occurs (e.g., logout).
            const onCleanup = async () => {
                await this.deleteSession(sessionId);
            };

            provider = new BaileysProvider(
                sessionId,
                webhookUrl,
                sessionDir,
                onCleanup
            );
        }

        // 4. Initialize the chosen provider and store it in the in-memory map.
        await provider.init();
        this.sessions.set(sessionId, provider);
        return provider;
    }

    /**
     * Updates an existing session's metadata (webhook or Meta config).
     * Re-initializes the session if provider configuration changes.
     * @param {string} sessionId
     * @param {string|undefined} webhookUrl
     * @param {object|undefined} metaConfig
     */
    async updateSession(sessionId, webhookUrl, metaConfig) {
        // 1. Strict Check: Exists in disk?
        const currentMeta = SessionRepository.getMetadata(sessionId);
        if (!currentMeta) {
            throw new Error(
                `La sesión '${sessionId}' no existe. No se puede actualizar.`
            );
        }

        logger.info(`[${sessionId}] Actualizando metadatos...`);

        // 2. Prepare new data (keep old if not provided)
        const newWebhook =
            webhookUrl !== undefined ? webhookUrl : currentMeta.webhookUrl;
        const newMetaConfig =
            metaConfig !== undefined ? metaConfig : currentMeta.metaConfig;

        // 3. Save to disk
        SessionRepository.saveMetadata(sessionId, {
            webhookUrl: newWebhook,
            metaConfig: newMetaConfig,
        });

        // 4. Update in memory (if active)
        if (this.sessions.has(sessionId)) {
            const activeSession = this.sessions.get(sessionId);

            // Hot update for Webhook
            if (webhookUrl !== undefined) {
                activeSession.webhookUrl = webhookUrl;
                logger.info(`[${sessionId}] Webhook actualizado en memoria.`);
            }

            // If provider config changed, restart session to apply strategy change
            if (metaConfig !== undefined) {
                logger.info(
                    `[${sessionId}] Configuración de proveedor cambiada. Reiniciando sesión...`
                );
                await activeSession.logout(); // Stop current
                this.sessions.delete(sessionId);

                // Restart with new config (startSession will pick the right provider)
                await this.startSession(sessionId, newWebhook, newMetaConfig);
            }
        }

        return { sessionId, webhookUrl: newWebhook, metaConfig: newMetaConfig };
    }

    /**
     * Deletes a session completely.
     * It logs out the session, removes it from memory, and deletes its files from storage.
     * @param {string} sessionId - The ID of the session to delete.
     * @returns {Promise<boolean>} True if the session was deleted.
     */
    async deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.logout(); // Cierra sockets o limpia temporales
            this.sessions.delete(sessionId);
        }
        await SessionRepository.deleteSession(sessionId);
        logger.info(`Sesión ${sessionId} eliminada.`);
        return true;
    }

    /**
     * Retrieves an active session from memory.
     * @param {string} sessionId - The ID of the session to retrieve.
     * @returns {BaileysProvider|MetaProvider|undefined} The session instance, or undefined if not found.
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    /**
     * Restores all sessions from the file system.
     * This is typically called on application startup to bring all previously running
     * sessions back online.
     */
    restoreSessions() {
        const allSessionIds = SessionRepository.getAllSessions();
        logger.info(`Restaurando ${allSessionIds.length} sesiones...`);

        allSessionIds.forEach(async (sessionId) => {
            const meta = SessionRepository.getMetadata(sessionId);
            if (meta) {
                this.startSession(
                    meta.sessionId,
                    meta.webhookUrl,
                    meta.metaConfig
                ).catch((e) =>
                    logger.error(`Fallo restaurando ${sessionId}: ${e.message}`)
                );
            }
        });
    }
}

export default new SessionService();
