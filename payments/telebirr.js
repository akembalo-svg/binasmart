'use strict';
// telebirr (Ethio Telecom SuperApp) payment gateway client. Protocol from developer.ethiotelecom.et docs + demo:
//   token:    POST /payment/v1/token             { appSecret }              header X-APP-Key = fabric app id
//   preOrder: POST /payment/v1/merchant/preOrder  { method: payment.preorder, biz_content{…}, sign }  → prepay_id
//   checkout: <webBaseUrl>appid=…&merch_code=…&nonce_str=…&prepay_id=…&timestamp=…&sign=…&sign_type=SHA256WithRSA&version=1.0&trade_type=Checkout
//   in-app:   the same signed "rawRequest" handed to the SuperApp JS bridge  window.ma.native('startPay', { rawRequest, bussinessType: 'BuyGoods' })
//   query:    POST /payment/v1/merchant/queryOrder { method: payment.queryorder } → order_status PAY_SUCCESS | WAIT_PAY | PAY_FAILED | ORDER_CLOSED …
//   refund:   POST /payment/v1/merchant/refund     { method: payment.refund }
// Signature: every request field except sign/sign_type/biz_content, plus every field INSIDE biz_content, sorted by key,
// joined "k=v&…", signed SHA256 RSA-PSS (MGF1, salt = 32 = digest length; jsrsasign "SHA256withRSAandMGF1"), base64.
// The sandbox uses a self-signed certificate, so TLS verification is off only when mode === 'sandbox'.
const crypto = require('crypto');
const https = require('https');

const EXCLUDE = new Set(['sign', 'sign_type', 'header', 'refund_info', 'openType', 'raw_request', 'biz_content', 'wallet_reference_data']);
const NONCE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function nonce() { let s = ''; const b = crypto.randomBytes(32); for (let i = 0; i < 32; i++) s += NONCE_CHARS[b[i] % NONCE_CHARS.length]; return s; }
function ts(now) { return String(Math.round((now || Date.now()) / 1000)); }
// merchant order ids must be letters/digits only (telebirr rejects "BINA-ABC123")
function orderId(prefix, code) { return (String(prefix || 'B') + String(code || '').replace(/[^A-Za-z0-9]/g, '') + Date.now().toString(36).toUpperCase()).slice(0, 64); }

function signBase(obj) {
  const fields = {};
  for (const k of Object.keys(obj)) if (!EXCLUDE.has(k) && obj[k] != null) fields[k] = obj[k];
  if (obj.biz_content) for (const k of Object.keys(obj.biz_content)) if (!EXCLUDE.has(k) && obj.biz_content[k] != null) fields[k] = obj.biz_content[k];
  return Object.keys(fields).sort().map(k => k + '=' + fields[k]).join('&');
}
function pemOf(key) {
  const s = String(key || '').trim();
  if (!s) return '';
  if (/-----BEGIN/.test(s)) return s.replace(/\\n/g, '\n');
  // allow base64 of the PEM (one line in .env) or a bare base64 PKCS8 body
  const dec = Buffer.from(s, 'base64').toString('utf8');
  if (/-----BEGIN/.test(dec)) return dec;
  return '-----BEGIN PRIVATE KEY-----\n' + s.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n').trim() + '\n-----END PRIVATE KEY-----';
}
function signString(str, privateKeyPem) {
  return crypto.sign('sha256', Buffer.from(str, 'utf8'), { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
}
function verifyString(str, sigB64, publicKeyPem) {
  try { return crypto.verify('sha256', Buffer.from(str, 'utf8'), { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(sigB64, 'base64')); } catch (e) { return false; }
}

// makeTelebirr({ mode, baseUrl, webBaseUrl, fabricAppId, appSecret, merchantAppId, merchantCode, privateKey, spPublicKey?, request?, now? })
function makeTelebirr(cfg) {
  const mode = (cfg.mode || 'sandbox').toLowerCase();
  const baseUrl = (cfg.baseUrl || (mode === 'live' ? 'https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway' : 'https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway')).replace(/\/+$/, '');
  const webBaseUrl = cfg.webBaseUrl || (mode === 'live' ? 'https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?' : 'https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?');
  const privateKey = pemOf(cfg.privateKey);
  const enabled = !!(cfg.fabricAppId && cfg.appSecret && cfg.merchantAppId && cfg.merchantCode && privateKey);
  const clock = cfg.now || Date.now;

  // Plain https so the sandbox's self-signed certificate can be tolerated without touching global TLS settings.
  const request = cfg.request || function (path, body, headers) {
    return new Promise((resolve, reject) => {
      const u = new URL(baseUrl + path);
      const data = JSON.stringify(body);
      const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', timeout: 20000, rejectUnauthorized: mode === 'live',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, res => {
        let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) { /* not json */ } resolve({ status: res.statusCode, json: j, text: s }); });
      });
      req.on('timeout', () => req.destroy(new Error('telebirr timeout'))); req.on('error', reject); req.end(data);
    });
  };

  let tokenCache = { token: '', until: 0 };
  async function token(force) {
    if (!force && tokenCache.token && clock() < tokenCache.until) return tokenCache.token;
    const r = await request('/payment/v1/token', { appSecret: cfg.appSecret }, { 'X-APP-Key': cfg.fabricAppId });
    const t = r.json && r.json.token;
    if (!t) throw new Error('telebirr token failed: ' + (r.text || r.status).toString().slice(0, 200));
    tokenCache = { token: t, until: clock() + 50 * 60 * 1000 }; // tokens last an hour; refresh after 50 min
    return t;
  }
  function signed(method, biz) {
    const req = { timestamp: ts(clock()), nonce_str: nonce(), method, version: '1.0', biz_content: biz };
    req.sign = signString(signBase(req), privateKey); req.sign_type = 'SHA256WithRSA';
    return req;
  }
  async function call(path, method, biz) {
    const tk = await token();
    let r = await request(path, signed(method, biz), { 'X-APP-Key': cfg.fabricAppId, Authorization: tk });
    if (r.status === 401) { r = await request(path, signed(method, biz), { 'X-APP-Key': cfg.fabricAppId, Authorization: await token(true) }); }
    const j = r.json || {};
    if (j.result !== 'SUCCESS' || String(j.code) !== '0') { const e = new Error('telebirr ' + method + ' failed: ' + (j.msg || j.code || r.status)); e.response = j; throw e; }
    return j.biz_content || {};
  }

  // Create an order. Returns { orderId, prepayId, checkoutUrl, rawRequest }.
  //   tradeType 'Checkout' = browser → telebirr web checkout page; 'InApp' = inside the SuperApp mini app (rawRequest → startPay)
  async function createOrder({ orderId: oid, title, amountEtb, notifyUrl, redirectUrl, tradeType, callbackInfo, timeoutMin }) {
    const amount = Number(amountEtb);
    if (!(amount > 0)) throw new Error('amount must be > 0');
    const id = String(oid || orderId('B')).replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
    const biz = {
      notify_url: notifyUrl, appid: cfg.merchantAppId, merch_code: cfg.merchantCode, merch_order_id: id,
      trade_type: tradeType === 'InApp' ? 'InApp' : 'Checkout', title: String(title || 'BinaSmart').replace(/[~`!#$%^*()\-+=|{}\[\]:;"'<>?,\/\\]/g, ' ').trim().slice(0, 100) || 'BinaSmart',
      total_amount: amount.toFixed(2).replace(/\.00$/, ''), trans_currency: 'ETB', timeout_express: (timeoutMin || 30) + 'm', business_type: 'BuyGoods',
      payee_identifier: cfg.merchantCode, payee_identifier_type: '04', payee_type: '5000',
    };
    if (redirectUrl) biz.redirect_url = redirectUrl;
    if (callbackInfo) biz.callback_info = String(callbackInfo).slice(0, 100);
    const out = await call('/payment/v1/merchant/preOrder', 'payment.preorder', biz);
    if (!out.prepay_id) throw new Error('telebirr preOrder returned no prepay_id');
    const raw = rawRequest(out.prepay_id);
    return { orderId: id, prepayId: out.prepay_id, rawRequest: raw, checkoutUrl: webBaseUrl + raw + '&version=1.0&trade_type=' + biz.trade_type };
  }
  function rawRequest(prepayId) {
    const map = { appid: cfg.merchantAppId, merch_code: cfg.merchantCode, nonce_str: nonce(), prepay_id: prepayId, timestamp: ts(clock()) };
    const sign = signString(signBase(map), privateKey);
    return ['appid=' + map.appid, 'merch_code=' + map.merch_code, 'nonce_str=' + map.nonce_str, 'prepay_id=' + map.prepay_id, 'timestamp=' + map.timestamp, 'sign=' + encodeURIComponent(sign), 'sign_type=SHA256WithRSA'].join('&');
  }
  // { orderStatus: 'PAY_SUCCESS' | 'WAIT_PAY' | 'PAY_FAILED' | 'ORDER_CLOSED' | 'PAYING' | 'REFUND…', paid: bool, paymentOrderId, transId, amount }
  async function queryOrder(merchOrderId) {
    const b = await call('/payment/v1/merchant/queryOrder', 'payment.queryorder', { appid: cfg.merchantAppId, merch_code: cfg.merchantCode, merch_order_id: String(merchOrderId) });
    const st = String(b.order_status || b.trade_status || '');
    return { orderStatus: st, paid: st === 'PAY_SUCCESS', paymentOrderId: b.payment_order_id || null, transId: b.trans_id || null, amount: b.total_amount != null ? Number(b.total_amount) : null, transTime: b.trans_time || null };
  }
  async function refund({ merchOrderId, amountEtb, reason, refundRequestNo }) {
    const b = await call('/payment/v1/merchant/refund', 'payment.refund', { appid: cfg.merchantAppId, merch_code: cfg.merchantCode, merch_order_id: String(merchOrderId), refund_request_no: String(refundRequestNo || orderId('R', merchOrderId)), actual_amount: Number(amountEtb).toFixed(2).replace(/\.00$/, ''), trans_currency: 'ETB', refund_reason: String(reason || 'refund').slice(0, 200) });
    return { status: b.refund_status, refundOrderId: b.refund_order_id || null, amount: b.refund_amount != null ? Number(b.refund_amount) : null };
  }
  // Notification body: verify the SP signature when we have their public key; the caller must still confirm with queryOrder.
  function verifyNotify(body) {
    if (!body || !body.merch_order_id) return { ok: false, reason: 'no order id' };
    if (!cfg.spPublicKey) return { ok: true, verified: false, reason: 'no SP public key configured; confirm with queryOrder' };
    const ok = verifyString(signBase(body), String(body.sign || ''), pemOf(cfg.spPublicKey).replace('PRIVATE', 'PUBLIC'));
    return { ok, verified: ok, reason: ok ? 'signature ok' : 'bad signature' };
  }
  return { enabled, mode, baseUrl, webBaseUrl, token, createOrder, rawRequest, queryOrder, refund, verifyNotify, _signBase: signBase, _signString: signString, _cfg: { merchantAppId: cfg.merchantAppId, merchantCode: cfg.merchantCode } };
}

module.exports = { makeTelebirr, signBase, signString, verifyString, nonce, orderId, pemOf };
