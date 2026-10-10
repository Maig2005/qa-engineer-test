import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../server.js';
import { db } from '../../db/database.js';

const JWT_SECRET = 'test-secret-key-do-not-use-in-production';

function getMerchantToken(id = '1', email = 'merchant@test.com') {
  return jwt.sign({ id, email, type: 'merchant' }, JWT_SECRET, { expiresIn: '1h' });
}

test('EINVOICE: POST /api/einvoice/submit submits invoice to tax authority', async () => {
  const token = getMerchantToken('1');
  const invoiceId = `inv_valid_${Date.now()}`;
  const validSiret = '12345678901234'; // 14 digits

  const response = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: validSiret
    });

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.message, 'Invoice submitted to tax authority');
  assert.strictEqual(response.body.data.invoice_id, invoiceId);
  assert.strictEqual(response.body.data.status, 'submitted');
  assert.ok(response.body.data.submission_id.startsWith('SUB-'));
});

test('EINVOICE: Bug G Regression - Rejects duplicate submission of already submitted invoice', async () => {
  const token = getMerchantToken('1');
  const invoiceId = `inv_dupe_${Date.now()}`;
  const validSiret = '12345678901234';

  // First submission
  const firstRes = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: validSiret
    });
  assert.strictEqual(firstRes.status, 200);

  // Duplicate second submission
  const secondRes = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: validSiret
    });

  assert.strictEqual(secondRes.status, 409);
  assert.ok(
    secondRes.body.error.toLowerCase().includes('already submitted'),
    `Expected error about duplicate submission, got: ${secondRes.body.error}`
  );
});

test('EINVOICE: POST /api/einvoice/submit rejects invalid SIRET length (!== 14 digits)', async () => {
  const token = getMerchantToken('1');
  const invalidSirets = ['123', '1234567890123', '123456789012345', 'alphabet14char'];

  for (const siret of invalidSirets) {
    const response = await request(app)
      .post('/api/einvoice/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: `inv_siret_${Date.now()}`,
        customer_siret: siret
      });

    assert.strictEqual(response.status, 400, `Expected 400 for SIRET: ${siret}`);
    assert.ok(response.body.error.includes('14 digits'));
  }
});

test('EINVOICE: POST /api/einvoice/submit rejects missing invoice_id', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customer_siret: '12345678901234'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('invoice_id required'));
});

test('EINVOICE: POST /api/einvoice/submit requires authentication', async () => {
  const response = await request(app)
    .post('/api/einvoice/submit')
    .send({
      invoice_id: 'inv_unauth',
      customer_siret: '12345678901234'
    });

  assert.strictEqual(response.status, 401);
});

test('EINVOICE: POST /api/einvoice/submit enforces merchant ownership (403)', async () => {
  // Create an invoice belonging to merchant '1'
  if (!db.invoices) db.invoices = [];
  const foreignInvoiceId = `inv_foreign_${Date.now()}`;
  db.invoices.push({
    id: foreignInvoiceId,
    merchant_id: '1',
    status: 'draft'
  });

  // Register merchant 2
  const reg = await request(app)
    .post('/api/auth/register')
    .send({
      email: `einvoice_other_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      business_name: 'Other E-Merchant'
    });
  const otherToken = reg.body.token;

  // Merchant 2 attempts to submit Merchant 1's invoice
  const response = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${otherToken}`)
    .send({
      invoice_id: foreignInvoiceId,
      customer_siret: '12345678901234'
    });

  assert.strictEqual(response.status, 403);
  assert.strictEqual(response.body.error, 'Access denied');
});

test('EINVOICE: GET /api/einvoice/status/:invoice_id returns submission status', async () => {
  const token = getMerchantToken('1');
  const invoiceId = `inv_status_check_${Date.now()}`;

  // First submit
  await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  // Now query status
  const response = await request(app)
    .get(`/api/einvoice/status/${invoiceId}`)
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.data.invoice_id, invoiceId);
  assert.strictEqual(response.body.data.einvoice_status, 'submitted');
  assert.ok(response.body.data.submission_id);
});

test('EINVOICE: GET /api/einvoice/status/:invoice_id returns 404 for unknown invoice', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .get('/api/einvoice/status/unknown_invoice_id')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.body.error, 'Invoice not found');
});

test('EINVOICE: GET /api/einvoice/status/:invoice_id enforces merchant isolation (403)', async () => {
  const invoiceId = `inv_iso_${Date.now()}`;
  db.invoices.push({
    id: invoiceId,
    merchant_id: '1',
    status: 'draft'
  });

  // Register another merchant
  const reg = await request(app)
    .post('/api/auth/register')
    .send({
      email: `other_iso_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      business_name: 'Iso Merchant'
    });
  const otherToken = reg.body.token;

  const response = await request(app)
    .get(`/api/einvoice/status/${invoiceId}`)
    .set('Authorization', `Bearer ${otherToken}`);

  assert.strictEqual(response.status, 403);
  assert.strictEqual(response.body.error, 'Access denied');
});
