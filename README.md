# Baileys Server Pro 🚀

Un servidor de WhatsApp multi-sesión, listo para producción, que utiliza `@whiskeysockets/baileys`. Proporciona una API REST segura para enviar y recibir mensajes, permitiendo una fácil integración con otras plataformas.

## ✨ Características

-   **Multi-Sesión:** Gestiona múltiples números de WhatsApp de forma simultánea.
-   **Persistencia:** Las sesiones se restauran automáticamente si el servidor se reinicia.
-   **Webhooks:** Recibe mensajes entrantes en tiempo real.
-   **Envío Multimedia:** Soporte para enviar imágenes y texto.
-   **Seguridad:** Endpoints protegidos por API Key.
-   **Dockerizado:** Fácil de desplegar y escalar.

## 🏁 Quick Start con Docker Compose

La forma más sencilla de levantar el servidor es usando `docker-compose`.

1.  **Crea un archivo `docker-compose.yml`** con el siguiente contenido:

    ```yml
    version: "3.8"
    services:
        baileys-server:
            image: tu-usuario-dockerhub/baileys-server:latest # Reemplaza con tu imagen
            container_name: baileys-pro
            restart: always
            ports:
                - "3000:3000"
            environment:
                - API_KEY=${API_KEY}
            volumes:
                - ./sessions:/usr/src/app/sessions
    ```

2.  **Crea un archivo `.env`** para tus variables de entorno:

    ```
    # Puerto de la aplicación
    PORT=3000

    # Clave secreta para proteger la API
    API_KEY=tu_clave_super_secreta_muy_larga
    ```

3.  **Crea la carpeta de sesiones** y dale los permisos correctos:

    ```bash
    mkdir -p sessions
    sudo chown -R 1000:1000 sessions
    ```

4.  **Levanta el servidor:**
    ```bash
    docker-compose up -d
    ```

Tu servidor estará corriendo en `http://localhost:3000`.

## 📚 Documentación de la API

La API cuenta con documentación interactiva **Swagger / OpenAPI**.

Una vez que el servidor esté corriendo, puedes acceder a la documentación en:
**[http://localhost:3000/api-docs](http://localhost:3000/api-docs)**

### Ejemplos con `curl`

Asegúrate de reemplazar `{sessionId}`, `{number}` y tu API Key.

**Iniciar una Sesión:**

```bash
curl -X POST http://localhost:3000/api/sessions/start \
-H "Content-Type: application/json" \
-H "x-api-key: tu_clave_super_secreta" \
-d '{
    "sessionId": "mi-tienda",
    "webhook": "[https://webhook.site/](https://webhook.site/)..."
}'
```

**Enviar un Mensaje de Texto:**

```bash
curl -X POST http://localhost:3000/api/sessions/mi-tienda/send-message \
-H "Content-Type: application/json" \
-H "x-api-key: tu_clave_super_secreta" \
-d '{
    "number": "573001234567",
    "message": "Hola desde la API! 🤖"
}'
```

## 🪝 Webhooks

Para recibir mensajes, proporciona una URL en el endpoint de `start`. Recibirás un `POST` con el siguiente formato:

```json
{
    "sessionId": "mi-tienda",
    "timestamp": "2025-09-09T22:30:00.000Z",
    "message": {
        "id": "ABCDEFG12345",
        "from": "573001234567@s.whatsapp.net",
        "text": "¡Hola! Quisiera más información."
    }
}
```

## 💾 Persistencia de Datos

El servidor guarda las credenciales en la carpeta `/usr/src/app/sessions` dentro del contenedor. Es **crucial** montar un volumen en esta ruta (`-v ./sessions:/usr/src/app/sessions`) para asegurar que tus sesiones no se pierdan.
