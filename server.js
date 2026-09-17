import "dotenv/config";
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import path from "path";
import morgan from "morgan";
import { fileURLToPath } from "url";

import swaggerSpec from "./src/infrastructure/config/swagger.js";
import sessionRoutes from "./src/infrastructure/http/routes/SessionRoutes.js";
import metaRoutes from "./src/infrastructure/http/routes/MetaRoutes.js";
import authRoutes from "./src/infrastructure/http/routes/AuthRoutes.js";
import settingsRoutes from "./src/infrastructure/http/routes/SettingsRoutes.js";
import { requireDashboardSession } from "./src/infrastructure/http/middlewares/dashboardAuth.js";
import SessionService from "./src/domain/services/SessionService.js";
import logger from "./src/shared/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

SessionService.restoreSessions();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// The dashboard's HTML entrypoint requires a logged-in session; static
// assets (css/js/login.html) stay reachable below so the login screen itself
// can render. This gate is only for the dashboard UI — /api/sessions and
// /api/meta are intentionally left untouched (see AuthRoutes/SettingsRoutes
// for the pieces that ARE gated).
app.get(["/", "/index.html"], requireDashboardSession, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/sessions", sessionRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(PORT, () => {
    logger.info(`🚀 Baileys Server Pro v2.0 corriendo en puerto ${PORT}`);
    logger.info(
        `📚 Documentación disponible en http://localhost:${PORT}/api-docs`
    );
});
