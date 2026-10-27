const {
  Pedido,
  PedidoDetalle,
  PedidoVenta,
  Producto,
  Venta,
  DetalleVenta,
  User,
  AffiliateBusiness,
} = require('../models');
const { ajustarReserva } = require('./stock.service');

const money = value => Math.round(Number(value || 0) * 100) / 100;

const finalizePaidOrder = async (orderId, transaction, payment = {}) => {
  const pasarelaPago = payment.pasarela_pago || null;
  const order = await Pedido.findByPk(orderId, {
    include: [{ model: PedidoDetalle, as: 'detalles' }],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!order) throw new Error('Pedido no encontrado');

  const existingLinks = await PedidoVenta.count({ where: { id_pedido: order.id_pedido }, transaction });
  if (existingLinks || order.venta_id) return order;

  const groups = new Map();
  const reservedByProduct = new Map();
  for (const item of order.detalles) {
    const product = await Producto.scope('allBusinesses').findByPk(item.producto_id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const alreadyReserved = reservedByProduct.get(item.producto_id) || 0;
    const requestedTotal = alreadyReserved + Number(item.cantidad);
    // Disponible para vender = stock físico - lo ya reservado por otros
    // pedidos pagados y aún no entregados (no se descuenta de verdad hasta
    // la entrega, pero tampoco se puede vender dos veces la misma unidad).
    const disponible = product ? Number(product.stock) - Number(product.stock_reservado) : 0;
    if (!product || disponible < requestedTotal) {
      throw new Error(`Stock insuficiente para ${item.producto_nombre}`);
    }
    reservedByProduct.set(item.producto_id, requestedTotal);
    const snapshotBusinessId = item.affiliate_business_id || null;
    if (Number(product.affiliate_business_id || 0) !== Number(snapshotBusinessId || 0)) {
      throw new Error(`La propiedad de ${item.producto_nombre} cambió; el pedido requiere revisión`);
    }
    const key = snapshotBusinessId ? String(snapshotBusinessId) : 'criscom';
    if (!groups.has(key)) groups.set(key, { affiliateBusinessId: snapshotBusinessId, items: [] });
    groups.get(key).items.push({ item, product });
  }

  const typeMap = { nota_venta: '0', factura: '1', boleta: '3' };
  const masterEmail = String(process.env.MASTER_ADMIN_EMAIL || '').trim().toLowerCase();
  const systemCashier = masterEmail ? await User.findOne({ where: { email: masterEmail }, transaction }) : null;
  if (!systemCashier) throw new Error('No se configuró la cuenta maestra para registrar la venta web');

  if (Number(order.costo_envio) > 0 && !groups.has('criscom')) {
    groups.set('criscom', { affiliateBusinessId: null, items: [] });
  }

  const createdSales = [];
  for (const group of groups.values()) {
    let cashier = systemCashier;
    let commissionRate = 0;
    if (group.affiliateBusinessId) {
      const business = await AffiliateBusiness.findByPk(group.affiliateBusinessId, { transaction });
      if (!business || business.estado !== 'activo') throw new Error('El punto de venta afiliado no está activo');
      cashier = await User.findByPk(business.owner_user_id, { transaction });
      if (!cashier) throw new Error('El punto de venta afiliado no tiene responsable');
      const trialActive = business.prueba_finaliza_en && new Date(business.prueba_finaliza_en) > new Date();
      commissionRate = trialActive ? 0 : Number(business.comision_porcentaje || 8);
    }

    const productsTotal = money(group.items.reduce((sum, entry) => sum + Number(entry.item.subtotal_con_igv), 0));
    const shipping = group.affiliateBusinessId ? 0 : money(order.costo_envio);
    const total = money(productsTotal + shipping);
    const commission = group.affiliateBusinessId ? money(productsTotal * commissionRate / 100) : 0;

    const sale = await Venta.unscoped().create({
      fecha: new Date(),
      total: money(total / 1.18),
      total_con_igv: total,
      id_cajero: cashier.id_user,
      metodo_pago: order.metodo_pago,
      observaciones: `Pedido web ${order.numero_pedido} · punto de venta ${group.affiliateBusinessId || 'CRISCOM'}`,
      tipo_documento: typeMap[order.tipo_comprobante],
      cliente_tipo_documento: order.cliente_documento_tipo === 'RUC' ? '6' : '1',
      cliente_numero_documento: order.cliente_documento_numero || null,
      cliente_nombre: order.razon_social || order.cliente_nombre,
      cliente_direccion: order.direccion_envio || null,
      cliente_email: order.cliente_email,
      estado_comprobante: order.tipo_comprobante === 'nota_venta' ? 'sin_emitir' : 'pendiente',
      comprobante_emitido: false,
      tipo_vendedor_snapshot: group.affiliateBusinessId ? 'afiliado' : 'virtual',
      comision_porcentaje: commissionRate,
      comision_servicio: commission,
      neto_vendedor: money(total - commission),
      affiliate_business_id: group.affiliateBusinessId,
      // Distingue esta venta (nacida de un pedido web) de una venta de
      // mostrador, y registra con qué pasarela se cobró, para que no se
      // mezclen en los reportes de cada afiliado ni en el cierre de caja.
      origen_tipo: 'pedido_web',
      pasarela_pago: pasarelaPago,
    }, { transaction });

    const lines = group.items.map(({ item }) => ({
      venta_id: sale.venta_id,
      producto_id: item.producto_id,
      descripcion: item.producto_nombre,
      cantidad: item.cantidad,
      precio_unitario: money(Number(item.precio_unitario_con_igv) / 1.18),
      precio_unitario_con_igv: item.precio_unitario_con_igv,
      subtotal: money(Number(item.subtotal_con_igv) / 1.18),
      subtotal_con_igv: item.subtotal_con_igv,
      condicion: item.condicion,
      garantia_meses: item.garantia_meses,
      estado_observaciones: item.estado_observaciones,
    }));
    if (shipping > 0) lines.push({
      venta_id: sale.venta_id,
      producto_id: null,
      descripcion: 'Servicio de entrega a domicilio',
      cantidad: 1,
      precio_unitario: money(shipping / 1.18),
      precio_unitario_con_igv: shipping,
      subtotal: money(shipping / 1.18),
      subtotal_con_igv: shipping,
      condicion: 'nuevo',
      garantia_meses: 0,
      estado_observaciones: null,
    });
    await DetalleVenta.bulkCreate(lines, { transaction });
    // No se descuenta stock físico aquí: se reserva. El pedido ya está pagado
    // y facturado (la Venta ya existe), pero la unidad solo sale del
    // inventario físico de verdad cuando el pedido pasa a "entregado"
    // (pedido.controller.js#updateStatus). Esto evita descontar algo que al
    // final no se llega a entregar, sin arriesgar vender dos veces lo mismo:
    // ajustarReserva es atómico, así que varias líneas del mismo producto en
    // este pedido se acumulan correctamente sin necesitar un cursor en JS.
    for (const { item, product } of group.items) {
      await ajustarReserva({
        productoId: product.id_producto,
        delta: Number(item.cantidad),
        tipo: 'reserva',
        referenciaTipo: 'pedido_web',
        referenciaId: order.id_pedido,
        motivo: `Pedido web ${order.numero_pedido}: pagado, pendiente de entrega`,
        usuarioId: cashier.id_user,
        affiliateBusinessId: group.affiliateBusinessId,
        transaction,
      });
    }
    await PedidoVenta.create({
      id_pedido: order.id_pedido,
      venta_id: sale.venta_id,
      affiliate_business_id: group.affiliateBusinessId,
      total_asignado: total,
    }, { transaction });
    createdSales.push(sale);
  }

  const primarySale = createdSales.find(sale => !sale.affiliate_business_id) || createdSales[0];
  await order.update({
    venta_id: primarySale?.venta_id || null,
    estado: 'confirmado',
    estado_pago: 'pagado',
  }, { transaction });
  return order;
};

module.exports = { finalizePaidOrder };
