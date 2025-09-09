// src/api/routes/session.routes.js

import { Router } from "express";
import SessionController from "../controllers/session.controller.js";

const router = Router();

// Rutas para gestionar el ciclo de vida de la sesión
router.post("/start", SessionController.start);
router.get("/:sessionId/status", SessionController.getStatus);
router.delete("/:sessionId/end", SessionController.end);

// Ruta para acciones dentro de una sesión
router.post("/:sessionId/send-message", SessionController.sendMessage);

export default router;
