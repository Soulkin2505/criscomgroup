const { Op } = require("sequelize");
const { sequelize } = require("../config/database");
const { SolicitudPostventa, SolicitudPostventaHistorial, DetalleVenta, PedidoDetalle, MovimientoInventario, Producto, Pago, Pedido } = require("../models");
const svc = require("../services/postventa.service");
const { aplicarMovimiento, ajustarReserva } = require("../services/stock.service");
const culqi = require("../services/culqi.service");

const { ESTADOS, TIPOS, ACCIONES, TRANSICIONES, REAPERTURA, REQUIEREN_RESPUESTA, iso, norm, ultimos4 } = svc;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v) => (typeof v === "string" ? v.trim() : "");
const fail = (res, status, message, errores) =>
  res.status(status).json(errores ? { success: false, message, errores } : { success: false, message });
const safe = (fn, label, msg) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    console.error(`[postventa.${label}]`, error);
    if (!res.headersSent) fail(res, 500, msg);
  }
};
const bool = (v) => (v === null || v === undefined ? null : Boolean(v));

// M8: al aprobar/resolver con accion_posterior 'reingreso_stock' el producto vuelve
// al inventario de verdad (antes era solo una etiqueta). Se resuelve el producto
// desde la venta o el pedido vinculado; con varias lineas se busca coincidencia
// por nombre. Devuelve null si no se puede identificar.
const resolverProductoReingreso = async (item) => {
  const buscado = norm(item.producto_servicio);
  const coincide = (texto) => {
    const t = norm(texto);
    return Boolean(t && buscado && (t.includes(buscado) || buscado.includes(t)));
  };
  if (item.venta_id) {
    const detalles = await DetalleVenta.findAll({
      where: { venta_id: item.venta_id },
      include: [{ model: Producto.unscoped(), as: "producto", attributes: ["id_producto", "nombre"] }],
    });
    const conProducto = detalles.filter((d) => d.producto_id && d.producto);
    if (conProducto.length === 1) return conProducto[0].producto_id;
    const match = conProducto.find((d) => coincide(d.producto.nombre) || coincide(d.descripcion));
    if (match) return match.producto_id;
  }
  if (item.pedido_id) {
    const detalles = await PedidoDetalle.findAll({ where: { id_pedido: item.pedido_id } });
    if (detalles.length === 1) return detalles[0].producto_id;
    const match = detalles.find((d) => coincide(d.producto_nombre));
    if (match) return match.producto_id;
  }
  return null;
};

// Si el pedido web vinculado nunca llegó a "entregado", el stock de ese
// producto nunca salió de verdad: todavía está en stock_reservado, no en
// stock físico. Una venta de mostrador (sin pedido_id) siempre se entregó al
// momento, así que cuenta como entregada. Sin pedido ni venta, no se sabe.
const fueEntregado = async (item) => {
  if (item.pedido_id) {
    const pedido = await Pedido.findByPk(item.pedido_id, { attributes: ["estado"] });
    return pedido ? pedido.estado === "entregado" : null;
  }
  if (item.venta_id) return true;
  return null;
};

const vistaPublica = (item, historial = []) => ({
  codigo_seguimiento: item.codigo_seguimiento,
  tipo: item.tipo,
  producto_servicio: item.producto_servicio,
  estado: item.estado,
  respuesta_cliente: item.respuesta_cliente,
  fecha_creacion: iso(item.fecha_creacion),
  fecha_actualizacion: iso(item.fecha_actualizacion),
  linea_tiempo: historial.map((h) => ({ estado: h.a, fecha: iso(h.creado) })),
});

const vistaAdmin = (item) => {
  const row = item.toJSON();
  row.vinculado = Boolean(row.vinculado);
  row.fuera_de_plazo = bool(row.fuera_de_plazo);
  row.fecha_creacion = iso(row.fecha_creacion);
  row.fecha_actualizacion = iso(row.fecha_actualizacion);
  return row;
};

function validarCreacion(b) {
  const e = {};
  const nombre = str(b.nombre), email = str(b.email), motivo = str(b.motivo), detalle = str(b.detalle);
  if (nombre.length < 3 || nombre.length > 150) e.nombre = "El nombre debe tener entre 3 y 150 caracteres.";
  if (!EMAIL_RE.test(email) || email.length > 180) e.email = "Ingresa un correo válido.";
  const tel = str(b.telefono);
  if (tel && (tel.length > 30 || ultimos4(tel).length < 4)) e.telefono = "Ingresa un teléfono válido (mínimo 4 dígitos, máximo 30 caracteres).";
  const pedido = str(b.numero_pedido);
  if (pedido.length < 3 || pedido.length > 80) e.numero_pedido = "Indica el número de pedido o comprobante (3 a 80 caracteres).";
  if (!TIPOS.includes(b.tipo)) e.tipo = "Elige cambio, devolución o garantía.";
  const prod = str(b.producto_servicio);
  if (prod.length < 3 || prod.length > 220) e.producto_servicio = "Indica el producto o servicio (3 a 220 caracteres).";
  if (motivo.length < 5 || motivo.length > 180) e.motivo = "El motivo debe tener entre 5 y 180 caracteres.";
  if (detalle.length < 20 || detalle.length > 4000) e.detalle = "El detalle debe tener entre 20 y 4000 caracteres.";
  const sol = str(b.solucion_solicitada);
  if (sol.length < 5 || sol.length > 1000) e.solucion_solicitada = "Indica la solución que solicitas (5 a 1000 caracteres).";
  const cantidad = b.cantidad === undefined || b.cantidad === "" ? 1 : Number(b.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) e.cantidad = "La cantidad debe ser un entero entre 1 y 999.";
  if (b.acepta_declaracion !== true) e.acepta_declaracion = "Debes aceptar la declaración.";
  return { errores: e, cantidad };
}

exports.createPublic = safe(async (req, res) => {
  const b = req.body || {};
  // Honeypot: un bot rellena 'website'. Se responde igual que un éxito, sin guardar.
  if (str(b.website)) return res.status(201).json({ success: true, message: "Solicitud registrada correctamente.", data: { codigo_seguimiento: null } });
  const { errores, cantidad } = validarCreacion(b);
  if (Object.keys(errores).length) return fail(res, 400, "Revisa los campos marcados.", errores);

  const email = str(b.email).toLowerCase(), numero_pedido = str(b.numero_pedido), producto_servicio = str(b.producto_servicio);
  const duplicada = await SolicitudPostventa.findOne({
    where: { email, numero_pedido, producto_servicio, fecha_creacion: { [Op.gte]: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  if (duplicada) return fail(res, 409, "Ya registraste una solicitud para este pedido y producto en las últimas 24 horas. Consulta su avance con tu código de seguimiento.");

  const vinculo = await svc.vincularPedido({ numero_pedido, email, producto_servicio, tipo: b.tipo });
  const datos = {
    nombre: str(b.nombre), email, telefono: str(b.telefono) || null, numero_pedido, tipo: b.tipo, producto_servicio,
    motivo: str(b.motivo), detalle: str(b.detalle), solucion_solicitada: str(b.solucion_solicitada), cantidad,
    estado: "recibida", ...vinculo,
  };
  let item = null;
  for (let intento = 0; intento < 5 && !item; intento += 1) {
    try {
      item = await SolicitudPostventa.create({ ...datos, codigo_seguimiento: svc.codigoNuevo() });
    } catch (error) {
      if (error.name !== "SequelizeUniqueConstraintError") throw error;
    }
  }
  if (!item) return fail(res, 500, "No pudimos generar un código de seguimiento. Intenta nuevamente.");
  await SolicitudPostventaHistorial.create({ solicitud_id: item.id_solicitud, usuario_id: null, de: null, a: "recibida", nota: "Solicitud registrada por el cliente" });
  await item.reload();
  svc.enviarCorreo(item.email, `Recibimos tu solicitud ${item.codigo_seguimiento}`,
    `Hola ${item.nombre},\n\nRecibimos tu solicitud de ${item.tipo}. Tu código de seguimiento es ${item.codigo_seguimiento}.\n`
    + "Para consultar el avance necesitarás este código y tu correo o los 4 últimos dígitos de tu teléfono.\n\nCRISCOM");
  const historial = await SolicitudPostventaHistorial.findAll({ where: { solicitud_id: item.id_solicitud }, order: [["id_historial", "ASC"]] });
  return res.status(201).json({ success: true, message: "Solicitud registrada correctamente.", data: vistaPublica(item, historial) });
}, "createPublic", "No pudimos registrar la solicitud. Intenta nuevamente.");

async function buscarSeguimiento(codigo, email, tel4) {
  const cod = str(codigo).toUpperCase();
  if (!svc.dentroDeAlfabeto.test(cod)) return null;
  const item = await SolicitudPostventa.findOne({ where: { codigo_seguimiento: cod } });
  if (!item) return null;
  const okMail = email && norm(email) === norm(item.email);
  const okTel = tel4 && /^\d{4}$/.test(String(tel4).trim()) && ultimos4(item.telefono) === String(tel4).trim();
  return okMail || okTel ? item : null;
}

async function responderSeguimiento(res, codigo, email, tel4) {
  if (!str(email) && !str(tel4)) return fail(res, 400, "Indica el correo con el que registraste la solicitud o los 4 últimos dígitos de tu teléfono.");
  const item = await buscarSeguimiento(codigo, email, tel4);
  if (!item) return fail(res, 404, "No encontramos una solicitud con esos datos. Revisa el código y el correo o teléfono.");
  const historial = await SolicitudPostventaHistorial.findAll({ where: { solicitud_id: item.id_solicitud }, order: [["creado", "ASC"], ["id_historial", "ASC"]] });
  return res.json({ success: true, data: vistaPublica(item, historial) });
}

exports.trackPublic = safe((req, res) => responderSeguimiento(res, req.params.codigo, req.query.email, req.query.tel4), "trackPublic", "No pudimos consultar la solicitud. Intenta nuevamente.");
exports.trackPublicPost = safe((req, res) => {
  const b = req.body || {};
  return responderSeguimiento(res, b.codigo, b.email, b.telefono4 ?? b.tel4);
}, "trackPublicPost", "No pudimos consultar la solicitud. Intenta nuevamente.");
exports._internals = { vistaAdmin, fail, safe };

const filtroLista = (q) => {
  const where = {};
  if (q.tipo && TIPOS.includes(q.tipo)) where.tipo = q.tipo;
  if (["true", "1"].includes(String(q.vinculado))) where.vinculado = true;
  if (["false", "0"].includes(String(q.vinculado))) where.vinculado = false;
  const texto = str(q.q);
  if (texto) {
    const like = `%${texto.replace(/[%_\\]/g, "")}%`;
    where[Op.or] = ["codigo_seguimiento", "nombre", "email", "numero_pedido", "producto_servicio"].map((c) => ({ [c]: { [Op.like]: like } }));
  }
  return where;
};

exports.listAdmin = safe(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const base = filtroLista(req.query);
  const where = { ...base };
  if (req.query.estado) {
    if (!ESTADOS.includes(req.query.estado)) return fail(res, 400, "Estado inválido.", { estado: "Estado inválido." });
    where.estado = req.query.estado;
  }
  const { rows, count } = await SolicitudPostventa.findAndCountAll({
    where, order: [["fecha_creacion", "DESC"], ["id_solicitud", "DESC"]], limit, offset: (page - 1) * limit,
  });
  const grupos = await SolicitudPostventa.findAll({ where: base, attributes: ["estado", [sequelize.fn("COUNT", sequelize.col("id_solicitud")), "n"]], group: ["estado"], raw: true });
  const resumen = Object.fromEntries(ESTADOS.map((s) => [s, 0]));
  let total = 0;
  for (const g of grupos) { resumen[g.estado] = Number(g.n); total += Number(g.n); }
  resumen.total = total;
  return res.json({ success: true, rows: rows.map(vistaAdmin), total: count, page, limit, resumen });
}, "listAdmin", "Error al obtener solicitudes.");

exports.getAdmin = safe(async (req, res) => {
  const item = await SolicitudPostventa.findByPk(req.params.id);
  if (!item) return fail(res, 404, "Solicitud no encontrada.");
  const historial = await SolicitudPostventaHistorial.findAll({ where: { solicitud_id: item.id_solicitud }, order: [["creado", "ASC"], ["id_historial", "ASC"]] });
  const data = vistaAdmin(item);
  data.historial = historial.map((h) => ({ ...h.toJSON(), creado: iso(h.creado) }));
  return res.json({ success: true, data });
}, "getAdmin", "Error al obtener la solicitud.");

function resumenCambios(antes, despues, cambios, extra = {}) {
  const partes = [];
  if (cambios.estado) partes.push(`Estado: ${antes.estado} a ${despues.estado}`);
  if (cambios.respuesta_cliente) partes.push("Respuesta al cliente actualizada");
  if (cambios.notas_admin) partes.push("Notas internas actualizadas");
  if (cambios.accion_posterior || cambios.accion_posterior_nota) partes.push(`Acción posterior: ${despues.accion_posterior || "ninguna"}${despues.accion_posterior_nota ? ` (${despues.accion_posterior_nota})` : ""}`);
  if (extra.refund) partes.push(`Reembolso Culqi confirmado: ${extra.refund.id} (S/ ${(extra.refund.amount / 100).toFixed(2)})`);
  if (extra.inventario) partes.push(extra.inventario.entregado ? "Stock físico reingresado" : "Reserva de stock liberada (pedido nunca entregado)");
  return partes.join(". ");
}

exports.updateAdmin = safe(async (req, res) => {
  const item = await SolicitudPostventa.findByPk(req.params.id);
  if (!item) return fail(res, 404, "Solicitud no encontrada.");
  const b = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;
  const errores = {};
  const actual = item.estado;
  const destino = has("estado") ? b.estado : actual;
  if (has("estado") && !ESTADOS.includes(b.estado)) errores.estado = "Estado inválido.";
  if (Object.keys(errores).length) return fail(res, 400, "Estado inválido.", errores);

  const cambiaEstado = destino !== actual;
  if (cambiaEstado) {
    const reabre = REAPERTURA[actual] === destino;
    if (reabre) {
      if (req.user?.id_role !== 1) return fail(res, 403, "Solo Gerencia puede reabrir una solicitud cerrada.");
    } else if (!TRANSICIONES[actual].includes(destino)) {
      return fail(res, 409, `No se puede pasar de "${actual}" a "${destino}".`, { estado: `Transiciones permitidas desde ${actual}: ${TRANSICIONES[actual].join(", ") || "ninguna (estado cerrado)"}.` });
    }
  }
  const respuesta = has("respuesta_cliente") ? str(b.respuesta_cliente) : str(item.respuesta_cliente);
  if (has("respuesta_cliente") && respuesta.length > 2000) errores.respuesta_cliente = "La respuesta no puede superar 2000 caracteres.";
  if (has("notas_admin") && str(b.notas_admin).length > 2000) errores.notas_admin = "Las notas no pueden superar 2000 caracteres.";
  if (cambiaEstado && REQUIEREN_RESPUESTA.includes(destino) && respuesta.length < 10) errores.respuesta_cliente = "Escribe una respuesta para el cliente (mínimo 10 caracteres) antes de aprobar, rechazar o resolver.";
  if (has("accion_posterior") || has("accion_posterior_nota")) {
    if (!["aprobada", "resuelta"].includes(destino)) errores.accion_posterior = "La acción posterior solo se registra al aprobar o resolver.";
    else if (has("accion_posterior") && b.accion_posterior !== null && !ACCIONES.includes(b.accion_posterior)) errores.accion_posterior = `Acción inválida. Usa: ${ACCIONES.join(", ")}.`;
    if (has("accion_posterior_nota") && str(b.accion_posterior_nota).length > 1000) errores.accion_posterior_nota = "La nota no puede superar 1000 caracteres.";
  }
  if (Object.keys(errores).length) return fail(res, 400, Object.values(errores)[0], errores);

  // M8: reingreso real de stock (reingreso_stock), ahora consciente de si el
  // pedido llegó a entregarse de verdad. Si nunca se entregó, no hay nada
  // físico que reingresar: lo que corresponde es liberar la reserva.
  const accionFinal = has("accion_posterior") ? (b.accion_posterior || null) : item.accion_posterior;
  const tocaInventarioPorAccion = ["aprobada", "resuelta"].includes(destino) && accionFinal === "reingreso_stock";
  // Reembolso real por Culqi. Un único marcador de inventario ("postventa_stock")
  // cubre tanto esta acción como la de arriba, para que nunca se libere o
  // reingrese dos veces el mismo movimiento si el admin cambia de acción.
  const reembolsaDinero = ["aprobada", "resuelta"].includes(destino) && accionFinal === "reembolso";

  let inventario = null; // { entregado, productoId } cuando hay que tocar inventario
  if (tocaInventarioPorAccion) {
    const yaAplicado = await MovimientoInventario.findOne({ where: { referencia_tipo: "postventa_stock", referencia_id: item.id_solicitud } });
    if (!yaAplicado) {
      const productoId = await resolverProductoReingreso(item);
      if (!productoId) return fail(res, 400, "No se pudo identificar el producto para ajustar inventario. Vincula la solicitud a una venta o pedido válido, o registra otra acción posterior.");
      const entregado = await fueEntregado(item);
      if (entregado === null) return fail(res, 400, "No se pudo determinar si el pedido fue entregado. Vincula la solicitud a una venta o pedido válido.");
      inventario = { entregado, productoId };
    }
  }

  let pago = null;
  let refundResult = null;
  if (reembolsaDinero) {
    if (!item.pedido_id) return fail(res, 400, "Solo se puede reembolsar por Culqi una solicitud vinculada a un pedido web.");
    pago = await Pago.findOne({ where: { id_pedido: item.pedido_id, proveedor: "culqi" }, order: [["id_pago", "DESC"]] });
    if (!pago || !["pagado", "devuelto"].includes(pago.estado)) {
      return fail(res, 400, "No se encontró un pago con Culqi confirmado para este pedido.");
    }
    if (pago.estado === "pagado") {
      if (!/^chr_/.test(String(pago.proveedor_id))) {
        return fail(res, 400, "Este pedido se pagó con billetera digital, PagoEfectivo o Cuotéalo: el reembolso automático solo cubre tarjeta o Yape. Gestiónalo directo en CulqiPanel.");
      }
      try {
        refundResult = await culqi.createRefund({ chargeId: pago.proveedor_id, reason: `Postventa ${item.codigo_seguimiento}: ${item.tipo}` });
      } catch (refundError) {
        const detail = refundError.response?.data?.merchant_message || refundError.message;
        return fail(res, 502, `Culqi rechazó el reembolso: ${detail}`);
      }
    }
    // Si el pedido nunca se entregó, no hay nada físico que el cliente se haya
    // quedado: la reserva se libera siempre, sin que el admin tenga que elegirlo
    // aparte. Si sí se entregó, el admin decide si además quiere reingreso_stock.
    if (!inventario) {
      const yaAplicado = await MovimientoInventario.findOne({ where: { referencia_tipo: "postventa_stock", referencia_id: item.id_solicitud } });
      if (!yaAplicado) {
        const entregado = await fueEntregado(item);
        if (entregado === false) {
          const productoId = await resolverProductoReingreso(item);
          if (productoId) inventario = { entregado: false, productoId };
        }
      }
    }
  }

  const antes = item.toJSON();
  const cambios = {};
  if (cambiaEstado) { item.estado = destino; cambios.estado = true; }
  if (has("notas_admin") && str(b.notas_admin) !== str(item.notas_admin)) { item.notas_admin = str(b.notas_admin); cambios.notas_admin = true; }
  if (has("respuesta_cliente") && respuesta !== str(item.respuesta_cliente)) { item.respuesta_cliente = respuesta; cambios.respuesta_cliente = true; }
  if (has("accion_posterior") && (b.accion_posterior || null) !== item.accion_posterior) { item.accion_posterior = b.accion_posterior || null; cambios.accion_posterior = true; }
  if (has("accion_posterior_nota") && (str(b.accion_posterior_nota) || null) !== item.accion_posterior_nota) { item.accion_posterior_nota = str(b.accion_posterior_nota) || null; cambios.accion_posterior_nota = true; }
  if (!Object.keys(cambios).length) return res.json({ success: true, data: vistaAdmin(item) });

  await sequelize.transaction(async (transaction) => {
    if (inventario) {
      const base = {
        productoId: inventario.productoId,
        referenciaTipo: "postventa_stock",
        referenciaId: item.id_solicitud,
        usuarioId: req.user?.id || null,
        affiliateBusinessId: item.affiliate_business_id || null,
        transaction,
      };
      if (inventario.entregado) {
        await aplicarMovimiento({ ...base, delta: item.cantidad, tipo: "ajuste_entrada", motivo: `Postventa ${item.codigo_seguimiento}: reingreso por ${item.tipo}` });
      } else {
        await ajustarReserva({ ...base, delta: -item.cantidad, tipo: "liberacion", motivo: `Postventa ${item.codigo_seguimiento}: pedido nunca entregado, se libera la reserva` });
      }
    }
    if (pago && refundResult) {
      await pago.update({ estado: "devuelto", respuesta_segura: { ...(pago.respuesta_segura || {}), refund: culqi.sanitizeRefund(refundResult) } }, { transaction });
    }
    await item.save({ transaction });
    await SolicitudPostventaHistorial.create({
      solicitud_id: item.id_solicitud, usuario_id: req.user?.id || null,
      de: actual, a: item.estado,
      nota: resumenCambios(antes, item, cambios, { refund: refundResult ? culqi.sanitizeRefund(refundResult) : null, inventario }).slice(0, 1000),
    }, { transaction });
  });
  await item.reload();
  if (cambios.estado || cambios.respuesta_cliente) {
    svc.enviarCorreo(item.email, `Actualización de tu solicitud ${item.codigo_seguimiento}`,
      `Hola ${item.nombre},\n\nTu solicitud ${item.codigo_seguimiento} está ahora en estado: ${item.estado.replaceAll("_", " ")}.\n`
      + (item.respuesta_cliente ? `\nRespuesta de CRISCOM:\n${item.respuesta_cliente}\n` : "") + "\nCRISCOM");
  }
  return res.json({ success: true, data: vistaAdmin(item) });
}, "updateAdmin", "Error al actualizar la solicitud.");
