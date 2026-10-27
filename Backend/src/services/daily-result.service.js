'use strict';
const { Op } = require('sequelize');
const { OrdenServicio, OrdenServicioRepuesto, MovimientoInventario, GastoTaller, DetalleVenta } = require('../models');
const { loadReceipts, round, limaDay } = require('./cash-ledger.service');

async function dailyResult(user, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00-05:00`))) throw new Error('Fecha inválida');
  const desde = new Date(`${day}T00:00:00-05:00`);
  const hasta = new Date(desde.getTime() + 86400000);
  if (limaDay(desde) !== day) throw new Error('Fecha inválida');
  const receipts = await loadReceipts({ user, desde, hasta });
  const directSales = receipts.sales.filter(s => s.origen_tipo !== 'orden_servicio' && !s.orden_servicio_id);
  // Los costos se toman del kardex histórico; nunca del costo actual del producto.
  const movements = await MovimientoInventario.findAll({ where: { referencia_tipo: 'venta', tipo: 'venta', referencia_id: { [Op.in]: directSales.map(s => s.venta_id) }, affiliate_business_id: user.affiliate_business_id || null } });
  const details = await DetalleVenta.findAll({ where: { venta_id: { [Op.in]: directSales.map(s => s.venta_id) } } });
  const missingLines = details.filter(d => d.producto_id && !movements.some(m => Number(m.referencia_id) === Number(d.venta_id) && Number(m.producto_id) === Number(d.producto_id))).length;
  const missing = missingLines + directSales.filter(s => !movements.some(m => Number(m.referencia_id) === Number(s.venta_id))).length + movements.filter(m => !Number(m.costo_unitario)).length;
  const orders = await OrdenServicio.findAll({ where: { affiliate_business_id: user.affiliate_business_id || null, anulada: false, moneda: 'PEN', estado: 'entregado', fecha_entrega_real: day, ...(user.id_role === 3 ? { creado_por: user.id_user } : {}) } });
  const parts = await OrdenServicioRepuesto.findAll({ where: { id_orden_servicio: { [Op.in]: orders.map(o => o.id_orden_servicio) }, estado_stock: ['consumido', 'no_aplica'] } });
  // GastosTaller todavía no dispone de tenant: nunca exponer gastos centrales a afiliados.
  const expenses = !user.affiliate_business_id && user.id_role !== 3 ? await GastoTaller.findAll({ where: { [Op.or]: [{ fecha: day }, { orden_servicio_id: { [Op.in]: orders.map(o => o.id_orden_servicio) } }] } }) : [];
  let productRevenue = directSales.reduce((sum, s) => sum + Number(s.total_con_igv), 0);
  let serviceRevenue = 0;
  let productCost = movements.reduce((sum, m) => sum + Math.abs(Number(m.cantidad)) * Number(m.costo_unitario || 0), 0);
  let missingParts = 0;
  for (const order of orders) {
    const activeParts = parts.filter(p => p.id_orden_servicio === order.id_orden_servicio);
    const productGross = Number(order.costo_repuestos);
    const serviceGross = Number(order.costo_mano_obra) + Number(order.recargo || 0);
    const gross = productGross + serviceGross;
    const factor = gross > 0 ? Math.max(0, gross - Number(order.descuento || 0)) / gross : 0;
    productRevenue += productGross * factor;
    serviceRevenue += serviceGross * factor;
    productCost += activeParts.reduce((sum, p) => sum + Number(p.cantidad) * Number(p.costo_unitario), 0);
    missingParts += activeParts.filter(p => !Number(p.costo_unitario)).length;
  }
  const orderIds = new Set(orders.map(o => Number(o.id_orden_servicio)));
  const serviceCost = expenses.filter(e => orderIds.has(Number(e.orden_servicio_id)) && e.categoria !== 'repuestos_stock').reduce((sum, e) => sum + Number(e.monto), 0);
  const overhead = expenses.filter(e => !e.orden_servicio_id && e.fecha === day && e.categoria !== 'repuestos_stock').reduce((sum, e) => sum + Number(e.monto), 0);
  const missingCosts = missing + missingParts + orders.filter(o => Number(o.costo_repuestos) > 0 && !parts.some(p => Number(p.id_orden_servicio) === Number(o.id_orden_servicio))).length;
  const { sales, payments, ...cash } = receipts;
  return {
    fecha: day, ...cash,
    ingresos_productos: round(productRevenue), ingresos_servicios: round(serviceRevenue),
    costo_productos: round(productCost), costo_servicios: round(serviceCost), gastos_generales: round(overhead),
    margen_productos: missingCosts ? null : round(productRevenue - productCost),
    margen_servicios: round(serviceRevenue - serviceCost),
    resultado_estimado: missingCosts ? null : round(productRevenue + serviceRevenue - productCost - serviceCost - overhead),
    costos_sin_registrar: missingCosts,
    criterio: 'Productos: venta directa o entrega del taller. Servicios: entrega del taller. Cobros: fecha de cada pago. Importes de venta con IGV y costos tal como se registraron: margen operativo estimado, no utilidad neta tributaria. Solo soles. Gastos vinculados se reconocen al entregar, compras a stock no se descuentan dos veces.',
    alcance: user.id_role === 3 ? 'Movimientos propios; no es el resultado global del negocio' : user.affiliate_business_id ? 'Negocio afiliado; gastos generales no incluidos' : 'Negocio central',
  };
}
module.exports = { dailyResult };
