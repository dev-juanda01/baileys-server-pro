// src/infrastructure/repositories/SettingsRepository.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Reuses the sessions/ volume (the only path Docker deployments persist
// today, per the README) so the generated API key survives container
// restarts. It's a plain file, not a directory, so FileSessionRepository's
// getAllSessions() (which only lists directories) never mistakes it for a
// session.
const SESSIONS_DIR = path.join(__dirname, "..", "..", "sessions");
const SETTINGS_FILE = path.join(SESSIONS_DIR, ".dashboard-settings.json");

/**
 * @class SettingsRepository
 * @description Persists dashboard-wide settings that aren't tied to a single
 * session — currently just the machine-to-machine API key's metadata (never
 * the raw key itself, only its hash).
 */
class SettingsRepository {
    constructor() {
        if (!fs.existsSync(SESSIONS_DIR)) {
            fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        }
    }

    _read() {
        if (!fs.existsSync(SETTINGS_FILE)) return {};
        try {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
        } catch (e) {
            return {};
        }
    }

    _write(data) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
    }

    /** @returns {{hash:string,lastFour:string,createdAt:string}|null} */
    getApiKeyMeta() {
        const data = this._read();
        return data.apiKey || null;
    }

    saveApiKey({ hash, lastFour, createdAt }) {
        const data = this._read();
        data.apiKey = { hash, lastFour, createdAt };
        this._write(data);
    }

    clearApiKey() {
        const data = this._read();
        delete data.apiKey;
        this._write(data);
    }
}

export default new SettingsRepository();
