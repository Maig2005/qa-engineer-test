import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../server.js';

const JWT_SECRET = 'test-secret-key-do-not-use-in-production';

function getMerchantToken(id = '1', email = 'merchant@test.com') {
  return jwt.sign({ id, email, type: 'merchant' }, JWT_SECRET, { expiresIn: '1h' });
}

test('PAYMENTS: Bug A Regression - GET /api/payments returns amount as number', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .get('/api/payments')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 200);
  assert.ok(Array.isArray(response.body.data));
  assert.ok(response.body.data.length > 0);

  const payment = response.body.data[0];
  assert.strictEqual(
    typeof payment.amount,
    'number',
    `Expected amount to be numeric, got ${typeof payment.amount}`
  );
  assert.strictEqual(payment.amount, 25.5);
});

test('PAYMENTS: Bug A Regression - GET /api/payments/:id returns amount as number', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .get('/api/payments/1')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(
    typeof response.body.data.amount,
    'number',
    `Expected amount to be numeric, got ${typeof response.body.data.amount}`
  );
  assert.strictEqual(response.body.data.amount, 25.5);
});

test('PAYMENTS: Bug B Regression - POST /api/payments rejects amount over €50,000', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 999999,
      currency: 'EUR',
      customer_email: 'customer@test.com'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(
    response.body.error.toLowerCase().includes('maximum'),
    `Expected error to mention maximum limit, got: ${response.body.error}`
  );
});

test('PAYMENTS: Bug B Boundary - POST /api/payments rejects €50,000.01', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 50000.01,
      currency: 'EUR',
      customer_email: 'boundary@test.com'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.toLowerCase().includes('maximum'));
});

test('PAYMENTS: Bug B Boundary - POST /api/payments accepts max boundary €50,000.00', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 50000.00,
      currency: 'EUR',
      customer_email: 'maxvalid@test.com'
    });

  assert.strictEqual(response.status, 201);
  assert.strictEqual(response.body.data.amount, 50000);
  assert.strictEqual(typeof response.body.data.amount, 'number');
});

test('PAYMENTS: POST /api/payments creates payment with valid data', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 149.99,
      currency: 'EUR',
      customer_email: 'shopper@test.com'
    });

  assert.strictEqual(response.status, 201);
  assert.strictEqual(response.body.data.amount, 149.99);
  assert.strictEqual(response.body.data.currency, 'EUR');
  assert.strictEqual(response.body.data.status, 'pending');
});

test('PAYMENTS: POST /api/payments rejects negative amount', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: -25.00,
      currency: 'EUR',
      customer_email: 'test@test.com'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('Valid amount'));
});

test('PAYMENTS: POST /api/payments rejects zero amount', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 0,
      currency: 'EUR',
      customer_email: 'test@test.com'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('Valid amount'));
});

test('PAYMENTS: POST /api/payments rejects unsupported currency', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 100,
      currency: 'BTC',
      customer_email: 'crypto@test.com'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('currency'));
});

test('PAYMENTS: POST /api/payments rejects invalid customer email', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 100,
      currency: 'EUR',
      customer_email: 'invalidemail'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('email'));
});

test('PAYMENTS: GET /api/payments requires authentication', async () => {
  const response = await request(app).get('/api/payments');
  assert.strictEqual(response.status, 401);
});

test('PAYMENTS: GET /api/payments/:id returns 404 for non-existent payment', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .get('/api/payments/99999')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.body.error, 'Payment not found');
});

test('PAYMENTS: GET /api/payments/:id enforces merchant authorization isolation (403)', async () => {
  // Register another real merchant to pass authentication
  const reg = await request(app)
    .post('/api/auth/register')
    .send({
      email: `other_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      business_name: 'Other Merchant'
    });
  const otherToken = reg.body.token;

  // Merchant 2 attempts to access Merchant 1's payment
  const response = await request(app)
    .get('/api/payments/1')
    .set('Authorization', `Bearer ${otherToken}`);

  assert.strictEqual(response.status, 403);
  assert.strictEqual(response.body.error, 'Access denied');
});
