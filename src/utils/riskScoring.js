// Financial Anomaly & Fraud Detection - deterministic, explainable,
// rule-based risk scoring for POS/Financial transactions. No AI/ML: a
// small fixed set of signals, each with a weight; the total weight maps to
// a risk level. Used by transactionController.js (both the merged
// POS+Financial history endpoint and the dedicated /transactions/flagged
// endpoint) and cartController.js's getAllPOSCarts (Recent Purchases risk
// badge), so the same rules and scores show up everywhere a transaction
// appears.

const LARGE_AMOUNT_THRESHOLD = 5000; // ₹ - flat threshold, not per-inmate history
const ROUND_AMOUNT_FLOOR = 1000; // ₹ - only flag round numbers at/above this
const ROUND_AMOUNT_STEP = 500; // ₹
const RAPID_REPEAT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const RAPID_REPEAT_COUNT = 3; // this transaction + at least 2 others nearby
const OFF_HOURS_START_HOUR = 23; // 11 PM
const OFF_HOURS_END_HOUR = 5; // 5 AM

const SIGNAL_WEIGHTS = {
  LARGE_AMOUNT: 30,
  RAPID_REPEAT: 25,
  REVERSED: 20,
  ROUND_AMOUNT: 15,
  OFF_HOURS: 15,
};

const isRoundAmount = (amount) => amount > 0 && amount % ROUND_AMOUNT_STEP === 0;

const isOffHours = (date) => {
  const hour = date.getHours();
  return hour >= OFF_HOURS_START_HOUR || hour < OFF_HOURS_END_HOUR;
};

const levelForScore = (score) => {
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score > 0) return "low";
  return "clear";
};

// `records`: [{ id, inmateId, amount, eventDate (Date|string|number), isReversed }]
// Returns a Map keyed by `id` -> { score, level, signals: [{code, weight, label}] }.
// Grouping is by inmateId so the rapid-repeat check only compares a
// transaction against that same inmate's other transactions in the batch,
// never across different inmates.
const computeRiskForBatch = (records) => {
  const byInmate = new Map();
  for (const r of records) {
    if (!r || !r.inmateId) continue;
    if (!byInmate.has(r.inmateId)) byInmate.set(r.inmateId, []);
    byInmate.get(r.inmateId).push(r);
  }

  const results = new Map();

  for (const r of records) {
    if (!r || r.id == null) continue;

    const amount = Math.abs(Number(r.amount) || 0);
    const eventDate = new Date(r.eventDate);
    const hasValidDate = !Number.isNaN(eventDate.getTime());
    const signals = [];

    if (amount >= LARGE_AMOUNT_THRESHOLD) {
      signals.push({
        code: "LARGE_AMOUNT",
        weight: SIGNAL_WEIGHTS.LARGE_AMOUNT,
        label: `Amount ₹${amount} exceeds the ₹${LARGE_AMOUNT_THRESHOLD} large-transaction threshold`,
      });
    }

    if (amount >= ROUND_AMOUNT_FLOOR && isRoundAmount(amount)) {
      signals.push({
        code: "ROUND_AMOUNT",
        weight: SIGNAL_WEIGHTS.ROUND_AMOUNT,
        label: `₹${amount} is an unusually round amount`,
      });
    }

    if (hasValidDate && isOffHours(eventDate)) {
      signals.push({
        code: "OFF_HOURS",
        weight: SIGNAL_WEIGHTS.OFF_HOURS,
        label: `Recorded at ${eventDate.toTimeString().slice(0, 5)} - outside typical hours`,
      });
    }

    if (r.isReversed) {
      signals.push({
        code: "REVERSED",
        weight: SIGNAL_WEIGHTS.REVERSED,
        label: "This transaction was reversed",
      });
    }

    let nearbyCount = 0;
    if (hasValidDate && r.inmateId) {
      const peers = byInmate.get(r.inmateId) || [];
      for (const other of peers) {
        if (other === r || other.id === r.id) continue;
        const otherDate = new Date(other.eventDate);
        if (Number.isNaN(otherDate.getTime())) continue;
        if (Math.abs(eventDate.getTime() - otherDate.getTime()) <= RAPID_REPEAT_WINDOW_MS) {
          nearbyCount += 1;
        }
      }
    }

    if (nearbyCount + 1 >= RAPID_REPEAT_COUNT) {
      signals.push({
        code: "RAPID_REPEAT",
        weight: SIGNAL_WEIGHTS.RAPID_REPEAT,
        label: `${nearbyCount + 1} transactions for this inmate within 30 minutes`,
      });
    }

    const score = signals.reduce((sum, s) => sum + s.weight, 0);
    results.set(r.id, { score, level: levelForScore(score), signals });
  }

  return results;
};

module.exports = {
  computeRiskForBatch,
  levelForScore,
  SIGNAL_WEIGHTS,
  LARGE_AMOUNT_THRESHOLD,
  ROUND_AMOUNT_FLOOR,
  ROUND_AMOUNT_STEP,
  RAPID_REPEAT_WINDOW_MS,
  RAPID_REPEAT_COUNT,
  OFF_HOURS_START_HOUR,
  OFF_HOURS_END_HOUR,
};
