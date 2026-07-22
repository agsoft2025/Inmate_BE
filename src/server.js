const express = require('express');
const app = express();
const path = require('path');
require('dotenv').config()
const cors = require('cors');
const hostname = '0.0.0.0';
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
const morgan = require("morgan");
const { attachLocationFilter, attachOptionalLocationFilter } = require("./utils/locationAccess");

const allowedOrigins = ["http://localhost:5173","https://inmateapi.agsoftsolutions.co.in"]

// const corsOptionsDelegate = function (req, callback) {
//     let corsOptions;
//     if (allowedOrigins.includes(req.header('Origin'))) {
//         corsOptions = { origin: true };
//     } else {
//         corsOptions = { origin: false }; 
//     }
//     callback(null, corsOptions);
// };

app.use(cors(allowedOrigins));
app.use(morgan(":method :url :status :response-time ms"));
app.use('/uploads', express.static(path.join(__dirname,'..', 'uploads')));
app.use("/user", authRoutes);
app.use("/admin", adminRoutes);
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
