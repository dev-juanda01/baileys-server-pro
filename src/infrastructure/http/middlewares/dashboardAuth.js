import crypto from "crypto";

const COOKIE_NAME = "hermes_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function getCredentials() {
    return {
        username: process.env.DASHBOARD_USERNAME,
        password: process.env.DASHBOARD_PASSWORD,
        secret: process.env.SESSION_SECRET,
    };
}

// Fails closed: without all three vars set, no session can be issued or
// verified, so the dashboard stays inaccessible rather than silently open.
function isConfigured() {
    const { username, password, secret } = getCredentials();
    return Boolean(username && password && secret);
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    header.split(";").forEach((pair) => {
        const idx = pair.indexOf("=");
        if (idx === -1) return;
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        try {
            out[key] = decodeURIComponent(value);
        } catch (e) {
            out[key] = value;
        }
    });
    return out;
}

function sign(value, secret) {
    const hmac = crypto.createHmac("sha256", secret).update(value).digest("base64url");
    return `${value}.${hmac}`;
}

function verify(token, secret) {
    if (!token) return null;
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return null;
    const value = token.slice(0, dotIndex);
    const hmac = token.slice(dotIndex + 1);
    const expected = crypto.createHmac("sha256", secret).update(value).digest("base64url");
    const a = Buffer.from(hmac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return value;
}

function createSessionCookie(username) {
    const { secret } = getCredentials();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    return sign(`${username}|${expiresAt}`, secret);
}

function readSession(req) {
    const { secret } = getCredentials();
    if (!secret) return null;
    const cookies = parseCookies(req.headers.cookie);
    const value = verify(cookies[COOKIE_NAME], secret);
    if (!value) return null;
    const [username, expiresAtStr] = value.split("|");
    const expiresAt = Number(expiresAtStr);
    if (!expiresAt || Date.now() > expiresAt) return null;
    return { username };
}

/**
 * Protects the dashboard's HTML entrypoint. Static assets (css/js/login page)
 * stay reachable so the login screen itself can render — only the main page
 * requires a valid session. The underlying /api/sessions and /api/meta
 * surface is intentionally left untouched by this middleware; it is not
 * mounted on those routes (see server.js).
 */
function requireDashboardSession(req, res, next) {
    if (!isConfigured()) {
        return res
            .status(503)
            .send(
                "Panel no configurado: define DASHBOARD_USERNAME, DASHBOARD_PASSWORD y SESSION_SECRET en las variables de entorno."
            );
    }
    const session = readSession(req);
    if (!session) {
        return res.redirect("/login.html");
    }
    req.dashboardUser = session.username;
    next();
}

/** Protects dashboard-only management endpoints (auth status, API key admin). */
function requireDashboardApi(req, res, next) {
    if (!isConfigured()) {
        return res.status(503).json({
            success: false,
            message:
                "Panel no configurado. Define DASHBOARD_USERNAME, DASHBOARD_PASSWORD y SESSION_SECRET.",
        });
    }
    const session = readSession(req);
    if (!session) {
        return res.status(401).json({ success: false, message: "No autenticado." });
    }
    req.dashboardUser = session.username;
    next();
}

export {
    COOKIE_NAME,
    SESSION_TTL_MS,
    isConfigured,
    getCredentials,
    createSessionCookie,
    readSession,
    requireDashboardSession,
    requireDashboardApi,
};
