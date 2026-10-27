const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Op } = require("sequelize");
const {
  OrdenServicio,
  OrdenServicioEvento,
  OrdenServicioPago,
  OrdenServicioRepuesto,
  Producto,
  OrdenServicioEvidencia,
  OrdenServicioCanalEvento,
  OrdenServicioCotizacion,
  User,
  MovimientoInventario,
  ClienteServicio,
  ActivoTecnico,
  OrdenServicioCredencial,
  sequelize,
} = require("../models");
const { finalizeServiceOrderBilling } = require('../services/service-order-finalization.service');
const { reserveQuant, closeReservations } = require('../services/inventory-quant.service');

exports.technicians = async (_req, res) => {
  try {
    const users = await User.findAll({ where: { id_role: 6 }, attributes: ["id_user", "name", "telefono"], order: [["name", "ASC"]] });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const allowedTypes = ["servicio_tecnico", "armado_pc", "mantenimiento"];
const maintenanceSubtypes = ["preventivo", "correctivo", "optimizacion", "limpieza_profunda"];
const allowedStates = [
  "recibido",
  "diagnostico",
  "cotizado",
  "aprobado",
  "en_proceso",
  "pruebas",
  "listo",
  "entregado",
  "cancelado",
];
const stateTransitions = {
  recibido: ['diagnostico', 'cancelado'],
  diagnostico: ['cotizado', 'en_proceso', 'cancelado'],
  cotizado: ['diagnostico', 'aprobado', 'cancelado'],
  aprobado: ['en_proceso', 'cancelado'],
  en_proceso: ['pruebas', 'cancelado'],
  pruebas: ['en_proceso', 'listo', 'cancelado'],
  listo: ['pruebas', 'entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
};
const numericFields = [
  "costo_repuestos",
  "costo_mano_obra",
  "descuento",
  "recargo",
  "adelanto",
  "garantia_dias",
];
const editableFields = [
  "tipo",
  "subtipo_trabajo",
  "tareas_solicitadas",
  "codigo",
  "cliente_servicio_id",
  "activo_tecnico_id",
  "cliente",
  "telefono",
  "whatsapp_consentimiento",
  "documento",
  "equipo",
  "numero_serie",
  "detalle",
  "accesorios",
  "estado_fisico",
  "accesorios_recibidos",
  "recepcion_conforme",
  "diagnostico_configuracion",
  "trabajo_realizado",
  "estado",
  "moneda",
  "costo_repuestos",
  "costo_mano_obra",
  "descuento",
  "recargo",
  "adelanto",
  "fecha_ingreso",
  "fecha_entrega_estimada",
  "garantia_dias",
  "garantia_cobertura",
  "garantia_exclusiones",
  "orden_origen_garantia_id",
  "notas",
  "tecnico_id",
];
const userId = (req) => req.user.id_user || req.user.id;
const tenantId = req => req.user.tipo_vendedor === 'afiliado' ? Number(req.user.affiliate_business_id) : null;
const tenantWhere = req => ({ affiliate_business_id: tenantId(req) });
const businessKey = req => tenantId(req) ? `affiliate:${tenantId(req)}` : 'central';
const findOrder = (req, id, options = {}) => OrdenServicio.findOne({ ...options, where: { ...(options.where || {}), id_orden_servicio: id, ...tenantWhere(req) } });
const findOrderProduct = (record, id, options = {}) => Producto.findOne({
  ...options,
  where: { ...(options.where || {}), id_producto: id, affiliate_business_id: record.affiliate_business_id },
});
const validateTechnicalLinks = async (req, data, transaction, createMissing = false) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (email && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Correo del cliente inválido');
  let client = null;
  let asset = null;
  if (data.cliente_servicio_id) {
    client = await ClienteServicio.findOne({ where: { id_cliente_servicio: Number(data.cliente_servicio_id), ...tenantWhere(req) }, transaction });
    if (!client) throw new Error('El cliente registrado no existe en este negocio');
  }
  if (data.activo_tecnico_id) {
    asset = await ActivoTecnico.findOne({ where: { id_activo_tecnico: Number(data.activo_tecnico_id), ...tenantWhere(req) }, transaction });
    if (!asset) throw new Error('El activo técnico no existe en este negocio');
    if (client && Number(asset.id_cliente_servicio) !== Number(client.id_cliente_servicio))
      throw new Error('El activo técnico no pertenece al cliente seleccionado');
    if (!client) {
      client = await ClienteServicio.findOne({ where: { id_cliente_servicio: asset.id_cliente_servicio, ...tenantWhere(req) }, transaction });
      data.cliente_servicio_id = asset.id_cliente_servicio;
    }
  }
  if (createMissing && !client) {
    const candidates = [];
    if (String(data.documento || '').trim()) candidates.push({ documento: String(data.documento).trim() });
    if (String(data.telefono || '').trim()) candidates.push({ telefono: String(data.telefono).trim() });
    if (candidates.length)
      client = await ClienteServicio.findOne({ where: { ...tenantWhere(req), [Op.or]: candidates }, transaction });
    if (!client) client = await ClienteServicio.create({
      nombre: String(data.cliente).trim(), documento: String(data.documento || '').trim() || null,
      telefono: String(data.telefono || '').trim() || null, ...tenantWhere(req), negocio_clave: businessKey(req),
      creado_por: userId(req),
    }, { transaction });
    data.cliente_servicio_id = client.id_cliente_servicio;
  }
  if (createMissing && email && client) await client.update({ email }, { transaction });
  if (createMissing && !asset) {
    const serial = String(data.numero_serie || '').trim();
    if (serial) asset = await ActivoTecnico.findOne({
      where: { ...tenantWhere(req), [Op.or]: [{ numero_serie: serial }, { imei: serial }] }, transaction,
    });
    if (asset && Number(asset.id_cliente_servicio) !== Number(client.id_cliente_servicio))
      throw new Error('La serie o IMEI ya pertenece a otro cliente');
    if (!asset) asset = await ActivoTecnico.create({
      id_cliente_servicio: client.id_cliente_servicio, tipo: String(data.equipo).trim(),
      numero_serie: serial || null, ...tenantWhere(req), negocio_clave: businessKey(req), creado_por: userId(req),
    }, { transaction });
    data.activo_tecnico_id = asset.id_activo_tecnico;
  }
  // Las columnas legadas se conservan como instantánea del expediente.
  if (client) {
    data.cliente = client.nombre;
    data.documento = client.documento;
    data.telefono = client.telefono;
  }
  if (asset) {
    data.equipo = [asset.tipo, asset.marca, asset.modelo].filter(Boolean).join(' · ');
    data.numero_serie = asset.numero_serie || asset.imei;
  }
};
const paymentMethods = ["efectivo", "pos", "qr", "transferencia", "otro", "tarjeta", "yape", "plin", "pago_link"];
const evidenceStages = [
  "recepcion",
  "diagnostico",
  "reparacion",
  "pruebas",
  "entrega",
  "otro",
  "firma_recepcion",
  "firma_garantia",
];
// Etapas de firma digital (S1): siempre privadas, requieren firmante y hash.
const signatureStages = ["firma_recepcion", "firma_garantia"];
const credentialKey = () => {
  const secret = process.env.SERVICE_CREDENTIAL_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('Configura SERVICE_CREDENTIAL_KEY para usar la bóveda temporal');
  return crypto.createHash('sha256').update(secret).digest();
};
const encryptCredential = value => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { secreto_cifrado: encrypted.toString('base64'), iv: iv.toString('hex'), auth_tag: cipher.getAuthTag().toString('hex') };
};
const decryptCredential = row => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(row.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.auth_tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(row.secreto_cifrado, 'base64')), decipher.final()]).toString('utf8');
};
const confirmedPaymentsTotal = async (id, transaction) =>
  Number(
    (await OrdenServicioPago.sum("monto", {
      where: { id_orden_servicio: id, estado: "confirmado" },
      transaction,
    })) || 0,
  );
const partsTotal = async (id, transaction) => {
  const parts = await OrdenServicioRepuesto.findAll({
    attributes: ['cantidad', 'precio_unitario'],
    where: {
      id_orden_servicio: id,
      estado_stock: ["no_aplica", "reservado", "consumido"],
    },
    transaction,
  });
  return Number(parts.reduce((sum, part) => sum + Number(part.cantidad) * Number(part.precio_unitario), 0).toFixed(2));
};
const restoreReservedParts = async (record, transaction, actorId) => {
  const parts = await OrdenServicioRepuesto.findAll({
    where: {
      id_orden_servicio: record.id_orden_servicio,
      estado_stock: "reservado",
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  for (const part of parts) {
    if (part.id_producto) {
      const product = await findOrderProduct(record, part.id_producto, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (product) {
        const stockAnterior = Number(product.stock);
        await product.increment("stock", { by: part.cantidad, transaction });
        await MovimientoInventario.create({
          producto_id: product.id_producto,
          tipo: 'liberacion',
          cantidad: part.cantidad,
          stock_anterior: stockAnterior,
          stock_nuevo: stockAnterior + Number(part.cantidad),
          costo_unitario: product.costo_promedio || null,
          referencia_tipo: 'orden_servicio',
          referencia_id: record.id_orden_servicio,
          motivo: `Liberación por cancelación de ${record.codigo}`,
          usuario_id: actorId,
          affiliate_business_id: record.affiliate_business_id || null,
        }, { transaction });
      }
    }
    await part.update({ estado_stock: "devuelto" }, { transaction });
    await closeReservations({ repuestoId: part.id_repuesto_servicio, estado: 'liberada', userId: actorId, transaction });
  }
  if (parts.length)
    await record.update(
      {
        costo_repuestos: await partsTotal(
          record.id_orden_servicio,
          transaction,
        ),
      },
      { transaction },
    );
  return parts.length;
};
const addDays = (date, days) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + Number(days || 0));
  return value.toISOString().slice(0, 10);
};
const normalize = (body) => {
  const data = {};
  editableFields.forEach((field) => {
    if (body[field] !== undefined)
      data[field] = body[field] === "" ? null : body[field];
  });
  for (const field of ['estado_fisico', 'accesorios_recibidos', 'tareas_solicitadas']) {
    if (data[field] == null) continue;
    if (!Array.isArray(data[field])) throw new Error(`${field} debe ser una lista`);
    data[field] = data[field].map(value => String(value).trim()).filter(Boolean).slice(0, 50);
  }
  if (body.recepcion_conforme !== undefined) {
    data.recepcion_conforme = body.recepcion_conforme === true || body.recepcion_conforme === 'true';
    data.recepcion_conforme_en = data.recepcion_conforme ? new Date() : null;
  }
  if (body.whatsapp_consentimiento !== undefined) {
    data.whatsapp_consentimiento = body.whatsapp_consentimiento === true || body.whatsapp_consentimiento === 'true';
    data.whatsapp_consentimiento_en = data.whatsapp_consentimiento ? new Date() : null;
    data.whatsapp_consentimiento_revocado_en = data.whatsapp_consentimiento ? null : new Date();
    data.whatsapp_consentimiento_fuente = data.whatsapp_consentimiento ? String(body.whatsapp_consentimiento_fuente || 'recepcion').slice(0, 80) : null;
  }
  if (!allowedTypes.includes(data.tipo))
    throw new Error("Tipo de orden no válido");
  if (data.tipo === 'mantenimiento' && !maintenanceSubtypes.includes(data.subtipo_trabajo))
    throw new Error("Selecciona un tipo de mantenimiento válido");
  if (!allowedStates.includes(data.estado))
    throw new Error("Estado de orden no válido");
  if (
    !String(data.codigo || "").trim() ||
    (!String(data.cliente || "").trim() && !data.cliente_servicio_id && !data.activo_tecnico_id) ||
    (!String(data.equipo || "").trim() && !data.activo_tecnico_id) ||
    !String(data.detalle || "").trim()
  )
    throw new Error("Código, cliente, equipo y detalle son obligatorios");
  numericFields.forEach((field) => {
    data[field] = Number(data[field] || 0);
  });
  if (
    numericFields.some(
      (field) => !Number.isFinite(data[field]) || data[field] < 0,
    )
  )
    throw new Error(
      "Los costos, adelanto y garantía deben ser valores no negativos",
    );
  const total =
    data.costo_repuestos + data.costo_mano_obra + data.recargo - data.descuento;
  if (total < 0)
    throw new Error("El descuento no puede superar el subtotal más el recargo");
  if (data.adelanto > total)
    throw new Error("El adelanto no puede superar el total");
  return data;
};
exports.list = async (req, res) => {
  const where = { anulada: false, ...tenantWhere(req) };
  if (allowedTypes.includes(req.query.tipo)) where.tipo = req.query.tipo;
  res.json(
    await OrdenServicio.findAll({
      where,
      include: [
        { model: ClienteServicio, as: 'cliente_registrado', required: false },
        { model: ActivoTecnico, as: 'activo', required: false },
      ],
      order: [["creado_en", "DESC"]],
    }),
  );
};
exports.cashSummary = async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || ""))
      ? String(req.query.fecha)
      : require('../services/cash-ledger.service').limaDay(new Date());
    let start = new Date(`${date}T00:00:00-05:00`);
    let end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    if (req.query.periodo === 'semana') start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (req.query.periodo === 'mes') start = new Date(`${date.slice(0, 7)}-01T00:00:00-05:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.hasta || ''))) {
      start = new Date(`${req.query.desde}T00:00:00-05:00`);
      end = new Date(new Date(`${req.query.hasta}T00:00:00-05:00`).getTime() + 24 * 60 * 60 * 1000);
    }
    const createdRange = { [Op.gte]: start, [Op.lt]: end };
    const activeOrders = await OrdenServicio.findAll({ where: { anulada: false, ...tenantWhere(req) } });
    const orderIds = activeOrders.map(order => order.id_orden_servicio);
    const childScope = { id_orden_servicio: { [Op.in]: orderIds.length ? orderIds : [-1] } };
    const [payments, parts] = await Promise.all([
      OrdenServicioPago.findAll({ where: { creado_en: createdRange, ...childScope } }),
      OrdenServicioRepuesto.findAll({
        where: {
          creado_en: createdRange,
          estado_stock: ["no_aplica", "reservado", "consumido"],
          ...childScope,
        },
      }),
    ]);
    const currencies = {};
    const bucket = currency => currencies[currency] ||= {
      cobrado: 0,
      cobrado_servicios: 0,
      cobrado_repuestos: 0,
      anulado: 0,
      costo_repuestos: 0,
      saldo_por_cobrar: 0,
      por_metodo: { efectivo: 0, pos: 0, qr: 0, transferencia: 0, otro: 0, tarjeta: 0, yape: 0, plin: 0, pago_link: 0 },
    };
    const ordersById = new Map(activeOrders.map(order => [Number(order.id_orden_servicio), order]));
    payments.forEach(payment => {
      const summary = bucket(payment.moneda);
      const amount = Number(payment.monto);
      if (payment.estado === "confirmado") {
        summary.cobrado += amount;
        summary.por_metodo[payment.metodo] += amount;
        const order = ordersById.get(Number(payment.id_orden_servicio));
        const partsAmount = Number(order?.costo_repuestos || 0);
        const serviceAmount = Math.max(0, Number(order?.costo_mano_obra || 0) + Number(order?.recargo || 0) - Number(order?.descuento || 0));
        const orderTotal = partsAmount + serviceAmount;
        summary.cobrado_repuestos += orderTotal ? amount * partsAmount / orderTotal : 0;
        summary.cobrado_servicios += orderTotal ? amount * serviceAmount / orderTotal : amount;
      } else summary.anulado += amount;
    });
    const orderCurrency = new Map(activeOrders.map(order => [order.id_orden_servicio, order.moneda]));
    parts.forEach(part => {
      const summary = bucket(orderCurrency.get(part.id_orden_servicio) || "PEN");
      summary.costo_repuestos += Number(part.cantidad) * Number(part.costo_unitario);
    });
    activeOrders.forEach(order => {
      const total = Math.max(0, Number(order.costo_repuestos) + Number(order.costo_mano_obra) + Number(order.recargo || 0) - Number(order.descuento || 0));
      bucket(order.moneda).saldo_por_cobrar += Math.max(0, total - Number(order.adelanto || 0));
    });
    Object.values(currencies).forEach(summary => {
      summary.margen_bruto = Number((summary.cobrado - summary.costo_repuestos).toFixed(2));
      for (const key of ["cobrado", "cobrado_servicios", "cobrado_repuestos", "anulado", "costo_repuestos", "saldo_por_cobrar"])
        summary[key] = Number(summary[key].toFixed(2));
      for (const method of Object.keys(summary.por_metodo))
        summary.por_metodo[method] = Number(summary.por_metodo[method].toFixed(2));
    });
    res.json({ fecha: date, periodo: { desde: start.toISOString(), hasta: end.toISOString() }, monedas: currencies });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
exports.history = async (req, res) => {
  if (!await findOrder(req, req.params.id)) return res.status(404).json({ message: "Orden no encontrada" });
  return res.json(
    await OrdenServicioEvento.findAll({
      where: { id_orden_servicio: req.params.id },
      order: [["creado_en", "ASC"]],
    }),
  );
};
exports.payments = async (req, res) => {
  if (!await findOrder(req, req.params.id)) return res.status(404).json({ message: "Orden no encontrada" });
  return res.json(
    await OrdenServicioPago.findAll({
      where: { id_orden_servicio: req.params.id },
      order: [["creado_en", "ASC"]],
    }),
  );
};
exports.addPayment = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const record = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record) {
      await transaction.rollback();
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    if (record.anulada)
      throw new Error("No se pueden registrar pagos en una orden anulada");
    const metodo = String(req.body.metodo || "").trim();
    const monto = Number(req.body.monto);
    const referencia = String(req.body.referencia || "").trim() || null;
    const nota = String(req.body.nota || "").trim() || null;
    if (!paymentMethods.includes(metodo))
      throw new Error("Método de pago no válido");
    if (!Number.isFinite(monto) || monto <= 0)
      throw new Error("El monto debe ser mayor que cero");
    if (["pos", "qr", "transferencia", "tarjeta", "yape", "plin", "pago_link"].includes(metodo) && !referencia)
      throw new Error(
        "La referencia de operación es obligatoria para este método",
      );
    const total = Math.max(
      0,
      Number(record.costo_repuestos) +
        Number(record.costo_mano_obra) +
        Number(record.recargo || 0) -
        Number(record.descuento || 0),
    );
    const paid = await confirmedPaymentsTotal(
      record.id_orden_servicio,
      transaction,
    );
    if (monto > total - paid + 0.001)
      throw new Error("El pago supera el saldo pendiente de la orden");
    const payment = await OrdenServicioPago.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        metodo,
        monto,
        moneda: record.moneda,
        referencia,
        nota,
        registrado_por: userId(req),
      },
      { transaction },
    );
    const newPaid = Number((paid + monto).toFixed(2));
    await record.update({ adelanto: newPaid }, { transaction });
    let billing = null;
    if (Math.abs(total - newPaid) < 0.001) {
      billing = await finalizeServiceOrderBilling(record.id_orden_servicio, userId(req), transaction);
    }
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "pago",
        estado_anterior: record.estado,
        estado_nuevo: record.estado,
        detalle: `Pago ${metodo}: ${record.moneda} ${monto.toFixed(2)}${referencia ? ` · Ref. ${referencia}` : ""}`,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.status(201).json({
      payment,
      pagado: newPaid,
      saldo: Number((total - newPaid).toFixed(2)),
      facturacion: billing ? {
        venta_id: billing.sale.venta_id,
        clasificacion_fiscal: billing.order.clasificacion_fiscal,
        estado: billing.order.estado_facturacion,
      } : null,
    });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.voidPayment = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const motivo = String(req.body.motivo || "").trim();
    if (!motivo) throw new Error("El motivo de anulación es obligatorio");
    const payment = await OrdenServicioPago.findOne({
      where: {
        id_pago_servicio: req.params.paymentId,
        id_orden_servicio: req.params.id,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const record = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!payment || !record) {
      await transaction.rollback();
      return res.status(404).json({ message: "Pago no encontrado" });
    }
    if (payment.estado === "anulado")
      throw new Error("El pago ya está anulado");
    if (record.venta_id)
      throw new Error('El pago pertenece a una venta de servicio ya facturada; debe anularse mediante el flujo contable');
    await payment.update(
      {
        estado: "anulado",
        anulado_por: userId(req),
        anulado_en: new Date(),
        anulacion_motivo: motivo,
      },
      { transaction },
    );
    const paid = await confirmedPaymentsTotal(
      record.id_orden_servicio,
      transaction,
    );
    await record.update({ adelanto: paid }, { transaction });
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "pago_anulado",
        estado_anterior: record.estado,
        estado_nuevo: record.estado,
        detalle: `${motivo} · ${payment.moneda} ${Number(payment.monto).toFixed(2)}`,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.json({ message: "Pago anulado con trazabilidad", pagado: paid });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.parts = async (req, res) => {
  if (!await findOrder(req, req.params.id)) return res.status(404).json({ message: "Orden no encontrada" });
  return res.json(
    await OrdenServicioRepuesto.findAll({
      where: { id_orden_servicio: req.params.id },
      order: [["creado_en", "ASC"]],
    }),
  );
};
exports.addPart = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const record = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record) {
      await transaction.rollback();
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    if (record.anulada || ["cancelado", "entregado"].includes(record.estado))
      throw new Error(
        "La orden no admite nuevos repuestos en su estado actual",
      );
    if (record.venta_id)
      throw new Error('La orden ya generó su venta contable y no admite nuevos repuestos');
    const cantidad = Number(req.body.cantidad);
    const requestedPrice = Number(req.body.precio_unitario);
    const requestedCost = Number(req.body.costo_unitario ?? 0);
    if (!Number.isInteger(cantidad) || cantidad <= 0)
      throw new Error("La cantidad debe ser un entero mayor que cero");
    let product = null;
    if (req.body.id_producto) {
      product = await findOrderProduct(record, req.body.id_producto, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!product) throw new Error("Producto de inventario no encontrado");
      if (Number(product.stock) < cantidad)
        throw new Error(
          `Stock insuficiente para ${product.nombre}. Disponible: ${product.stock}`,
        );
    }
    const descripcion = String(
      product?.nombre || req.body.descripcion || "",
    ).trim();
    const productPrice = Number(
      product?.precio_unitario_con_igv ?? product?.precio_unitario,
    );
    const precio =
      Number.isFinite(requestedPrice) && requestedPrice >= 0
        ? requestedPrice
        : productPrice;
    const costo =
      Number.isFinite(requestedCost) && requestedCost >= 0 ? requestedCost : 0;
    if (!descripcion)
      throw new Error("La descripción del repuesto es obligatoria");
    if (!Number.isFinite(precio) || precio < 0)
      throw new Error("El precio unitario no es válido");
    if (product) {
      const stockAnterior = Number(product.stock);
      await product.decrement("stock", { by: cantidad, transaction });
      await MovimientoInventario.create({
        producto_id: product.id_producto,
        tipo: 'reserva',
        cantidad,
        stock_anterior: stockAnterior,
        stock_nuevo: stockAnterior - cantidad,
        costo_unitario: product.costo_promedio || null,
        referencia_tipo: 'orden_servicio',
        referencia_id: record.id_orden_servicio,
        motivo: `Reserva para ${record.codigo}`,
        usuario_id: userId(req),
        affiliate_business_id: record.affiliate_business_id || null,
      }, { transaction });
    }
    const part = await OrdenServicioRepuesto.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        id_producto: product?.id_producto || null,
        sku: product?.sku || String(req.body.sku || "").trim() || null,
        descripcion,
        cantidad,
        costo_unitario: costo,
        precio_unitario: precio,
        estado_stock: product ? "reservado" : "no_aplica",
        registrado_por: userId(req),
      },
      { transaction },
    );
    if (product) await reserveQuant({
      productoId: product.id_producto, cantidad, ubicacionId: req.body.ubicacion_id,
      lote: req.body.lote, numeroSerie: req.body.numero_serie,
      repuestoId: part.id_repuesto_servicio, userId: userId(req),
      affiliateBusinessId: record.affiliate_business_id, transaction,
    });
    const newTotal = await partsTotal(record.id_orden_servicio, transaction);
    await record.update({ costo_repuestos: newTotal }, { transaction });
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "repuesto",
        estado_anterior: record.estado,
        estado_nuevo: record.estado,
        detalle: `${cantidad} × ${descripcion} · ${record.moneda} ${precio.toFixed(2)}`,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.status(201).json({ part, costo_repuestos: newTotal });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.removePart = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const motivo = String(req.body.motivo || "").trim();
    if (!motivo) throw new Error("El motivo de retiro es obligatorio");
    const record = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const part = await OrdenServicioRepuesto.findOne({
      where: {
        id_repuesto_servicio: req.params.partId,
        id_orden_servicio: req.params.id,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record || !part) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ message: "Orden o repuesto no encontrado" });
    }
    if (part.estado_stock === "consumido")
      throw new Error(
        "Un repuesto consumido no puede retirarse; registra un ajuste auditado",
      );
    if (part.estado_stock === "devuelto")
      throw new Error("El repuesto ya fue retirado");
    if (part.estado_stock === "reservado" && part.id_producto) {
      const product = await findOrderProduct(record, part.id_producto, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (product)
        {
          const stockAnterior = Number(product.stock);
          await product.increment("stock", { by: part.cantidad, transaction });
          await MovimientoInventario.create({
            producto_id: product.id_producto,
            tipo: 'liberacion',
            cantidad: part.cantidad,
            stock_anterior: stockAnterior,
            stock_nuevo: stockAnterior + Number(part.cantidad),
            costo_unitario: product.costo_promedio || null,
            referencia_tipo: 'orden_servicio',
            referencia_id: record.id_orden_servicio,
            motivo: `Repuesto retirado de ${record.codigo}: ${motivo}`,
            usuario_id: userId(req),
            affiliate_business_id: record.affiliate_business_id || null,
          }, { transaction });
        }
    }
    await part.update({ estado_stock: "devuelto" }, { transaction });
    await closeReservations({ repuestoId: part.id_repuesto_servicio, estado: 'liberada', userId: userId(req), transaction });
    const newTotal = await partsTotal(record.id_orden_servicio, transaction);
    await record.update({ costo_repuestos: newTotal }, { transaction });
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "repuesto_retirado",
        estado_anterior: record.estado,
        estado_nuevo: record.estado,
        detalle: `${part.cantidad} × ${part.descripcion} · ${motivo}`,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.json({
      message: "Repuesto retirado y stock restaurado",
      costo_repuestos: newTotal,
    });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.evidence = async (req, res) => {
  if (!await findOrder(req, req.params.id)) return res.status(404).json({ message: "Orden no encontrada" });
  const records = await OrdenServicioEvidencia.findAll({
    where: { id_orden_servicio: req.params.id, eliminada: false },
    order: [["creado_en", "ASC"]],
  });
  res.json(
    records.map((record) => ({
      ...record.toJSON(),
      archivo_url: `/ordenes-servicio/${record.id_orden_servicio}/evidencias/${record.id_evidencia_servicio}/archivo`,
      nombre_archivo: undefined,
    })),
  );
};
exports.addEvidence = async (req, res) => {
  const transaction = await sequelize.transaction();
  const cleanup = () => {
    if (req.file?.path)
      fs.promises.unlink(req.file.path).catch(() => undefined);
  };
  try {
    if (!req.file) throw new Error("Selecciona un archivo de evidencia");
    const record = await findOrder(req, req.params.id, { transaction });
    if (!record || record.anulada)
      throw new Error("Orden no encontrada o anulada");
    const etapa = String(req.body.etapa || "").trim();
    if (!evidenceStages.includes(etapa))
      throw new Error("Etapa de evidencia no válida");
    const isSignature = signatureStages.includes(etapa);
    let firmanteNombre = null;
    let firmanteDni = null;
    let hashSha256 = null;
    let tipo;
    if (isSignature) {
      if (!req.file.mimetype.startsWith("image/"))
        throw new Error("La firma debe capturarse como imagen");
      firmanteNombre = String(req.body.firmante_nombre || "").trim();
      if (!firmanteNombre)
        throw new Error("Registra el nombre de quien firma");
      firmanteDni = String(req.body.firmante_dni || "").trim() || null;
      const buffer = await fs.promises.readFile(req.file.path);
      hashSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      tipo = "firma";
    } else {
      tipo = req.file.mimetype.startsWith("image/")
        ? "imagen"
        : req.file.mimetype.startsWith("audio/")
          ? "audio"
          : "documento";
    }
    const evidence = await OrdenServicioEvidencia.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        etapa,
        tipo,
        nombre_original: path.basename(req.file.originalname),
        nombre_archivo: path.basename(req.file.filename),
        mime: req.file.mimetype,
        tamano: req.file.size,
        descripcion: String(req.body.descripcion || "").trim() || null,
        firmante_nombre: firmanteNombre,
        firmante_dni: firmanteDni,
        hash_sha256: hashSha256,
        // Las firmas nunca se publican al cliente.
        visible_cliente: false,
        subida_por: userId(req),
      },
      { transaction },
    );
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "evidencia",
        estado_anterior: record.estado,
        estado_nuevo: record.estado,
        detalle: `${etapa}: ${evidence.nombre_original}`,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.status(201).json({
      ...evidence.toJSON(),
      archivo_url: `/ordenes-servicio/${record.id_orden_servicio}/evidencias/${evidence.id_evidencia_servicio}/archivo`,
      nombre_archivo: undefined,
    });
  } catch (error) {
    await transaction.rollback();
    cleanup();
    res.status(400).json({ message: error.message });
  }
};
exports.evidenceFile = async (req, res) => {
  if (!await findOrder(req, req.params.id)) return res.status(404).json({ message: "Evidencia no encontrada" });
  const evidence = await OrdenServicioEvidencia.findOne({
    where: {
      id_evidencia_servicio: req.params.evidenceId,
      id_orden_servicio: req.params.id,
      eliminada: false,
    },
  });
  if (!evidence)
    return res.status(404).json({ message: "Evidencia no encontrada" });
  const file = path.resolve(
    __dirname,
    "../uploads/private/service-evidence",
    path.basename(evidence.nombre_archivo),
  );
  if (!fs.existsSync(file))
    return res.status(404).json({ message: "Archivo no encontrado" });
  res.type(evidence.mime);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(evidence.nombre_original)}`,
  );
  res.sendFile(file);
};
exports.removeEvidence = async (req, res) => {
  const motivo = String(req.body.motivo || "").trim();
  if (!motivo)
    return res.status(400).json({ message: "El motivo es obligatorio" });
  if (!await findOrder(req, req.params.id)) return res.status(404).json({ message: "Evidencia no encontrada" });
  const evidence = await OrdenServicioEvidencia.findOne({
    where: {
      id_evidencia_servicio: req.params.evidenceId,
      id_orden_servicio: req.params.id,
      eliminada: false,
    },
  });
  if (!evidence)
    return res.status(404).json({ message: "Evidencia no encontrada" });
  await evidence.update({
    eliminada: true,
    eliminada_por: userId(req),
    eliminada_en: new Date(),
    eliminacion_motivo: motivo,
  });
  res.json({
    message:
      "Evidencia retirada del expediente; archivo conservado para auditoría",
  });
};
exports.setEvidenceVisibility = async (req, res) => {
  const order = await findOrder(req, req.params.id);
  if (!order) return res.status(404).json({ message: "Orden no encontrada" });
  const evidence = await OrdenServicioEvidencia.findOne({
    where: {
      id_evidencia_servicio: req.params.evidenceId,
      id_orden_servicio: order.id_orden_servicio,
      eliminada: false,
    },
  });
  if (!evidence) return res.status(404).json({ message: "Evidencia no encontrada" });
  if (signatureStages.includes(evidence.etapa))
    return res.status(400).json({ message: "Una firma no puede publicarse al cliente" });
  const visible = req.body.visible_cliente === true;
  await evidence.update({
    visible_cliente: visible,
    publicada_por: visible ? userId(req) : null,
    publicada_en: visible ? new Date() : null,
  });
  await OrdenServicioEvento.create({
    id_orden_servicio: order.id_orden_servicio,
    tipo: visible ? "evidencia_publicada" : "evidencia_ocultada",
    estado_anterior: order.estado,
    estado_nuevo: order.estado,
    detalle: `${evidence.etapa}: ${evidence.nombre_original}`,
    creado_por: userId(req),
  });
  return res.json({
    id_evidencia_servicio: evidence.id_evidencia_servicio,
    visible_cliente: evidence.visible_cliente,
    publicada_en: evidence.publicada_en,
  });
};
exports.quotes = async (req, res) => {
  if (!await findOrder(req, req.params.id)) return res.status(404).json({ message: "Orden no encontrada" });
  return res.json(
    await OrdenServicioCotizacion.findAll({
      where: { id_orden_servicio: req.params.id },
      order: [["version", "DESC"]],
    }),
  );
};
exports.createQuote = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const record = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record || record.anulada)
      throw new Error("Orden no encontrada o anulada");
    const version =
      Number(
        (await OrdenServicioCotizacion.max("version", {
          where: { id_orden_servicio: record.id_orden_servicio },
          transaction,
        })) || 0,
      ) + 1;
    const repuestos = Number(record.costo_repuestos || 0);
    const manoObra = Number(record.costo_mano_obra || 0);
    const descuento = Number(record.descuento || 0);
    const recargo = Number(record.recargo || 0);
    const total = repuestos + manoObra + recargo - descuento;
    if (total < 0)
      throw new Error("El total de la cotización no puede ser negativo");
    await OrdenServicioCotizacion.update(
      { estado: "reemplazada" },
      {
        where: {
          id_orden_servicio: record.id_orden_servicio,
          estado: ["borrador", "enviada"],
        },
        transaction,
      },
    );
    const quote = await OrdenServicioCotizacion.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        version,
        moneda: record.moneda,
        repuestos,
        mano_obra: manoObra,
        descuento,
        recargo,
        total,
        diagnostico: record.diagnostico_configuracion,
        trabajo_propuesto:
          String(
            req.body.trabajo_propuesto || record.trabajo_realizado || "",
          ).trim() || null,
        condiciones: String(req.body.condiciones || "").trim() || null,
        creada_por: userId(req),
      },
      { transaction },
    );
    const previousState = record.estado;
    if (record.estado === "diagnostico")
      await record.update({ estado: "cotizado" }, { transaction });
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "cotizacion",
        estado_anterior: previousState,
        estado_nuevo:
          previousState === "diagnostico" ? "cotizado" : previousState,
        detalle: `Cotización v${version} creada por ${record.moneda} ${total.toFixed(2)}`,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.status(201).json(quote);
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.resolveQuote = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const action = String(req.body.accion || "").trim();
    if (!["enviar", "aprobar", "rechazar"].includes(action))
      throw new Error("Acción de cotización no válida");
    const quote = await OrdenServicioCotizacion.findOne({
      where: {
        id_cotizacion_servicio: req.params.quoteId,
        id_orden_servicio: req.params.id,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const record = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!quote || !record) throw new Error("Cotización u orden no encontrada");
    const previousState = record.estado;
    if (action === "enviar") {
      if (quote.estado !== "borrador")
        throw new Error("Solo un borrador puede enviarse");
      await quote.update(
        { estado: "enviada", enviada_en: new Date() },
        { transaction },
      );
    } else {
      if (quote.estado !== "enviada")
        throw new Error("La cotización debe estar enviada antes de resolverla");
      const aprobador = String(req.body.aprobador_nombre || "").trim();
      const canal = String(req.body.canal_respuesta || "").trim();
      const evidencia = String(req.body.evidencia_consentimiento || "").trim();
      if (
        !aprobador ||
        !["presencial", "whatsapp", "correo", "web", "otro"].includes(canal)
      )
        throw new Error(
          "Nombre del cliente y canal de respuesta son obligatorios",
        );
      if (!evidencia)
        throw new Error(
          "Registra la evidencia o referencia del consentimiento",
        );
      if (action === "aprobar") {
        const paid = await confirmedPaymentsTotal(
          record.id_orden_servicio,
          transaction,
        );
        if (paid > Number(quote.total))
          throw new Error(
            "La cotización aprobada es menor que los pagos ya confirmados",
          );
        await record.update(
          {
            estado: "aprobado",
            costo_repuestos: quote.repuestos,
            costo_mano_obra: quote.mano_obra,
            descuento: quote.descuento,
            recargo: quote.recargo,
          },
          { transaction },
        );
      }
      await quote.update(
        {
          estado: action === "aprobar" ? "aprobada" : "rechazada",
          resuelta_en: new Date(),
          aprobador_nombre: aprobador,
          canal_respuesta: canal,
          evidencia_consentimiento: evidencia,
        },
        { transaction },
      );
    }
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: `cotizacion_${action}`,
        estado_anterior: previousState,
        estado_nuevo: action === "aprobar" ? "aprobado" : previousState,
        detalle: `Cotización v${quote.version}: ${action}`,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.json(quote);
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.credentialStatus = async (req, res) => {
  const order = await findOrder(req, req.params.id);
  if (!order) return res.status(404).json({ message: 'Orden no encontrada' });
  const row = await OrdenServicioCredencial.findOne({ where: { id_orden_servicio: order.id_orden_servicio } });
  if (!row) return res.json({ configurada: false });
  if (new Date(row.expira_en) <= new Date()) { await row.destroy(); return res.json({ configurada: false, expirada: true }); }
  res.json({ configurada: true, tipo: row.tipo, expira_en: row.expira_en, consultado_en: row.consultado_en });
};
exports.setCredential = async (req, res) => {
  try {
    const order = await findOrder(req, req.params.id);
    if (!order) return res.status(404).json({ message: 'Orden no encontrada' });
    const secreto = String(req.body.secreto || '').trim();
    if (!secreto || secreto.length > 500) throw new Error('La credencial debe tener entre 1 y 500 caracteres');
    const hours = Math.min(Math.max(Number(req.body.horas_vigencia || 72), 1), 720);
    const values = { ...encryptCredential(secreto), tipo: String(req.body.tipo || 'desbloqueo').slice(0, 30), expira_en: new Date(Date.now() + hours * 3600000), creado_por: userId(req), consultado_por: null, consultado_en: null };
    await OrdenServicioCredencial.upsert({ id_orden_servicio: order.id_orden_servicio, ...values });
    await OrdenServicioEvento.create({ id_orden_servicio: order.id_orden_servicio, tipo: 'credencial_guardada', detalle: `Credencial temporal configurada por ${hours} horas`, creado_por: userId(req) });
    res.status(201).json({ configurada: true, tipo: values.tipo, expira_en: values.expira_en });
  } catch (error) { res.status(400).json({ message: error.message }); }
};
exports.revealCredential = async (req, res) => {
  try {
    const order = await findOrder(req, req.params.id);
    if (!order) return res.status(404).json({ message: 'Orden no encontrada' });
    const row = await OrdenServicioCredencial.findOne({ where: { id_orden_servicio: order.id_orden_servicio } });
    if (!row || new Date(row.expira_en) <= new Date()) { if (row) await row.destroy(); return res.status(404).json({ message: 'La credencial no existe o expiró' }); }
    const secreto = decryptCredential(row);
    await row.update({ consultado_por: userId(req), consultado_en: new Date() });
    await OrdenServicioEvento.create({ id_orden_servicio: order.id_orden_servicio, tipo: 'credencial_consultada', detalle: 'Credencial temporal consultada', creado_por: userId(req) });
    res.json({ secreto, tipo: row.tipo, expira_en: row.expira_en });
  } catch (error) { res.status(400).json({ message: error.message }); }
};
exports.removeCredential = async (req, res) => {
  const order = await findOrder(req, req.params.id);
  if (!order) return res.status(404).json({ message: 'Orden no encontrada' });
  await OrdenServicioCredencial.destroy({ where: { id_orden_servicio: order.id_orden_servicio } });
  await OrdenServicioEvento.create({ id_orden_servicio: order.id_orden_servicio, tipo: 'credencial_eliminada', detalle: 'Credencial temporal eliminada', creado_por: userId(req) });
  res.json({ message: 'Credencial eliminada' });
};

exports.create = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const data = normalize(req.body);
    data.estado = 'recibido';
    await validateTechnicalLinks(req, data, transaction, true);
    if (data.recepcion_conforme) data.recepcion_responsable_id = userId(req);
    data.token_seguimiento = crypto.randomBytes(18).toString("hex");
    const record = await OrdenServicio.create(
      { ...data, creado_por: userId(req), affiliate_business_id: tenantId(req) },
      { transaction },
    );
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "creacion",
        estado_nuevo: record.estado,
        detalle: "Orden creada",
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.status(201).json(record);
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.createWarrantyReentry = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const origin = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!origin) {
      await transaction.rollback();
      return res.status(404).json({ message: "Orden original no encontrada" });
    }
    if (origin.anulada) throw new Error("La orden original está anulada");
    if (origin.estado !== "entregado" || !origin.garantia_inicio || !origin.garantia_fin)
      throw new Error("La orden original no tiene una garantía activa iniciada");
    const today = new Date().toISOString().slice(0, 10);
    if (today < origin.garantia_inicio || today > origin.garantia_fin)
      throw new Error(`La garantía venció el ${origin.garantia_fin}`);
    const motivo = String(req.body.motivo || "").trim();
    if (!motivo) throw new Error("El motivo del reingreso es obligatorio");
    const suffix = `${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const record = await OrdenServicio.create({
      tipo: origin.tipo,
      codigo: `GAR-${origin.codigo}-${suffix}`.slice(0, 40),
      cliente: origin.cliente,
      cliente_servicio_id: origin.cliente_servicio_id,
      activo_tecnico_id: origin.activo_tecnico_id,
      telefono: origin.telefono,
      documento: origin.documento,
      equipo: origin.equipo,
      numero_serie: origin.numero_serie,
      detalle: motivo,
      accesorios: String(req.body.accesorios || "").trim() || origin.accesorios,
      diagnostico_configuracion: "",
      trabajo_realizado: "",
      estado: "recibido",
      moneda: origin.moneda,
      costo_repuestos: 0,
      costo_mano_obra: 0,
      descuento: 0,
      recargo: 0,
      adelanto: 0,
      fecha_ingreso: today,
      garantia_dias: 0,
      garantia_cobertura: origin.garantia_cobertura,
      garantia_exclusiones: origin.garantia_exclusiones,
      orden_origen_garantia_id: origin.id_orden_servicio,
      notas: `Reingreso por garantía de ${origin.codigo}. Vigencia original: ${origin.garantia_inicio} a ${origin.garantia_fin}.`,
      creado_por: userId(req),
      affiliate_business_id: tenantId(req),
    }, { transaction });
    await OrdenServicioEvento.bulkCreate([
      {
        id_orden_servicio: origin.id_orden_servicio,
        tipo: "reingreso_garantia",
        estado_anterior: origin.estado,
        estado_nuevo: origin.estado,
        detalle: `Reingreso ${record.codigo}: ${motivo}`,
        creado_por: userId(req),
      },
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "creacion_garantia",
        estado_nuevo: record.estado,
        detalle: `Creada desde ${origin.codigo}: ${motivo}`,
        creado_por: userId(req),
      },
    ], { transaction });
    await transaction.commit();
    res.status(201).json(record);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.update = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const record = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record) {
      await transaction.rollback();
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    if (record.anulada)
      throw new Error("Una orden anulada no puede modificarse");
    const before = record.estado;
    const data = normalize(req.body);
    if (data.recepcion_conforme && !record.recepcion_conforme) data.recepcion_responsable_id = userId(req);
    if (data.recepcion_conforme === false) data.recepcion_responsable_id = null;
    await validateTechnicalLinks(req, data, transaction);
    if (data.estado !== before && !stateTransitions[before]?.includes(data.estado))
      throw new Error(`Transición inválida: ${before} → ${data.estado}. Completa la etapa anterior.`);
    const structuredParts = await OrdenServicioRepuesto.count({
      where: {
        id_orden_servicio: record.id_orden_servicio,
        estado_stock: ["no_aplica", "reservado", "consumido"],
      },
      transaction,
    });
    const structuredPayments = await OrdenServicioPago.count({
      where: {
        id_orden_servicio: record.id_orden_servicio,
        estado: "confirmado",
      },
      transaction,
    });
    if (structuredParts)
      data.costo_repuestos = await partsTotal(
        record.id_orden_servicio,
        transaction,
      );
    if (structuredPayments)
      data.adelanto = await confirmedPaymentsTotal(
        record.id_orden_servicio,
        transaction,
      );
    if (record.venta_id) {
      const accountingFields = ['costo_repuestos', 'costo_mano_obra', 'descuento', 'recargo', 'adelanto'];
      if (accountingFields.some(field => Number(data[field]) !== Number(record[field])))
        throw new Error('La orden ya generó su venta contable y sus importes no pueden modificarse');
      // Cancelar aqui repondria el stock de los repuestos pero la Venta seguiria vigente (ingreso sin salida)
      if (data.estado === 'cancelado' && before !== 'cancelado')
        throw new Error('La orden ya generó su venta contable y no puede cancelarse desde aquí; requiere el flujo de anulación contable');
    }
    if (data.estado === "entregado" && before !== "entregado") {
      const total = Math.max(0, Number(data.costo_repuestos) + Number(data.costo_mano_obra) + Number(data.recargo || 0) - Number(data.descuento || 0));
      const paid = await confirmedPaymentsTotal(record.id_orden_servicio, transaction);
      if (paid + 0.001 < total) throw new Error('No se puede cerrar el servicio con saldo pendiente');
      await finalizeServiceOrderBilling(record.id_orden_servicio, userId(req), transaction);
      data.fecha_entrega_real = require('../services/cash-ledger.service').limaDay(new Date());
      data.garantia_inicio = data.fecha_entrega_real;
      data.garantia_fin = addDays(data.fecha_entrega_real, data.garantia_dias);
      await OrdenServicioRepuesto.update(
        { estado_stock: "consumido" },
        {
          where: {
            id_orden_servicio: record.id_orden_servicio,
            estado_stock: "reservado",
          },
          transaction,
        },
      );
      const consumedParts = await OrdenServicioRepuesto.findAll({
        where: { id_orden_servicio: record.id_orden_servicio, estado_stock: 'consumido' }, transaction,
      });
      for (const part of consumedParts)
        await closeReservations({ repuestoId: part.id_repuesto_servicio, estado: 'consumida', userId: userId(req), transaction });
    }
    if (data.estado === "cancelado" && before !== "cancelado")
      await restoreReservedParts(record, transaction, userId(req));
    await record.update(data, { transaction });
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: before === data.estado ? "edicion" : "estado",
        estado_anterior: before,
        estado_nuevo: data.estado,
        detalle:
          before === data.estado
            ? "Datos de la orden actualizados"
            : `Estado cambiado de ${before} a ${data.estado}`,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.json(record);
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};
exports.remove = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const record = await findOrder(req, req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record) {
      await transaction.rollback();
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    const motivo = String(req.body?.motivo || "").trim();
    if (!motivo) throw new Error("El motivo de anulación es obligatorio");
    await restoreReservedParts(record, transaction, userId(req));
    await record.update(
      { anulada: true, anulacion_motivo: motivo, anulada_en: new Date() },
      { transaction },
    );
    await OrdenServicioEvento.create(
      {
        id_orden_servicio: record.id_orden_servicio,
        tipo: "anulacion",
        estado_anterior: record.estado,
        detalle: motivo,
        creado_por: userId(req),
      },
      { transaction },
    );
    await transaction.commit();
    res.json({ message: "Orden anulada y conservada para auditoría" });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ message: error.message });
  }
};

// Reference only: this does not issue or validate a receipt with SUNAT.
exports.registerHonorarios = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const order = await findOrder(req, req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) throw new Error('Orden no encontrada');
    if (!order.venta_id || !['mixta', 'recibo_honorarios'].includes(order.clasificacion_fiscal)) throw new Error('La orden no tiene honorarios pendientes vinculables');
    const reference = String(req.body.referencia || '').trim().toUpperCase();
    if (!/^E001-\d{1,8}$/.test(reference)) throw new Error('Usa el número del recibo emitido, por ejemplo E001-123');
    await order.update({ referencia_comprobante: reference }, { transaction });
    await OrdenServicioEvento.create({ id_orden_servicio: order.id_orden_servicio, tipo: 'referencia_rhe', detalle: 'Referencia RHE registrada por el operador (sin validación SUNAT): ' + reference, creado_por: userId(req) }, { transaction });
    await transaction.commit();
    res.json({ message: 'Referencia registrada. El ERP no emite ni valida este RHE.' });
  } catch (error) { await transaction.rollback(); res.status(400).json({ message: error.message }); }
};
exports.emailTicket = async (req, res) => {
  try {
    const order = await findOrder(req, req.params.id);
    if (!order) return res.status(404).json({ message: 'Orden no encontrada' });
    const client = order.cliente_servicio_id ? await ClienteServicio.findOne({ where: { id_cliente_servicio: order.cliente_servicio_id, ...tenantWhere(req) } }) : null;
    if (!client?.email) return res.status(400).json({ message: 'Registra el correo en la ficha del cliente antes de enviar' });
    const mail = require('../services/mail.service');
    if (mail.getMailMode() !== 'live' || !mail.smtpConfigured()) return res.status(503).json({ message: 'Envío no disponible: falta activar y configurar el correo del ERP. Puedes imprimir el ticket.' });
    const parts = await OrdenServicioRepuesto.findAll({ where: { id_orden_servicio: order.id_orden_servicio, estado_stock: ['no_aplica', 'reservado', 'consumido'] } });
    const amounts = require('../services/workshop-amounts.service').workshopAmounts(order, parts);
    const sale = order.venta_id ? await require('../models').Venta.unscoped().findByPk(order.venta_id) : null;
    const text = [ 'CRISCOM · TICKET INTERNO NO FISCAL', order.codigo, order.cliente,
      ...parts.map(p => p.cantidad + ' × ' + p.descripcion + ': ' + order.moneda + ' ' + (Number(p.cantidad) * Number(p.precio_unitario)).toFixed(2)),
      'Mano de obra: ' + order.costo_mano_obra, 'Recargo: ' + order.recargo, 'Descuento: ' + order.descuento,
      'TOTAL ' + order.moneda + ' ' + amounts.total.toFixed(2), 'Pagado: ' + order.adelanto,
      'Saldo: ' + Math.max(0, amounts.total - Number(order.adelanto)).toFixed(2),
      'Productos: ' + (sale?.comprobante_emitido ? sale.serie + '-' + sale.correlativo : 'Comprobante pendiente / no corresponde'),
      'Honorarios: ' + (order.referencia_comprobante || 'Recibo pendiente / no corresponde'),
      'Este resumen no sustituye la boleta, factura ni recibo por honorarios.' ].join('\n');
    await mail.createTransport('live').sendMail({ from: process.env.MAIL_FROM, to: client.email, subject: mail.oneLine('CRISCOM · Ticket ' + order.codigo), text });
    await OrdenServicioEvento.create({ id_orden_servicio: order.id_orden_servicio, tipo: 'ticket_correo', detalle: 'Ticket enviado al correo registrado del cliente', creado_por: userId(req) });
    res.json({ message: 'Ticket enviado al correo registrado' });
  } catch (error) { res.status(500).json({ message: 'No se pudo completar el envío del ticket' }); }
};

exports.billingSummary = async (req, res) => {
  try {
    const order = await findOrder(req, req.params.id);
    if (!order) return res.status(404).json({ message: 'Orden no encontrada' });
    const parts = await OrdenServicioRepuesto.findAll({ where: { id_orden_servicio: order.id_orden_servicio, estado_stock: ['no_aplica', 'reservado', 'consumido'] } });
    const amounts = require('../services/workshop-amounts.service').workshopAmounts(order, parts);
    const sale = order.venta_id ? await require('../models').Venta.unscoped().findByPk(order.venta_id) : null;
    res.json({ productos: amounts.productTotal, honorarios: amounts.serviceTotal,
      venta_id: sale?.venta_id, puede_emitir_productos: sale?.categoria_ingreso === 'productos_taller' && !sale.comprobante_emitido,
      estado_productos: sale?.comprobante_emitido ? 'aceptado' : sale?.estado_comprobante || 'sin_emitir',
      documento_productos: sale?.comprobante_emitido ? sale.serie + '-' + sale.correlativo : null,
      referencia_honorarios: order.referencia_comprobante || null,
      modo_sunat: require('../services/sunat.service').sunatMode(),
    });
  } catch (error) { res.status(400).json({ message: error.message }); }
};
