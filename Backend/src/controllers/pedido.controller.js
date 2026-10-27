const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sequelize, Pedido, PedidoDetalle, Producto, Pago } = require('../models');
const culqi = require('../services/culqi.service');
const culqiOrders = require('../services/culqi-orders.service');
const { finalizePaidOrder } = require('../services/order-finalization.service');
const shippingQuote = require('../services/shipping-quote.service');
const { deleteUnpaidOrder } = require('../services/order-expiration.service');
const { aplicarMovimiento, ajustarReserva } = require('../services/stock.service');
const { Op } = require('sequelize');

const affiliateOrderIds = async req => {
  if (req.user?.id_role === 3 && (req.user?.tipo_vendedor !== 'afiliado' || !req.user?.affiliate_business_id)) return [];
  if (req.user?.tipo_vendedor !== 'afiliado' || !req.user?.affiliate_business_id) return null;
  const rows = await PedidoDetalle.findAll({
    attributes: ['id_pedido'],
    where: { affiliate_business_id: req.user.affiliate_business_id },
    group: ['id_pedido'],
  });
  return rows.map(row => row.id_pedido);
};

const optionalUser = req => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    return token ? jwt.verify(token, process.env.JWT_SECRET) : null;
  } catch { return null; }
};

const orderInclude = [{ model: PedidoDetalle, as: 'detalles' }];
const hashPaymentToken = token => crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
const validPaymentToken = (order, token) => {
  if (!order.payment_token_hash || !token) return false;
  const expected = Buffer.from(order.payment_token_hash, 'hex');
  const received = Buffer.from(hashPaymentToken(token), 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};
const safeOrder = order => {
  const data = order.toJSON();
  delete data.payment_token_hash;
  return data;
};
const publicOrder = order => {
  const data = safeOrder(order);
  return {
    numero_pedido: data.numero_pedido,
    estado: data.estado,
    estado_pago: data.estado_pago,
    metodo_pago: data.metodo_pago,
    total_final: data.total_final,
    tipo_entrega: data.tipo_entrega,
    fecha_creacion: data.fecha_creacion,
    detalles: data.detalles,
  };
};

// Culqi recomienda mandar estos datos en cada cargo para mejorar su propio
// motor de detección de fraude (ver "Denegaciones" en su manual). Todos los
// campos son opcionales: si el pedido es recojo en tienda no hay dirección,
// y simplemente se omite — Culqi igual acepta el cargo.
const antifraudDetailsFor = order => {
  const [firstName, ...rest] = String(order.cliente_nombre || '').trim().split(/\s+/).filter(Boolean);
  return {
    first_name: firstName || undefined,
    last_name: rest.join(' ') || undefined,
    address: order.direccion_envio || undefined,
    address_city: order.direccion_distrito || order.direccion_provincia || undefined,
    country_code: 'PE',
  };
};

// Billetera digital, PagoEfectivo y Cuotéalo usan el producto "Órdenes de
// Pago" de Culqi, no el de cargos: hay que crear (y confirmar) la orden en
// Culqi para que el checkout pueda mostrarla, y guardar su id en Pago para
// que el webhook asíncrono la pueda encontrar. Los tres comparten esta misma
// creación de orden; lo único que cambia es qué botón ve el cliente en el
// checkout (eso lo decide el frontend al abrir el widget).
const ORDER_METODOS = ['billetera_digital', 'pago_efectivo', 'cuotealo'];
const setUpCulqiOrder = async order => {
  const key = `order-${order.id_pedido}-culqi`;
  const [firstName, ...rest] = String(order.cliente_nombre || '').trim().split(/\s+/).filter(Boolean);
  const culqiOrder = await culqiOrders.createOrder({
    amount: Math.round(Number(order.total_final) * 100),
    orderNumber: order.numero_pedido,
    email: order.cliente_email,
    firstName: firstName || 'Cliente',
    lastName: rest.join(' ') || '-',
    phone: order.cliente_telefono,
  });
  const existing = await Pago.findOne({ where: { idempotency_key: key } });
  if (existing) {
    await existing.update({ proveedor_id: culqiOrder.id, estado: 'creado', respuesta_segura: culqiOrders.sanitizeOrder(culqiOrder) });
  } else {
    await Pago.create({
      id_pedido: order.id_pedido,
      proveedor: 'culqi',
      idempotency_key: key,
      proveedor_id: culqiOrder.id,
      monto_centimos: Math.round(Number(order.total_final) * 100),
      moneda: 'PEN',
      respuesta_segura: culqiOrders.sanitizeOrder(culqiOrder),
    });
  }
  return culqiOrder;
};

exports.create = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const body = req.body;
    if (!Array.isArray(body.items) || !body.items.length) throw new Error('El carrito está vacío');
    if (!body.cliente_email || !body.cliente_nombre || !body.cliente_telefono) throw new Error('Faltan datos del cliente');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.cliente_email).trim())) throw new Error('Correo electrónico inválido');
    if (!/^\+?[0-9\s-]{7,20}$/.test(String(body.cliente_telefono).trim())) throw new Error('Teléfono inválido');
    if (!['domicilio', 'recojo_tienda'].includes(body.tipo_entrega)) throw new Error('Tipo de entrega inválido');
    if (!['yape', 'billetera_digital', 'pago_efectivo', 'cuotealo', 'transferencia', 'tarjeta', 'contraentrega'].includes(body.metodo_pago)) throw new Error('Método de pago inválido');
    const type = body.tipo_comprobante || (body.requiere_factura ? 'factura' : 'boleta');
    if (!['boleta', 'factura'].includes(type)) throw new Error('Las compras web requieren boleta o factura');
    if (type === 'factura' && (body.cliente_documento_tipo !== 'RUC' || !/^\d{11}$/.test(body.cliente_documento_numero || ''))) {
      throw new Error('La factura requiere un RUC válido de 11 dígitos');
    }
    if (type === 'factura' && !String(body.razon_social || '').trim()) throw new Error('La factura requiere razón social');

    const requestedTotals = new Map();
    for (const requested of body.items) {
      const productId = Number(requested.productId);
      const quantity = Number(requested.quantity);
      if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1) throw new Error('Producto o cantidad invalida');
      requestedTotals.set(productId, (requestedTotals.get(productId) || 0) + quantity);
    }
    const normalized = [];
    for (const [productId, quantity] of requestedTotals) {
      const product = await Producto.scope('allBusinesses').findByPk(productId, { transaction, lock: transaction.LOCK.SHARE });
      if (!product) throw new Error('Producto no disponible');
      // Disponible = stock físico - reservado por otros pedidos web pagados y
      // aún no entregados (no se han descontado de verdad, pero ya están comprometidos).
      if (Number(product.stock) - Number(product.stock_reservado) < quantity) throw new Error(`Stock insuficiente para ${product.nombre}`);
      const price = Number(product.es_oferta && product.precio_oferta_con_igv ? product.precio_oferta_con_igv : product.precio_unitario_con_igv);
      normalized.push({ product, quantity, price, subtotal: price * quantity });
    }
    const subtotal = normalized.reduce((sum, item) => sum + item.subtotal, 0);
    const affiliateSubtotal = normalized.filter(item => item.product.affiliate_business_id).reduce((sum, item) => sum + item.subtotal, 0);
    // El recargo cubre el procesamiento con tarjeta de mercadería afiliada.
    // Se calcula en servidor para impedir que el navegador lo omita o altere.
    const cardSurcharge = body.metodo_pago === 'tarjeta' ? Math.round(affiliateSubtotal * 0.05 * 100) / 100 : 0;
    if (body.tipo_entrega === 'domicilio' && (!body.direccion_envio || !body.direccion_departamento || !body.direccion_provincia || !body.direccion_distrito)) {
      throw new Error('El delivery requiere departamento, provincia, distrito y dirección');
    }
    const shipping = (await shippingQuote.quote(body)).amount;
    const totalFinal = subtotal + shipping + cardSurcharge;
    // Yape vía Culqi ("cargo único") acepta hasta S/2,000 por pago; por encima
    // de eso Culqi lo rechazaría, así que lo bloqueamos antes de crear el pedido.
    if (body.metodo_pago === 'yape' && totalFinal > 2000) {
      throw new Error('Yape acepta compras de hasta S/2,000. Elige tarjeta, billetera digital u otro método para este monto.');
    }
    // Billetera digital usa "Órdenes de Pago" de Culqi: el mínimo de S/6 lo
    // impone la API de Culqi (confirmado directamente); el máximo de S/500 no
    // lo impone Culqi, es el límite práctico de las apps de Yape/Plin para QR.
    if (body.metodo_pago === 'billetera_digital' && (totalFinal < 6 || totalFinal > 500)) {
      throw new Error('Billetera digital acepta compras entre S/6 y S/500. Elige tarjeta, Yape u otro método para este monto.');
    }
    // Cuotéalo (financiamiento BCP) acepta entre S/100 y S/50,000 según el
    // manual de Culqi; la API de Órdenes sí acepta montos altos sin rechazarlos.
    if (body.metodo_pago === 'cuotealo' && (totalFinal < 100 || totalFinal > 50000)) {
      throw new Error('Cuotéalo acepta compras entre S/100 y S/50,000. Elige otro método para este monto.');
    }
    const user = optionalUser(req);
    const number = `CG-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const paymentToken = crypto.randomBytes(24).toString('base64url');
    const order = await Pedido.create({
      numero_pedido: number,
      payment_token_hash: hashPaymentToken(paymentToken),
      id_usuario: user?.id_user || user?.id || null,
      cliente_email: String(body.cliente_email).trim().toLowerCase(),
      cliente_nombre: body.cliente_nombre,
      cliente_telefono: body.cliente_telefono,
      cliente_documento_tipo: body.cliente_documento_tipo || null,
      cliente_documento_numero: body.cliente_documento_numero || null,
      razon_social: body.razon_social || null,
      tipo_entrega: body.tipo_entrega,
      direccion_envio: body.direccion_envio || null,
      direccion_departamento: body.direccion_departamento || null,
      direccion_provincia: body.direccion_provincia || null,
      direccion_distrito: body.direccion_distrito || null,
      direccion_referencia: body.direccion_referencia || null,
      metodo_pago: body.metodo_pago,
      tipo_comprobante: type,
      subtotal,
      costo_envio: shipping,
      recargo_tarjeta: cardSurcharge,
      total_final: totalFinal,
      notas_cliente: body.notas_cliente || null,
    }, { transaction });
    await PedidoDetalle.bulkCreate(normalized.map(({ product, quantity, price, subtotal: line }) => ({
      id_pedido: order.id_pedido,
      producto_id: product.id_producto,
      producto_nombre: product.nombre,
      cantidad: quantity,
      precio_unitario_con_igv: price,
      subtotal_con_igv: line,
      condicion: product.condicion || 'nuevo',
      garantia_meses: product.garantia_meses ?? (product.condicion === 'segunda_mano' ? 3 : 12),
      estado_observaciones: product.estado_observaciones || null,
      affiliate_business_id: product.affiliate_business_id || null,
      propietario_id: product.propietario_id || null,
      comision_porcentaje: product.affiliate_business_id ? 8 : 0,
    })), { transaction });
    await transaction.commit();
    const createdOrder = await Pedido.findByPk(order.id_pedido, { include: orderInclude });

    let culqiOrderId = null;
    let billeteraSetupError = null;
    if (ORDER_METODOS.includes(body.metodo_pago)) {
      try {
        const culqiOrder = await setUpCulqiOrder(createdOrder);
        culqiOrderId = culqiOrder.id;
      } catch (setupError) {
        // El pedido ya quedó creado; el cliente puede reintentar desde
        // "Mis pedidos" (reissuePaymentToken vuelve a crear la orden Culqi).
        billeteraSetupError = setupError.response?.data?.merchant_message || setupError.message;
      }
    }

    res.status(201).json({
      success: true,
      pedido: safeOrder(createdOrder),
      payment_token: paymentToken,
      culqi_public_key: await culqi.publicKey(),
      culqi_order_id: culqiOrderId,
      payment_required: body.metodo_pago === 'tarjeta' || body.metodo_pago === 'yape' || Boolean(culqiOrderId),
      billetera_setup_error: billeteraSetupError,
    });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.payWithCulqi = async (req, res) => {
  let payment;
  let order;
  let charge;
  let preparation;
  let finalization;
  try {
    // Persist the payment intent before contacting Culqi. This makes an
    // externally approved charge recoverable even if local finalization fails.
    preparation = await sequelize.transaction();
    order = await Pedido.findByPk(req.params.id, { transaction: preparation, lock: preparation.LOCK.UPDATE });
    if (!order) throw new Error('Pedido no encontrado');
    if (!validPaymentToken(order, req.get('x-order-payment-token'))) throw new Error('Autorización de pago inválida');
    if (order.estado_pago === 'pagado') { await preparation.rollback(); return res.json({ success: true, pedido: safeOrder(order), already_paid: true }); }
    const key = `order-${order.id_pedido}-culqi`;
    payment = await Pago.findOne({ where: { idempotency_key: key }, transaction: preparation });
    if (!payment) payment = await Pago.create({ id_pedido: order.id_pedido, proveedor: 'culqi', idempotency_key: key, monto_centimos: Math.round(Number(order.total_final) * 100), moneda: 'PEN' }, { transaction: preparation });
    await preparation.commit();

    charge = payment.proveedor_id
      ? await culqi.retrieveCharge(payment.proveedor_id)
      : await culqi.createCharge({ token: req.body.token, amount: payment.monto_centimos, email: order.cliente_email, orderNumber: order.numero_pedido, idempotencyKey: key, antifraudDetails: antifraudDetailsFor(order) });

    const validCharge = charge.outcome?.type === 'venta_exitosa' && Number(charge.amount) === Number(payment.monto_centimos);
    if (!validCharge) throw new Error('El cargo Culqi no coincide con el pedido');

    finalization = await sequelize.transaction();
    const lockedPayment = await Pago.findByPk(payment.id_pago, { transaction: finalization, lock: finalization.LOCK.UPDATE });
    await lockedPayment.update({ proveedor_id: charge.id, respuesta_segura: culqi.sanitizeCharge(charge) }, { transaction: finalization });
    await finalizePaidOrder(order.id_pedido, finalization, { pasarela_pago: 'culqi' });
    await lockedPayment.update({ estado: 'pagado' }, { transaction: finalization });
    await finalization.commit();
    res.json({ success: true, numero_pedido: order.numero_pedido, charge: culqi.sanitizeCharge(charge) });
  } catch (error) {
    if (finalization && !finalization.finished) await finalization.rollback().catch(() => {});
    if (preparation && !preparation.finished) await preparation.rollback().catch(() => {});
    // Do not hide or retry blindly an already approved external charge.
    if (charge?.id && payment?.id_pago) {
      await Pago.update({ proveedor_id: charge.id, estado: 'fallido', respuesta_segura: culqi.sanitizeCharge(charge) }, { where: { id_pago: payment.id_pago } }).catch(() => {});
      return res.status(202).json({ success: false, pending_reconciliation: true, message: 'El pago fue recibido y el pedido está en verificación. No vuelvas a pagarlo.' });
    }
    res.status(400).json({ success: false, message: error.response?.data?.merchant_message || error.message });
  }
};

exports.track = async (req, res) => {
  const order = await Pedido.findOne({ where: { numero_pedido: req.params.numero }, include: orderInclude });
  if (!order) return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
  res.json({ success: true, pedido: publicOrder(order) });
};

exports.mine = async (req, res) => {
  const user = optionalUser(req);
  if (!user) return res.status(401).json({ success: false, message: 'No autorizado' });
  const orders = await Pedido.findAll({ where: { id_usuario: user.id_user || user.id }, include: orderInclude, order: [['fecha_creacion', 'DESC']] });
  res.json({ success: true, pedidos: orders.map(safeOrder) });
};

exports.adminList = async (req, res) => {
  const ownedIds = await affiliateOrderIds(req);
  const orders = await Pedido.findAll({
    where: ownedIds ? { id_pedido: { [Op.in]: ownedIds } } : undefined,
    include: orderInclude,
    order: [['fecha_creacion', 'DESC']],
    limit: 200,
  });
  res.json({ success: true, pedidos: orders.map(safeOrder) });
};

exports.adminPayments = async (req, res) => {
  const ownedIds = await affiliateOrderIds(req);
  const payments = await Pago.findAll({
    where: ownedIds ? { id_pedido: { [Op.in]: ownedIds } } : undefined,
    include: [{ model: Pedido, as: 'pedido', attributes: ['id_pedido', 'numero_pedido', 'estado', 'estado_pago', 'total_final'] }],
    order: [['creado_en', 'DESC']],
    limit: 200,
  });
  res.json({ success: true, pagos: payments.map(item => ({
    id_pago: item.id_pago,
    id_pedido: item.id_pedido,
    proveedor: item.proveedor,
    proveedor_id: item.proveedor_id,
    monto_centimos: item.monto_centimos,
    moneda: item.moneda,
    estado: item.estado,
    detalle: item.respuesta_segura || null,
    creado_en: item.creado_en,
    actualizado_en: item.actualizado_en,
    pedido: item.pedido,
  })) });
};

exports.adminDeliveries = async (req, res) => {
  const ownedIds = await affiliateOrderIds(req);
  const orders = await Pedido.findAll({
    where: {
      ...(ownedIds ? { id_pedido: { [Op.in]: ownedIds } } : {}),
      tipo_entrega: 'domicilio',
      estado: { [Op.in]: ['confirmado', 'preparando', 'enviado'] },
      [Op.or]: [
        { estado_pago: 'pagado' },
        { metodo_pago: 'contraentrega', estado_pago: 'pendiente' },
      ],
    },
    include: orderInclude,
    order: [['fecha_actualizacion', 'ASC']],
    limit: 200,
  });
  res.json({ success: true, deliveries: orders.map(safeOrder) });
};

exports.updateStatus = async (req, res) => {
  try {
    const allowed = ['pendiente_pago', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'];
    const status = String(req.body.estado || '');
    if (!allowed.includes(status)) return res.status(422).json({ success: false, message: 'Estado de pedido inválido' });
    const preview = await Pedido.findByPk(req.params.id);
    if (!preview) return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
    if (status === 'entregado' && preview.estado_pago !== 'pagado') {
      return res.status(400).json({ success: false, message: 'No se puede entregar un pedido con pago pendiente' });
    }
    if (status === 'cancelado' && preview.estado_pago !== 'pagado' && !preview.venta_id) {
      await sequelize.transaction(transaction => deleteUnpaidOrder(preview.id_pedido, transaction));
      return res.json({ success: true, deleted: true, message: 'Pedido impago cancelado y eliminado' });
    }

    let order;
    await sequelize.transaction(async (transaction) => {
      // Se vuelve a leer y bloquear aquí (no arriba) para decidir sobre el
      // estado real en el momento del cambio, no uno ya desactualizado si dos
      // solicitudes llegan casi juntas (ej. dos clics en "Entregado").
      order = await Pedido.findByPk(req.params.id, { include: orderInclude, transaction, lock: transaction.LOCK.UPDATE });
      if (!order) throw new Error('Pedido no encontrado');

      // Solo aquí se descuenta stock físico de verdad para un pedido web — al
      // pagar solo se reserva (order-finalization.service.js). Si se cancela
      // antes de entregar, se libera la reserva sin tocar stock físico, porque
      // nunca salió nada. Nunca se repite: depende del estado real bloqueado.
      const entregaAhora = status === 'entregado' && order.estado !== 'entregado';
      const liberaPorCancelacion = status === 'cancelado' && order.estado_pago === 'pagado'
        && order.estado !== 'entregado' && order.estado !== 'cancelado';

      if (entregaAhora || liberaPorCancelacion) {
        for (const detalle of order.detalles) {
          if (!detalle.producto_id) continue; // líneas de servicio (envío, etc.) no mueven stock
          const base = {
            productoId: detalle.producto_id,
            referenciaTipo: 'pedido_web',
            referenciaId: order.id_pedido,
            usuarioId: req.user?.id || null,
            affiliateBusinessId: detalle.affiliate_business_id || null,
            transaction,
          };
          if (entregaAhora) {
            await aplicarMovimiento({ ...base, delta: -detalle.cantidad, tipo: 'venta', motivo: `Pedido web ${order.numero_pedido}: entregado` });
            await ajustarReserva({ ...base, delta: -detalle.cantidad, tipo: 'liberacion', motivo: `Pedido web ${order.numero_pedido}: reserva consumida al entregar` });
          } else {
            await ajustarReserva({ ...base, delta: -detalle.cantidad, tipo: 'liberacion', motivo: `Pedido web ${order.numero_pedido}: cancelado antes de entregar, se libera la reserva` });
          }
        }
      }
      await order.update({ estado: status }, { transaction });
    });

    return res.json({ success: true, pedido: safeOrder(order) });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.adminDelete = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const order = await Pedido.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
    }
    if (order.estado_pago === 'pagado' || order.venta_id) {
      await transaction.rollback();
      return res.status(409).json({ success: false, message: 'El pedido tiene una venta o pago confirmado y debe conservarse por trazabilidad' });
    }

    await deleteUnpaidOrder(order.id_pedido, transaction);
    await transaction.commit();
    return res.json({ success: true, message: 'Pedido eliminado correctamente' });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.reissuePaymentToken = async (req, res) => {
  const user = optionalUser(req);
  if (!user) return res.status(401).json({ success: false, message: 'No autorizado' });
  const order = await Pedido.findByPk(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
  const userId = user.id_user || user.id;
  if (order.id_usuario !== userId) return res.status(403).json({ success: false, message: 'Sin acceso al pedido' });
  if (!['tarjeta', 'yape', ...ORDER_METODOS].includes(order.metodo_pago)) {
    return res.status(400).json({ success: false, message: 'Este pedido no se paga por Culqi' });
  }
  if (order.estado_pago === 'pagado') return res.status(400).json({ success: false, message: 'El pedido ya está pagado' });
  const paymentToken = crypto.randomBytes(24).toString('base64url');
  await order.update({ payment_token_hash: hashPaymentToken(paymentToken) });

  let culqiOrderId = null;
  if (ORDER_METODOS.includes(order.metodo_pago)) {
    try {
      const culqiOrder = await setUpCulqiOrder(order);
      culqiOrderId = culqiOrder.id;
    } catch (setupError) {
      return res.status(502).json({ success: false, message: setupError.response?.data?.merchant_message || setupError.message });
    }
  }
  res.json({ success: true, payment_token: paymentToken, culqi_public_key: await culqi.publicKey(), culqi_order_id: culqiOrderId, pedido: safeOrder(order) });
};

exports.getById = async (req, res) => {
  const user = optionalUser(req);
  if (!user) return res.status(401).json({ success: false, message: 'No autorizado' });
  const order = await Pedido.findByPk(req.params.id, { include: orderInclude });
  if (!order) return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
  const userId = user.id_user || user.id;
  if (user.id_role === 4 && order.id_usuario !== userId) return res.status(403).json({ success: false, message: 'Sin acceso al pedido' });
  res.json({ success: true, pedido: safeOrder(order) });
};

exports.confirmManualPayment = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const order = await Pedido.findByPk(req.params.id, { include: orderInclude, transaction, lock: transaction.LOCK.UPDATE });
    if (!order) throw new Error('Pedido no encontrado');
    if (req.user.id_role === 3) {
      if (req.user.tipo_vendedor !== 'afiliado' || !req.user.affiliate_business_id) {
        await transaction.rollback();
        return res.status(403).json({ success: false, message: 'Solo el gerente o un auditor vigente pueden validar este pago' });
      }
      const productIds = order.detalles.map(item => item.producto_id);
      const products = await Producto.scope('allBusinesses').findAll({ where: { id_producto: productIds }, transaction });
      const ownsEntireOrder = products.length === productIds.length
        && products.every(product => Number(product.affiliate_business_id) === Number(req.user.affiliate_business_id));
      if (!ownsEntireOrder) {
        await transaction.rollback();
        return res.status(403).json({ success: false, message: 'El afiliado solo puede validar pagos de pedidos compuestos íntegramente por su propia mercadería' });
      }
    }
    if (order.estado_pago !== 'pagado') {
      await Pago.create({ id_pedido: order.id_pedido, proveedor: 'manual', idempotency_key: `order-${order.id_pedido}-manual`, monto_centimos: Math.round(Number(order.total_final) * 100), estado: 'pagado', respuesta_segura: { confirmed_by: req.user.id_user, reference: req.body.referencia || null } }, { transaction });
      await finalizePaidOrder(order.id_pedido, transaction, { pasarela_pago: 'manual' });
    }
    await transaction.commit();
    res.json({ success: true });
  } catch (error) { await transaction.rollback(); res.status(400).json({ success: false, message: error.message }); }
};

const findPaymentForWebhook = async (verifiedId, orderNumber, transaction) => {
  let payment = await Pago.findOne({ where: { proveedor_id: verifiedId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!payment && orderNumber) {
    const metadataOrder = await Pedido.findOne({ where: { numero_pedido: orderNumber }, transaction, lock: transaction.LOCK.UPDATE });
    if (metadataOrder) payment = await Pago.findOne({ where: { id_pedido: metadataOrder.id_pedido, proveedor: 'culqi' }, transaction, lock: transaction.LOCK.UPDATE });
  }
  return payment;
};

// Billetera digital (Plin, Yape u otra billetera por QR): Culqi notifica el
// cambio de estado de la Orden por el evento order.status.changed. Igual que
// con los cargos, el body del webhook es solo una notificación: se vuelve a
// pedir la orden autoritativa a la API antes de confiar en nada.
const handleOrderWebhook = async (object, res) => {
  let transaction;
  try {
    const verified = await culqiOrders.retrieveOrder(object.id);
    const orderNumber = verified.order_number || verified.metadata?.order_number;
    transaction = await sequelize.transaction();
    const payment = await findPaymentForWebhook(verified.id, orderNumber, transaction);
    if (!payment) { await transaction.rollback(); return res.status(202).json({ received: true }); }
    const localOrder = await Pedido.findByPk(payment.id_pedido, { transaction, lock: transaction.LOCK.UPDATE });
    if (!culqiOrders.isOrderPaid(verified)) {
      // Aún no está pagada (p. ej. "pending") o expiró: no es un error, solo
      // todavía no hay nada que confirmar.
      await payment.update({ respuesta_segura: culqiOrders.sanitizeOrder(verified) }, { transaction });
      await transaction.commit();
      return res.json({ received: true });
    }
    const validOrder = Number(verified.amount) === Number(payment.monto_centimos)
      && verified.currency_code === payment.moneda
      && orderNumber === localOrder?.numero_pedido;
    if (!validOrder) throw new Error('El evento de orden Culqi no coincide con el pedido');
    if (payment.estado !== 'pagado' || !localOrder.venta_id) {
      await payment.update({ proveedor_id: verified.id, respuesta_segura: culqiOrders.sanitizeOrder(verified) }, { transaction });
      await finalizePaidOrder(payment.id_pedido, transaction, { pasarela_pago: 'culqi' });
      await payment.update({ estado: 'pagado' }, { transaction });
    }
    await transaction.commit();
    res.json({ received: true });
  } catch (_error) {
    if (transaction && !transaction.finished) await transaction.rollback().catch(() => {});
    res.status(500).json({ received: false });
  }
};

const handleChargeWebhook = async (object, res) => {
  let transaction;
  try {
    // The webhook body is only a notification. Retrieve the authoritative
    // charge from Culqi before trusting amount, currency or order metadata.
    const verified = await culqi.retrieveCharge(object.id);
    const orderNumber = verified.metadata?.order_number;
    transaction = await sequelize.transaction();
    const payment = await findPaymentForWebhook(verified.id, orderNumber, transaction);
    if (!payment) { await transaction.rollback(); return res.status(202).json({ received: true }); }
    const localOrder = await Pedido.findByPk(payment.id_pedido, { transaction, lock: transaction.LOCK.UPDATE });
    const validCharge = verified.outcome?.type === 'venta_exitosa'
      && Number(verified.amount) === Number(payment.monto_centimos)
      && verified.currency_code === payment.moneda
      && orderNumber === localOrder?.numero_pedido;
    if (!validCharge) throw new Error('El evento Culqi no coincide con el pedido');
    if (payment.estado !== 'pagado' || !localOrder.venta_id) {
      await payment.update({ proveedor_id: verified.id, respuesta_segura: culqi.sanitizeCharge(verified) }, { transaction });
      await finalizePaidOrder(payment.id_pedido, transaction, { pasarela_pago: 'culqi' });
      await payment.update({ estado: 'pagado' }, { transaction });
    }
    await transaction.commit();
    res.json({ received: true });
  } catch (_error) {
    if (transaction && !transaction.finished) await transaction.rollback().catch(() => {});
    res.status(500).json({ received: false });
  }
};

exports.webhook = async (req, res) => {
  const object = req.body?.data?.object || req.body?.object;
  if (!object?.id) return res.status(202).json({ received: true });
  if (!await culqi.isConfigured()) return res.status(503).json({ received: false });
  const isOrderEvent = object.object === 'order' || /^ord_/.test(String(object.id));
  if (isOrderEvent) return handleOrderWebhook(object, res);
  return handleChargeWebhook(object, res);
};
