import multer from "multer";
import { Router } from "express";
import SessionController from "../controllers/session.controller.js";

const upload = multer({ dest: "uploads/" });
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
 * /api/sessions/{sessionId}/send-image:
 *   post:
 *     summary: Envía un mensaje con una imagen
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - image
 *             properties:
 *               number:
 *                 type: string
 *                 description: "Número de teléfono del destinatario."
 *               caption:
 *                 type: string
 *                 description: "Texto opcional que acompaña a la imagen."
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: "El archivo de imagen a enviar."
 *     responses:
 *       '200':
 *         description: Imagen enviada exitosamente.
 *       '400':
 *         description: Faltan parámetros requeridos.
 *       '404':
 *         description: Sesión no encontrada.
 */
router.post(
    "/:sessionId/send-image",
    upload.single("image"),
    SessionController.sendImage
);

/**
 * @swagger
 * /api/sessions/{sessionId}/send-document:
 *   post:
 *     summary: Envía un mensaje con un documento (PDF, etc.)
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - number
 *               - document
 *             properties:
 *               number:
 *                 type: string
 *                 description: "Número de teléfono del destinatario."
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: "El archivo del documento a enviar."
 *     responses:
 *       '200':
 *         description: Documento enviado exitosamente.
 *       '400':
 *         description: Faltan parámetros requeridos.
 *       '404':
 *         description: Sesión no encontrada.
 */
router.post(
    "/:sessionId/send-document",
    upload.single("document"),
    SessionController.sendDocument
);

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

/**
 * @swagger
 * /api/sessions/{sessionId}/qr:
 *   get:
 *     summary: Get the QR code for a WhatsApp session
 *     description: Returns the QR code for the specified session if available. If the session is already connected or the QR is not available, returns a message.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique identifier for the session.
 *     responses:
 *       '200':
 *         description: QR code retrieved successfully or informative message.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 qr:
 *                   type: string
 *                   nullable: true
 *                   description: QR code string or null if not available.
 *                 message:
 *                   type: string
 *                   description: Informative message about the QR code status.
 *       '404':
 *         description: Session not found.
 */
router.get("/:sessionId/qr", SessionController.getQrCode);

export default router;
