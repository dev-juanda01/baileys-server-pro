const API_BASE_URL = window.location.origin;

async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, options);
    let data;
    try {
        data = await response.json();
    } catch (e) {
        data = { success: false, message: `Respuesta inválida del servidor (HTTP ${response.status}).` };
    }
    if (!response.ok && data.success === undefined) {
        data.success = false;
    }
    return data;
}

function toJson(body) {
    return {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    };
}

const Api = {
    listSessions() {
        return request("/api/sessions");
    },
    startSession({ sessionId, webhook, metaConfig }) {
        return request("/api/sessions/start", {
            method: "POST",
            ...toJson({ sessionId, webhook, metaConfig }),
        });
    },
    getStatus(sessionId) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/status`, {
            cache: "no-cache",
        });
    },
    getQr(sessionId) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/qr`, {
            cache: "no-cache",
        });
    },
    updateMetadata(sessionId, payload) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/metadata`, {
            method: "PUT",
            ...toJson(payload),
        });
    },
    migrate(sessionId, newSessionId) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/migrate`, {
            method: "POST",
            ...toJson({ newSessionId }),
        });
    },
    endSession(sessionId) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/end`, {
            method: "DELETE",
        });
    },
    sendMessage(sessionId, { number, message }) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/send-message`, {
            method: "POST",
            ...toJson({ number, message }),
        });
    },
    sendButtonMessage(sessionId, { number, text, footer, buttons }) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/send-button-message`, {
            method: "POST",
            ...toJson({ number, text, footer, buttons }),
        });
    },
    sendListMessage(sessionId, payload) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/send-list-message`, {
            method: "POST",
            ...toJson(payload),
        });
    },
    sendMedia(sessionId, kind, formData) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/send-${kind}`, {
            method: "POST",
            body: formData,
        });
    },
    getTemplates(sessionId) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/templates`);
    },
    submitTemplate(sessionId, templateData) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/templates/submit`, {
            method: "POST",
            ...toJson({ templateData }),
        });
    },
    deleteTemplate(sessionId, templateName, templateId) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/templates`, {
            method: "DELETE",
            ...toJson({ templateName, templateId }),
        });
    },
    sendTemplate(sessionId, payload) {
        return request(`/api/sessions/${encodeURIComponent(sessionId)}/send-template`, {
            method: "POST",
            ...toJson(payload),
        });
    },
    logout() {
        return request("/api/auth/logout", { method: "POST" });
    },
    getApiKeyStatus() {
        return request("/api/settings/api-key");
    },
    generateApiKey() {
        return request("/api/settings/api-key", { method: "POST" });
    },
    revokeApiKey() {
        return request("/api/settings/api-key", { method: "DELETE" });
    },
};
