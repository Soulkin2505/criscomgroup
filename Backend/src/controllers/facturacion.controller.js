const { Op } = require('sequelize');
const { sequelize, Venta, DetalleVenta, Producto, Company, DocumentoElectronico, User } = require('../models');
const sunat = require('../services/sunat.service');

const publicEmitter = company => {
  const ready = sunat.readiness(company);
  const modo = sunat.companyMode(company);
  return {
    id_company: company.id_company,
    razon_social: company.razon_social,
    ruc: company.ruc,
    tipo_ruc: company.tipo_ruc,
    facturacion_habilitada: company.facturacion_habilitada,
    emisor_predeterminado: company.emisor_predeterminado,
    serie_factura: company.serie_factura,
    serie_boleta: company.serie_boleta,
    direccion: company.direccion,
    certificado_configurado: ready.certificate,
    credenciales_sol_configuradas: ready.sol,
    configuracion_completa: ready.complete,
    origen_credenciales: ready.sol_source,
    origen_certificado: ready.certificate_source,
    modo_sunat: modo.mode === 'production' ? 'produccion' : 'pruebas',
    modo_motivo: modo.motivo,
    modo_valido: modo.servidor_valido,
  };
};

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const safe = (fn, label) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    console.error(`[facturacion] ${label}:`, error);
    if (!res.headersSent) fail(res, 500, 'Error en el servidor al procesar la facturación');
  }
};

// Editar emisores/series exige la cuenta maestra (o superusuario temporal). Se informa el motivo.
const fiscalAdminState = async req => {
  const configured = String(process.env.MASTER_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!configured || !req.user?.id) return { ok: false, motivo: 'La cuenta maestra no está configurada en el servidor' };
  const user = await User.findByPk(req.user.id, { attributes: ['id_user', 'email', 'id_role', 'superusuario_temporal', 'superusuario_expira_en'] });
  const exact = user && user.id_role === 1 && String(user.email).trim().toLowerCase() === configured;
  const temporary = user && user.id_role === 2 && user.superusuario_temporal && user.superusuario_expira_en && new Date(user.superusuario_expira_en) > new Date();
  if (exact || temporary) return { ok: true, motivo: null };
  return { ok: false, motivo: 'Solo la cuenta maestra puede modificar el emisor fiscal y sus series' };
};
exports.requireFiscalAdmin = async (req, res, next) => {
  try {
    const state = await fiscalAdminState(req);
    if (!state.ok) return fail(res, 403, state.motivo);
    return next();
  } catch (error) {
    console.error('[facturacion] permisos:', error);
    return fail(res, 500, 'No se pudo verificar el permiso');
  }
};

const selectEmitter = async (req, transaction) => {
  const requested = Number(req.body.id_company_emisor || 0);
  if (requested && req.user.id_role === 3) throw new Error('Los vendedores no pueden cambiar el emisor fiscal');
  const company = requested
    ? await Company.findByPk(requested, { transaction, lock: transaction.LOCK.UPDATE })
    : await Company.findOne({ where: { facturacion_habilitada: true, emisor_predeterminado: true }, transaction, lock: transaction.LOCK.UPDATE });
  if (!company || !company.facturacion_habilitada) throw new Error('El emisor fiscal seleccionado no está habilitado');
  if (company.tipo_ruc !== '10') throw new Error('Por ahora la facturación solo está habilitada para el RUC 10');
  return company;
};

exports.emit = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (req.user.id_role === 3 && req.user.tipo_vendedor === 'afiliado') {
      throw new Error('Los afiliados confirman ventas, pero no emiten comprobantes SUNAT');
    }
    const sale = await Venta.unscoped().findByPk(req.params.ventaId, { include: [{ model: DetalleVenta, as: 'detalles', include: [{ model: Producto, as: 'producto' }] }], transaction, lock: transaction.LOCK.UPDATE });
    if (!sale) throw new Error('Venta no encontrada');
    if (sale.affiliate_business_id && sale.metodo_pago !== 'tarjeta') {
      throw new Error('Las ventas propias del afiliado no usan el emisor SUNAT de CRISCOM; solo las cobradas con tarjeta por Culqi se facturan con este RUC');
    }
    if (sale.orden_servicio_id && sale.categoria_ingreso !== 'productos_taller') throw new Error('Esta orden requiere revisión fiscal: no se emitirá mano de obra como venta de productos');
    if (!['1', '3'].includes(sale.tipo_documento)) throw new Error('Las notas de venta no se envían a SUNAT');
    if (sale.comprobante_emitido) throw new Error('El comprobante ya fue emitido');
    const company = await selectEmitter(req, transaction);
    await sunat.activateIfReady(company, { transaction });
    const type = sale.tipo_documento === '1' ? '01' : '03';
    // Pruebas manuales: se genera y firma el XML para probar, pero no se reserva correlativo, no se guarda
    // documento ni se marca la venta como emitida; asi puede emitirse de verdad al volver a produccion.
    if (sunat.companyMode(company).motivo === 'manual') {
      const serie = type === '01' ? company.serie_factura : company.serie_boleta;
      const next = (Number(await DocumentoElectronico.max('correlativo', { where: { id_company_emisor: company.id_company, tipo: type, serie }, transaction })) || 0) + 1;
      const preview = { ...sale.get({ plain: true }), serie, correlativo: next };
      sunat.signXml(sunat.buildInvoiceXml({ company, sale: preview, details: sale.detalles }), company);
      await transaction.commit();
      return res.json({ success: true, sandbox: true, prueba: true, documento: { id: null, estado: 'prueba', serie, correlativo: next, codigo: '0', mensaje: 'Modo pruebas activado manualmente: XML generado y firmado, no enviado a SUNAT. La venta sigue sin emitir.' } });
    }
    const existing = await DocumentoElectronico.findOne({ where: { venta_id: sale.venta_id }, transaction });
    if (existing?.estado === 'aceptado') throw new Error('El comprobante ya fue aceptado');
    if (existing && existing.id_company_emisor !== company.id_company) throw new Error('No se puede cambiar el emisor después de iniciar la emisión');
    const serie = type === '01' ? company.serie_factura : company.serie_boleta;
    // El UNIQUE(id_company_emisor, tipo, serie, correlativo) ya existe: dos emisiones
    // concurrentes podian leer el mismo MAX y la segunda moria con duplicate-key.
    // Se reintenta con el MAX fresco dentro de la misma transaccion (MySQL no aborta
    // la transaccion por duplicate-key, solo la sentencia).
    const esDuplicado = e => e && (e.name === 'SequelizeUniqueConstraintError' || e.parent?.code === 'ER_DUP_ENTRY');
    let doc = existing || null;
    let nextCorrelative = existing?.correlativo || null;
    for (let intento = 0; intento < 6 && !doc; intento += 1) {
      try {
        nextCorrelative = (Number(await DocumentoElectronico.max('correlativo', { where: { id_company_emisor: company.id_company, tipo: type, serie }, transaction })) || 0) + 1;
        doc = await DocumentoElectronico.create({ venta_id: sale.venta_id, id_company_emisor: company.id_company, tipo: type, serie, correlativo: nextCorrelative, estado: 'pendiente' }, { transaction });
      } catch (error) {
        if (!esDuplicado(error) || intento === 5) throw error;
      }
    }
    await sale.update({ id_company_emisor: company.id_company, serie, correlativo: nextCorrelative }, { transaction });
    const unsigned = sunat.buildInvoiceXml({ company, sale, details: sale.detalles });
    const signed = sunat.signXml(unsigned, company);
    const fileName = `${company.ruc}-${type}-${sale.serie}-${String(sale.correlativo).padStart(8, '0')}`;
    const result = await sunat.sendBill({ fileName, signedXml: signed, company });
    const artifacts = sunat.saveArtifacts({ fileName, xml: signed, cdr: result.cdr });
    // SUNAT ResponseCode: 0 = aceptado; 2000-3999 = rechazado; >=4000 = aceptado con observaciones.
    const accepted = result.sandbox || result.code === '0' || Number(result.code) >= 4000;
    await doc.update({ estado: accepted ? 'aceptado' : 'rechazado', hash_xml: artifacts.hash, xml_path: artifacts.xmlPath, cdr_path: artifacts.cdrPath, codigo_respuesta: result.code, mensaje_respuesta: result.description, intentos: doc.intentos + 1 }, { transaction });
    await sale.update({ comprobante_emitido: accepted, estado_comprobante: accepted ? 'aceptado' : 'rechazado' }, { transaction });
    await transaction.commit();
    res.json({ success: accepted, sandbox: result.sandbox, documento: { id: doc.id_documento, estado: accepted ? 'aceptado' : 'rechazado', serie: sale.serie, correlativo: sale.correlativo, codigo: result.code, mensaje: result.description } });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.status = safe(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const where = {};
  if (typeof req.query.estado === 'string' && /^[a-z_]{3,20}$/.test(req.query.estado)) where.estado = req.query.estado;
  const { rows, count } = await DocumentoElectronico.findAndCountAll({ where, include: [{ model: Company, as: 'emisor', attributes: ['id_company', 'ruc', 'razon_social'] }], order: [['creado_en', 'DESC']], limit, offset, distinct: true });
  res.set('X-Total-Count', String(count));
  res.json(rows);
}, 'documentos');

// Solo lectura: no modifica emisores. El bloqueo del RUC 20 es una accion explicita (POST /emisores/bloquear-ruc20).
exports.emitters = safe(async (req, res) => {
  const companies = await Company.findAll({ where: { tipo_ruc: '10' }, order: [['emisor_predeterminado', 'DESC'], ['id_company', 'ASC']] });
  const admin = await fiscalAdminState(req);
  const info = sunat.sunatModeInfo();
  const rucVeinte = await Company.count({ where: { tipo_ruc: '20', [Op.or]: [{ facturacion_habilitada: true }, { emisor_predeterminado: true }] } });
  res.json({
    emisores: companies.map(publicEmitter),
    permisos: { puede_editar: admin.ok, motivo: admin.ok ? null : admin.motivo },
    sunat: { mode: info.mode, mode_valid: info.valid, warning: info.warning },
    ruc20_habilitados_pendientes: rucVeinte,
  });
}, 'emisores');

exports.blockRuc20 = safe(async (_req, res) => {
  const [afectados] = await Company.update({ facturacion_habilitada: false, emisor_predeterminado: false }, { where: { tipo_ruc: '20' } });
  res.json({ success: true, afectados });
}, 'bloquear-ruc20');

exports.setDefaultEmitter = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const company = await Company.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!company) throw Object.assign(new Error('Emisor no encontrado'), { status: 404 });
    if (company.tipo_ruc !== '10') throw new Error('Por ahora solo se puede usar el RUC 10');
    if (!company.facturacion_habilitada) throw new Error('El emisor está deshabilitado');
    if (!publicEmitter(company).configuracion_completa && sunat.companyMode(company).mode !== 'sandbox') throw new Error('Faltan certificado o credenciales SOL de este emisor');
    await Company.update({ emisor_predeterminado: false }, { where: {}, transaction });
    await company.update({ emisor_predeterminado: true }, { transaction });
    await transaction.commit();
    res.json({ success: true, emisor: publicEmitter(company) });
  } catch (error) {
    await transaction.rollback().catch(() => {});
    fail(res, error.status || 400, error.message);
  }
};

exports.updateEmitter = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const company = await Company.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!company) throw Object.assign(new Error('Emisor no encontrado'), { status: 404 });
    if (company.tipo_ruc !== '10') throw new Error('El RUC 20 permanece bloqueado hasta su activación independiente');
    const razonSocial = String(req.body.razon_social || '').trim();
    const direccion = String(req.body.direccion || '').trim();
    const serieFactura = String(req.body.serie_factura || '').trim().toUpperCase();
    const serieBoleta = String(req.body.serie_boleta || '').trim().toUpperCase();
    const errores = {};
    if (razonSocial.length < 3 || razonSocial.length > 100) errores.razon_social = 'La razón social debe tener entre 3 y 100 caracteres';
    if (direccion.length < 5 || direccion.length > 255) errores.direccion = 'El domicilio fiscal debe tener entre 5 y 255 caracteres';
    if (!/^F[A-Z0-9]{3}$/.test(serieFactura)) errores.serie_factura = 'La serie de factura debe tener formato F001';
    if (!/^B[A-Z0-9]{3}$/.test(serieBoleta)) errores.serie_boleta = 'La serie de boleta debe tener formato B001';
    if (Object.keys(errores).length) { await transaction.rollback(); return fail(res, 422, Object.values(errores)[0], { errores }); }
    const seriesChanged = serieFactura !== company.serie_factura || serieBoleta !== company.serie_boleta;
    if (seriesChanged) {
      const emitted = await DocumentoElectronico.count({ where: { id_company_emisor: company.id_company }, transaction });
      const confirmed = req.body.confirmar_cambio_series === true || req.body.confirmar_cambio_series === 'true';
      if (emitted && !confirmed) {
        await transaction.rollback();
        return fail(res, 409, 'Este emisor ya tiene comprobantes. Cambiar las series reinicia el correlativo en 1 para la serie nueva; confirma el cambio para continuar.', { requiere_confirmacion: true, comprobantes_emitidos: emitted });
      }
    }
    if (!sunat.readiness(company).complete && sunat.companyMode(company).mode !== 'sandbox') throw new Error('Faltan certificado o credenciales SOL de este emisor: no se puede habilitar en producción');
    await Company.update({ emisor_predeterminado: false }, { where: { id_company: { [Op.ne]: company.id_company } }, transaction });
    await company.update({ razon_social: razonSocial, direccion, serie_factura: serieFactura, serie_boleta: serieBoleta, facturacion_habilitada: true, emisor_predeterminado: true, sunat_config_key: 'RUC10' }, { transaction });
    await transaction.commit();
    return res.json({ success: true, emisor: publicEmitter(company) });
  } catch (error) {
    await transaction.rollback().catch(() => {});
    return fail(res, error.status || 400, error.message);
  }
};
