# EU Pay QA Bug Reports — Intentional & Discovered Defects

**Repository:** https://github.com/European-pay/qa-engineer-test  
**Author:** QA Engineering Intern  
**Date:** 11 October 2026  
**Total Confirmed Bugs Documented:** 7 Intentional Bugs + 1 Environment Seed Bug  

---

## Summary Matrix

| Bug ID | Component | Severity | Location | Defect Summary | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Bug A** | Payment API | Medium | `src/routes/payment.routes.js:16, 52` | Payment amount returned as string instead of numeric float | **Fixed & Verified** |
| **Bug B** | Payment API | High | `src/routes/payment.routes.js:75-78` | Missing maximum payment transaction amount limit (€50,000) | **Fixed & Verified** |
| **Bug C** | Auth API | Medium | `src/routes/auth.routes.js:10-14` | Permissive regex permits invalid emails without TLD (`user@domain`) | **Fixed & Verified** |
| **Bug D** | Webhooks | Critical | `src/routes/webhook.routes.js:21-33` | Missing HMAC-SHA256 signature verification allows webhook spoofing | **Fixed & Verified** |
| **Bug E** | Webhooks | High | `src/routes/webhook.routes.js:38-45` | Missing webhook idempotency allows duplicate status processing | **Fixed & Verified** |
| **Bug F** | Table Orders | Medium | `src/routes/table-order.routes.js:44-56` | Missing duplicate order check allows multiple pending orders for one table | **Fixed & Verified** |
| **Bug G** | E-Invoicing | Medium | `src/routes/einvoice.routes.js:50-59` | Missing duplicate submission check allows re-submitting submitted invoices | **Fixed & Verified** |
| **Env Bug**| Seed Database | High | `src/db/database.js:19` | Seeded merchant password has invalid dummy bcrypt hash; login fails | **Fixed & Verified** |

---

## Detailed Bug Reports

### Bug A: Payment Amount Data Type Returned as String

- **Location:** `src/routes/payment.routes.js` (lines 16, 52)
- **Severity:** Medium
- **Component:** Payment API
- **How to Reproduce:**
  1. Authenticate as merchant: `POST /api/auth/login` with `{"email":"merchant@test.com","password":"Test123!"}`
  2. Request payment list: `GET /api/payments` with `Authorization: Bearer <token>`
  3. Inspect `data[0].amount` in response.
- **Expected Behavior:**
  The `amount` property should be returned as a numeric floating-point number (e.g. `25.5` with `typeof amount === "number"`).
- **Actual Behavior:**
  The `amount` property was returned as a string (`"25.5"` with `typeof amount === "string"`).
- **Impact:**
  Client applications (web dashboards, Flutter mobile app) performing calculations (totals, currency conversions, charts) encounter `NaN` errors or incorrect string concatenations (`"25.5" + 10 = "25.510"` instead of `35.5`).
- **Root Cause:**
  Lines 16 and 52 explicitly invoked `.toString()` on `p.amount` and `payment.amount`.
- **Applied Fix:**
  Replaced `.toString()` with `parseFloat(p.amount)` and `parseFloat(payment.amount)`.
- **Regression Test:**
  `src/routes/__tests__/payment.routes.test.js`:
  - `PAYMENTS: Bug A Regression - GET /api/payments returns amount as number`
  - `PAYMENTS: Bug A Regression - GET /api/payments/:id returns amount as number`

---

### Bug B: Missing Maximum Payment Amount Validation Limit

- **Location:** `src/routes/payment.routes.js` (lines 75-78)
- **Severity:** High
- **Component:** Payment API
- **How to Reproduce:**
  1. Authenticate as merchant to obtain JWT.
  2. Send `POST /api/payments` with payload:
     ```json
     {
       "amount": 999999999,
       "currency": "EUR",
       "customer_email": "customer@test.com"
     }
     ```
  3. Observe response status code.
- **Expected Behavior:**
  API should reject transactions exceeding the business and Anti-Money Laundering (AML) ceiling of €50,000 with `400 Bad Request` and an error indicating maximum limit exceeded.
- **Actual Behavior:**
  API accepted the request with `201 Created` and generated a payment record for €999,999,999.00.
- **Impact:**
  Catastrophic risk of financial fraud, unbounded liability, and regulatory non-compliance with European AML transaction threshold mandates.
- **Root Cause:**
  Only minimum amount (`amount <= 0`) was validated; no upper bound check was implemented.
- **Applied Fix:**
  Enforced limit check in `src/routes/payment.routes.js`:
  ```javascript
  if (amount > 50000) {
    return res.status(400).json({ error: 'Amount exceeds maximum allowed limit of €50,000' });
  }
  ```
- **Regression Test:**
  `src/routes/__tests__/payment.routes.test.js`:
  - `PAYMENTS: Bug B Regression - POST /api/payments rejects amount over €50,000`
  - `PAYMENTS: Bug B Boundary - POST /api/payments rejects €50,000.01`
  - `PAYMENTS: Bug B Boundary - POST /api/payments accepts max boundary €50,000.00`

---

### Bug C: Permissive Email Validation Regex Permitting TLD-less Emails

- **Location:** `src/routes/auth.routes.js` (lines 10-14)
- **Severity:** Medium
- **Component:** Auth API
- **How to Reproduce:**
  1. Send `POST /api/auth/register` with payload:
     ```json
     {
       "email": "user@domain",
       "password": "SecurePassword123!",
       "business_name": "Test Company"
     }
     ```
- **Expected Behavior:**
  HTTP `400 Bad Request` with `{ "error": "Invalid email format" }` because `"user@domain"` lacks a top-level domain (TLD).
- **Actual Behavior:**
  HTTP `201 Created` — merchant account successfully created with an undeliverable email address.
- **Impact:**
  Merchants register with invalid email addresses, breaking transactional email notifications, two-factor authentication (2FA), password reset links, and compliance verification.
- **Root Cause:**
  Regex `/^[^\s@]+@[^\s@]+$/` only checks for an `@` symbol with surrounding non-whitespace characters, completely ignoring domain suffixes.
- **Applied Fix:**
  Replaced with an RFC-compliant regex requiring domain and TLD:
  ```javascript
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  ```
- **Regression Test:**
  `src/routes/__tests__/auth.routes.test.js`:
  - `AUTH: Bug C Regression - POST /api/auth/register rejects email without TLD`
  - `AUTH: POST /api/auth/register accepts valid RFC email with domain and TLD`

---

### Bug D: Missing HMAC-SHA256 Webhook Signature Verification

- **Location:** `src/routes/webhook.routes.js` (lines 21-33)
- **Severity:** Critical
- **Component:** Webhook Subsystem
- **How to Reproduce:**
  1. Send `POST /api/webhooks/payment-status` with no `x-webhook-signature` header:
     ```json
     {
       "payment_id": "1",
       "status": "completed",
       "event_id": "evt_spoofed"
     }
     ```
- **Expected Behavior:**
  HTTP `401 Unauthorized` with `{ "error": "Invalid signature" }`.
- **Actual Behavior:**
  HTTP `200 OK` with `{ "message": "Webhook processed" }`, mutating payment status to `completed`.
- **Impact:**
  Severe vulnerability: An unauthenticated attacker can forge payment status notifications, marking fraudulent or unpaid orders as `completed` without payment ever being received.
- **Root Cause:**
  HMAC signature verification logic was commented out in `webhook.routes.js`.
- **Applied Fix:**
  Uncommented and enforced HMAC-SHA256 signature verification against `WEBHOOK_SECRET` with `crypto.createHmac`.
- **Regression Test:**
  `src/routes/__tests__/webhook.routes.test.js`:
  - `WEBHOOKS: Bug D Regression - Rejects payment webhook without signature`
  - `WEBHOOKS: Bug D Regression - Rejects payment webhook with forged signature`
  - `WEBHOOKS: Bug D Acceptance - Accepts payment webhook with valid HMAC-SHA256 signature`

---

### Bug E: Missing Webhook Idempotency Check

- **Location:** `src/routes/webhook.routes.js` (lines 38-45, 55-57)
- **Severity:** High
- **Component:** Webhook Subsystem
- **How to Reproduce:**
  1. Send valid signed webhook to `POST /api/webhooks/payment-status` with `event_id: "evt_100"`.
  2. Send identical request again with the exact same `event_id: "evt_100"`.
- **Expected Behavior:**
  First request processes with 200. Second request detects duplicate `event_id` and responds idempotently with `200 OK` and `{ "message": "Already processed" }` without re-processing state.
- **Actual Behavior:**
  Both requests returned `{ "message": "Webhook processed" }`, overwriting timestamps and re-processing the event.
- **Impact:**
  External PSP network retries cause redundant webhook processing, race conditions, double event triggers, and distorted audit history.
- **Root Cause:**
  `db.processed_webhooks.includes(event_id)` check and tracking were commented out.
- **Applied Fix:**
  Activated `db.processed_webhooks` array lookup and record tracking.
- **Regression Test:**
  `src/routes/__tests__/webhook.routes.test.js`:
  - `WEBHOOKS: Bug E Regression - Webhook idempotency prevents duplicate processing`

---

### Bug F: Missing Duplicate Table Order Prevention

- **Location:** `src/routes/table-order.routes.js` (lines 44-56)
- **Severity:** Medium
- **Component:** Table Orders
- **How to Reproduce:**
  1. Place table order: `POST /api/table-orders` for table `88`.
  2. Immediately place a second order for table `88` before the first order is served.
- **Expected Behavior:**
  Second request should be rejected with `409 Conflict`: `{ "error": "Table already has a pending order" }`.
- **Actual Behavior:**
  Second request succeeded with `201 Created`, creating multiple conflicting pending orders for the same table.
- **Impact:**
  Kitchen staff receive duplicate orders, leading to food waste, customer double-charging, and table billing discrepancies.
- **Root Cause:**
  Validation check querying `existingOrder` with status `'pending'` was commented out.
- **Applied Fix:**
  Uncommented pending order check for `table_number` and `merchant_id`.
- **Regression Test:**
  `src/routes/__tests__/table-order.routes.test.js`:
  - `TABLE-ORDERS: Bug F Regression - Rejects duplicate pending order for same table`
  - `TABLE-ORDERS: Allows new order once previous table order is served/completed`

---

### Bug G: Missing Duplicate E-Invoice Submission Prevention

- **Location:** `src/routes/einvoice.routes.js` (lines 50-59)
- **Severity:** Medium
- **Component:** E-Invoicing
- **How to Reproduce:**
  1. Submit invoice: `POST /api/einvoice/submit` for `invoice_id: "inv_123"`.
  2. Re-submit the same invoice: `POST /api/einvoice/submit` for `invoice_id: "inv_123"`.
- **Expected Behavior:**
  Second submission should be rejected with `409 Conflict`: `{ "error": "Invoice already submitted to tax authority" }`.
- **Actual Behavior:**
  Second submission succeeded with `200 OK`, generating a new `submission_id` and overwriting submission metadata.
- **Impact:**
  Tax authority API (Seqino / DGFiP) receives duplicate invoices, triggering compliance fines, duplicate VAT records, and tax portal rejections.
- **Root Cause:**
  Duplicate submission check `invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted'` was commented out.
- **Applied Fix:**
  Uncommented duplicate submission status check in `einvoice.routes.js`.
- **Regression Test:**
  `src/routes/__tests__/einvoice.routes.test.js`:
  - `EINVOICE: Bug G Regression - Rejects duplicate submission of already submitted invoice`

---

### Auxiliary Bug: Seed Merchant Password Hash Invalid

- **Location:** `src/db/database.js` (line 19)
- **Severity:** High (Setup & Verification Blocker)
- **Component:** Database Seeding
- **How to Reproduce:**
  1. Run `npm start`.
  2. Follow README instruction: `POST /api/auth/login` with `{"email":"merchant@test.com","password":"Test123!"}`.
  3. Returns `401 Unauthorized: Invalid credentials`.
- **Root Cause:**
  The seeded hash `$2a$10$8Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9` was a mocked dummy string with repeated substrings that did not match `Test123!`.
- **Applied Fix:**
  Replaced dummy hash with authentic bcrypt hash for `Test123!`: `$2a$10$kiOcfHkD9PjceRfNWETTvett8RB3sRAlNJriMT4AMCNPJr0SSycDu`.
- **Regression Test:**
  `src/routes/__tests__/auth.routes.test.js`:
  - `AUTH: POST /api/auth/login succeeds with valid seed credentials`
