import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './src/config/swagger.js';

import logger from "./src/utils/logger.js";
import sessionRoutes from "./src/api/routes/session.routes.js";
import { initializeDirectories } from "./src/utils/init.js";
import SessionManager from "./src/services/SessionManager.js";
import { bannerBaileysServerPro } from "./src/utils/banner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const banner = bannerBaileysServerPro;

initializeDirectories();
SessionManager.restoreSessions();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/api/sessions", sessionRoutes);

app.listen(PORT, () => {
    logger.info(banner);
    logger.info(`✅ Servidor escuchando en http://localhost:${PORT}`);
    logger.info(`📕 Documentación disponible en http://localhost:${PORT}/api-docs`);
});
