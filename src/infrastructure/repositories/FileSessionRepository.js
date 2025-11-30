// src/infrastructure/repositories/FileSessionRepository.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../shared/logger.js";

// These lines determine the directory path for storing session files.
// It's constructed relative to the current file's location to ensure it works correctly
// regardless of where the application is started from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSIONS_DIR = path.join(__dirname, "..", "..", "..", "sessions");

/**
 * @class FileSessionRepository
 * @description Manages session data stored in the local file system.
 * This includes creating, reading, updating, and deleting session files and metadata.
 */
class FileSessionRepository {
    /**
     * @constructor
     * @description Ensures the main directory for storing sessions exists, creating it if necessary upon instantiation.
     */
    constructor() {
        // Check if the sessions directory exists, and create it if it doesn't.
        // The 'recursive: true' option ensures that parent directories are also created if needed.
        if (!fs.existsSync(SESSIONS_DIR)) {
            fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        }
    }

    /**
     * Saves or updates metadata for a specific session.
     * It merges new data with existing data to prevent overwriting.
     * @param {string} sessionId - The ID of the session.
     * @param {object} data - The metadata object to save.
     */
    saveMetadata(sessionId, data) {
        const sessionDir = path.join(SESSIONS_DIR, sessionId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        const filePath = path.join(sessionDir, "metadata.json");

        // Read existing data to avoid overwriting, especially for partial updates.
        let currentData = {};
        if (fs.existsSync(filePath)) {
            try {
                currentData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            } catch (e) {}
        }

        // Merge current data with new data and add an 'updatedAt' timestamp.
        const newData = {
            ...currentData,
            ...data,
            updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(filePath, JSON.stringify(newData, null, 2));
    }

    /**
     * Retrieves the metadata for a given session.
     * @param {string} sessionId - The ID of the session.
     * @returns {object|null} The session metadata object, or null if not found or an error occurs.
     */
    getMetadata(sessionId) {
        const filePath = path.join(SESSIONS_DIR, sessionId, "metadata.json");
        if (!fs.existsSync(filePath)) return null;
        try {
            // Read and parse the metadata file.
            return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch (error) {
            logger.error(
                `Error leyendo metadata de ${sessionId}: ${error.message}`
            );
            return null;
        }
    }

    /**
     * Retrieves a list of all session IDs (directory names).
     * @returns {string[]} An array of session IDs.
     */
    getAllSessions() {
        if (!fs.existsSync(SESSIONS_DIR)) return [];
        // Read the contents of the sessions directory and filter for directories only.
        return fs.readdirSync(SESSIONS_DIR).filter((file) => {
            return fs.statSync(path.join(SESSIONS_DIR, file)).isDirectory();
        });
    }

    /**
     * Deletes a session's directory and all its contents.
     * @param {string} sessionId - The ID of the session to delete.
     * @returns {Promise<boolean>} A promise that resolves to true if deletion was successful, false otherwise.
     */
    async deleteSession(sessionId) {
        const sessionDir = path.join(SESSIONS_DIR, sessionId);
        if (fs.existsSync(sessionDir)) {
            // Asynchronously remove the directory and all its contents.
            // 'recursive: true' allows deletion of non-empty directories.
            // 'force: true' suppresses errors if the path does not exist.
            await fs.promises.rm(sessionDir, { recursive: true, force: true });
            return true;
        }
        return false;
    }

    /**
     * Gets the absolute path to a session's directory.
     * @param {string} sessionId - The ID of the session.
     * @returns {string} The full path to the session directory.
     */
    getSessionDir(sessionId) {
        return path.join(SESSIONS_DIR, sessionId);
    }
}

export default new FileSessionRepository();
