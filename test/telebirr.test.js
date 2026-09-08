'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { makeTelebirr, signBase, signString, verifyString, orderId, pemOf } = require('../payments/telebirr');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = publicKey.export({ type: 'spki', format: 'pem' });

test('signBase flattens biz_content, skips sign fields, sorts keys — matches the documented example', () => {
  const req = { timestamp: '1755866911', nonce_str: 'H5QN4M6EAB2TXXVFK8SVV0RW6UFASICS', method: 'payment.preorder', version: '1.0', sign: 'x', sign_type: 'SHA256WithRSA',
    biz_content: { notify_url: 'https://www.google.com', appid: '1227484825753601', merch_code: '101011', merch_order_id: '1755866910890', trade_type: 'Checkout', title: 'diamond_1.5', total_amount: '1.5', trans_currency: 'ETB', timeout_express: '120m' } };
  assert.equal(signBase(req), 'appid=1227484825753601&merch_code=101011&merch_order_id=1755866910890&method=payment.preorder&nonce_str=H5QN4M6EAB2TXXVFK8SVV0RW6UFASICS&notify_url=https://www.google.com&timeout_express=120m&timestamp=1755866911&title=diamond_1.5&total_amount=1.5&trade_type=Checkout&trans_currency=ETB&version=1.0');
});

test('RSA-PSS SHA256 signature round-trips; PEM accepted raw, escaped, or base64', () => {
  const s = signString('a=1&b=2', PRIV);
  assert.ok(verifyString('a=1&b=2', s, PUB)); assert.ok(!verifyString('a=1&b=3', s, PUB));
  assert.equal(pemOf(PRIV.replace(/\n/g, '\\n')).trim(), PRIV.trim());
  assert.equal(pemOf(Buffer.from(PRIV).toString('base64')).trim(), PRIV.trim());
  assert.equal(pemOf(PRIV).trim(), PRIV.trim());
  assert.match(orderId('C', 'BINA-AB12CD'), /^CBINAAB12CD[A-Z0-9]+$/);
});

function fake() {
  const calls = [];
  const request = async (path, body, headers) => {
    calls.push({ path, body, headers });
    if (path === '/payment/v1/token') return { status: 200, json: { token: 'Bearer T1', expirationDate: '20990101000000' } };
    if (!/^Bearer /.test(headers.Authorization || '')) return { status: 401, json: {} };
    const base = signBase(body); assert.ok(verifyString(base, body.sign, PUB), 'request must be signed correctly');
    if (path === '/payment/v1/merchant/preOrder') return { status: 200, json: { result: 'SUCCESS', code: '0', biz_content: { merch_order_id: body.biz_content.merch_order_id, prepay_id: 'PP123' } } };
    if (path === '/payment/v1/merchant/queryOrder') return { status: 200, json: { result: 'SUCCESS', code: '0', biz_content: { merch_order_id: body.biz_content.merch_order_id, order_status: body.biz_content.merch_order_id === 'PAID1' ? 'PAY_SUCCESS' : 'WAIT_PAY', payment_order_id: 'PO1', trans_id: 'TX1', total_amount: '315.00' } } };
    if (path === '/payment/v1/merchant/refund') return { status: 200, json: { result: 'SUCCESS', code: '0', biz_content: { refund_status: 'REFUND_SUCCESS', refund_order_id: 'RF1', refund_amount: '315.00' } } };
    return { status: 404, json: { result: 'FAIL', code: '9', msg: 'no route' } };
  };
  const tb = makeTelebirr({ mode: 'sandbox', fabricAppId: 'FAB', appSecret: 'SEC', merchantAppId: '1694334196198400', merchantCode: '202766', privateKey: PRIV, request, now: () => 1757400000000 });
  return { tb, calls };
}

test('createOrder: token then signed preOrder; checkout url and in-app rawRequest carry the prepay id', async () => {
  const { tb, calls } = fake();
  assert.equal(tb.enabled, true);
  const o = await tb.createOrder({ orderId: 'CBINA1', title: 'Ticket: Film A (2 seats)', amountEtb: 315, notifyUrl: 'https://bina.et/api/telebirr/notify', redirectUrl: 'https://bina.et/ticket/BINA-1' });
  assert.equal(calls[0].path, '/payment/v1/token'); assert.equal(calls[0].headers['X-APP-Key'], 'FAB');
  const pre = calls[1]; assert.equal(pre.path, '/payment/v1/merchant/preOrder'); assert.equal(pre.headers.Authorization, 'Bearer T1');
  assert.equal(pre.body.method, 'payment.preorder'); assert.equal(pre.body.biz_content.total_amount, '315'); assert.equal(pre.body.biz_content.trade_type, 'Checkout'); assert.equal(pre.body.biz_content.merch_code, '202766'); assert.equal(pre.body.biz_content.business_type, 'BuyGoods');
  assert.equal(o.prepayId, 'PP123');
  assert.match(o.checkoutUrl, /^https:\/\/developerportal\.ethiotelebirr\.et:38443\/payment\/web\/paygate\?appid=1694334196198400&merch_code=202766&nonce_str=[A-Z0-9]{32}&prepay_id=PP123&timestamp=1757400000&sign=[^&]+&sign_type=SHA256WithRSA&version=1\.0&trade_type=Checkout$/);
  const raw = new URLSearchParams(o.rawRequest);
  assert.ok(verifyString(signBase({ appid: raw.get('appid'), merch_code: raw.get('merch_code'), nonce_str: raw.get('nonce_str'), prepay_id: raw.get('prepay_id'), timestamp: raw.get('timestamp') }), raw.get('sign'), PUB), 'rawRequest signature verifies');
  const inapp = await tb.createOrder({ orderId: 'CBINA2', title: 'x', amountEtb: 10.5, notifyUrl: 'n', tradeType: 'InApp' });
  assert.equal(calls.at(-1).body.biz_content.trade_type, 'InApp'); assert.equal(calls.at(-1).body.biz_content.total_amount, '10.50');
  assert.equal(calls.filter(c => c.path === '/payment/v1/token').length, 1, 'token cached');
  assert.ok(inapp.rawRequest.includes('prepay_id=PP123'));
});

test('queryOrder maps statuses; refund; notify verification without SP key defers to queryOrder', async () => {
  const { tb } = fake();
  assert.deepEqual((await tb.queryOrder('PAID1')).paid, true);
  assert.equal((await tb.queryOrder('OPEN1')).orderStatus, 'WAIT_PAY');
  const r = await tb.refund({ merchOrderId: 'PAID1', amountEtb: 315, reason: 'test' });
  assert.equal(r.status, 'REFUND_SUCCESS');
  assert.equal(tb.verifyNotify({ merch_order_id: 'PAID1', sign: 'x' }).ok, true);
  assert.equal(tb.verifyNotify({}).ok, false);
  const off = makeTelebirr({ mode: 'sandbox' }); assert.equal(off.enabled, false);
});
