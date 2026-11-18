// Payment provider adapter for booking payments.
//
// Same mock-first pattern as the Google/email adapters: works with zero config
// so paid-booking flows are fully testable, and a real gateway drops in behind
// the same interface later.
//
//   * MOCK (default) — no provider configured, or PAYMENT_PROVIDER=mock. Payment
//     "succeeds" instantly with a synthetic id. NO real money moves.
//   * REAL (stub)    — when PAYMENT_PROVIDER names a gateway (e.g. razorpay) and
//     PAYMENT_KEY_ID/PAYMENT_KEY_SECRET are set. Not implemented yet: creating a
//     real order + verifying the provider webhook is the remaining integration.
//
// Config (env): PAYMENT_PROVIDER=mock|razorpay, PAYMENT_KEY_ID, PAYMENT_KEY_SECRET.

const crypto = require('crypto');

const MODE = String(process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

function isConfigured() {
  return MODE !== 'mock' && !!(process.env.PAYMENT_KEY_ID && process.env.PAYMENT_KEY_SECRET);
}
function providerName() {
  return isConfigured() ? MODE : 'mock';
}

/**
 * Create a payment intent for a booking.
 * @returns {Promise<{provider:string, providerIntentId:string, checkoutUrl:string|null, autoSucceed:boolean, status:string}>}
 */
async function createIntent({ amountMinor, currency = 'INR', idempotencyKey, bookingRef } = {}) {
  if (!isConfigured()) {
    // Mock: no checkout page, settles immediately.
    return {
      provider: 'mock',
      providerIntentId: `mock_int_${crypto.randomUUID()}`,
      checkoutUrl: null,
      autoSucceed: true,
      status: 'succeeded',
    };
  }
  // Real provider: create an order and return a hosted checkout URL; the booking
  // is confirmed only when the provider webhook reports success.
  throw new Error(`Payment provider "${MODE}" is not implemented yet. Set PAYMENT_PROVIDER=mock, or add the ${MODE} integration.`);
}

/** Settle a mock payment (records a synthetic successful charge). */
async function settleMock({ amountMinor, currency = 'INR' }) {
  return {
    provider: 'mock',
    providerPaymentId: `mock_pay_${crypto.randomUUID()}`,
    status: 'paid',
    amountMinor,
    currency,
  };
}

/** Verify + parse a real provider webhook. Returns null in mock mode. */
function verifyWebhook(/* req */) {
  if (!isConfigured()) return null;
  // Real providers verify an HMAC signature over the raw body here.
  return null;
}

module.exports = { isConfigured, providerName, createIntent, settleMock, verifyWebhook };
