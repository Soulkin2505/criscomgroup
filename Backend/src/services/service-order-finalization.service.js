const {
  OrdenServicio,
  OrdenServicioPago,
  OrdenServicioRepuesto,
  Venta,
  DetalleVenta,
} = require('../models');

const { workshopAmounts } = require('./workshop-amounts.service');
const money = value => Math.round(Number(value || 0) * 100) / 100;

const classifyServiceOrder = parts => parts.length ? 'boleta_factura' : 'recibo_honorarios';

const finalizeServiceOrderBilling = async (orderId, userId, transaction) => {
  const order = await OrdenServicio.findByPk(orderId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!order) throw new Error('Orden de servicio no encontrada');
  if (order.venta_id) return { order, sale: await Venta.unscoped().findByPk(order.venta_id, { transaction }), alreadyFinalized: true };

  const [parts, payments] = await Promise.all([
    OrdenServicioRepuesto.findAll({
      where: { id_orden_servicio: order.id_orden_servicio, estado_stock: ['no_aplica', 'reservado', 'consumido'] },
      transaction,
    }),
    OrdenServicioPago.findAll({
      where: { id_orden_servicio: order.id_orden_servicio, estado: 'confirmado' },
      transaction,
    }),
  ]);
  const total = money(Number(order.costo_repuestos) + Number(order.costo_mano_obra) + Number(order.recargo || 0) - Number(order.descuento || 0));
  const paid = money(payments.reduce((sum, payment) => sum + Number(payment.monto), 0));
  if (total <= 0) throw new Error('La orden no tiene un importe facturable');
  if (paid + 0.001 < total) throw new Error('La orden todavía tiene saldo pendiente');

  if (order.moneda !== 'PEN') throw new Error('La facturación actual solo admite soles; la orden requiere revisión de moneda');
  const amounts = workshopAmounts(order, parts);
  const classification = amounts.productTotal > 0 ? (amounts.serviceTotal > 0 ? 'mixta' : 'boleta_factura') : 'recibo_honorarios';
  const fiscalTotal = amounts.productTotal || amounts.serviceTotal;
  const isInvoice = amounts.productTotal > 0 && /^\d{11}$/.test(String(order.documento || ''));
  const sale = await Venta.unscoped().create({
    fecha: new Date(),
    total: classification === 'recibo_honorarios' ? fiscalTotal : money(fiscalTotal / 1.18),
    total_con_igv: fiscalTotal,
    id_cajero: userId,
    metodo_pago: [...new Set(payments.map(payment => payment.metodo))].join('+') || 'otro',
    observaciones: `Orden de servicio ${order.codigo}`,
    tipo_documento: classification === 'recibo_honorarios' ? null : isInvoice ? '1' : '3',
    serie: classification === 'recibo_honorarios' ? null : isInvoice ? 'F001' : 'B001',
    cliente_tipo_documento: /^\d{11}$/.test(String(order.documento || '')) ? '6' : /^\d{8}$/.test(String(order.documento || '')) ? '1' : null,
    cliente_numero_documento: order.documento || null,
    cliente_nombre: order.cliente,
    estado_comprobante: 'pendiente',
    comprobante_emitido: false,
    tipo_vendedor_snapshot: 'servicio_tecnico',
    neto_vendedor: fiscalTotal,
    affiliate_business_id: order.affiliate_business_id || null,
    origen_tipo: 'orden_servicio',
    orden_servicio_id: order.id_orden_servicio,
    categoria_ingreso: amounts.productTotal > 0 ? 'productos_taller' : 'servicios',
  }, { transaction });

  const lines = amounts.lines.filter(line => line.gross > 0).map(({ part, gross, net }) => ({
    venta_id: sale.venta_id,
    producto_id: part.id_producto || null,
    descripcion: part.descripcion,
    cantidad: part.cantidad,
    precio_unitario: money(net / Number(part.cantidad)),
    precio_unitario_con_igv: money(gross / Number(part.cantidad)),
    subtotal: net,
    subtotal_con_igv: gross,
    condicion: 'nuevo',
    garantia_meses: 0,
  }));
  const serviceSale = amounts.serviceTotal;
  if (classification === 'recibo_honorarios' && amounts.serviceTotal > 0) lines.push({
    venta_id: sale.venta_id,
    producto_id: null,
    descripcion: order.trabajo_realizado || (order.tipo === 'armado_pc' ? 'Servicio de armado de PC' : 'Servicio técnico y mano de obra'),
    cantidad: 1,
    precio_unitario: classification === 'recibo_honorarios' ? serviceSale : money(serviceSale / 1.18),
    precio_unitario_con_igv: serviceSale,
    subtotal: classification === 'recibo_honorarios' ? serviceSale : money(serviceSale / 1.18),
    subtotal_con_igv: serviceSale,
    condicion: 'nuevo',
    garantia_meses: 0,
  });
  await DetalleVenta.bulkCreate(lines, { transaction });
  await order.update({
    venta_id: sale.venta_id,
    clasificacion_fiscal: classification,
    estado_facturacion: 'pendiente_emision',
  }, { transaction });
  return { order, sale, classification, alreadyFinalized: false };
};

module.exports = { classifyServiceOrder, finalizeServiceOrderBilling };
