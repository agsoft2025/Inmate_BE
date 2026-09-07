const express = require('express');
const app = express();
const path = require('path');
require('dotenv').config()
const cors = require('cors');
const hostname = '0.0.0.0';
const { version: appVersion } = require('../package.json');
const { dbConnect } = require('./config/db');
const { scheduleBackup, rescheduleBackupOnUpdate } = require('./config/cronBackup');

dbConnect();
// === Daily Backup at 12:00 AM ===
scheduleBackup();           // initial schedule
rescheduleBackupOnUpdate();

app.use(express.json());

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
const adminRoutes = require("./routes/adminRoutes")
const internalRoutes = require("./routes/internalRoutes")
const morgan = require("morgan");
const { attachLocationFilter, attachOptionalLocationFilter } = require("./utils/locationAccess");

const defaultOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://152.67.190.22:3000",
    "http://agsoftsolutions.co.in",
    "http://152.67.190.22",
    "https://agsoftsolutions.co.in",
    "https://global-server-fe.vercel.app",
    "https://school.agsoftsolutions.co.in",
    "https://inmate.agsoftsolutions.co.in"
];
const envOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
}));
app.use(morgan(":method :url :status :response-time ms"));
app.use('/uploads', express.static(path.join(__dirname,'..', 'uploads')));

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

app.use("/user", authRoutes);
app.use("/admin", adminRoutes);
app.use("/internal", internalRoutes);
app.use("/inmate", authenticateToken, attachLocationFilter, inmateRoutes);
app.use("/financial", authenticateToken, attachLocationFilter, financialRoutes);
app.use("/tuck-shop", authenticateToken, attachLocationFilter, tuckShopRoutes);
app.use("/pos-shop-cart", authenticateToken, attachOptionalLocationFilter, cartRoutes);
app.use("/users", userRoutes);
app.use("/faceRecognition",userRoutes)
app.use("/transactions", authenticateToken, attachLocationFilter, transactionRoutes);
app.use("/dashboard", authenticateToken, attachLocationFilter, dashboardRoutes);
app.use("/reports", authenticateToken, attachLocationFilter, reportRoutes);
app.use("/logs", authenticateToken, attachLocationFilter, auditLogsRoutes);
app.use("/bulk-oprations", authenticateToken, attachLocationFilter, bulkOperations);
app.use("/department", authenticateToken, departmentRoles);
app.use("/location", authenticateToken, inmateLocationRoutes)
// inventory and canteen operation
app.use('/inventory',authenticateToken, attachLocationFilter, inventoryRoutes)
app.use("/backup",authenticateToken,backupRoutes)
app.use("/mandate",InmatePaymentMandateRoutes)
app.use("/payment",inmatePaymentRoutes)
app.use("/file",inmateFileUploadRoutes)


app.listen(process.env.PORT,hostname, () => {
    console.log(`server running successfully on ${process.env.PORT}`)
    console.log('Running in', process.env.NODE_ENV, 'mode');
})
