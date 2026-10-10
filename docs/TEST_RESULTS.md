# EU Pay QA Test Results & Fixes Summary

**Repository:** https://github.com/European-pay/qa-engineer-test  
**Author:** QA Engineering Intern  
**Date:** 11 October 2026  
**Status:** All 7 Intentional Defects Fixed + 56 Automated Tests Passing  

---

## 1. Test Execution Summary

### Automated Test Suite (`npm test`)

```
TAP version 13
1..56
# tests 56
# suites 0
# pass 56
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1336.9
```

### Test Suite Breakdown

| Test Suite File | Component | Tests Run | Pass | Fail | Key Areas Verified |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `src/routes/__tests__/auth.routes.test.js` | Auth & JWT | 10 | 10 | 0 | Bug C regression (TLD check), registration, password rules, duplicate prevention, seed login, invalid credentials |
| `src/routes/__tests__/payment.routes.test.js` | Payment API | 13 | 13 | 0 | Bug A regression (numeric float amount), Bug B regression (max €50,000 limit), boundary checks, negative/zero amounts, currency filters, 403 isolation |
| `src/routes/__tests__/webhook.routes.test.js` | Webhook Subsystem | 9 | 9 | 0 | Bug D regression (HMAC signature required & checked), Bug E regression (idempotency by `event_id`), 404 payment lookup, e-invoice callbacks |
| `src/routes/__tests__/table-order.routes.test.js` | Table Orders | 11 | 11 | 0 | Bug F regression (duplicate pending order prevention), happy path creation, line item summation, status transitions, 403 merchant isolation |
| `src/routes/__tests__/einvoice.routes.test.js` | E-Invoicing | 9 | 9 | 0 | Bug G regression (duplicate submission prevention), 14-digit French SIRET validation, submission UUID creation, 403 merchant isolation |
| `src/routes/__tests__/socket.test.js` | Socket.IO | 4 | 4 | 0 | Socket room joining (`join_merchant`, `join_table`), `new_order` event emit on order creation, `order_status_changed` event emit on patch |
| **Total** | **All Modules** | **56** | **56** | **0** | **100% Pass Rate** |

---

## 2. Bug Verification Script Results (`npm run verify-bugs`)

The official bug verification script was executed after applying all fixes:

```
> eupay-qa-test@1.0.0 verify-bugs
> node scripts/verify-bugs.js

🔍 Verifying bugs are present in the codebase...

❌ Bug A missing: amount should be converted to string (incorrectly)
❌ Bug B already fixed: Maximum amount check is present
❌ Bug D already fixed: Signature verification is present
❌ Bug E already fixed: Idempotency check is present
❌ Bug F already fixed: Duplicate check is present
❌ Bug G already fixed: Duplicate submission check is present
❌ Bug C missing: Email regex should be permissive (buggy)

📊 Bugs found: 0/7
```

**Interpretation:** All 7 intentional bugs were detected as resolved/fixed in accordance with the verification script's exact regex heuristics.

---

## 3. Detailed Fix Documentation

### Fix 1 (Bug A): Payment Amount Data Type
- **Files Changed:** `src/routes/payment.routes.js` (lines 16, 52)
- **Code Changes:**
  ```javascript
  // Before
  amount: p.amount.toString(),
  amount: payment.amount.toString(),

  // After
  amount: parseFloat(p.amount),
  amount: parseFloat(payment.amount),
  ```
- **Rationale:** JavaScript financial calculations must preserve numeric data types. Strings cause concatenation bugs and `NaN` errors on client frontends.
- **Verification:** `GET /api/payments` returns `typeof amount === "number"`.

---

### Fix 2 (Bug B): Maximum Payment Amount Validation
- **Files Changed:** `src/routes/payment.routes.js` (lines 75-78)
- **Code Changes:**
  ```javascript
  // Before
  // Missing validation

  // After
  if (amount > 50000) {
    return res.status(400).json({ error: 'Amount exceeds maximum allowed limit of €50,000' });
  }
  ```
- **Rationale:** Prevents unrealistic payment amounts, accidental input errors, and regulatory AML non-compliance.
- **Verification:** `POST /api/payments` with amount `999999` returns `400 Bad Request` containing "maximum".

---

### Fix 3 (Bug C): Email Validation Requires Valid Domain and TLD
- **Files Changed:** `src/routes/auth.routes.js` (lines 10-14)
- **Code Changes:**
  ```javascript
  // Before
  const emailRegex = /^[^\s@]+@[^\s@]+$/;

  // After
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  ```
- **Rationale:** Rejects invalid emails lacking top-level domains such as `user@domain`, ensuring transactional emails can be delivered.
- **Verification:** `POST /api/auth/register` with `user@domain` returns `400 Bad Request`.

---

### Fix 4 (Bug D): HMAC-SHA256 Webhook Signature Verification
- **Files Changed:** `src/routes/webhook.routes.js` (lines 21-33)
- **Code Changes:**
  ```javascript
  // Before: Commented out signature check

  // After:
  if (!signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  ```
- **Rationale:** Prevents webhook spoofing by external attackers attempting to mark unconfirmed payments as completed.
- **Verification:** Unsigned or forged webhooks return `401 Unauthorized`; signed webhooks return `200 OK`.

---

### Fix 5 (Bug E): Webhook Idempotency Check
- **Files Changed:** `src/routes/webhook.routes.js` (lines 38-45, 55-57)
- **Code Changes:**
  ```javascript
  // Before: Commented out idempotency check

  // After:
  if (!db.processed_webhooks) {
    db.processed_webhooks = [];
  }

  if (event_id && db.processed_webhooks.includes(event_id)) {
    return res.status(200).json({ message: 'Already processed' });
  }
  ...
  if (event_id) {
    db.processed_webhooks.push(event_id);
  }
  ```
- **Rationale:** Webhooks are retried across networks. Deduplication ensures requests are processed exactly once.
- **Verification:** Subsequent delivery of identical `event_id` returns `200 OK` with `{ message: "Already processed" }`.

---

### Fix 6 (Bug F): Table Order Duplicate Prevention & Real-Time Socket Emission
- **Files Changed:** `src/routes/table-order.routes.js` (lines 44-56, 76-80, 120-128)
- **Code Changes:**
  ```javascript
  // Duplicate check:
  const existingOrder = (db.table_orders || []).find(
    o => o.merchant_id === merchant_id && 
         o.table_number === table_number && 
         o.status === 'pending'
  );
  if (existingOrder) {
    return res.status(409).json({ error: 'Table already has a pending order' });
  }

  // Socket.IO emission:
  const io = req.app.get('io');
  if (io) {
    io.to(`merchant_${merchant_id}`).emit('new_order', newOrder);
  }
  ```
- **Rationale:** Eliminates concurrent duplicate orders for dining tables and activates real-time restaurant displays.
- **Verification:** Second pending order returns `409 Conflict`. Socket client receives `new_order` and `order_status_changed`.

---

### Fix 7 (Bug G): E-Invoice Duplicate Submission Prevention & SIRET Format Enforcement
- **Files Changed:** `src/routes/einvoice.routes.js` (lines 43-48, 50-59)
- **Code Changes:**
  ```javascript
  // SIRET 14-digit validation:
  if (!customer_siret || !/^\d{14}$/.test(customer_siret)) {
    return res.status(400).json({ 
      error: 'Valid customer SIRET required for e-invoicing (14 digits)' 
    });
  }

  // Duplicate submission check:
  if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
    return res.status(409).json({ 
      error: 'Invoice already submitted to tax authority' 
    });
  }
  ```
- **Rationale:** Prevents repeat transmission penalties from tax authorities and validates B2B customer SIRET format.
- **Verification:** Re-submitting submitted invoice returns `409 Conflict`.

---

### Auxiliary Fix 8: Seed Merchant Password Hash
- **Files Changed:** `src/db/database.js` (line 19)
- **Code Changes:**
  ```javascript
  password: "$2a$10$kiOcfHkD9PjceRfNWETTvett8RB3sRAlNJriMT4AMCNPJr0SSycDu", // password: Test123!
  ```
- **Rationale:** Repaired invalid dummy hash allowing documented seed credentials (`merchant@test.com` / `Test123!`) to authenticate.

---

### Auxiliary Fix 9: Test Runner Port Concurrency & Listener Resilience
- **Files Changed:** `src/server.js` (lines 104-126)
- **Code Changes:**
  Added check preventing `httpServer.listen` from locking port 3000 during test runner execution, and added graceful `EADDRINUSE` handler.

---

## 4. Unresolved Limitations & Recommendations

1. **In-Memory Storage:** `src/db/database.js` stores records in RAM. For production readiness, migrate to a persistent database (PostgreSQL with Knex/Prisma/TypeORM).
2. **Environment Variable Configuration:** Secrets (`JWT_SECRET`, `WEBHOOK_SECRET`) should be loaded from `process.env` using `dotenv`.
3. **Webhook Timing Safe Comparison:** Use `crypto.timingSafeEqual` for constant-time HMAC comparison when buffers match length.
4. **Rate Limiting:** Implement Express rate-limiting middleware (`express-rate-limit`) on `/api/auth/login` to prevent brute-force attacks.
