# EU Pay QA Test Plan — Comprehensive Strategy & Webhook Flow Specification

**Project:** EU Pay Payment Processing & Merchant API  
**Author:** QA Engineering Intern  
**Date:** 11 October 2026  
**Status:** Approved / Executed  
**Test Suite Runner:** Node.js Native Test Runner (`node --test`) + Supertest  

---

## 1. Executive Summary & Test Scope

This test plan defines the end-to-end quality assurance strategy for the EU Pay Core Payment API, focusing on functional correctness, security verification, idempotency, real-time messaging, and regression resilience.

### In-Scope
- **Authentication & Authorization:** JWT issuance, token verification, merchant isolation, input validation (RFC email compliance, password strength).
- **Payment Processing:** Payment creation, data type integrity (numeric precision vs string coercion), AML/risk limits (€50,000 threshold), boundary cases, currency whitelisting (`EUR`, `USD`, `GBP`).
- **Webhook Subsystem:** Provider payment status updates (Powens simulation), HMAC-SHA256 cryptographic signature validation, replay attack prevention, and idempotency guarantees.
- **Table Orders (Socket.IO + REST):** Dine-in order placement, duplicate pending order prevention per table, line item aggregation, status state transitions, and real-time Socket.IO room broadcast events (`new_order`, `order_status_changed`).
- **E-Invoicing (Seqino PDP Simulation):** Tax authority transmission, 14-digit French SIRET validation, submission deduplication, and transmission status tracking.
- **Security & Error Handling:** Injection safety, malformed JSON resilience, unauthenticated/unauthorized access blocking (401/403).

### Out-of-Scope
- Real money movements via live banking rails (Bridge, Powens production AIS/PIS).
- Live submissions to the French General Directorate of Public Finance (DGFiP) / live Seqino production PDP.
- Frontend mobile UI testing (Flutter client application) and web UI (Next.js 14).
- Distributed multi-node performance / load testing (tested locally up to concurrency thresholds).

---

## 2. Test Environment & Architecture

| Component | Test Environment Specification |
| :--- | :--- |
| **Runtime** | Node.js v22.14.0 (ESM, `--test` native runner) |
| **Web Server** | Express 4.18.2 with HTTP server and Socket.IO 4.7.2 |
| **API Client** | Supertest 6.3.4 (in-process ephemeral HTTP testing) |
| **Mocking & Isolation** | In-memory database reset & isolated per test run; crypto HMAC helpers |
| **Secrets Under Test** | `JWT_SECRET`: `'test-secret-key-do-not-use-in-production'`, `WEBHOOK_SECRET`: `'test-webhook-secret-key'` |

---

## 3. Webhook Payment Flow Testing Matrix

Webhooks represent the most critical integration point because external Payment Service Providers (PSPs like Powens) report asynchronous payment outcomes. Spoofed or duplicate webhooks can cause catastrophic financial loss (e.g. shipping goods for unpaid orders).

### Detailed Webhook Scenarios (12 Core Scenarios)

| ID | Scenario | Input / Precondition | Expected Status | Expected Outcome / Assertion |
| :--- | :--- | :--- | :--- | :--- |
| **WH-01** | Valid Webhook with Authentic HMAC Signature | Valid `payment_id`, `status: "completed"`, `event_id`, signed with `WEBHOOK_SECRET` | `200 OK` | Payment updated to `completed`, `webhook_received_at` set, `event_id` recorded in `processed_webhooks`. |
| **WH-02** | Webhook with Missing Signature Header | Same valid payload, but omitting `x-webhook-signature` header | `401 Unauthorized` | Rejected immediately with `{ error: "Invalid signature" }`. Payment status untouched. |
| **WH-03** | Webhook with Forged / Invalid Signature | Valid payload with tampered signature string | `401 Unauthorized` | Rejected immediately; payment record in database remains in original state. |
| **WH-04** | Webhook Replay / Duplicate Delivery (Idempotency) | Re-sending identical payload and `event_id` after successful WH-01 | `200 OK` | Returns `{ message: "Already processed" }`; status is not re-mutated or re-emitted. |
| **WH-05** | Webhook for Non-Existent Payment | Valid signature and payload with `payment_id: "999999"` | `404 Not Found` | Rejects with `{ error: "Payment not found" }`. |
| **WH-06** | Webhook Missing Required Fields | Payload omitting `payment_id` or `status` with valid signature | `400 Bad Request` | Returns validation error: `{ error: "payment_id and status required" }`. |
| **WH-07** | State Transition (Pending -> Failed -> Completed) | Sequential webhooks updating status for same payment | `200 OK` | Payment reflects latest valid status correctly. |
| **WH-08** | Concurrent Duplicate Webhooks (Race Condition) | 2 identical requests dispatched concurrently with same `event_id` | Exactly one processes | First returns 200 "Webhook processed", second returns 200 "Already processed". |
| **WH-09** | SQL Injection Payload in `payment_id` | `payment_id: "1' OR '1'='1"`, signed with HMAC | `404 Not Found` | Handled safely by exact key matching without database syntax errors. |
| **WH-10** | Timing Attack Resistance | Signatures with varying character matches | `401 Unauthorized` | Consistent signature validation response without timing leakage. |
| **WH-11** | Malformed JSON in Webhook Body | Body containing corrupted JSON bytes | `400 Bad Request` | Express JSON body-parser rejects request cleanly without server crash. |
| **WH-12** | E-Invoice Tax Authority Callback | POST `/api/webhooks/e-invoice` with `invoice_id`, `status: "accepted"` | `200 OK` | Updates `einvoice_status`, records `tax_authority_id` and `submitted_at`. |

---

## 4. End-to-End Functional Test Modules

### A. Authentication & Merchant Management
- **Registration (Happy Path):** Valid RFC email, password >= 8 characters, business name. Expects `201 Created` with JWT token.
- **Email Syntax Validation (Bug C Regression):** Rejects emails without top-level domains (`user@domain`, `admin@localhost`).
- **Password Strength:** Rejects passwords with length < 8 chars with `400 Bad Request`.
- **Deduplication:** Duplicate email registration returns `409 Conflict`.
- **Login Verification:** Valid credentials return `200 OK` with valid JWT token signed with HS256. Invalid credentials return `401 Unauthorized`.

### B. Payment API
- **Amount Type Representation (Bug A Regression):** GET `/api/payments` and GET `/api/payments/:id` return `amount` as numeric float/number (not string).
- **Maximum Transaction Ceiling (Bug B Regression):** Rejects amounts > €50,000 with `400 Bad Request` mentioning maximum limit.
- **Boundary Tests:**
  - Amount = €50,000.00: accepted (`201 Created`).
  - Amount = €50,000.01: rejected (`400 Bad Request`).
  - Amount <= 0: rejected (`400 Bad Request`).
- **Currency & Customer Email Validation:** Enforces supported currencies (`EUR`, `USD`, `GBP`) and email formatting.
- **Merchant Isolation:** Rejects cross-tenant access to another merchant's payment with `403 Forbidden`.

### C. Table Orders & Socket.IO
- **Order Placement:** Computes sum of line item `(price * quantity)`. Returns `201 Created`.
- **Duplicate Prevention (Bug F Regression):** Rejects new order if target table already has an active `pending` order (`409 Conflict`). Allows new orders once previous order transitions to `served` or `cancelled`.
- **Input Validation:** Enforces non-empty items array and required merchant/table identifiers.
- **Status Progression:** Validates transitions through `confirmed`, `preparing`, `ready`, `served`, `cancelled`.
- **Real-Time WebSockets:**
  - Verifies clients join `merchant_${id}` and `table_${number}` rooms.
  - Verifies `new_order` event broadcast on order placement.
  - Verifies `order_status_changed` event broadcast on status transition.

### D. E-Invoicing & B2B Tax Compliance
- **Submission (Happy Path):** Authenticated merchant submits invoice with 14-digit French SIRET. Generates `SUB-...` submission UUID.
- **Duplicate Submission (Bug G Regression):** Rejects re-submission of invoices with `submitted` or `accepted` status (`409 Conflict`).
- **SIRET Format Validation:** Enforces exactly 14 numeric digits (`/^\d{14}$/`). Rejects alphanumeric or invalid length inputs.
- **Status Query:** Returns submission metadata, tax authority identifiers, and submission timestamps.

---

## 5. Security & Risk Assessment

| Risk Vector | Severity | Mitigation & Verification |
| :--- | :--- | :--- |
| **Unauthenticated Webhook Spoofing** | Critical | Enforced HMAC-SHA256 signature verification matching provider shared secret. |
| **Webhook Replay / Double Credit** | High | Implemented idempotent event tracking via `db.processed_webhooks`. |
| **Cross-Tenant Data Leakage** | High | Strict `merchant_id === req.user.id` verification returning `403 Forbidden`. |
| **Uncapped Payment Creation** | High | Hardcoded risk limit of €50,000 per transaction enforced before database write. |
| **Invalid Email Domain Exploitation** | Medium | RFC-aligned email validation regex requiring valid domain and TLD (`.[a-zA-Z]{2,}`). |
| **Concurrent Kitchen Duplication** | Medium | Table status lock: rejects duplicate pending orders per table (`409 Conflict`). |
| **Duplicate Tax Authority Invoicing** | Medium | Submission idempotency check preventing duplicate tax penalties (`409 Conflict`). |

---

## 6. Execution & Automation

All test suites are automated using Node.js's native test runner and Supertest:
```bash
# Execute entire test suite
npm test

# Verify all 7 bugs are fixed (reports 0/7 remaining bugs)
npm run verify-bugs
```
The automated test suite runs 56 tests in ~1.3 seconds with 100% pass rate.
