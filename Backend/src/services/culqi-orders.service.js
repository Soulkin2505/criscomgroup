const axios = require('axios');
const { credentials } = require('./culqi.service');

// "Órdenes de Pago" es un producto distinto de Culqi al de "Cargos" (tarjeta,
// Yape token): se usa para billeteras móviles interoperables (Plin, Yape,
// BBVA Wallet, etc.), PagoEfectivo y Cuotéalo. Es asíncrono: el cliente puede
// pagar minutos u horas después, por lo que la confirmación llega solo por
// webhook (evento order.status.changed), nunca por la respuesta del navegador.
// Referencia: docs.culqi.com/es/documentacion/pagos-online/ordenes-de-pago
// y el SDK oficial culqi-php (lib/Culqi/Orders.php, order_validation.php).
const culqiClient = axios.create({ baseURL: process.env.CULQI_API_URL || 'https://api.culqi.com/v2', timeout: 20000 });

const createOrder = async ({ amount, orderNumber, email, firstName, lastName, phone, description, expiresInSeconds = 30 * 60 }) => {
  const config = await credentials();
  if (!config.secretKey || !config.publicKey) {
    if (process.env.PAYMENTS_MODE === 'sandbox') {
      return { id: `ord_test_${Date.now()}`, object: 'order', amount, currency_code: 'PEN', state: 'pending', order_number: orderNumber, metadata: { order_number: orderNumber }, test: true };
    }
    throw new Error('Culqi no está configurado');
  }
  const created = await culqiClient.post('/orders/', {
    amount,
    currency_code: 'PEN',
    description: description || `Pedido ${orderNumber}`,
    order_number: orderNumber,
    confirm: false,
    client_details: { first_name: firstName, last_name: lastName, email, phone_number: phone },
    expiration_date: Math.floor(Date.now() / 1000) + expiresInSeconds,
    metadata: { order_number: orderNumber },
  }, { headers: { Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/json' } });
  // Culqi exige confirmar la orden (confirm:true) antes de que quede disponible
  // para que el cliente pague; crearla con confirm:false es solo el borrador.
  const confirmed = await culqiClient.post(`/orders/${encodeURIComponent(created.data.id)}/confirm/`, {}, { headers: { Authorization: `Bearer ${config.secretKey}` } });
  return confirmed.data || created.data;
};

const retrieveOrder = async orderId => {
  const config = await credentials();
  if (!config.secretKey || !config.publicKey) throw new Error('Culqi no está configurado');
  const response = await culqiClient.get(`/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${config.secretKey}` } });
  return response.data;
};

// OJO: la documentación pública de Culqi no confirma el valor exacto que usa el
// campo "state" cuando una orden fue pagada (solo vimos "pending" de ejemplo y
// la palabra "pagada" en texto, no el enum real de la API). Antes de confiar en
// esto en producción, confirmar contra una orden real pagada en sandbox o en
// CulqiPanel. Se deja la lista abierta a propósito, no como un valor único, para
// no fallar en silencio si el nombre real difiere de lo que aquí se asume.
const PAID_STATES = ['paid', 'pagada', 'completed', 'pagado'];
const isOrderPaid = order => PAID_STATES.includes(String(order?.state || '').toLowerCase());

const sanitizeOrder = order => ({ id: order.id, state: order.state || null, amount: order.amount, currency_code: order.currency_code, order_number: order.order_number, test: Boolean(order.test) });

module.exports = { createOrder, retrieveOrder, sanitizeOrder, isOrderPaid, PAID_STATES };
