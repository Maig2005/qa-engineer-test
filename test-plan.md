# EU Pay QA Test Plan — Webhook & Payment API Testing Strategy

Please refer to [`docs/QA_TEST_PLAN.md`](docs/QA_TEST_PLAN.md) for the complete, comprehensive QA Test Plan document.

### Webhook Payment Flow Highlights

1. **Test Scope**: End-to-end webhook handling for external PSP status updates (Powens simulation) and tax authority callbacks (Seqino simulation).
2. **Security Controls**: HMAC-SHA256 signature verification via `x-webhook-signature` using `WEBHOOK_SECRET`.
3. **Idempotency Guarantees**: Event deduplication via `event_id` against `db.processed_webhooks`. Duplicate delivery returns 200 with `{ message: "Already processed" }`.
4. **Scenarios Covered**:
   - Valid signature verification
   - Missing signature header rejection (401)
   - Forged/invalid signature rejection (401)
   - Duplicate event delivery prevention
   - Non-existent payment rejection (404)
   - Missing required payload parameters rejection (400)
   - E-invoice tax authority callbacks (200)
   - Non-existent invoice callback rejection (404)
   - Missing e-invoice parameters rejection (400)
   - Cross-merchant authorization checks (403)
