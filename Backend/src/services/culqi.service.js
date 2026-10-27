const axios = require('axios');
const gateways = require('./payment-gateway.service');

const culqiClient = axios.create({ baseURL: process.env.CULQI_API_URL || 'https://api.culqi.com/v2', timeout: 20000 });
const credentials = async () => {
  const stored = await gateways.getActiveCredentials('culqi').catch(() => null);
  return { publicKey: stored?.public_key || process.env.CULQI_PUBLIC_KEY || null, secretKey: stored?.secret_key || process.env.CULQI_SECRET_KEY || null };
};
const isConfigured = async () => { const value = await credentials(); return Boolean(value.secretKey && value.publicKey); };
const publicKey = async () => (await credentials()).publicKey;

const createCharge = async ({ token, amount, email, orderNumber, idempotencyKey, antifraudDetails }) => {
  const config = await credentials();
  if (!config.secretKey || !config.publicKey) {
    if (process.env.PAYMENTS_MODE === 'sandbox') return { id: `chr_test_${Date.now()}`, amount, currency_code: 'PEN', outcome: { type: 'venta_exitosa' }, fraud_score: null, source: { last_four: '4242' }, metadata: { order_number: orderNumber }, test: true };
    throw new Error('Culqi no está configurado');
  }
  const body = { amount, currency_code: 'PEN', email, source_id: token, capture: true, description: `Pedido ${orderNumber}`, metadata: { order_number: orderNumber } };
  // Recomendado por Culqi ("Denegaciones") para mejorar su detección de
  // fraude: mandar estos datos del cliente en cada cargo, no reusarlos entre
  // clientes distintos. Son opcionales; si falta algo, se omite ese campo.
  if (antifraudDetails && Object.keys(antifraudDetails).length) body.antifraud_details = antifraudDetails;
  const response = await culqiClient.post('/charges', body, { headers: { Authorization: `Bearer ${config.secretKey}`, 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' } });
  return response.data;
};
const retrieveCharge = async chargeId => {
  const config = await credentials();
  if (!config.secretKey || !config.publicKey) throw new Error('Culqi no está configurado');
  const response = await culqiClient.get(`/charges/${encodeURIComponent(chargeId)}`, { headers: { Authorization: `Bearer ${config.secretKey}` } });
  return response.data;
};

// Devoluciones solo aplican a cargos (tarjeta/Yape token, ids "chr_..."), no a
// pagos por Orden (billetera/PagoEfectivo/Cuotéalo) — Culqi no documenta ese
// mismo endpoint para Órdenes, así que no se asume que funcione igual.
// amount en céntimos para devolución parcial; se omite para devolver el total.
const createRefund = async ({ chargeId, amount, reason }) => {
  const config = await credentials();
  if (!config.secretKey || !config.publicKey) throw new Error('Culqi no está configurado');
  const body = { charge_id: chargeId, reason };
  if (amount) body.amount = amount;
  const response = await culqiClient.post('/refunds', body, { headers: { Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/json' } });
  return response.data;
};
const sanitizeRefund = refund => ({ id: refund.id, charge_id: refund.charge_id, amount: refund.amount, reason: refund.reason, status: refund.status || null });
// fraud_score queda disponible para quien revise el pedido antes de
// despacharlo (CulqiPanel lo rechaza solo desde 75%; por debajo de eso, el
// manual recomienda revisión manual, no bloqueo automático).
const sanitizeCharge = charge => ({ id: charge.id, outcome: charge.outcome?.type || null, last_four: charge.source?.last_four || null, card_brand: charge.source?.iin?.card_brand || null, fraud_score: charge.fraud_score ?? null, test: Boolean(charge.test) });

module.exports = { createCharge, retrieveCharge, sanitizeCharge, createRefund, sanitizeRefund, isConfigured, publicKey, credentials };
