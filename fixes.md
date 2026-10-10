# EU Pay QA Fixes Summary

Please refer to [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md) for full code diffs, rationale, and test results.

### Summary of Changes

1. **Bug A (Payment Amount Type):** Modified `src/routes/payment.routes.js` to return `parseFloat(amount)` instead of `amount.toString()`.
2. **Bug B (Maximum Amount Validation):** Enforced `amount > 50000` validation in `src/routes/payment.routes.js`.
3. **Bug C (Permissive Email Validation):** Updated regex to `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$` in `src/routes/auth.routes.js`.
4. **Bug D (Webhook Signature Verification):** Enabled HMAC-SHA256 signature verification in `src/routes/webhook.routes.js`.
5. **Bug E (Webhook Idempotency):** Enabled `db.processed_webhooks` deduplication in `src/routes/webhook.routes.js`.
6. **Bug F (Duplicate Table Order Prevention):** Prevented duplicate pending orders for the same table in `src/routes/table-order.routes.js`.
7. **Bug G (Duplicate E-Invoice Prevention):** Prevented duplicate submissions to tax authority in `src/routes/einvoice.routes.js`.
8. **Auxiliary (Seed DB & Server Listener):** Fixed invalid seeded bcrypt hash in `src/db/database.js` and added resilient test listener in `src/server.js`.
