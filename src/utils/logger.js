// src/utils/logger.js

import pino from "pino";

// Configuración de pino-pretty
const transport = pino.transport({
    target: "pino-pretty",
    options: {
        colorize: true, // Añade colores a la salida
        translateTime: "SYS:dd-mm-yyyy HH:MM:ss", // Formato de fecha legible
        ignore: "pid,hostname", // Ignora propiedades innecesarias
        messageFormat: "{msg}", // Formato del mensaje (simplificado)
    },
});

// Creamos y exportamos la instancia del logger
const logger = pino(transport);

export default logger;
