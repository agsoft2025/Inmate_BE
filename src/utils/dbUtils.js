const mongoose = require('mongoose');

/**
 * Checks if the current MongoDB connection supports transactions.
 * Transactions require a replica set or mongos.
 */
async function supportsTransactions() {
  try {
    const admin = mongoose.connection.db.admin();
    const status = await admin.serverStatus();
    // Repl attribute is present only on replica set members
    return !!status.repl;
  } catch (error) {
    // If we don't have privileges to run serverStatus, default to false
    // or log appropriately. For safety, we return false here.
    return false;
  }
}

module.exports = { supportsTransactions };
