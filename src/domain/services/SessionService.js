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
            //
            // IMPORTANT: Baileys' sock.logout() resolves before the "connection.update"
            // (loggedOut) event actually fires. When updateSession() switches a session
            // from Baileys -> Meta, it calls logout() and immediately starts the new
            // MetaProvider, which overwrites this sessionId in `this.sessions`. If the
            // stale loggedOut event arrives afterwards and this callback blindly deletes
            // by sessionId, it wipes out the brand-new Meta session instead of the old
            // Baileys one. Guard by identity: only clean up if THIS exact provider
            // instance is still the one registered for the sessionId.
            const onCleanup = async () => {
                if (this.sessions.get(sessionId) === provider) {
                    await this.deleteSession(sessionId);
                }
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

                // Detach the cleanup hook BEFORE logging out. Baileys' "loggedOut"
                // connection.update event can arrive after this function has already
                // moved on and registered a brand-new provider (e.g. MetaProvider) for
                // this sessionId. Without detaching, that delayed event would still
                // fire the old provider's onCleanup, which deletes by sessionId and
                // wipes out the session we just created. We are intentionally tearing
                // this provider down as part of a provider switch, so its own cleanup
                // hook must be a no-op from this point on.
                activeSession.onCleanup = null;

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
     * Lists every session persisted on disk, merged with its live in-memory
     * state (status, provider, whether it's actually running). Powers the
     * dashboard's instance list — never includes tokens, only whether a Meta
     * config is present.
     * @returns {Array<object>}
     */
    listSessions() {
        const allSessionIds = SessionRepository.getAllSessions();

        return allSessionIds.map((sessionId) => {
            const meta = SessionRepository.getMetadata(sessionId) || {};
            const activeSession = this.sessions.get(sessionId);
            const isMetaSession =
                activeSession?.constructor?.name === "MetaProvider";
            const hasMetaConfig = Boolean(
                meta.metaConfig?.phoneId && meta.metaConfig?.token
            );

            return {
                sessionId,
                webhookUrl: meta.webhookUrl || null,
                hasMetaConfig,
                provider: activeSession
                    ? isMetaSession
                        ? "META_CLOUD_API"
                        : "WHATSAPP_WEB"
                    : hasMetaConfig
                    ? "META_CLOUD_API"
                    : "WHATSAPP_WEB",
                status: activeSession?.status || "stopped",
                active: Boolean(activeSession),
                updatedAt: meta.updatedAt || null,
            };
        });
    }

    /**
     * Migrates an already-authenticated session to a new sessionId, WITHOUT
     * invalidating the underlying WhatsApp Business App device pairing or the
     * Meta Cloud API credentials — renames the on-disk session folder and
     * updates the in-memory map key. Used to move sessions that were created
     * under an old sessionId scheme (e.g. business_uuid) to a new one (e.g.
     * connection_uuid) without requiring the client to rescan a QR code or
     * redo the Meta Embedded Signup.
     *
     * @async
     * @param {string} oldSessionId
     * @param {string} newSessionId
     * @returns {Promise<{migrated: boolean, wasActive: boolean}>}
     * @throws {Error} If a session already exists (on disk or in memory) under newSessionId.
     */
    async migrateSessionId(oldSessionId, newSessionId) {
        if (oldSessionId === newSessionId) {
            return { migrated: false, wasActive: this.sessions.has(oldSessionId) };
        }

        if (this.sessions.has(newSessionId)) {
            throw new Error(`Ya existe una sesión activa en memoria con el id "${newSessionId}".`);
        }

        const renamed = await SessionRepository.renameSession(oldSessionId, newSessionId);
        if (!renamed) {
            return { migrated: false, wasActive: false };
        }

        const activeSession = this.sessions.get(oldSessionId);
        if (activeSession) {
            activeSession.sessionId = newSessionId;
            this.sessions.delete(oldSessionId);
            this.sessions.set(newSessionId, activeSession);
        }

        logger.info(`Sesión migrada de "${oldSessionId}" a "${newSessionId}".`);
        return { migrated: true, wasActive: !!activeSession };
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
