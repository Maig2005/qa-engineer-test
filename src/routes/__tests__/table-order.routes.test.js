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

test('TABLE-ORDERS: POST /api/table-orders creates a new table order with calculated total', async () => {
  const tableNumber = 101;
  const items = [
    { name: 'Pasta Carbonara', price: 14.50, quantity: 2 },
    { name: 'Sparkling Water', price: 3.50, quantity: 1 }
  ];

  const response = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      customer_name: 'Alice',
      order_type: 'dine_in',
      items
    });

  assert.strictEqual(response.status, 201);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.data.status, 'pending');
  assert.strictEqual(response.body.data.total, 32.50);
  assert.strictEqual(response.body.data.customer_name, 'Alice');
});

test('TABLE-ORDERS: Bug F Regression - Rejects duplicate pending order for same table', async () => {
  const tableNumber = 102;
  const items = [{ name: 'Espresso', price: 2.50, quantity: 1 }];

  // First order
  const firstRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items
    });
  assert.strictEqual(firstRes.status, 201);

  // Duplicate second order while first is still pending
  const secondRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items: [{ name: 'Croissant', price: 3.00, quantity: 1 }]
    });

  assert.strictEqual(secondRes.status, 409);
  assert.strictEqual(secondRes.body.error, 'Table already has a pending order');
});

test('TABLE-ORDERS: Allows new order once previous table order is served/completed', async () => {
  const tableNumber = 103;
  const token = getMerchantToken('1');

  // Place initial order
  const firstRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items: [{ name: 'Pizza Margherita', price: 12.00, quantity: 1 }]
    });
  assert.strictEqual(firstRes.status, 201);
  const orderId = firstRes.body.data.id;

  // Transition order from pending to served
  const updateRes = await request(app)
    .patch(`/api/table-orders/${orderId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'served' });
  assert.strictEqual(updateRes.status, 200);

  // Now placing another order for table 103 must succeed
  const nextRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items: [{ name: 'Tiramisu', price: 6.50, quantity: 1 }]
    });
  assert.strictEqual(nextRes.status, 201);
  assert.strictEqual(nextRes.body.data.status, 'pending');
});

test('TABLE-ORDERS: POST /api/table-orders rejects empty items array', async () => {
  const response = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: 104,
      items: []
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('at least one item'));
});

test('TABLE-ORDERS: POST /api/table-orders rejects missing required fields', async () => {
  const response = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('required'));
});

test('TABLE-ORDERS: GET /api/table-orders lists orders for authenticated merchant', async () => {
  const token = getMerchantToken('1');
  const response = await request(app)
    .get('/api/table-orders')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.ok(Array.isArray(response.body.data));
});

test('TABLE-ORDERS: GET /api/table-orders rejects unauthenticated requests', async () => {
  const response = await request(app).get('/api/table-orders');
  assert.strictEqual(response.status, 401);
});

test('TABLE-ORDERS: PATCH /api/table-orders/:id/status updates status', async () => {
  const token = getMerchantToken('1');
  // Create order
  const createRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: 105,
      items: [{ price: 5, quantity: 1 }]
    });
  const orderId = createRes.body.data.id;

  const patchRes = await request(app)
    .patch(`/api/table-orders/${orderId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'confirmed' });

  assert.strictEqual(patchRes.status, 200);
  assert.strictEqual(patchRes.body.data.status, 'confirmed');
});

test('TABLE-ORDERS: PATCH /api/table-orders/:id/status rejects invalid status', async () => {
  const token = getMerchantToken('1');
  const order = db.table_orders?.[0];
  assert.ok(order, 'Expected at least one table order in db');

  const patchRes = await request(app)
    .patch(`/api/table-orders/${order.id}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'flying_to_mars' });

  assert.strictEqual(patchRes.status, 400);
  assert.ok(patchRes.body.error.includes('Valid status required'));
});

test('TABLE-ORDERS: PATCH /api/table-orders/:id/status returns 404 for non-existent order', async () => {
  const token = getMerchantToken('1');
  const patchRes = await request(app)
    .patch('/api/table-orders/non-existent-order-uuid/status')
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'confirmed' });

  assert.strictEqual(patchRes.status, 404);
  assert.strictEqual(patchRes.body.error, 'Order not found');
});

test('TABLE-ORDERS: PATCH /api/table-orders/:id/status rejects unauthorized merchant (403)', async () => {
  // Register merchant 2
  const reg = await request(app)
    .post('/api/auth/register')
    .send({
      email: `other_table_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      business_name: 'Other Bistro'
    });
  const otherToken = reg.body.token;

  // Order belongs to merchant '1'
  const order = db.table_orders.find(o => o.merchant_id === '1');
  assert.ok(order);

  const response = await request(app)
    .patch(`/api/table-orders/${order.id}/status`)
    .set('Authorization', `Bearer ${otherToken}`)
    .send({ status: 'ready' });

  assert.strictEqual(response.status, 403);
  assert.strictEqual(response.body.error, 'Access denied');
});
