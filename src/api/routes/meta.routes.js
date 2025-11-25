import { Router } from "express";
import MetaController from "../controllers/meta.controller.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Meta Webhook
 *     description: Endpoints para la integración con la API de Meta (Facebook).
 */

/**
 * @swagger
 * /api/meta/webhook:
 *   get:
 *     summary: Verifica el endpoint del webhook de Meta.
 *     tags: [Meta Webhook]
 *     description: |
 *       Este endpoint es utilizado por Meta para verificar la URL de tu webhook.
 *       Cuando configuras tu webhook en el panel de desarrolladores de Meta, ellos envían una petición GET a esta URL.
 *       Debes configurar un token de verificación en tus variables de entorno (META_VERIFY_TOKEN) que coincida con el que pones en el panel de Meta.
 *     parameters:
 *       - in: query
 *         name: hub.mode
 *         schema:
 *           type: string
 *           enum: [subscribe]
 *         required: true
 *         description: Debe ser 'subscribe'.
 *       - in: query
 *         name: hub.verify_token
 *         schema:
 *           type: string
 *         required: true
 *         description: El token de verificación que configuraste en Meta.
 *       - in: query
 *         name: hub.challenge
 *         schema:
 *           type: string
 *         required: true
 *         description: Un string aleatorio que debe ser devuelto en la respuesta.
 *     responses:
 *       '200':
 *         description: Verificación exitosa. Devuelve el valor de 'hub.challenge'.
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: "1158201444"
 *       '400':
 *         description: Faltan parámetros requeridos en la query.
 *       '403':
 *         description: El token de verificación no coincide.
 */
router.get("/webhook", MetaController.verify);

/**
 * @swagger
 * /api/meta/webhook:
 *   post:
 *     summary: Recibe eventos y mensajes desde el webhook de Meta.
 *     tags: [Meta Webhook]
 *     description: |
 *       Este endpoint recibe notificaciones de la API de WhatsApp Cloud (Meta).
 *       Procesa los eventos entrantes, como nuevos mensajes, y los reenvía al webhook configurado para la sesión correspondiente.
 *       El servidor responde inmediatamente con un 200 OK a Meta para evitar reintentos, y procesa el evento en segundo plano.
 *     requestBody:
 *       description: Payload del evento de webhook enviado por Meta.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MetaWebhookEvent'
 *     responses:
 *       '200':
 *         description: Evento recibido correctamente. El procesamiento se realiza de forma asíncrona.
 */
router.post("/webhook", MetaController.handleIncoming);

export default router;
