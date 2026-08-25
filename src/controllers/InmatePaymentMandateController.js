const razorpay = require("../config/razorpay");
const inmateModel = require("../model/inmateModel");
const InmatePaymentMandate = require("../model/InmatePaymentMandate");
const PaymentLog = require("../model/PaymentLog");
const { createMandate } = require("../utils/emandate");
const axios = require("axios");
const https = require("https");
const { logError } = require("../utils/safeLog");
const { requireLocationFilter, LocationAccessError } = require("../utils/locationAccess");

// Same pattern as paymentController.js's getLocationFilterOrAbort - /mandate
// doesn't mount attachLocationFilter, so this is resolved inline.
const getLocationFilterOrAbort = (req, res) => {
    try {
        return req.locationFilter ?? requireLocationFilter(req.user);
    } catch (error) {
        if (error instanceof LocationAccessError) {
            res.status(error.status).json({ success: false, message: error.message });
            return null;
        }
        throw error;
    }
};

const normalizeRole = (role) => (typeof role === "string" ? role.trim().toUpperCase() : "");

// An INMATE-role caller may only ever create/save a mandate for their own
// inmate record - staff (ADMIN/SUPER ADMIN) are unrestricted beyond the
// facility scope already enforced by the locationFilter-based lookup at
// each call site below.
const assertOwnRecordIfInmate = (req, res, resolvedInmateId) => {
    if (normalizeRole(req.user?.role) === "INMATE" && req.user?.inmateId !== resolvedInmateId) {
        res.status(403).json({ success: false, message: "Access denied: you may only manage your own mandates" });
        return false;
    }
    return true;
};

const createInmateMandate1 = async (req, res) => {
    try {
        const { inmate_id: inmateId, name, email, phone, maxAmount } = req.body;

        let customer;

        // 1️⃣ Try creating customer
        try {
            customer = await razorpay.customers.create({ name, email, contact: phone });
        } catch (err) {
            if (err.error && err.error.code === "BAD_REQUEST_ERROR" &&
                err.error.description.includes("Customer already exists")) {

                const existingCustomer = await InmatePaymentMandate.findOne({ inmateId });
                if (!existingCustomer) {
                    return res.status(400).json({ success: false, message: "Customer already exists. Please use existing record." });
                }
                customer = { id: existingCustomer.customerId };
            } else {
                throw err;
            }
        }


        // 2️⃣ Create subscription registration mandate (pending)
        const mandate = await razorpay.subscriptions.create({
            plan_id: "plan_RTiEo2ywGXgp5k",
            customer_notify: 1,
            customer_id: customer.id,
            total_count: 12
        });


        // 3️⃣ Save in DB as pending
        const saved = await InmatePaymentMandate.create({
            inmateId,
            customerId: customer.id,
            mandateId: mandate.id,
            maxAmount,
            isActive: false, // pending approval
            status: 'pending'
        });



        // 4️⃣ Return approval link
        res.json({
            success: true,
            message: "Mandate created. Please approve from UPI app once.",
            mandateId: mandate.id,
            customerId: customer.id,
            approvalUrl: mandate.short_url
        });
    } catch (err) {
        logError("createInmateMandate1 error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

const createInmateMandate2 = async (req, res) => {
    try {
        const { name, email, phone: contact } = req.body;

        if (!name || !email || !contact) {
            return res.status(400).json({
                success: false,
                message: "Name, email, and contact are required."
            });
        }

        // 1. Customer Fetch-or-Create (✅ Perfect)
        let customer;
        try {
            const customers = await razorpay.customers.all({ contact: contact });

            if (customers.items.length > 0) {
                customer = customers.items[0];
            } else {
                customer = await razorpay.customers.create({
                    name, email, contact,
                });
            }
        } catch (e) {
            throw new Error("Failed to process customer.");
        }

        // 🔥 ULTRA-SIMPLE MANDATE ORDER (NO CONFIG!)
        const order = await razorpay.orders.create({
            amount: 100, // ₹1 minimum
            currency: "INR",
            receipt: `mandate_${Date.now()}`,
            notes: {
                type: "tuckshop_mandate_setup"
            },
            customer_id: customer.id
            // ⚡ NO payment/config block = MANDATE WORKS!
        });


        res.status(200).json({
            success: true,
            message: "Mandate setup order created.",
            orderId: order.id,
            customerId: customer.id,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID
        });

    } catch (err) {
        logError("createInmateMandate1 error:", err);
        res.status(500).json({
            success: false,
            message: err?.response?.data?.error?.description || err.message
        });
    }
};

const createInmateMandate3 = async (req, res) => {
    try {
        const { inmate_id, name, email, phone, maxAmount } = req.body;

        // Validate input fields
        if (!inmate_id || !name || !email || !phone || !maxAmount) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        // Validate maxAmount
        const maxAmountNum = parseInt(maxAmount);
        if (isNaN(maxAmountNum) || maxAmountNum < 100 || maxAmountNum > 50000) {
            return res.status(400).json({ success: false, message: 'maxAmount must be between 100 and 50000' });
        }

        // Check if mandate already exists for the inmate
        const existingMandate = await InmatePaymentMandate.findOne({ inmateId: inmate_id });
        if (existingMandate && existingMandate.isActive) {
            return res.status(400).json({ success: false, message: 'Active mandate already exists' });
        }

        // 1. Create or Fetch Customer
        let customer;
        const customers = await razorpay.customers.all({ contact: phone });
        if (customers.items.length > 0) {
            customer = customers.items[0];
        } else {
            customer = await razorpay.customers.create({ name, email, contact: phone });
        }

        // 2. Verify Plan Exists
        const planId = 'plan_RTiEo2ywGXgp5k'; // Your existing plan
        let plan;
        try {
            plan = await razorpay.plans.fetch(planId);

            // Access amount and currency from plan.item
            const planDetails = {
                id: plan.id,
                amount: plan.item.amount, // e.g., 10000 (₹100 in paise)
                currency: plan.item.currency, // e.g., INR
                period: plan.period,
                interval: plan.interval,
            };

            if (!plan || !plan.item) {
                return res.status(400).json({
                    success: false,
                    message: 'Plan not found or invalid. Please check the plan ID.',
                });
            }

            if (plan.item.currency !== 'INR') {
                return res.status(400).json({
                    success: false,
                    message: `Invalid plan configuration. Expected: currency=INR. Got: currency=${plan.item.currency}`,
                });
            }

            // Note: Plan amount (₹100) will be used as refundable token for mandate authentication
        } catch (planError) {
            logError("Error fetching plan:", planError);
            return res.status(500).json({
                success: false,
                message: 'Invalid or inaccessible plan ID: ' + (planError.error?.description || planError.message),
            });
        }

        // 3. Create Subscription (e-Mandate) with no upfront charge beyond authentication token
        const subscription = await razorpay.subscriptions.create({
            plan_id: planId,
            customer_id: customer.id,
            total_count: 364, // Large number for ongoing mandate
            customer_notify: 1,
            notes: {
                type: 'tuckshop_mandate_setup',
                inmate_id,
                max_amount: maxAmountNum,
            },
        });

        return res.json({
            success: true,
            subscriptionId: subscription.id,
            customerId: customer.id,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            shortUrl: subscription.short_url,
            authenticationNote: `₹${plan.item.amount / 100} token charge (refunded after approval)`,
        });
    } catch (error) {
        logError("Error creating mandate:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.error?.description || error.message || 'Failed to create mandate',
        });
    }
};

// Create Inmate Mandate (One-Time Approval)
const createInmateMandate = async (req, res) => {
    try {
        const { inmate_id, name, email, phone, maxAmount } = req.body;

        // Validate input fields
        if (!inmate_id || !name || !email || !phone || !maxAmount) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }
        // inmate_id is used as a raw Mongo filter value below (twice) -
        // require it to be a string so an operator object (e.g.
        // {"$ne": null}) can't match an arbitrary inmate/mandate instead
        // of erroring.
        if (typeof inmate_id !== "string") {
            return res.status(400).json({ success: false, message: 'inmate_id must be a valid inmate id' });
        }

        const locationFilter = getLocationFilterOrAbort(req, res);
        if (!locationFilter) return;
        // Scoped to the caller's own facility, same as every other
        // inmate lookup in this app - a request can't set up a mandate
        // against another facility's inmate just by sending that inmate's
        // business id.
        const inmateData = await inmateModel.findOne({ inmateId: inmate_id, ...locationFilter })
        if(!inmateData) return res.status(400).json({ success: false, message: 'please select valid inmateId' });
        if (!assertOwnRecordIfInmate(req, res, inmateData.inmateId)) return;

        // Validate maxAmount
        const maxAmountNum = parseInt(maxAmount);
        if (isNaN(maxAmountNum) || maxAmountNum < 100 || maxAmountNum > 50000) {
            return res.status(400).json({ success: false, message: 'maxAmount must be between 100 and 50000' });
        }

        // Check if mandate already exists for the inmate
        const existingMandate = await InmatePaymentMandate.findOne({ inmateId: inmate_id });
        if (existingMandate && existingMandate.isActive) {
            return res.status(400).json({ success: false, message: 'Active mandate already exists' });
        }

        // 1. Create or Fetch Customer
        let customer;
        const customers = await razorpay.customers.all({ contact: phone });
        if (customers.items.length > 0) {
            customer = customers.items[0];
        } else {
            customer = await razorpay.customers.create({ name, email, contact: phone });
        }

        // 2. Verify Plan Exists
        const planId = 'plan_RTiEo2ywGXgp5k'; // Your existing plan
        let plan;
        try {
            plan = await razorpay.plans.fetch(planId);

            const planDetails = {
                id: plan.id,
                amount: plan.item.amount, // e.g., 10000 (₹100 in paise)
                currency: plan.item.currency, // e.g., INR
                period: plan.period,
                interval: plan.interval,
            };

            if (!plan || !plan.item) {
                return res.status(400).json({
                    success: false,
                    message: 'Plan not found or invalid. Please check the plan ID.',
                });
            }

            if (plan.item.currency !== 'INR') {
                return res.status(400).json({
                    success: false,
                    message: `Invalid plan configuration. Expected: currency=INR. Got: currency=${plan.item.currency}`,
                });
            }
        } catch (planError) {
            logError("Error fetching plan:", planError);
            return res.status(500).json({
                success: false,
                message: 'Invalid or inaccessible plan ID: ' + (planError.error?.description || planError.message),
            });
        }

        // 3. Create Subscription (e-Mandate) with start_at and end_at
        // const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds (e.g., ~1739702040 for 01:34 PM IST, Oct 17, 2025)
        // const startTime = currentTime + 60; // Start 60 seconds from now
        // const endTime = 4765046400; // February 7, 2100, 00:00:00 UTC (max allowed)
        const currentTime = Math.floor(Date.now() / 1000);
        const startTime = currentTime + 60;
        const tenYearsInSeconds = 10 * 365 * 24 * 60 * 60;
        const endTime = startTime + tenYearsInSeconds;
        const subscription = await razorpay.subscriptions.create({
            plan_id: planId,
            customer_id: customer.id,
            start_at: startTime, // Start 60 seconds from now
            end_at: endTime, // End at max allowed time
            customer_notify: 1,
            notes: {
                type: 'tuckshop_mandate_setup',
                inmate_id,
                max_amount: maxAmountNum,
            },
        });

        return res.json({
            success: true,
            subscriptionId: subscription.id,
            customerId: customer.id,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            shortUrl: subscription.short_url,
            authenticationNote: `₹${plan.item.amount / 100} token charge (refunded after approval)`,
        });
    } catch (error) {
        logError("Error creating mandate:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.error?.description || error.message || 'Failed to create mandate',
        });
    }
};



// ADD THIS ROUTE
const saveMandate = async (req, res) => {
  try {
    const { inmate_id, subscriptionId, customerId, maxAmount } = req.body;

    if (!inmate_id || !subscriptionId || !customerId || !maxAmount) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    // inmate_id is used as a raw Mongo filter value below, and is stored
    // as-is on the created mandate document - require it to be a string.
    // subscriptionId/customerId are also used as raw Mongo/Razorpay-API
    // inputs below, so the same guard applies to them.
    if (
      typeof inmate_id !== "string" ||
      typeof subscriptionId !== "string" ||
      typeof customerId !== "string"
    ) {
      return res.status(400).json({ success: false, message: 'inmate_id, subscriptionId, and customerId must be valid strings' });
    }

    // Previously this endpoint never checked that inmate_id referred to a
    // real inmate at all, let alone one the caller is authorized to act
    // for - it went straight from "is this a non-empty string" to creating
    // the mandate record. Scoped to the caller's own facility, same as
    // createInmateMandate above.
    const locationFilter = getLocationFilterOrAbort(req, res);
    if (!locationFilter) return;
    const inmateData = await inmateModel.findOne({ inmateId: inmate_id, ...locationFilter });
    if (!inmateData) {
      return res.status(400).json({ success: false, message: 'please select valid inmateId' });
    }
    if (!assertOwnRecordIfInmate(req, res, inmateData.inmateId)) return;

    // Verify subscription status with Razorpay - the client-asserted
    // "this mandate is approved" claim is never trusted directly; the
    // actual status is always re-fetched from Razorpay's own API.
    const subscription = await razorpay.subscriptions.fetch(subscriptionId);
    if (subscription.status !== 'authenticated') {
      return res.status(400).json({ success: false, message: 'Mandate not active' });
    }
    // The subscription must also actually belong to the customerId the
    // client is asserting it belongs to - otherwise a caller could submit
    // a real, "authenticated" subscription id that belongs to a totally
    // different customer/mandate and have it saved as if it were theirs.
    if (subscription.customer_id !== customerId) {
      return res.status(400).json({ success: false, message: 'Mandate does not belong to this customer' });
    }

    const existingMandate = await InmatePaymentMandate.findOne({inmateId:inmate_id})
    if(existingMandate && existingMandate?.isActive) return res.status(500).send({success:false,message:"already approved"})
    // Save mandate to database
    const mandate = await InmatePaymentMandate.create({
      inmateId: inmate_id,
      customerId,
      mandateId: subscriptionId, // Use subscription ID as mandate ID
      maxAmount: parseInt(maxAmount),
      isActive: true,
    });

    return res.json({
      success: true,
      message: 'Mandate saved successfully',
      mandateId: subscriptionId,
    });
  } catch (error) {
    logError("Error saving mandate:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};



module.exports = {
    createInmateMandate, saveMandate
}