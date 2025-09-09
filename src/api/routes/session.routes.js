import { Router } from "express";
import SessionController from "../controllers/session.controller.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Sessions
 *     description: Gestión del ciclo de vida de las sesiones de WhatsApp
 */

/**
 * @swagger
 * /api/sessions/start:
 *   post:
 *     summary: Inicia una nueva sesión de WhatsApp
 *     tags: [Sessions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Identificador único para la sesión.
 *                 example: "tienda-1"
 *               webhook:
 *                 type: string
 *                 description: URL opcional para recibir notificaciones de mensajes.
 *                 example: "https://webhook.site/..."
 *     responses:
 *       '200':
 *         description: Sesión iniciada correctamente.
 */
router.post("/start", SessionController.start);

/**
 * @swagger
 * /api/sessions/{sessionId}/status:
 *   get:
 *     summary: Obtiene el estado de una sesión específica
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: El ID de la sesión.
 *     responses:
 *       '200':
 *         description: Estado de la sesión.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                   example: "open"
 *                 qr:
 *                   type: string
 *                   description: Código QR en formato de texto si la sesión necesita ser escaneada.
 *       '404':
 *         description: Sesión no encontrada.
 */
router.get("/:sessionId/status", SessionController.getStatus);

/**
 * @swagger
 * /api/sessions/{sessionId}/send-message:
 *   post:
 *     summary: Envía un mensaje de texto
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: El ID de la sesión.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - message
 *             properties:
 *               number:
 *                 type: string
 *                 description: "Número de teléfono del destinatario (ej: 573001234567)."
 *               message:
 *                 type: string
 *                 description: El mensaje de texto a enviar.
 *     responses:
 *       '200':
 *         description: Mensaje enviado exitosamente.
 *       '404':
 *         description: Sesión no encontrada.
 *       '503':
 *         description: La sesión no está abierta o lista para enviar mensajes.
 */
router.post("/:sessionId/send-message", SessionController.sendMessage);

/**
 * @swagger
 * /api/sessions/{sessionId}/end:
 *   delete:
 *     summary: Cierra una sesión y elimina sus datos
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: El ID de la sesión a cerrar.
 *     responses:
 *       '200':
 *         description: Sesión cerrada exitosamente.
 *       '404':
 *         description: Sesión no encontrada.
 */
router.delete("/:sessionId/end", SessionController.end);

export default router;
