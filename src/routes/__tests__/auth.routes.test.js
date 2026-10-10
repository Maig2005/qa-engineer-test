import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';

test('AUTH: POST /api/auth/register creates new merchant with valid data', async () => {
  const uniqueEmail = `merchant_${Date.now()}@example.com`;
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: uniqueEmail,
      password: 'SecurePassword123!',
      business_name: 'Alpha Corp'
    });

  assert.strictEqual(response.status, 201);
  assert.strictEqual(response.body.message, 'Registration successful');
  assert.ok(response.body.token);
  assert.strictEqual(response.body.user.email, uniqueEmail);
  assert.strictEqual(response.body.user.business_name, 'Alpha Corp');
});

test('AUTH: Bug C Regression - POST /api/auth/register rejects email without TLD', async () => {
  const invalidEmails = [
    'user@domain',
    'merchant@localhost',
    'test@invaliddomain',
    'plainaddress',
    '@nodomain.com'
  ];

  for (const email of invalidEmails) {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'SecurePassword123!',
        business_name: 'Invalid Email Co'
      });

    assert.strictEqual(
      response.status,
      400,
      `Expected 400 Bad Request for email: ${email}`
    );
    assert.strictEqual(response.body.error, 'Invalid email format');
  }
});

test('AUTH: POST /api/auth/register accepts valid RFC email with domain and TLD', async () => {
  const validEmail = `valid_${Date.now()}@sub.company.eu`;
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: validEmail,
      password: 'StrongPassword123!',
      business_name: 'Valid Store Ltd'
    });

  assert.strictEqual(response.status, 201);
  assert.strictEqual(response.body.user.email, validEmail);
});

test('AUTH: POST /api/auth/register rejects short password (< 8 chars)', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: `short_${Date.now()}@example.com`,
      password: '12345',
      business_name: 'Short Pass Co'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('8 characters'));
});

test('AUTH: POST /api/auth/register rejects missing or blank business name', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: `nobiz_${Date.now()}@example.com`,
      password: 'SecurePassword123!',
      business_name: ' '
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('Business name'));
});

test('AUTH: POST /api/auth/register rejects duplicate email with 409 Conflict', async () => {
  const email = `dupe_${Date.now()}@example.com`;
  
  // First registration
  const firstRes = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: 'SecurePassword123!',
      business_name: 'First Store'
    });
  assert.strictEqual(firstRes.status, 201);

  // Duplicate registration
  const secondRes = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: 'AnotherPassword123!',
      business_name: 'Second Store'
    });
  assert.strictEqual(secondRes.status, 409);
  assert.strictEqual(secondRes.body.error, 'Email already registered');
});

test('AUTH: POST /api/auth/login succeeds with valid seed credentials', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'Test123!'
    });

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.message, 'Login successful');
  assert.ok(response.body.token);
  assert.strictEqual(response.body.user.email, 'merchant@test.com');
});

test('AUTH: POST /api/auth/login rejects incorrect password with 401', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'WrongPassword999!'
    });

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Invalid credentials');
});

test('AUTH: POST /api/auth/login rejects non-existent email with 401', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'nonexistent@test.com',
      password: 'Test123!'
    });

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Invalid credentials');
});

test('AUTH: POST /api/auth/login rejects missing credentials with 400', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({});

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('required'));
});
