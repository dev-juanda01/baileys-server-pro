// src/config/swagger.js
import swaggerJSDoc from "swagger-jsdoc";

const swaggerDefinition = {
    openapi: "3.0.0",
    info: {
        title: "Baileys Server Pro API",
        version: "1.0.0",
        description:
            "Una API REST para interactuar con WhatsApp a través de Baileys, gestionando múltiples sesiones.",
    },
    servers: [
        {
            url: "http://localhost:3000",
            description: "Servidor de Desarrollo",
        },
    ],
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: "apiKey",
                in: "header",
                name: "x-api-key",
            },
        },
    },
    security: [
        {
            ApiKeyAuth: [],
        },
    ],
};

const options = {
    swaggerDefinition,
    // Rutas a los archivos que contienen las anotaciones de la API
    apis: ["./src/api/routes/*.js"],
};

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec;
