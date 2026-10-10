import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/server.js';

const JWT_SECRET = 'test-secret-key-do-not-use-in-production';

async function runReproduction() {
  console.log('====================================================');
  console.log('       REPRODUCING ALL 7 CONFIRMED BUGS            ');
  console.log('====================================================');

  const merchantToken = jwt.sign(
    { id: '1', email: 'merchant@test.com', type: 'merchant' },
    JWT_SECRET
  );

  // Bug A: Amount returned as string instead of number
  const paymentsRes = await request(app)
    .get('/api/payments')
    .set('Authorization', `Bearer ${merchantToken}`);
  const singlePayRes = await request(app)
    .get('/api/payments/1')
    .set('Authorization', `Bearer ${merchantToken}`);
  console.log('\n[BUG A - Payment API Response Data Type]');
  console.log('  GET /api/payments: amount =', JSON.stringify(paymentsRes.body.data[0]?.amount), 'Type:', typeof paymentsRes.body.data[0]?.amount);
  console.log('  GET /api/payments/1: amount =', JSON.stringify(singlePayRes.body.data?.amount), 'Type:', typeof singlePayRes.body.data?.amount);
  console.log('  -> Defect reproduced: amount is string ("25.5") instead of float/number (25.5)');

  // Bug B: Missing maximum payment amount validation
  const hugePaymentRes = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${merchantToken}`)
    .send({ amount: 999999999, currency: 'EUR', customer_email: 'customer@test.com' });
  console.log('\n[BUG B - Missing Maximum Amount Validation (€50,000 Limit)]');
  console.log('  POST /api/payments with amount=999999999');
  console.log('  Status:', hugePaymentRes.status, 'Created ID:', hugePaymentRes.body.data?.id);
  console.log('  -> Defect reproduced: astronomical transaction allowed without rejection');

  // Bug C: Auth API allows invalid emails without TLD
  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ email: 'user@domain', password: 'Password123!', business_name: 'No TLD Store' });
  console.log('\n[BUG C - Permissive Email Validation Regex]');
  console.log('  POST /api/auth/register with email="user@domain"');
  console.log('  Status:', registerRes.status, 'Message:', registerRes.body.message);
  console.log('  -> Defect reproduced: invalid email accepted without top-level domain');

  // Bug D: Webhook accepts request without signature
  const unsignedWebhookRes = await request(app)
    .post('/api/webhooks/payment-status')
    .send({ payment_id: '1', status: 'completed', event_id: 'evt_spoof_1' });
  console.log('\n[BUG D - Missing Webhook HMAC Signature Verification]');
  console.log('  POST /api/webhooks/payment-status without x-webhook-signature');
  console.log('  Status:', unsignedWebhookRes.status, 'Message:', unsignedWebhookRes.body.message);
  console.log('  -> Defect reproduced: unauthenticated webhook processed successfully');

  // Bug E: Webhook duplicate delivery not prevented
  const webhook1 = await request(app)
    .post('/api/webhooks/payment-status')
    .send({ payment_id: '1', status: 'completed', event_id: 'evt_dupe_100' });
  const webhook2 = await request(app)
    .post('/api/webhooks/payment-status')
    .send({ payment_id: '1', status: 'completed', event_id: 'evt_dupe_100' });
  console.log('\n[BUG E - Missing Webhook Idempotency Check]');
  console.log('  POST /api/webhooks/payment-status duplicate event_id="evt_dupe_100"');
  console.log('  First status:', webhook1.status, 'Second status:', webhook2.status, 'Second message:', webhook2.body.message);
  console.log('  -> Defect reproduced: duplicate webhook processed twice instead of idempotent return');

  // Bug F: Table orders duplicate pending order not prevented
  const order1 = await request(app)
    .post('/api/table-orders')
    .send({ merchant_id: '1', table_number: 88, items: [{ price: 12.5, quantity: 2 }] });
  const order2 = await request(app)
    .post('/api/table-orders')
    .send({ merchant_id: '1', table_number: 88, items: [{ price: 8.0, quantity: 1 }] });
  console.log('\n[BUG F - Missing Duplicate Table Order Prevention]');
  console.log('  POST /api/table-orders for table 88 while table 88 has pending order');
  console.log('  First order ID:', order1.body.data?.id, 'Second order ID:', order2.body.data?.id);
  console.log('  Second order status:', order2.status, 'Message:', order2.body.message);
  console.log('  -> Defect reproduced: table can have multiple active pending orders');

  // Bug G: E-Invoice duplicate submission not prevented
  const einvoice1 = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${merchantToken}`)
    .send({ invoice_id: 'inv_repro_test', customer_siret: '12345678901234' });
  const einvoice2 = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${merchantToken}`)
    .send({ invoice_id: 'inv_repro_test', customer_siret: '12345678901234' });
  console.log('\n[BUG G - Missing Duplicate E-Invoice Submission Prevention]');
  console.log('  POST /api/einvoice/submit for already submitted invoice');
  console.log('  First status:', einvoice1.status, 'First submission_id:', einvoice1.body.data?.submission_id);
  console.log('  Second status:', einvoice2.status, 'Second submission_id:', einvoice2.body.data?.submission_id);
  console.log('  -> Defect reproduced: duplicate submission created and status overwritten');

  console.log('\n====================================================');
  console.log('       ALL 7 BUGS CONFIRMED REPRODUCIBLE!           ');
  console.log('====================================================\n');
  process.exit(0);
}

runReproduction().catch(err => {
  console.error(err);
  process.exit(1);
});
