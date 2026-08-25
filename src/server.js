const express = require('express');
const app = express();
require('dotenv').config()
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const hostname = '0.0.0.0';
const { version: appVersion } = require('../package.json');
const { dbConnect } = require('./config/db');
const { scheduleBackup, rescheduleBackupOnUpdate } = require('./config/cronBackup');
const { getTrustProxySetting } = require('./config/httpsConfig');
const { getHelmetOptions } = require('./config/securityHeaders');
const enforceHttps = require('./middleware/enforceHttps');
const sanitizeInput = require('./middleware/sanitizeInput');

dbConnect();
// === Daily Backup at 12:00 AM ===
scheduleBackup();           // initial schedule
rescheduleBackupOnUpdate();

// Must be set before anything reads req.ip/req.secure (the HTTPS redirect
// just below, and the rate limiters further down) - see
// config/httpsConfig.js for why this is `1` (trust exactly one reverse-
// proxy hop) rather than `true` (trust any number, which would let a
// client spoof its own IP past the rate limiter via X-Forwarded-For).
const trustProxySetting = getTrustProxySetting();
if (trustProxySetting !== false) {
    app.set('trust proxy', trustProxySetting);
}

// Explicit allowlist, never a wildcard (`*` can't be combined with
// `credentials: true` anyway - browsers reject that combination outright).
// Overridable via CORS_ALLOWED_ORIGINS (comma-separated) so a production
// frontend origin can be added/rotated without a code deploy; falls back to
// these defaults when unset - the deployed production origin, the Vite dev
// server's default port (5173, the app's actual local frontend port), and
// localhost:3000 (kept for any tooling/direct-hit use against that port).
function parseAllowedOrigins() {
    if (process.env.CORS_ALLOWED_ORIGINS !== undefined) {
        return process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
    }
    return ["http://localhost:5173", "http://[::1]:5173", "http://localhost:3000", "https://inmateapi.agsoftsolutions.co.in"];
}
const allowedOrigins = parseAllowedOrigins();
if (allowedOrigins.length === 0) {
    // Fails closed (every cross-origin browser request gets rejected), not
    // open - still worth a loud warning since it likely means a
    // misconfigured CORS_ALLOWED_ORIGINS env var.
    console.warn("CORS: no allowed origins configured - all cross-origin requests will be rejected.");
}

// Previously `cors(allowedOrigins)` - passing an array as the first
// positional arg isn't a real allowlist to the `cors` package (it's not an
// options object), so this had no effect and `credentials` was never set.
// That happened to be harmless while auth lived in localStorage/headers,
// but cookie-based auth (this fix) requires the browser to actually send
// and receive the auth cookie cross-origin, which needs a real allowlist
// (reflecting one specific origin, never `*`) plus `credentials: true`.
const corsOptionsDelegate = function (req, callback) {
    let corsOptions;
    if (allowedOrigins.includes(req.header('Origin'))) {
        corsOptions = { origin: true, credentials: true };
    } else {
        corsOptions = { origin: false };
    }
    callback(null, corsOptions);
};

// Mounted FIRST, before enforceHttps/helmet/auth/rate-limiting - anything
// that can short-circuit a request with its own response (a redirect, a
// 4xx/429 rejection). `cors` middleware answers the browser's OPTIONS
// preflight itself (204, before calling next()) and also stamps the
// Access-Control-* headers onto `res` for every other request before
// passing it along, so those headers are still present even if a later
// middleware rejects the request.
//
// This isn't just tidiness: with cors() mounted after enforceHttps() (the
// previous order), a plain-HTTP request hitting this app while
// ENFORCE_HTTPS is active (production, or NODE_ENV=production locally by
// mistake - see the .env fix alongside this change) got a 301/400 with NO
// CORS headers, since enforceHttps() responds before cors() ever runs.
// The browser reports that as "blocked by CORS policy" - masking the real
// cause (an HTTPS redirect) behind a misleading CORS error. Mounting cors
// first means any such failure downstream still carries correct CORS
// headers, so the browser surfaces the actual error instead.
app.use(cors(corsOptionsDelegate));

// Redirects/rejects plain-HTTP requests in production - see
// middleware/enforceHttps.js. Runs after cors() (above) so a rejected/
// redirected insecure request still carries correct CORS headers instead
// of surfacing to the browser as a misleading CORS error - but still
// before auth/body parsing, same as before.
app.use(enforceHttps());
// Sets the standard security headers (CSP, X-Content-Type-Options,
// Referrer-Policy, frame protections, HSTS in production, etc.) on every
// response, including static files under /uploads - see
// config/securityHeaders.js for the two app-specific overrides.
app.use(helmet(getHelmetOptions()));

app.use(express.json());
// Populates req.cookies from the incoming Cookie header - needed for
// authToken.js to read the httpOnly JWT/CSRF cookies set on login. Must be
// mounted before any route that runs authenticateToken.
app.use(cookieParser());
// Strips any MongoDB operator key ($ne, $where, ...) or dot-notation path
// out of every request body, on every route, before any handler sees it -
// see middleware/sanitizeInput.js. Must run after express.json() (needs
// req.body already parsed) and before every route below.
app.use(sanitizeInput());

const authRoutes = require("./routes/authRoutes");
const inmateRoutes = require("./routes/inmateRoutes");
const financialRoutes = require("./routes/financialRoutes");
const tuckShopRoutes = require("./routes/tuckShopRoutes");
const cartRoutes = require("./routes/cartRoutes");
const userRoutes = require("./routes/usersRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const reportRoutes = require("./routes/reportRoutes");
const auditLogsRoutes = require("./routes/auditRoutes");
const authenticateToken = require("./middleware/authToken");
const bulkOperations = require("./routes/bulkOprationRoutes");
const departmentRoles = require("./routes/departmentRoutes");
const inmateLocationRoutes = require('./routes/inmateLocationRoutes')
const inventoryRoutes = require('./routes/inventoryRoutes')
const backupRoutes = require('./routes/backupRoutes')
const InmatePaymentMandateRoutes = require("./routes/InmatePaymentMandateRoutes")
const inmatePaymentRoutes = require("./routes/inmatePaymentRoutes")
const inmateFileUploadRoutes = require("./routes/inmateFileRoute")
const uploadsRoutes = require("./routes/uploadsRoute")
const adminRoutes = require("./routes/adminRoutes")
const officerFeedbackRoutes = require("./routes/officerFeedbackRoutes")
const morgan = require("morgan");
const { attachLocationFilter, attachOptionalLocationFilter } = require("./utils/locationAccess");
const requireRole = require("./middleware/requireRole");
const createRateLimiter = require("./middleware/rateLimit");
const rateLimitConfig = require("./config/rateLimitConfig");

// cors() is mounted much earlier now (right after `trust proxy`, before
// enforceHttps/helmet) - see the comment there for why. Nothing route-
// related needed here anymore.
app.use(morgan(":method :url :status :response-time ms"));

// Lenient, app-wide safety net (per caller IP) ahead of every route below.
// The stricter, endpoint-specific limiters further down (login, payment,
// file upload, password change) layer on top of this one for the routes
// that need tighter bounds - see config/rateLimitConfig.js for every
// tier's window/ceiling and how to override them via environment
// variables.
const globalRateLimiter = createRateLimiter({
    ...rateLimitConfig.global,
    keyPrefix: "global",
    message: "Too many requests. Please try again later.",
});
// /payment/* (Razorpay order create/verify) and /mandate/* (auto-debit
// mandate setup) - both authenticated, so keyed by the caller's own user
// id rather than IP (multiple staff can legitimately share one facility's
// network/IP).
const paymentRateLimiter = createRateLimiter({
    ...rateLimitConfig.payment,
    keyPrefix: "payment",
    keyGenerator: (req) => req.user?.id || req.ip,
    message: "Too many payment requests. Please try again later.",
});
// POST /file (inmate file/photo upload) - authenticated, keyed the same way.
const uploadRateLimiter = createRateLimiter({
    ...rateLimitConfig.upload,
    keyPrefix: "upload",
    keyGenerator: (req) => req.user?.id || req.ip,
    message: "Too many upload requests. Please try again later.",
});

app.get('/', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Inmate Backend</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { text-align: center; padding: 2rem 3rem; border-radius: 12px; background: #1e293b; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
        h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
        .status { color: #4ade80; font-weight: 600; }
        .version { margin-top: 1rem; font-size: 0.9rem; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Inmate Backend</h1>
        <p class="status">&#9679; Server is running</p>
        <p class="version">Version ${appVersion}</p>
    </div>
</body>
</html>`);
});

app.use(globalRateLimiter);

app.use("/user", authRoutes);
app.use("/admin", adminRoutes);
// Role gating for /inmate, /tuck-shop, and /location is applied per-route
// inside their own route files (some of their routes are staff-only, others
// are shared with POS or with the record's own INMATE user) - see
// routes/inmateRoutes.js, routes/tuckShopRoutes.js, routes/inmateLocationRoutes.js.
app.use("/inmate", authenticateToken, attachLocationFilter, inmateRoutes);
app.use("/financial", authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), attachLocationFilter, financialRoutes);
app.use("/tuck-shop", authenticateToken, attachLocationFilter, tuckShopRoutes);
app.use("/pos-shop-cart", authenticateToken, requireRole("ADMIN", "SUPER ADMIN", "POS"), attachOptionalLocationFilter, cartRoutes);
app.use("/users", userRoutes);
app.use("/faceRecognition",userRoutes)
app.use("/transactions", authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), attachLocationFilter, transactionRoutes);
app.use("/dashboard", authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), attachLocationFilter, dashboardRoutes);
app.use("/reports", authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), attachLocationFilter, reportRoutes);
app.use("/logs", authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), attachLocationFilter, auditLogsRoutes);
app.use("/bulk-oprations", authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), attachLocationFilter, bulkOperations);
app.use("/department", authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), departmentRoles);
app.use("/location", authenticateToken, inmateLocationRoutes)
// inventory and canteen operation
app.use('/inventory',authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), attachLocationFilter, inventoryRoutes)
app.use("/backup",authenticateToken, requireRole("ADMIN", "SUPER ADMIN"), backupRoutes)
app.use("/officer-feedback", authenticateToken, requireRole("ADMIN", "SUPER ADMIN", "POS"), officerFeedbackRoutes)
app.use("/mandate", authenticateToken, paymentRateLimiter, InmatePaymentMandateRoutes)
app.use("/payment", authenticateToken, paymentRateLimiter, inmatePaymentRoutes)
app.use("/file", authenticateToken, uploadRateLimiter, attachLocationFilter, inmateFileUploadRoutes)
// Replaces the old unauthenticated `express.static('/uploads', ...)` mount
// (see controllers/uploadsController.js for the full rationale) - every
// uploaded inmate document/photo now requires a valid session and is only
// served back if the InmateFile record it maps to is in the caller's own
// facility (and, for INMATE-role callers, their own record).
app.use('/uploads', authenticateToken, attachLocationFilter, uploadsRoutes)


app.listen(process.env.PORT,hostname, () => {
    console.log(`server running successfully on ${process.env.PORT}`)
    console.log('Running in', process.env.NODE_ENV, 'mode');
})
