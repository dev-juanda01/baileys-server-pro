// src/services/SessionManager.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import WhatsappSession from "./WhatsappSession.js";
import logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSIONS_DIR = path.join(__dirname, "..", "..", "sessions");

class SessionManager {
    constructor() {
        this.sessions = new Map();
    }

    async startSession(sessionId, webhookUrl) {
        if (this.sessions.has(sessionId)) {
            const existingSession = this.sessions.get(sessionId);
            logger.warn(
                `La sesión ${sessionId} ya existe con estado: ${existingSession.status}`
            );

            // Si la sesión está en estado fallido, la reinicia.
            if (existingSession.status === "max_retries_reached") {
                logger.info(
                    `[${sessionId}] La sesión está en estado fallido. Reiniciando desde 'start'`
                );
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
            createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        const session = new WhatsappSession(sessionId, webhookUrl);
        await session.init();

        this.sessions.set(sessionId, session);
        return session;
    }

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
                    logger.info(
                        `✅ Restaurando sesión: ${
                            metadata.sessionId
                        } con webhook: ${metadata.webhookUrl || "ninguno"}`
                    );
                    this.startSession(metadata.sessionId, metadata.webhookUrl);
                } catch (error) {
                    logger.error(
                        { error },
                        `Error al restaurar la sesión desde ${sessionId}`
                    );
                }
            }
        }
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    async endSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            logger.info(`Cerrando sesión: ${sessionId}`);
            await session.logout();
            return true;
        }
        return false;
    }
}

const sessionManager = new SessionManager();
export default sessionManager;
