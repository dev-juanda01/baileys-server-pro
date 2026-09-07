# Baileys Server Pro v2.0 🚀

Un servidor de WhatsApp robusto y escalable con Arquitectura Híbrida. Permite gestionar sesiones utilizando @whiskeysockets/baileys (conexión por QR) o la API Oficial de Meta (Cloud API) de forma transparente.

## ✨ Características Principales

- **Arquitectura Híbrida**: Soporte simultáneo para sesiones de Baileys (Legacy) y API Oficial de Meta (Cloud API) en el mismo servidor.

- **Multi-Sesión**: Gestiona múltiples números simultáneamente.

- **Colas y Reintentos**: Sistema de colas en memoria para garantizar que los mensajes se envíen incluso si hay desconexiones temporales.

- **Webhooks Robustos**: Notificación de mensajes entrantes con reintentos automáticos ante fallos del servidor destino.

- **Soporte Multimedia Completo**: Envío de Imágenes, Video, Audio y Documentos.

- **Mensajes Interactivos**: Soporte para Botones y Listas (vía API Oficial).

- **Sistema de Alertas**: Notificaciones por correo electrónico (SMTP) ante fallos críticos o desconexiones permanentes.

- **Persistencia**: Restauración automática de sesiones tras reinicios.

- **Dockerizado**: Optimizado con Node 20 Alpine y gestión de permisos.

## 🏁 Instalación Rápida (Docker Compose)

La forma más sencilla de levantar el servidor es usando `docker-compose`.

1.  **Preparar el Entorno**

    Crea un archivo `.env` con la configuración del puerto y, opcionalmente, las credenciales SMTP para recibir alertas de errores.

    ```
    # Puerto del servidor
    PORT=3000

    # (Opcional) Configuración de Alertas por Email
    EMAIL_NOTIFY_TO=soporte@tudominio.com
    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_USER=tu-email@gmail.com
    SMTP_PASS=tu-password-de-aplicacion
    ```

2.  **Crea un archivo `docker-compose.yml`** con el siguiente contenido:

    ```yml
    version: "3.8"
    services:
        baileys-server:
            image: tu-usuario/baileys-server-pro:latest
            container_name: baileys-pro
            restart: always
            ports:
                - "3000:3000"
            env_file:
                - .env
            volumes:
                - ./sessions:/usr/src/app/sessions
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

**Opción A: Sesión Baileys (Requiere escanear QR)**
Ideal para números personales o PYMES sin verificación de Meta.

```bash
curl -X POST http://localhost:3000/api/sessions/start \
-H "Content-Type: application/json" \
-d '{
    "sessionId": "mi-tienda",
    "webhook": "https://mi-webhook.com/api"
}'
```
Luego, escanea el QR en http://localhost:3000/api/sessions/mi-tienda/qr

**Opción B: Sesión Meta API Oficial (Sin QR)**
Ideal para envío de botones, listas y alta estabilidad.

```bash
curl -X POST http://localhost:3000/api/sessions/start \
-H "Content-Type: application/json" \
-d '{
    "sessionId": "empresa-oficial",
    "webhook": "https://mi-webhook.com/api",
    "metaConfig": {
        "phoneId": "123456789",
        "token": "EAAB...",
        "apiVersion": "v18.0"
    }
}'
```

**Enviar un Mensaje de Texto:**

Los endpoints son los mismos independientemente del proveedor (Baileys o Meta).

```bash
curl -X POST http://localhost:3000/api/sessions/{sessionId}/send-message \
-H "Content-Type: application/json" \
-d '{ 
    "number": "573001234567", 
    "message": "Hola mundo!" 
}'
```

**Imagen/Video/Documento/Audio:**

```bash
curl -X POST http://localhost:3000/api/sessions/{sessionId}/send-image \
-F "number=573001234567" \
-F "caption=Mira esta foto" \
-F "image=@/ruta/local/imagen.jpg"
```

**Botones (Respuestas Rápidas):**

```bash
curl -X POST http://localhost:3000/api/sessions/{sessionId}/send-button-message \
-H "Content-Type: application/json" \
-d '{
    "number": "573001234567",
    "text": "Selecciona una opción:",
    "footer": "Menu Principal",
    "buttons": [
        { "id": "btn_1", "text": "Ventas" },
        { "id": "btn_2", "text": "Soporte" }
    ]
}'
```

## 🪝 Webhooks

El servidor enviará un POST a tu URL configurada cada vez que reciba un mensaje. Si tu servidor falla, Baileys Server Pro reintentará el envío hasta 3 veces antes de descartarlo y enviarte una alerta por email.

```json
{
  "sessionId": "mi-tienda",
  "timestamp": "2025-11-15T10:00:00.000Z",
  "message": {
    "id": "3EB0...",
    "from": "573001234567@s.whatsapp.net",
    "senderName": "Juan Perez",
    "type": "imageMessage", 
    "text": "Foto del producto", // Caption si es imagen
    "media": "BASE64_STRING...", // Archivo en Base64 si es multimedia
    "mimetype": "image/jpeg"
  }
}
```

## 💾 Persistencia de Datos

El servidor guarda las credenciales en la carpeta `/usr/src/app/sessions` dentro del contenedor. Es **crucial** montar un volumen en esta ruta (`-v ./sessions:/usr/src/app/sessions`) para asegurar que tus sesiones no se pierdan.

## 🛠 Solución de Problemas
**Error** ```EACCES: permission denied``` **en logs**: El contenedor no puede escribir en la carpeta ```sessions```. Ejecuta en tu host: ```sudo chown -R 1000:1000 ./sessions```

**Error** ```Stream Errored (conflict)```: Estás intentando abrir la misma sesión en dos lugares. Detén el contenedor, borra la carpeta de esa sesión específica en ```./sessions``` y vuelve a iniciar.

**Los botones llegan como texto**: Si usas Baileys con una cuenta personal, WhatsApp puede degradar los botones a texto. Se recomienda usar **WhatsApp Business** o la integración con **Meta API** para garantizar la interactividad.