import crypto from "crypto";
import {
    isConfigured,
    getCredentials,
    createSessionCookie,
    readSession,
    COOKIE_NAME,
    SESSION_TTL_MS,
} from "../middlewares/dashboardAuth.js";

function timingSafeEqualStr(a, b) {
    const bufA = Buffer.from(String(a ?? ""));
    const bufB = Buffer.from(String(b ?? ""));
    if (bufA.length !== bufB.length) {
        // Compare against itself so the branch takes comparable time either way,
        // avoiding an obvious length-based timing signal.
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

class AuthController {
    async login(req, res) {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                message:
                    "Panel no configurado. Define DASHBOARD_USERNAME, DASHBOARD_PASSWORD y SESSION_SECRET.",
            });
        }

        const { username, password } = req.body || {};
        if (!username || !password) {
            return res
                .status(400)
                .json({ success: false, message: "Usuario y contraseña son requeridos." });
        }

        const creds = getCredentials();
        const validUser = timingSafeEqualStr(username, creds.username);
        const validPass = timingSafeEqualStr(password, creds.password);
        if (!validUser || !validPass) {
            return res
                .status(401)
                .json({ success: false, message: "Usuario o contraseña incorrectos." });
        }

        const cookieValue = createSessionCookie(creds.username);
        res.cookie(COOKIE_NAME, cookieValue, {
            httpOnly: true,
            sameSite: "lax",
            maxAge: SESSION_TTL_MS,
        });
        res.json({ success: true });
    }

    async logout(req, res) {
        res.clearCookie(COOKIE_NAME);
        res.json({ success: true });
    }

    async me(req, res) {
        const session = readSession(req);
        res.json({
            success: true,
            authenticated: Boolean(session),
            username: session?.username || null,
        });
    }
}

export default new AuthController();
