import "dotenv/config";
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import path from "path";
import { fileURLToPath } from "url";

import swaggerSpec from "./src/infrastructure/config/swagger.js";
import sessionRoutes from "./src/infrastructure/http/routes/SessionRoutes.js";
import metaRoutes from "./src/infrastructure/http/routes/MetaRoutes.js";
import SessionService from "./src/domain/services/SessionService.js";
import logger from "./src/shared/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

SessionService.restoreSessions();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/sessions", sessionRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(PORT, () => {
    logger.info(`🚀 Baileys Server Pro v2.0 corriendo en puerto ${PORT}`);
    logger.info(
        `📚 Documentación disponible en http://localhost:${PORT}/api-docs`
    );
});
