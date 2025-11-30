import swaggerJSDoc from "swagger-jsdoc";

const swaggerDefinition = {
    openapi: "3.0.0",
    info: {
        title: "Baileys Server Pro API v2",
        version: "2.0.0",
        description: "API Híbrida para WhatsApp (Baileys + Meta Cloud API)",
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
    apis: ["./src/infrastructure/http/routes/*.js"],
};
const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec;
