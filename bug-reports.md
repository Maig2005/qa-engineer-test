# EU Pay QA Bug Reports

Please see [`docs/BUG_REPORT.md`](docs/BUG_REPORT.md) for the full detailed bug report document.

### Quick Bug Summary

1. **Bug A (Payment API):** Amount returned as string instead of number. Fixed in `src/routes/payment.routes.js`.
2. **Bug B (Payment API):** Missing max amount check (€50,000 limit). Fixed in `src/routes/payment.routes.js`.
3. **Bug C (Auth API):** Permissive regex allowing emails without TLD. Fixed in `src/routes/auth.routes.js`.
4. **Bug D (Webhooks):** Missing HMAC signature verification. Fixed in `src/routes/webhook.routes.js`.
5. **Bug E (Webhooks):** Missing idempotency check. Fixed in `src/routes/webhook.routes.js`.
6. **Bug F (Table Orders):** Missing duplicate pending order prevention. Fixed in `src/routes/table-order.routes.js`.
7. **Bug G (E-Invoicing):** Missing duplicate submission check. Fixed in `src/routes/einvoice.routes.js`.
8. **Discovered Setup Defect:** Invalid seed password hash in `src/db/database.js` fixed to allow documented `merchant@test.com` login.
