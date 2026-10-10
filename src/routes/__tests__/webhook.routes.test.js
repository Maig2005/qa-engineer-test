import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../server.js';
import { db } from '../../db/database.js';

const WEBHOOK_SECRET = 'test-webhook-secret-key';

function generateSignature(payload) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
}

test('WEBHOOKS: Bug D Regression - Rejects payment webhook without signature', async () => {
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: `evt_unsigned_${Date.now()}`
  };

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .send(payload);

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Invalid signature');
});

test('WEBHOOKS: Bug D Regression - Rejects payment webhook with forged signature', async () => {
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: `evt_forged_${Date.now()}`
  };

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    .send(payload);

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Invalid signature');
});

test('WEBHOOKS: Bug D Acceptance - Accepts payment webhook with valid HMAC-SHA256 signature', async () => {
  const payload = {
    payment_id: '2',
    status: 'completed',
    event_id: `evt_valid_${Date.now()}`
  };
  const signature = generateSignature(payload);

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.new_status, 'completed');

  const updatedPayment = db.payments.find(p => p.id === '2');
  assert.strictEqual(updatedPayment.status, 'completed');
  assert.ok(updatedPayment.webhook_received_at);
});

test('WEBHOOKS: Bug E Regression - Webhook idempotency prevents duplicate processing', async () => {
  const eventId = `evt_idempotency_${Date.now()}`;
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: eventId
  };
  const signature = generateSignature(payload);

  // First delivery
  const firstRes = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(firstRes.status, 200);
  assert.strictEqual(firstRes.body.message, 'Webhook processed');

  // Second duplicate delivery with identical event_id
  const secondRes = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(secondRes.status, 200);
  assert.strictEqual(secondRes.body.message, 'Already processed');
});

test('WEBHOOKS: Rejects webhook missing payment_id or status', async () => {
  const payload = {
    event_id: `evt_bad_${Date.now()}`
  };
  const signature = generateSignature(payload);

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('required'));
});

test('WEBHOOKS: Rejects webhook for non-existent payment with 404', async () => {
  const payload = {
    payment_id: '999999',
    status: 'completed',
    event_id: `evt_nonexistent_${Date.now()}`
  };
  const signature = generateSignature(payload);

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.body.error, 'Payment not found');
});

test('WEBHOOKS: POST /api/webhooks/e-invoice updates tax authority status', async () => {
  // Ensure an invoice exists in db
  if (!db.invoices) db.invoices = [];
  const invoiceId = `inv_hook_${Date.now()}`;
  db.invoices.push({
    id: invoiceId,
    merchant_id: '1',
    status: 'pending',
    einvoice_status: 'submitted'
  });

  const payload = {
    invoice_id: invoiceId,
    status: 'accepted',
    submission_id: 'SUB-12345',
    tax_authority_id: 'FR-TAX-98765'
  };

  const response = await request(app)
    .post('/api/webhooks/e-invoice')
    .send(payload);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.status, 'accepted');

  const updatedInvoice = db.invoices.find(i => i.id === invoiceId);
  assert.strictEqual(updatedInvoice.einvoice_status, 'accepted');
  assert.strictEqual(updatedInvoice.tax_authority_id, 'FR-TAX-98765');
});

test('WEBHOOKS: POST /api/webhooks/e-invoice returns 404 for non-existent invoice', async () => {
  const response = await request(app)
    .post('/api/webhooks/e-invoice')
    .send({
      invoice_id: 'non_existent_invoice',
      status: 'rejected'
    });

  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.body.error, 'Invoice not found');
});

test('WEBHOOKS: POST /api/webhooks/e-invoice rejects missing required fields', async () => {
  const response = await request(app)
    .post('/api/webhooks/e-invoice')
    .send({});

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('required'));
});
