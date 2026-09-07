import axios from "axios";
import logger from "../../../shared/logger.js";

/**
 * Mixin que agrega capacidades de gestión de templates HSM a cualquier provider base.
 * Se compone con MetaProvider vía MixinBuilder para no modificar su responsabilidad de mensajería.
 *
 * Requiere que this.config incluya:
 *   - token:      Bearer token de la Graph API
 *   - phoneId:    ID del número de teléfono (para envío)
 *   - accountId:  WABA ID (para creación de templates y delete)
 *   - appId:      App ID de Meta (para iniciar sesión de Resumable Upload)
 *   - apiVersion: versión de la Graph API (opcional, default v18.0)
 *
 * @param {class} Base - Clase base a extender (MetaProvider)
 */
const MetaTemplatesMixin = (Base) => class extends Base {

    // ── Helpers ───────────────────────────────────────────────────────────────

    _requireAccountId() {
        if (!this.config?.accountId) {
            throw new Error(
                `[${this.sessionId}] metaConfig.accountId (WABA ID) es requerido para gestionar templates.`
            );
        }
    }

    /**
     * Sube un archivo media a Meta vía Resumable Upload API y retorna el handle interno.
     *
     * Flujo de tres pasos:
     *   0. Descargar el buffer desde la URL pública (S3/CDN)
     *   1. Iniciar sesión de carga con APP_ID → obtener uploadSessionId ("upload:...")
     *   2. Subir contenido binario → obtener handle ("4::...")
     *
     * IMPORTANTE: el endpoint /uploads requiere el App ID, no el WABA ID.
     *
     * @param {string} mediaUrl  URL pública accesible del archivo
     * @returns {Promise<string>} upload handle para usar en header_handle
     */
    async _uploadMediaHandle(mediaUrl) {
        if (!this.config?.appId) {
            throw new Error(
                `[${this.sessionId}] metaConfig.appId (App ID de Meta) es requerido para subir media.`
            );
        }

        const apiVersion = this.config.apiVersion || "v18.0";
        const appId      = this.config.appId;
        const token      = this.config.token;

        // ── Paso 0: descargar el archivo para obtener buffer y tamaño exacto ──
        logger.info(`[${this.sessionId}] Descargando media para Resumable Upload: ${mediaUrl}`);
        const imgRes     = await axios.get(mediaUrl, { responseType: "arraybuffer" });
        const fileBuffer = Buffer.from(imgRes.data);
        const fileLength = fileBuffer.length;

        const ext = mediaUrl.split(".").pop().toLowerCase().split("?")[0];
        const mimeMap = {
            jpg:  "image/jpeg",
            jpeg: "image/jpeg",
            png:  "image/png",
            mp4:  "video/mp4",
            pdf:  "application/pdf",
        };
        const fileType = mimeMap[ext] || "image/jpeg";

        // ── Paso 1: iniciar sesión de carga con APP_ID ─────────────────────────
        logger.info(
            `[${this.sessionId}] Iniciando upload session (${fileLength} bytes, ${fileType}) con appId ${appId}`
        );
        const initRes = await axios.post(
            `https://graph.facebook.com/${apiVersion}/${appId}/uploads`,
            null,
            {
                params: {
                    file_length:  fileLength,
                    file_type:    fileType,
                    access_token: token,
                },
            }
        );

        const uploadSessionId = initRes.data.id;
        logger.info(`[${this.sessionId}] Upload session creada: ${uploadSessionId}`);

        // ── Paso 2: subir contenido binario ────────────────────────────────────
        const uploadRes = await axios.post(
            `https://graph.facebook.com/${apiVersion}/${uploadSessionId}`,
            fileBuffer,
            {
                headers: {
                    Authorization:  `Bearer ${token}`,
                    "file_offset":  "0",
                    "Content-Type": "application/octet-stream",
                },
            }
        );

        const handle = uploadRes.data.h;
        logger.info(`[${this.sessionId}] Upload completado. Handle: ${handle}`);
        return handle;
    }

    /**
     * Construye el array de components requerido por la Graph API de Meta.
     * Para headers IMAGE/VIDEO/DOCUMENT sube el media vía Resumable Upload API
     * y usa el handle retornado en header_handle.
     *
     * @param {object} t - Datos del template
     * @returns {Promise<object[]>}
     */
    async _buildTemplateComponents(t) {
        const components = [];

        if (t.header_type && t.header_type !== "NONE") {
            const header = { type: "HEADER", format: t.header_type };

            if (t.header_type === "TEXT") {
                header.text = t.header_text || "";
            } else if (t.header_media_url) {
                const handle = await this._uploadMediaHandle(t.header_media_url);
                header.example = { header_handle: [handle] };
            }

            components.push(header);
        }

        const varCount      = (t.body.match(/\{\{(\d+)\}\}/g) || []).length;
        const bodyComponent = { type: "BODY", text: t.body };
        if (varCount > 0) {
            bodyComponent.example = {
                body_text: [Array.from({ length: varCount }, (_, i) => `sample_${i + 1}`)],
            };
        }
        components.push(bodyComponent);

        if (t.footer) components.push({ type: "FOOTER", text: t.footer });

        const buttons = Array.isArray(t.buttons) ? t.buttons : [];
        if (buttons.length) {
            components.push({
                type: "BUTTONS",
                buttons: buttons.map((btn) => {
                    const b = { type: btn.type, text: btn.text };
                    if (btn.url)          b.url          = btn.url;
                    if (btn.phone_number) b.phone_number = btn.phone_number;
                    return b;
                }),
            });
        }

        return components;
    }

    // ── Operaciones outgoing de templates ─────────────────────────────────────

    /**
     * Envía el template a Meta Business API para aprobación.
     * @param {object} templateData  Campos: name, category, language, header_type, body, footer, buttons...
     * @returns {Promise<{ id: string, status: string }>}
     */
    async submitTemplate(templateData) {
        this._requireAccountId();

        const url = `${this.baseUrl}/${this.config.accountId}/message_templates`;
        const payload = {
            name:       templateData.name,
            language:   templateData.language,
            category:   templateData.category,
            components: await this._buildTemplateComponents(templateData),
        };

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    Authorization:  `Bearer ${this.config.token}`,
                    "Content-Type": "application/json",
                },
            });
            logger.info(
                `[${this.sessionId}] Template "${templateData.name}" enviado a Meta. ID: ${response.data.id}`
            );
            return response.data;
        } catch (error) {
            logger.error(
                { error: error.response?.data || error.message },
                `[${this.sessionId}] Error al enviar template "${templateData.name}" a Meta.`
            );
            throw error;
        }
    }

    /**
     * Elimina un template de Meta Business API.
     * @param {string} templateName
     * @param {string} [templateId]  meta_template_id (hsm_id)
     * @returns {Promise<object>}
     */
    async deleteTemplate(templateName, templateId) {
        this._requireAccountId();

        const params = new URLSearchParams({ name: templateName });
        if (templateId) params.append("hsm_id", String(templateId));

        const url = `${this.baseUrl}/${this.config.accountId}/message_templates?${params.toString()}`;

        try {
            const response = await axios.delete(url, {
                headers: { Authorization: `Bearer ${this.config.token}` },
            });
            logger.info(`[${this.sessionId}] Template "${templateName}" eliminado de Meta.`);
            return response.data;
        } catch (error) {
            logger.error(
                { error: error.response?.data },
                `[${this.sessionId}] Error al eliminar template "${templateName}" en Meta.`
            );
            throw error;
        }
    }

    /**
     * Envía un mensaje de tipo template a un número de teléfono.
     * @param {string} number        Número destino con código de país.
     * @param {string} templateName
     * @param {string} language      Código de idioma (ej. "es").
     * @param {object} variables     Mapa posicional { "1": "Juan", "2": "REF-123" }.
     * @returns {Promise<object>}
     */
    async sendTemplate(number, templateName, language, variables = {}) {
        const bodyParameters = Object.entries(variables).map(([, value]) => ({
            type: "text",
            text: String(value),
        }));

        const components = bodyParameters.length
            ? [{ type: "body", parameters: bodyParameters }]
            : [];

        return this._sendPayload(number, {
            type: "template",
            template: {
                name:       templateName,
                language:   { code: language },
                components,
            },
        });
    }

    // ── Incoming: reenvío de cambios de estado de templates ───────────────────

    /**
     * Reenvía un evento message_template_status_update al webhook de olimpochat.
     * @param {object} value  change.value del payload entrante de Meta.
     */
    async onTemplateStatusUpdate(value) {
        if (!this.webhookUrl) return;

        const payload = {
            sessionId:                 this.sessionId,
            type:                      "template_status_update",
            event:                     value.event,
            message_template_id:       value.message_template_id,
            message_template_name:     value.message_template_name,
            message_template_language: value.message_template_language,
            reason:                    value.reason || null,
        };

        try {
            await axios.post(this.webhookUrl, payload);
            logger.info(`[${this.sessionId}] Template status "${value.event}" reenviado al webhook.`);
        } catch (error) {
            logger.error(
                { error: error.message },
                `[${this.sessionId}] Error reenviando template status al webhook.`
            );
        }
    }
};

export { MetaTemplatesMixin };
