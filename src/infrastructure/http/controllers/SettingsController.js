import crypto from "crypto";
import SettingsRepository from "../../repositories/SettingsRepository.js";
import logger from "../../../shared/logger.js";

function hashKey(rawKey) {
    return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * @class SettingsController
 * @description Manages the dashboard-wide API key. This is groundwork for
 * future machine-to-machine authentication (e.g. the olimpochat integration)
 * — generating/revoking a key here does NOT currently gate /api/sessions or
 * /api/meta; nothing verifies this key against incoming requests yet.
 */
class SettingsController {
    async getApiKeyStatus(req, res) {
        const meta = SettingsRepository.getApiKeyMeta();
        if (!meta) {
            return res.json({ success: true, exists: false });
        }
        res.json({
            success: true,
            exists: true,
            lastFour: meta.lastFour,
            createdAt: meta.createdAt,
        });
    }

    async generateApiKey(req, res) {
        const rawKey = crypto.randomBytes(32).toString("hex");
        const hash = hashKey(rawKey);
        const lastFour = rawKey.slice(-4);
        const createdAt = new Date().toISOString();

        SettingsRepository.saveApiKey({ hash, lastFour, createdAt });
        logger.info(`Dashboard: nueva API key generada por "${req.dashboardUser}".`);

        // The only time the raw value is ever returned — only its hash is stored.
        res.json({ success: true, apiKey: rawKey, lastFour, createdAt });
    }

    async revokeApiKey(req, res) {
        SettingsRepository.clearApiKey();
        logger.info(`Dashboard: API key revocada por "${req.dashboardUser}".`);
        res.json({ success: true });
    }
}

export default new SettingsController();
