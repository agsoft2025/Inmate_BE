const mongoose = require('mongoose');
const { getMongoConnectionOptions, assertSecureMongoConfig, redactMongoUri } = require('./mongoSecurity');

exports.dbConnect = async () => {
    const uri = process.env.DB_MONGO_URL;

    if (!uri) {
        console.error("Mongo DB connection error: DB_MONGO_URL is not set.");
        return;
    }

    // Best-effort check that the connection is actually authenticated + encrypted.
    // Non-fatal by default (so existing/local-dev setups keep working); set
    // DB_MONGO_REQUIRE_SECURE=true once the production MongoDB has auth/TLS
    // enabled to make this enforced instead of just a warning. See
    // docs/mongodb_security_migration.md for the full migration steps.
    const { ok, reasons } = assertSecureMongoConfig(uri);
    if (!ok) {
        const summary = `Mongo DB security warning: ${reasons.join("; ")}.`;
        if (process.env.DB_MONGO_REQUIRE_SECURE === "true") {
            console.error(`${summary} Refusing to start because DB_MONGO_REQUIRE_SECURE=true.`);
            process.exit(1);
        }
        console.warn(summary);
    }

    const options = getMongoConnectionOptions();

    await mongoose.connect(uri, options).then(() => {
        console.log("Mongo db connected succesfully");
    }).catch((err) => {
        // Never log the raw error object - some MongoDB driver errors
        // (e.g. malformed-URI parse errors) embed the connection string,
        // which may contain credentials.
        console.log("mongo db connection error:", err.name, "-", redactMongoUri(err.message));
    });
}
