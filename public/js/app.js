const state = {
    sessions: [],
    selectedId: null,
    currentDetail: null,
    activeTab: "overview",
    pollTimer: null,
    templatesCache: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function icon(name) {
    return `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const TOAST_ICONS = { success: "check_circle", error: "warning", info: "info" };

function toast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(TOAST_ICONS[type] || TOAST_ICONS.info)}<span>${escapeHtml(message)}</span>`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4500);
}

function openModal(html) {
    document.getElementById("modal-content").innerHTML = html;
    document.getElementById("modal-overlay").hidden = false;
}

function closeModal() {
    document.getElementById("modal-overlay").hidden = true;
    document.getElementById("modal-content").innerHTML = "";
}

document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
});

function statusLabel(status, active) {
    if (!active) return "No activa en el servidor";
    const map = {
        open: "Conectado",
        connecting: "Conectando...",
        starting: "Iniciando...",
        close: "Desconectado",
        closed: "Desconectado",
        max_retries_reached: "Fallo de conexión",
        stopped: "Detenida",
    };
    return map[status] || status || "Desconocido";
}

function pillClass(status) {
    if (status === "APPROVED") return "pill-approved";
    if (status === "REJECTED") return "pill-rejected";
    return "pill-pending";
}

// Deterministic per-instance accent color so cards in the sidebar are easy
// to tell apart at a glance, without needing user-uploaded avatars.
function avatarColor(sessionId) {
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
        hash = (hash << 5) - hash + sessionId.charCodeAt(i);
        hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `linear-gradient(135deg, hsl(${hue}, 62%, 58%), hsl(${(hue + 35) % 360}, 62%, 44%))`;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

async function refreshSidebar() {
    const res = await Api.listSessions();
    if (!res.success) {
        toast(res.message || "Error cargando la lista de sesiones.", "error");
        return;
    }
    state.sessions = res.data || [];
    renderSidebar();
}

function renderSidebar() {
    const filter = document
        .getElementById("instance-search")
        .value.trim()
        .toLowerCase();
    const listEl = document.getElementById("instance-list");
    const filtered = state.sessions.filter((s) =>
        s.sessionId.toLowerCase().includes(filter)
    );

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="empty-list">${
            state.sessions.length === 0
                ? "No hay sesiones todavía. Crea la primera."
                : "Sin resultados."
        }</div>`;
        return;
    }

    listEl.innerHTML = filtered
        .map((s) => {
            const isMeta = s.provider === "META_CLOUD_API";
            return `
        <div class="instance-card ${
            s.sessionId === state.selectedId ? "active" : ""
        }" data-id="${escapeHtml(s.sessionId)}">
            <div class="instance-avatar" style="background:${avatarColor(s.sessionId)};">${escapeHtml(
                s.sessionId.slice(0, 2).toUpperCase()
            )}</div>
            <div class="instance-info">
                <div class="instance-name">${escapeHtml(s.sessionId)}</div>
                <div class="instance-meta">
                    <span class="status-dot ${
                        s.active ? s.status : "stopped"
                    }"></span>
                    <span class="status-label">${statusLabel(
                        s.status,
                        s.active
                    )}</span>
                </div>
            </div>
            <span class="badge ${isMeta ? "badge-meta" : "badge-baileys"}">${
                isMeta ? "Meta" : "QR"
            }</span>
        </div>`;
        })
        .join("");

    listEl.querySelectorAll(".instance-card").forEach((card) => {
        card.addEventListener("click", () => selectSession(card.dataset.id));
    });
}

document
    .getElementById("instance-search")
    .addEventListener("input", () => renderSidebar());

// ---------------------------------------------------------------------------
// Selection / polling
// ---------------------------------------------------------------------------

function selectSession(sessionId) {
    state.selectedId = sessionId;
    state.activeTab = "overview";
    document
        .querySelectorAll(".tab-btn")
        .forEach((b) => b.classList.toggle("active", b.dataset.tab === "overview"));
    document
        .querySelectorAll(".tab-panel")
        .forEach((p) => (p.hidden = p.id !== "tab-overview"));
    document.getElementById("empty-state").hidden = true;
    document.getElementById("instance-detail").hidden = false;
    renderSidebar();
    loadDetail();
}

async function loadDetail() {
    if (!state.selectedId) return;
    const listEntry = state.sessions.find(
        (s) => s.sessionId === state.selectedId
    ) || { sessionId: state.selectedId, provider: "WHATSAPP_WEB" };

    const statusRes = await Api.getStatus(state.selectedId);
    state.currentDetail = {
        ...listEntry,
        active: !!statusRes.success,
        status: statusRes.success ? statusRes.status : "stopped",
        qr: statusRes.success ? statusRes.qr : null,
        provider: statusRes.success ? statusRes.provider : listEntry.provider,
        metaConfig: statusRes.success ? statusRes.metaConfig : null,
    };

    renderDetailHeader();
    // Only the overview tab needs to react to live polling (QR / status). The
    // other tabs hold in-progress user input (forms), so we never blow those
    // away on a background refresh tick — only on an explicit tab switch or
    // action.
    if (state.activeTab === "overview") renderOverviewTab();
}

function restartPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
        await refreshSidebar();
        if (state.selectedId) await loadDetail();
    }, 3500);
}

// ---------------------------------------------------------------------------
// Detail header
// ---------------------------------------------------------------------------

function renderDetailHeader() {
    const d = state.currentDetail;
    document.getElementById("detail-session-id").textContent = d.sessionId;

    const dot = document.getElementById("detail-status-dot");
    dot.className = "status-dot " + (d.active ? d.status : "stopped");

    document.getElementById("detail-status-label").textContent = statusLabel(
        d.status,
        d.active
    );

    const isMeta = d.provider === "META_CLOUD_API";
    const badge = document.getElementById("detail-provider-badge");
    badge.textContent = isMeta ? "Meta Cloud API" : "WhatsApp Web";
    badge.className = "badge " + (isMeta ? "badge-meta" : "badge-baileys");

    document.getElementById("btn-refresh-qr").disabled = !d.active;
}

document
    .getElementById("btn-refresh-qr")
    .addEventListener("click", refreshQr);

async function refreshQr() {
    if (!state.selectedId) return;
    const res = await Api.getQr(state.selectedId);
    if (!res.success) {
        toast(res.message || "Error obteniendo el QR.", "error");
        return;
    }
    if (res.message) toast(res.message, "success");
    await loadDetail();
}

document
    .getElementById("btn-delete-session")
    .addEventListener("click", async () => {
        if (!state.selectedId) return;
        if (
            !confirm(
                `¿Seguro que quieres eliminar la sesión "${state.selectedId}"? Esta acción no se puede deshacer.`
            )
        )
            return;
        const res = await Api.endSession(state.selectedId);
        toast(
            res.success ? "Sesión eliminada." : res.message || "Error eliminando la sesión.",
            res.success ? "success" : "error"
        );
        if (res.success) {
            state.selectedId = null;
            state.currentDetail = null;
            document.getElementById("instance-detail").hidden = true;
            document.getElementById("empty-state").hidden = false;
            await refreshSidebar();
        }
    });

document.getElementById("btn-migrate").addEventListener("click", openMigrateModal);

function openMigrateModal() {
    if (!state.selectedId) return;
    openModal(`
        <h2>Migrar ID de sesión</h2>
        <p class="hint">Renombra el sessionId conservando la vinculación del dispositivo (Baileys) o las credenciales de Meta — no requiere volver a escanear el QR ni rehacer el Embedded Signup.</p>
        <form id="form-migrate">
            <div class="form-group">
                <label>Nuevo sessionId</label>
                <input type="text" name="newSessionId" required placeholder="nuevo-id" />
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Cancelar</button>
                <button type="submit" class="btn btn-primary">${icon("swap_horiz")} Migrar</button>
            </div>
        </form>
    `);
    document.getElementById("btn-cancel-modal").addEventListener("click", closeModal);
    document.getElementById("form-migrate").addEventListener("submit", async (e) => {
        e.preventDefault();
        const newSessionId = new FormData(e.target).get("newSessionId").trim();
        if (!newSessionId) return;
        const res = await Api.migrate(state.selectedId, newSessionId);
        if (!res.success) {
            toast(res.message || "Error migrando la sesión.", "error");
            return;
        }
        toast("Sesión migrada correctamente.", "success");
        closeModal();
        await refreshSidebar();
        selectSession(newSessionId);
    });
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        state.activeTab = btn.dataset.tab;
        document
            .querySelectorAll(".tab-btn")
            .forEach((b) => b.classList.toggle("active", b === btn));
        document
            .querySelectorAll(".tab-panel")
            .forEach((p) => (p.hidden = true));
        document.getElementById("tab-" + state.activeTab).hidden = false;
        renderActiveTabFresh();
    });
});

function renderActiveTabFresh() {
    if (!state.currentDetail) return;
    switch (state.activeTab) {
        case "overview":
            renderOverviewTab();
            break;
        case "send":
            renderSendTab();
            break;
        case "templates":
            renderTemplatesTab();
            break;
        case "settings":
            renderSettingsTab();
            break;
    }
}

// ---------------------------------------------------------------------------
// Overview / QR tab
// ---------------------------------------------------------------------------

function renderOverviewTab() {
    const d = state.currentDetail;
    const container = document.getElementById("tab-overview");
    const isMeta = d.provider === "META_CLOUD_API";

    if (!d.active) {
        container.innerHTML = `
            <div class="card">
                <h3>${icon("error")} Sesión no activa en el servidor</h3>
                <p class="card-subtitle">Esta sesión existe en disco pero no está cargada en memoria ahora mismo (el servidor pudo haberse reiniciado hace poco). Suele restaurarse sola en unos segundos; si persiste, revisa los logs del servidor.</p>
            </div>`;
        return;
    }

    if (isMeta) {
        const cfg = d.metaConfig || {};
        container.innerHTML = `
            <div class="card">
                <h3>${icon("cloud")} Meta Cloud API</h3>
                <p class="card-subtitle">Esta sesión usa la API Oficial de Meta — no requiere código QR.</p>
                <table>
                    <tbody>
                        <tr><th>Phone ID</th><td>${escapeHtml(cfg.phoneId || "-")}</td></tr>
                        <tr><th>WABA (accountId)</th><td>${escapeHtml(cfg.accountId || "-")}</td></tr>
                        <tr><th>App ID</th><td>${escapeHtml(cfg.appId || "-")}</td></tr>
                        <tr><th>Versión API</th><td>${escapeHtml(cfg.apiVersion || "-")}</td></tr>
                        <tr><th>Token configurado</th><td>${
                            cfg.hasToken
                                ? `<span style="color:var(--md-primary);display:inline-flex;align-items:center;gap:4px;">${icon(
                                      "check_circle"
                                  )} Sí</span>`
                                : `<span style="color:var(--md-error);display:inline-flex;align-items:center;gap:4px;">${icon(
                                      "cancel"
                                  )} No</span>`
                        }</td></tr>
                    </tbody>
                </table>
            </div>`;
        return;
    }

    if (d.status === "open") {
        container.innerHTML = `
            <div class="card">
                <h3 style="color:var(--md-primary);">${icon("check_circle")} Conectado</h3>
                <p class="card-subtitle">La sesión de WhatsApp Web está activa y lista para enviar mensajes.</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="card">
            <h3>${icon("qr_code_2")} Escanea el código QR</h3>
            <p class="card-subtitle">WhatsApp → Dispositivos vinculados → Vincular un dispositivo.</p>
            <div class="qr-wrap">
                <div id="qr-box" class="qr-box">Generando código QR...</div>
                <button id="btn-force-refresh-qr" class="btn btn-secondary btn-sm">${icon(
                    "refresh"
                )} Forzar nuevo QR</button>
            </div>
        </div>`;

    const qrBox = document.getElementById("qr-box");
    if (d.qr) {
        qrBox.innerHTML = "";
        new QRCode(qrBox, { text: d.qr, width: 232, height: 232 });
    } else {
        qrBox.textContent = "Código QR no disponible todavía...";
    }
    document
        .getElementById("btn-force-refresh-qr")
        .addEventListener("click", refreshQr);
}

// ---------------------------------------------------------------------------
// Send message tab
// ---------------------------------------------------------------------------

function renderSendTab() {
    const d = state.currentDetail;
    const container = document.getElementById("tab-send");

    if (!d.active) {
        container.innerHTML = `<p class="empty-hint">La sesión no está activa. No se pueden enviar mensajes.</p>`;
        return;
    }

    const isMeta = d.provider === "META_CLOUD_API";
    container.innerHTML = `
        <div class="card">
            ${
                d.status !== "open"
                    ? `<p class="hint" style="color:var(--md-on-warning-container);background:var(--md-warning-container);display:flex;align-items:center;gap:6px;padding:10px 12px;border-radius:var(--shape-sm);">${icon(
                          "warning"
                      )} Estado actual: "${escapeHtml(
                          d.status
                      )}". El envío puede fallar si la sesión no está conectada.</p>`
                    : ""
            }
            <div class="form-group">
                <label>Tipo de mensaje</label>
                <select id="send-type">
                    <option value="text">Texto</option>
                    <option value="image">Imagen</option>
                    <option value="document">Documento</option>
                    <option value="audio">Audio</option>
                    <option value="video">Video</option>
                    <option value="buttons">Botones</option>
                    ${isMeta ? '<option value="list">Lista</option>' : ""}
                </select>
            </div>
            <div class="form-group">
                <label>Número de teléfono</label>
                <input type="text" id="send-number" placeholder="573001234567" />
            </div>
            <div id="send-fields"></div>
            <button id="btn-send" class="btn btn-primary">${icon("send")} Enviar</button>
        </div>
        <div class="card">
            <h3>${icon("terminal")} Respuesta del servidor</h3>
            <pre id="send-log" class="log-box">Aquí aparecerá la respuesta...</pre>
        </div>`;

    const fieldsBox = document.getElementById("send-fields");
    const typeSelect = document.getElementById("send-type");

    function setupButtonRows() {
        const rowsBox = document.getElementById("buttons-rows");
        let rows = [{ id: "btn_1", text: "" }];
        function draw() {
            rowsBox.innerHTML = rows
                .map(
                    (r, i) => `
                <div class="dynamic-row">
                    <input type="text" class="btn-id" placeholder="id" value="${escapeHtml(r.id)}" />
                    <input type="text" class="btn-text" placeholder="texto" value="${escapeHtml(r.text)}" />
                    <button type="button" class="btn-icon btn-remove-row" data-i="${i}">${icon(
                        "close"
                    )}</button>
                </div>`
                )
                .join("");
            rowsBox.querySelectorAll(".btn-remove-row").forEach((btn) => {
                btn.addEventListener("click", () => {
                    rows.splice(Number(btn.dataset.i), 1);
                    draw();
                });
            });
        }
        draw();
        document.getElementById("btn-add-button").addEventListener("click", () => {
            if (rows.length >= 3) {
                toast("Máximo 3 botones.", "error");
                return;
            }
            rows.push({ id: `btn_${rows.length + 1}`, text: "" });
            draw();
        });
        fieldsBox._getButtons = () =>
            Array.from(rowsBox.querySelectorAll(".dynamic-row"))
                .map((row) => ({
                    id: row.querySelector(".btn-id").value.trim(),
                    text: row.querySelector(".btn-text").value.trim(),
                }))
                .filter((b) => b.id && b.text);
    }

    function renderFields(type) {
        switch (type) {
            case "text":
                fieldsBox.innerHTML = `<div class="form-group"><label>Mensaje</label><textarea id="f-message" placeholder="Escribe tu mensaje..."></textarea></div>`;
                break;
            case "image":
            case "video":
                fieldsBox.innerHTML = `
                    <div class="form-group"><label>Texto (opcional)</label><input type="text" id="f-caption" /></div>
                    <div class="form-group"><label>Archivo</label><input type="file" id="f-file" accept="${type}/*" /></div>`;
                break;
            case "document":
                fieldsBox.innerHTML = `<div class="form-group"><label>Archivo</label><input type="file" id="f-file" /></div>`;
                break;
            case "audio":
                fieldsBox.innerHTML = `<div class="form-group"><label>Archivo de audio</label><input type="file" id="f-file" accept="audio/*" /></div>`;
                break;
            case "buttons":
                fieldsBox.innerHTML = `
                    <div class="form-group"><label>Texto principal</label><textarea id="f-text"></textarea></div>
                    <div class="form-group"><label>Pie de página (opcional)</label><input type="text" id="f-footer" /></div>
                    <div class="form-group">
                        <label>Botones (máx. 3)</label>
                        <div id="buttons-rows"></div>
                        <button type="button" id="btn-add-button" class="btn btn-secondary btn-sm">${icon(
                            "add"
                        )} Añadir botón</button>
                    </div>`;
                setupButtonRows();
                break;
            case "list":
                fieldsBox.innerHTML = `
                    <div class="form-group"><label>Título (opcional)</label><input type="text" id="f-title" /></div>
                    <div class="form-group"><label>Texto del cuerpo</label><textarea id="f-text"></textarea></div>
                    <div class="form-group"><label>Pie de página (opcional)</label><input type="text" id="f-footer" /></div>
                    <div class="form-group"><label>Texto del botón</label><input type="text" id="f-buttonText" placeholder="Ver menú" /></div>
                    <div class="form-group">
                        <label>Secciones (JSON)</label>
                        <textarea id="f-sections" rows="8">${escapeHtml(
                            JSON.stringify(
                                [
                                    {
                                        title: "Sección 1",
                                        rows: [
                                            {
                                                id: "opcion_1",
                                                title: "Opción A",
                                                description: "Descripción A",
                                            },
                                        ],
                                    },
                                ],
                                null,
                                2
                            )
                        )}</textarea>
                        <span class="hint">Array de secciones con "title" y "rows" (id, title, description).</span>
                    </div>`;
                break;
        }
    }

    typeSelect.addEventListener("change", () => renderFields(typeSelect.value));
    renderFields(typeSelect.value);

    document.getElementById("btn-send").addEventListener("click", async () => {
        const number = document.getElementById("send-number").value.trim();
        if (!number) {
            toast("El número es requerido.", "error");
            return;
        }
        const type = typeSelect.value;
        let res;

        if (type === "text") {
            const message = document.getElementById("f-message").value.trim();
            if (!message) {
                toast("El mensaje es requerido.", "error");
                return;
            }
            res = await Api.sendMessage(state.selectedId, { number, message });
        } else if (["image", "document", "audio", "video"].includes(type)) {
            const file = document.getElementById("f-file").files[0];
            if (!file) {
                toast("Selecciona un archivo.", "error");
                return;
            }
            const fd = new FormData();
            fd.append("number", number);
            if (type === "image" || type === "video") {
                fd.append("caption", document.getElementById("f-caption").value || "");
            }
            fd.append(type, file);
            res = await Api.sendMedia(state.selectedId, type, fd);
        } else if (type === "buttons") {
            const text = document.getElementById("f-text").value.trim();
            const footer = document.getElementById("f-footer").value.trim();
            const buttons = fieldsBox._getButtons ? fieldsBox._getButtons() : [];
            if (!text || buttons.length === 0) {
                toast("Texto y al menos un botón son requeridos.", "error");
                return;
            }
            res = await Api.sendButtonMessage(state.selectedId, {
                number,
                text,
                footer,
                buttons,
            });
        } else if (type === "list") {
            const title = document.getElementById("f-title").value.trim();
            const text = document.getElementById("f-text").value.trim();
            const footer = document.getElementById("f-footer").value.trim();
            const buttonText = document.getElementById("f-buttonText").value.trim();
            let sections;
            try {
                sections = JSON.parse(document.getElementById("f-sections").value);
            } catch (e) {
                toast("El JSON de secciones no es válido.", "error");
                return;
            }
            if (!text || !buttonText || !sections) {
                toast("Faltan campos requeridos.", "error");
                return;
            }
            res = await Api.sendListMessage(state.selectedId, {
                number,
                title,
                text,
                footer,
                buttonText,
                sections,
            });
        }

        document.getElementById("send-log").textContent = JSON.stringify(res, null, 2);
        toast(
            res.success ? "Mensaje enviado." : res.message || res.error || "Error al enviar.",
            res.success ? "success" : "error"
        );
    });
}

// ---------------------------------------------------------------------------
// Templates tab (Meta only)
// ---------------------------------------------------------------------------

function renderTemplatesTab() {
    const d = state.currentDetail;
    const container = document.getElementById("tab-templates");

    if (!d.active) {
        container.innerHTML = `<p class="empty-hint">La sesión no está activa.</p>`;
        return;
    }
    if (d.provider !== "META_CLOUD_API") {
        container.innerHTML = `<p class="empty-hint">Las plantillas HSM solo están disponibles para sesiones de Meta Cloud API.</p>`;
        return;
    }

    container.innerHTML = `
        <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <h3 style="margin:0;">${icon("description")} Plantillas registradas</h3>
                <div style="display:flex;gap:8px;">
                    <button id="btn-load-templates" class="btn btn-secondary btn-sm">${icon(
                        "refresh"
                    )} Cargar plantillas</button>
                    <button id="btn-new-template" class="btn btn-primary btn-sm">${icon(
                        "add"
                    )} Nueva plantilla</button>
                </div>
            </div>
            <div id="templates-table-wrap" style="margin-top:14px;">
                <p class="empty-hint">Pulsa "Cargar plantillas" para ver las plantillas de este WABA.</p>
            </div>
        </div>
        <div id="template-form-card"></div>`;

    document.getElementById("btn-load-templates").addEventListener("click", loadTemplatesTable);
    document.getElementById("btn-new-template").addEventListener("click", renderTemplateForm);

    if (state.templatesCache[state.selectedId]) {
        renderTemplatesTable(state.templatesCache[state.selectedId]);
    }
}

async function loadTemplatesTable() {
    const wrap = document.getElementById("templates-table-wrap");
    wrap.innerHTML = `<p class="empty-hint">Cargando...</p>`;
    const res = await Api.getTemplates(state.selectedId);
    if (!res.success) {
        wrap.innerHTML = `<p class="empty-hint">Error: ${escapeHtml(
            res.message || "No se pudieron cargar las plantillas."
        )}</p>`;
        return;
    }
    const templates = Array.isArray(res.data) ? res.data : [];
    state.templatesCache[state.selectedId] = templates;
    renderTemplatesTable(templates);
}

function renderTemplatesTable(templates) {
    const wrap = document.getElementById("templates-table-wrap");
    if (!templates || templates.length === 0) {
        wrap.innerHTML = `<p class="empty-hint">No hay plantillas registradas.</p>`;
        return;
    }
    wrap.innerHTML = `
        <table>
            <thead><tr><th>Nombre</th><th>Categoría</th><th>Idioma</th><th>Estado</th><th></th></tr></thead>
            <tbody>
                ${templates
                    .map(
                        (t) => `
                    <tr>
                        <td>${escapeHtml(t.name)}</td>
                        <td>${escapeHtml(t.category || "-")}</td>
                        <td>${escapeHtml(t.language || "-")}</td>
                        <td><span class="pill ${pillClass(t.status)}">${escapeHtml(t.status || "-")}</span></td>
                        <td class="row-actions">
                            <button class="btn btn-secondary btn-sm btn-send-template" data-name="${escapeHtml(
                                t.name
                            )}" data-lang="${escapeHtml(t.language || "")}">${icon("send")} Enviar</button>
                            <button class="btn btn-danger btn-sm btn-delete-template" data-name="${escapeHtml(
                                t.name
                            )}" data-id="${escapeHtml(t.id || "")}">${icon("delete")} Eliminar</button>
                        </td>
                    </tr>`
                    )
                    .join("")}
            </tbody>
        </table>`;

    wrap.querySelectorAll(".btn-delete-template").forEach((btn) => {
        btn.addEventListener("click", async () => {
            if (!confirm(`¿Eliminar la plantilla "${btn.dataset.name}"?`)) return;
            const res = await Api.deleteTemplate(
                state.selectedId,
                btn.dataset.name,
                btn.dataset.id || undefined
            );
            toast(
                res.success ? "Plantilla eliminada." : res.message || "Error eliminando.",
                res.success ? "success" : "error"
            );
            if (res.success) loadTemplatesTable();
        });
    });

    wrap.querySelectorAll(".btn-send-template").forEach((btn) => {
        btn.addEventListener("click", () =>
            openSendTemplateModal(btn.dataset.name, btn.dataset.lang)
        );
    });
}

function renderTemplateForm() {
    const card = document.getElementById("template-form-card");
    card.innerHTML = `
        <div class="card">
            <h3>${icon("description")} Nueva plantilla</h3>
            <form id="form-template">
                <div class="form-grid">
                    <div class="form-group"><label>Nombre</label><input type="text" name="name" required placeholder="bienvenida_cliente" /></div>
                    <div class="form-group">
                        <label>Categoría</label>
                        <select name="category">
                            <option value="UTILITY">UTILITY</option>
                            <option value="MARKETING">MARKETING</option>
                            <option value="AUTHENTICATION">AUTHENTICATION</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Idioma</label><input type="text" name="language" value="es" required /></div>
                    <div class="form-group">
                        <label>Tipo de encabezado</label>
                        <select name="header_type" id="tpl-header-type">
                            <option value="NONE">Ninguno</option>
                            <option value="TEXT">Texto</option>
                            <option value="IMAGE">Imagen</option>
                            <option value="VIDEO">Video</option>
                            <option value="DOCUMENT">Documento</option>
                        </select>
                    </div>
                    <div class="form-group full" id="tpl-header-text-wrap" hidden>
                        <label>Texto del encabezado</label><input type="text" name="header_text" />
                    </div>
                    <div class="form-group full" id="tpl-header-media-wrap" hidden>
                        <label>URL de media de ejemplo</label><input type="url" name="header_media_url" />
                    </div>
                    <div class="form-group full"><label>Cuerpo</label><textarea name="body" required placeholder="Hola {{1}}, tu pedido {{2}} está listo."></textarea></div>
                    <div class="form-group full"><label>Pie de página (opcional)</label><input type="text" name="footer" /></div>
                </div>
                <div class="form-group">
                    <label>Botones (máx. 3, opcional)</label>
                    <div id="tpl-buttons-rows"></div>
                    <button type="button" id="btn-add-tpl-button" class="btn btn-secondary btn-sm">${icon(
                        "add"
                    )} Añadir botón</button>
                </div>
                <div class="modal-footer" style="margin-top:16px;">
                    <button type="button" id="btn-cancel-template" class="btn btn-secondary">Cancelar</button>
                    <button type="submit" class="btn btn-primary">${icon(
                        "send"
                    )} Enviar a Meta para aprobación</button>
                </div>
            </form>
        </div>`;

    const headerTypeSelect = document.getElementById("tpl-header-type");
    headerTypeSelect.addEventListener("change", () => {
        const v = headerTypeSelect.value;
        document.getElementById("tpl-header-text-wrap").hidden = v !== "TEXT";
        document.getElementById("tpl-header-media-wrap").hidden = !["IMAGE", "VIDEO", "DOCUMENT"].includes(v);
    });

    const rowsBox = document.getElementById("tpl-buttons-rows");
    let tplButtons = [];
    function drawTplButtons() {
        rowsBox.innerHTML = tplButtons
            .map(
                (b, i) => `
            <div class="dynamic-row">
                <select class="tpl-btn-type" data-i="${i}">
                    <option value="QUICK_REPLY" ${b.type === "QUICK_REPLY" ? "selected" : ""}>QUICK_REPLY</option>
                    <option value="URL" ${b.type === "URL" ? "selected" : ""}>URL</option>
                    <option value="PHONE_NUMBER" ${b.type === "PHONE_NUMBER" ? "selected" : ""}>PHONE_NUMBER</option>
                </select>
                <input type="text" class="tpl-btn-text" placeholder="texto" value="${escapeHtml(b.text || "")}" data-i="${i}" />
                <input type="text" class="tpl-btn-value" placeholder="${
                    b.type === "URL" ? "URL" : b.type === "PHONE_NUMBER" ? "teléfono" : ""
                }" value="${escapeHtml(b.value || "")}" data-i="${i}" ${b.type === "QUICK_REPLY" ? "hidden" : ""} />
                <button type="button" class="btn-icon btn-remove-tpl-row" data-i="${i}">${icon(
                    "close"
                )}</button>
            </div>`
            )
            .join("");

        rowsBox.querySelectorAll(".tpl-btn-type").forEach((sel) =>
            sel.addEventListener("change", (e) => {
                tplButtons[Number(e.target.dataset.i)].type = e.target.value;
                drawTplButtons();
            })
        );
        rowsBox.querySelectorAll(".tpl-btn-text").forEach((inp) =>
            inp.addEventListener("input", (e) => {
                tplButtons[Number(e.target.dataset.i)].text = e.target.value;
            })
        );
        rowsBox.querySelectorAll(".tpl-btn-value").forEach((inp) =>
            inp.addEventListener("input", (e) => {
                tplButtons[Number(e.target.dataset.i)].value = e.target.value;
            })
        );
        rowsBox.querySelectorAll(".btn-remove-tpl-row").forEach((btn) =>
            btn.addEventListener("click", (e) => {
                tplButtons.splice(Number(e.target.dataset.i), 1);
                drawTplButtons();
            })
        );
    }
    drawTplButtons();
    document.getElementById("btn-add-tpl-button").addEventListener("click", () => {
        if (tplButtons.length >= 3) {
            toast("Máximo 3 botones.", "error");
            return;
        }
        tplButtons.push({ type: "QUICK_REPLY", text: "", value: "" });
        drawTplButtons();
    });

    document.getElementById("btn-cancel-template").addEventListener("click", () => {
        card.innerHTML = "";
    });

    document.getElementById("form-template").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const templateData = {
            name: fd.get("name").trim(),
            category: fd.get("category"),
            language: fd.get("language").trim(),
            header_type: fd.get("header_type"),
            body: fd.get("body").trim(),
        };
        if (fd.get("footer")?.trim()) templateData.footer = fd.get("footer").trim();
        if (templateData.header_type === "TEXT") {
            templateData.header_text = fd.get("header_text")?.trim();
        }
        if (["IMAGE", "VIDEO", "DOCUMENT"].includes(templateData.header_type)) {
            templateData.header_media_url = fd.get("header_media_url")?.trim();
        }

        const buttons = tplButtons
            .filter((b) => b.text.trim())
            .map((b) => {
                const btn = { type: b.type, text: b.text.trim() };
                if (b.type === "URL") btn.url = b.value.trim();
                if (b.type === "PHONE_NUMBER") btn.phone_number = b.value.trim();
                return btn;
            });
        if (buttons.length) templateData.buttons = buttons;

        const res = await Api.submitTemplate(state.selectedId, templateData);
        toast(
            res.success
                ? "Plantilla enviada a Meta para aprobación."
                : res.message || "Error enviando la plantilla.",
            res.success ? "success" : "error"
        );
        if (res.success) {
            card.innerHTML = "";
            loadTemplatesTable();
        }
    });
}

function openSendTemplateModal(name, language) {
    openModal(`
        <h2>Enviar plantilla: ${escapeHtml(name)}</h2>
        <form id="form-send-template">
            <div class="form-group"><label>Número de teléfono</label><input type="text" name="number" required placeholder="573001234567" /></div>
            <div class="form-group"><label>Idioma</label><input type="text" name="language" value="${escapeHtml(
                language || "es"
            )}" required /></div>
            <div class="form-group"><label>Variables (JSON, opcional)</label><textarea name="variables" placeholder='{"1": "Juan", "2": "REF-123"}'></textarea></div>
            <div class="form-group"><label>Header override (JSON, opcional — solo si el template tiene header de media)</label><textarea name="header" placeholder='{"type":"IMAGE","mediaUrl":"https://..."}'></textarea></div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Cancelar</button>
                <button type="submit" class="btn btn-primary">${icon("send")} Enviar</button>
            </div>
        </form>
    `);
    document.getElementById("btn-cancel-modal").addEventListener("click", closeModal);
    document.getElementById("form-send-template").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        let variables = {};
        let header = null;
        try {
            if (fd.get("variables")?.trim()) variables = JSON.parse(fd.get("variables"));
            if (fd.get("header")?.trim()) header = JSON.parse(fd.get("header"));
        } catch (err) {
            toast("JSON inválido en variables o header.", "error");
            return;
        }
        const res = await Api.sendTemplate(state.selectedId, {
            number: fd.get("number").trim(),
            templateName: name,
            language: fd.get("language").trim(),
            variables,
            header,
        });
        toast(
            res.success ? "Plantilla enviada." : res.message || "Error enviando la plantilla.",
            res.success ? "success" : "error"
        );
        if (res.success) closeModal();
    });
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function renderSettingsTab() {
    const d = state.currentDetail;
    const container = document.getElementById("tab-settings");

    container.innerHTML = `
        <div class="card">
            <h3>${icon("webhook")} Webhook</h3>
            <p class="card-subtitle">URL a la que se enviarán los mensajes entrantes.</p>
            <form id="form-webhook">
                <div class="form-group">
                    <input type="url" name="webhook" value="${escapeHtml(
                        d.webhookUrl || ""
                    )}" placeholder="https://mi-webhook.com/api" />
                </div>
                <button type="submit" class="btn btn-primary btn-sm">${icon("save")} Guardar webhook</button>
            </form>
        </div>

        <div class="card">
            <h3>${icon("cloud")} Proveedor: API Oficial de Meta</h3>
            <p class="card-subtitle">
                Al guardar se reemplaza por completo la configuración de Meta de esta sesión — por seguridad el token
                nunca se muestra aquí, así que debes reingresarlo completo incluso si solo cambias otro campo.
            </p>
            <form id="form-meta">
                <div class="form-grid">
                    <div class="form-group"><label>Phone ID</label><input type="text" name="phoneId" value="${escapeHtml(
                        d.metaConfig?.phoneId || ""
                    )}" /></div>
                    <div class="form-group">
                        <label>Token de acceso ${
                            d.metaConfig?.hasToken ? "(configurado — reingresar para cambiar)" : ""
                        }</label>
                        <input type="password" name="token" placeholder="${
                            d.metaConfig?.hasToken ? "••••••••" : ""
                        }" />
                    </div>
                    <div class="form-group"><label>WABA / Account ID</label><input type="text" name="accountId" value="${escapeHtml(
                        d.metaConfig?.accountId || ""
                    )}" /></div>
                    <div class="form-group"><label>App ID</label><input type="text" name="appId" value="${escapeHtml(
                        d.metaConfig?.appId || ""
                    )}" /></div>
                    <div class="form-group full"><label>Versión de API</label><input type="text" name="apiVersion" value="${escapeHtml(
                        d.metaConfig?.apiVersion || ""
                    )}" placeholder="v18.0" /></div>
                </div>
                <button type="submit" class="btn btn-primary btn-sm">${icon(
                    "save"
                )} Guardar configuración de Meta</button>
            </form>
        </div>`;

    document.getElementById("form-webhook").addEventListener("submit", async (e) => {
        e.preventDefault();
        const webhook = new FormData(e.target).get("webhook").trim();
        const res = await Api.updateMetadata(state.selectedId, { webhook });
        toast(
            res.success ? "Webhook actualizado." : res.message || "Error actualizando el webhook.",
            res.success ? "success" : "error"
        );
        if (res.success) {
            await refreshSidebar();
            await loadDetail();
        }
    });

    document.getElementById("form-meta").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const phoneId = fd.get("phoneId").trim();
        const token = fd.get("token").trim();
        if (!phoneId || !token) {
            toast("Phone ID y Token son requeridos para guardar la configuración de Meta.", "error");
            return;
        }
        const metaConfig = {
            phoneId,
            token,
            accountId: fd.get("accountId").trim() || undefined,
            appId: fd.get("appId").trim() || undefined,
            apiVersion: fd.get("apiVersion").trim() || undefined,
        };
        const res = await Api.updateMetadata(state.selectedId, { metaConfig });
        toast(
            res.success
                ? "Configuración de Meta actualizada (la sesión se reiniciará)."
                : res.message || "Error actualizando la configuración.",
            res.success ? "success" : "error"
        );
        if (res.success) {
            await refreshSidebar();
            await loadDetail();
        }
    });
}

// ---------------------------------------------------------------------------
// New instance modal
// ---------------------------------------------------------------------------

document.getElementById("btn-new-instance").addEventListener("click", openNewInstanceModal);

function openNewInstanceModal() {
    openModal(`
        <h2>Nueva instancia</h2>
        <form id="form-new-instance">
            <div class="form-group">
                <label>ID de la sesión</label>
                <input type="text" name="sessionId" required placeholder="ej: tienda-1" />
            </div>
            <div class="form-group">
                <label>Webhook (opcional)</label>
                <input type="url" name="webhook" placeholder="https://mi-webhook.com/api" />
            </div>
            <div class="switch-row">
                <input type="checkbox" id="toggle-meta" />
                <label for="toggle-meta" style="font-weight:600;">Usar API Oficial de Meta (sin QR)</label>
            </div>
            <div id="meta-fields" hidden>
                <div class="form-grid">
                    <div class="form-group"><label>Phone ID</label><input type="text" name="phoneId" /></div>
                    <div class="form-group"><label>Token de acceso</label><input type="password" name="token" /></div>
                    <div class="form-group"><label>WABA / Account ID</label><input type="text" name="accountId" /></div>
                    <div class="form-group"><label>App ID</label><input type="text" name="appId" /></div>
                    <div class="form-group full"><label>Versión de API</label><input type="text" name="apiVersion" placeholder="v18.0" /></div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Cancelar</button>
                <button type="submit" class="btn btn-primary">${icon("add")} Crear sesión</button>
            </div>
        </form>
    `);

    document.getElementById("toggle-meta").addEventListener("change", (e) => {
        document.getElementById("meta-fields").hidden = !e.target.checked;
    });
    document.getElementById("btn-cancel-modal").addEventListener("click", closeModal);

    document.getElementById("form-new-instance").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const sessionId = fd.get("sessionId").trim();
        const webhook = fd.get("webhook").trim();
        let metaConfig = null;

        if (document.getElementById("toggle-meta").checked) {
            const phoneId = fd.get("phoneId").trim();
            const token = fd.get("token").trim();
            if (!phoneId || !token) {
                toast("Phone ID y Token son requeridos para usar la API de Meta.", "error");
                return;
            }
            metaConfig = {
                phoneId,
                token,
                accountId: fd.get("accountId").trim() || undefined,
                appId: fd.get("appId").trim() || undefined,
                apiVersion: fd.get("apiVersion").trim() || undefined,
            };
        }

        const res = await Api.startSession({
            sessionId,
            webhook: webhook || undefined,
            metaConfig,
        });
        if (!res.success) {
            toast(res.message || "Error creando la sesión.", "error");
            return;
        }
        toast("Sesión creada, iniciando...", "success");
        closeModal();
        await refreshSidebar();
        selectSession(sessionId);
    });
}

// ---------------------------------------------------------------------------
// Logout / API key (dashboard-only; does not gate /api/sessions or /api/meta)
// ---------------------------------------------------------------------------

document.getElementById("btn-logout").addEventListener("click", async () => {
    if (!confirm("¿Cerrar sesión del dashboard?")) return;
    await Api.logout();
    window.location.href = "/login.html";
});

document.getElementById("btn-api-key").addEventListener("click", async () => {
    const statusRes = await Api.getApiKeyStatus();
    renderApiKeyModal(statusRes);
});

function renderApiKeyModal(statusRes, revealedKey = null) {
    const exists = Boolean(statusRes.success && statusRes.exists);
    openModal(`
        <h2>${icon("key")} API Key (uso futuro)</h2>
        <p class="hint">
            Pensada para autenticar servicios externos (p. ej. la integración con olimpochat) frente a la API sin
            login interactivo. Por ahora los endpoints de sesiones siguen siendo públicos — generarla aquí solo la
            deja lista para cuando se active su verificación en el servidor.
        </p>
        ${
            revealedKey
                ? `<div class="card" style="background:var(--md-warning-container);color:var(--md-on-warning-container);">
                     <strong style="display:flex;align-items:center;gap:6px;">${icon(
                         "warning"
                     )} Copia esta clave ahora — no se volverá a mostrar:</strong>
                     <div class="log-box" style="margin-top:8px;">${escapeHtml(revealedKey)}</div>
                     <button type="button" id="btn-copy-key" class="btn btn-secondary btn-sm" style="margin-top:8px;">${icon(
                         "content_copy"
                     )} Copiar</button>
                   </div>`
                : exists
                ? `<p>Clave activa, terminada en <strong>${escapeHtml(
                      statusRes.lastFour
                  )}</strong> (creada ${escapeHtml(new Date(statusRes.createdAt).toLocaleString())}).</p>`
                : `<p class="empty-hint">No hay ninguna API key generada todavía.</p>`
        }
        <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Cerrar</button>
            ${
                exists
                    ? `<button type="button" class="btn btn-danger" id="btn-revoke-key">${icon(
                          "delete"
                      )} Revocar</button>`
                    : ""
            }
            <button type="button" class="btn btn-primary" id="btn-generate-key">${icon("key")} ${
        exists ? "Regenerar" : "Generar"
    } API Key</button>
        </div>
    `);

    document.getElementById("btn-cancel-modal").addEventListener("click", closeModal);

    if (revealedKey) {
        document.getElementById("btn-copy-key").addEventListener("click", () => {
            navigator.clipboard
                .writeText(revealedKey)
                .then(() => toast("Copiado al portapapeles.", "success"))
                .catch(() => toast("No se pudo copiar.", "error"));
        });
    }

    document.getElementById("btn-generate-key").addEventListener("click", async () => {
        if (exists && !confirm("Esto invalida la clave anterior. ¿Continuar?")) return;
        const res = await Api.generateApiKey();
        if (!res.success) {
            toast(res.message || "Error generando la API key.", "error");
            return;
        }
        toast("API key generada.", "success");
        renderApiKeyModal(
            { success: true, exists: true, lastFour: res.lastFour, createdAt: res.createdAt },
            res.apiKey
        );
    });

    const revokeBtn = document.getElementById("btn-revoke-key");
    if (revokeBtn) {
        revokeBtn.addEventListener("click", async () => {
            if (!confirm("¿Revocar la API key actual?")) return;
            const res = await Api.revokeApiKey();
            toast(
                res.success ? "API key revocada." : res.message || "Error revocando.",
                res.success ? "success" : "error"
            );
            if (res.success) renderApiKeyModal({ success: true, exists: false });
        });
    }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
    await refreshSidebar();
    restartPolling();
}

init();
