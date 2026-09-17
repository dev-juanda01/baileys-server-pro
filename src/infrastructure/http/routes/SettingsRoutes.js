import { Router } from "express";
import SettingsController from "../controllers/SettingsController.js";
import { requireDashboardApi } from "../middlewares/dashboardAuth.js";

const router = Router();

// Every route here is dashboard-admin-only (requires a logged-in session) —
// unrelated to whether the resulting API key is itself enforced anywhere.
router.use(requireDashboardApi);

/**
 * @swagger
 * tags:
 *   - name: Settings
 *     description: Ajustes del dashboard (API key para uso futuro server-to-server)
 */

/**
 * @swagger
 * /api/settings/api-key:
 *   get:
 *     summary: Estado de la API key (existe, últimos 4 caracteres, fecha de creación)
 *     tags: [Settings]
 *     responses:
 *       '200':
 *         description: Estado de la API key.
 *       '401':
 *         description: No autenticado en el dashboard.
 */
router.get("/api-key", SettingsController.getApiKeyStatus);

/**
 * @swagger
 * /api/settings/api-key:
 *   post:
 *     summary: Genera (o regenera) la API key
 *     description: >
 *       Devuelve el valor en texto plano una única vez; solo se persiste su hash.
 *       Esta clave todavía no se valida contra ningún endpoint — es la base para
 *       habilitar más adelante autenticación server-to-server (p. ej. olimpochat).
 *     tags: [Settings]
 *     responses:
 *       '200':
 *         description: API key generada.
 */
router.post("/api-key", SettingsController.generateApiKey);

/**
 * @swagger
 * /api/settings/api-key:
 *   delete:
 *     summary: Revoca la API key actual
 *     tags: [Settings]
 *     responses:
 *       '200':
 *         description: API key revocada.
 */
router.delete("/api-key", SettingsController.revokeApiKey);

export default router;
