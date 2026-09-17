import { Router } from "express";
import AuthController from "../controllers/AuthController.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Login del dashboard (no afecta a /api/sessions ni /api/meta)
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Inicia sesión en el dashboard
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Sesión iniciada; establece la cookie hermes_session.
 *       '401':
 *         description: Usuario o contraseña incorrectos.
 *       '503':
 *         description: El panel no tiene configuradas las variables de entorno de autenticación.
 */
router.post("/login", AuthController.login);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Cierra la sesión del dashboard
 *     tags: [Auth]
 *     responses:
 *       '200':
 *         description: Sesión cerrada.
 */
router.post("/logout", AuthController.logout);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Indica si la petición trae una sesión de dashboard válida
 *     tags: [Auth]
 *     responses:
 *       '200':
 *         description: Estado de autenticación.
 */
router.get("/me", AuthController.me);

export default router;
