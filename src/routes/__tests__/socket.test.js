import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, io } from '../../server.js';

const JWT_SECRET = 'test-secret-key-do-not-use-in-production';

function getMerchantToken(id = '1') {
  return jwt.sign({ id, email: 'merchant@test.com', type: 'merchant' }, JWT_SECRET);
}

test('SOCKET.IO: server io instance is configured with CORS and registered on app', () => {
  assert.ok(io, 'Socket.IO server instance should be defined');
  assert.strictEqual(app.get('io'), io, 'App io property should match exported io instance');
});

test('SOCKET.IO: join_merchant and join_table room events function properly', () => {
  const joinedRooms = new Set();
  const mockSocket = {
    id: 'mock_socket_123',
    join: (room) => {
      joinedRooms.add(room);
    },
    on: function(event, handler) {
      if (event === 'join_merchant') {
        handler('42');
      }
      if (event === 'join_table') {
        handler(7);
      }
    }
  };

  // Simulate connection event handler
  const connectionListeners = io.listeners('connection');
  assert.ok(connectionListeners.length > 0, 'Connection listener should be registered');
  
  // Invoke connection handler with mock socket
  connectionListeners[0](mockSocket);

  assert.ok(joinedRooms.has('merchant_42'), 'Socket should have joined merchant_42 room');
  assert.ok(joinedRooms.has('table_7'), 'Socket should have joined table_7 room');
});

test('SOCKET.IO: POST /api/table-orders emits new_order event to merchant room', async () => {
  let emittedRoom = null;
  let emittedEvent = null;
  let emittedData = null;

  // Intercept io.to
  const originalTo = io.to;
  io.to = function(room) {
    emittedRoom = room;
    return {
      emit: function(event, data) {
        emittedEvent = event;
        emittedData = data;
      }
    };
  };

  try {
    const response = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: '1',
        table_number: 201,
        customer_name: 'Socket Guest',
        items: [{ price: 9.99, quantity: 1 }]
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(emittedRoom, 'merchant_1');
    assert.strictEqual(emittedEvent, 'new_order');
    assert.strictEqual(emittedData.customer_name, 'Socket Guest');
    assert.strictEqual(emittedData.table_number, 201);
  } finally {
    io.to = originalTo;
  }
});

test('SOCKET.IO: PATCH /api/table-orders/:id/status emits order_status_changed event to table room', async () => {
  let emittedRoom = null;
  let emittedEvent = null;
  let emittedData = null;

  // Create an order first
  const orderRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: 202,
      customer_name: 'Socket Guest 2',
      items: [{ price: 15.00, quantity: 1 }]
    });
  const orderId = orderRes.body.data.id;

  const originalTo = io.to;
  io.to = function(room) {
    emittedRoom = room;
    return {
      emit: function(event, data) {
        emittedEvent = event;
        emittedData = data;
      }
    };
  };

  try {
    const token = getMerchantToken('1');
    const patchRes = await request(app)
      .patch(`/api/table-orders/${orderId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'preparing' });

    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(emittedRoom, 'table_202');
    assert.strictEqual(emittedEvent, 'order_status_changed');
    assert.strictEqual(emittedData.order_id, orderId);
    assert.strictEqual(emittedData.status, 'preparing');
    assert.strictEqual(emittedData.table_number, 202);
  } finally {
    io.to = originalTo;
  }
});
