'use strict';

// One receipt source: direct sales OR workshop payments, never their billing mirror.
const round = n => Math.round((Number(n) || 0) * 100) / 100;
const METHODS = ['efectivo', 'tarjeta', 'yape', 'plin', 'transferencia', 'pago_link', 'qr', 'otro'];
const method = value => {
  const key = String(value || '').toLowerCase();
  return key === 'pos' ? 'tarjeta' : METHODS.includes(key) ? key : 'otro';
};
const limaDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

function summarizeReceipts(sales, payments) {
  const byMethod = Object.fromEntries(METHODS.map(key => [key, { total: 0, cantidad: 0 }]));
  let products = 0, workshop = 0;
  for (const sale of sales) {
    if (sale.origen_tipo === 'orden_servicio' || sale.orden_servicio_id) continue;
    const amount = round(sale.total_con_igv);
    products += amount;
    const bucket = byMethod[method(sale.metodo_pago)];
    bucket.total += amount; bucket.cantidad++;
  }
  for (const payment of payments) {
    if (payment.estado !== 'confirmado' || payment.moneda !== 'PEN') continue;
    const amount = round(payment.monto);
    workshop += amount;
    const bucket = byMethod[method(payment.metodo)];
    bucket.total += amount; bucket.cantidad++;
  }
  for (const bucket of Object.values(byMethod)) bucket.total = round(bucket.total);
  return { cobrado: round(products + workshop), cobrado_ventas: round(products), cobrado_taller: round(workshop), por_metodo: byMethod };
}

async function loadReceipts({ user, desde, hasta }) {
  const { Op } = require('sequelize');
  const { Venta, OrdenServicio, OrdenServicioPago, GastoTaller } = require('../models');
  const tenant = user.affiliate_business_id || null;
  const cashier = user.id_role === 3 ? user.id_user : null;
  const sales = await Venta.unscoped().findAll({ where: { affiliate_business_id: tenant, fecha: { [Op.gte]: desde, [Op.lt]: hasta }, ...(cashier ? { id_cajero: cashier } : {}) } });
  const orders = await OrdenServicio.findAll({ where: { affiliate_business_id: tenant, anulada: false }, attributes: ['id_orden_servicio'] });
  const payments = await OrdenServicioPago.findAll({ where: {
    id_orden_servicio: { [Op.in]: orders.map(o => o.id_orden_servicio) },
    creado_en: { [Op.gte]: desde, [Op.lt]: hasta },
    ...(cashier ? { registrado_por: cashier } : {}),
  } });
  const cash = summarizeReceipts(sales, payments);
  const expenses = !tenant ? await GastoTaller.findAll({ where: {
    fecha: { [Op.gte]: limaDay(desde), [Op.lt]: limaDay(hasta) },
    [Op.or]: [{ orden_servicio_id: null }, { orden_servicio_id: { [Op.in]: orders.map(o => o.id_orden_servicio) } }],
    ...(cashier ? { registrado_por: cashier } : {}),
  } }) : [];
  const cashOut = round(expenses.filter(e => method(e.medio_pago) === 'efectivo').reduce((sum, e) => sum + Number(e.monto), 0));
  return { ...cash, egresos_efectivo: cashOut, efectivo_neto: round(cash.por_metodo.efectivo.total - cashOut), sales, payments };
}

module.exports = { METHODS, method, round, limaDay, summarizeReceipts, loadReceipts };
