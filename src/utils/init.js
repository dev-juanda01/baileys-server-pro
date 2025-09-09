// src/utils/init.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSIONS_DIR = path.join(__dirname, "..", "..", "sessions");

export function initializeDirectories() {
    if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        console.log("📁 Directorio de sesiones creado en:", SESSIONS_DIR);
    }
}
