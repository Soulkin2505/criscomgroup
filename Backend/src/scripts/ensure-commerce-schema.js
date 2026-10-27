const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const addMissing = async (table, columns) => {
  const qi = sequelize.getQueryInterface();
  const current = await qi.describeTable(table);
  let added = 0;
  for (const [name, definition] of Object.entries(columns)) {
    if (!current[name]) {
      await qi.addColumn(table, name, definition);
      added += 1;
    }
  }
  return added;
};

const enumValues = type => {
  const match = String(type || '').trim().match(/^enum\s*\((.*)\)$/i);
  if (!match) return null;
  return [...match[1].matchAll(/'((?:''|[^'])*)'/g)].map(item => item[1].replace(/''/g, "'"));
};

const enumEquals = (type, expected) => {
  const actual = enumValues(type);
  return actual !== null && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
};

const mysqlColumns = async targets => {
  const [rows] = await sequelize.query(
    `SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (${targets.map(() => '(TABLE_NAME = ? AND COLUMN_NAME = ?)').join(' OR ')})`,
    { replacements: targets.flat() },
  );
  return new Map(rows.map(row => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]));
};

// Libro de reclamaciones: la tabla original solo tenia datos de contacto y un estado libre.
// Idempotente: agrega lo que falte (sin migrar datos) y deja estado como ENUM con indice unico en codigo.
const ensureLibroReclamaciones = async () => {
  const table = 'libro_reclamaciones';
  const estados = ['pendiente', 'en_proceso', 'respondido', 'archivado'];
  await addMissing(table, {
    codigo: { type: DataTypes.STRING(20), allowNull: true },
    tipo: { type: DataTypes.ENUM('reclamo', 'queja'), allowNull: true },
    documento: { type: DataTypes.STRING(20), allowNull: true },
    domicilio: { type: DataTypes.STRING(255), allowNull: true },
    es_menor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    apoderado: { type: DataTypes.STRING(160), allowNull: true },
    tipo_bien: { type: DataTypes.ENUM('producto', 'servicio'), allowNull: true },
    bien: { type: DataTypes.STRING(255), allowNull: true },
    monto: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    pedido: { type: DataTypes.TEXT, allowNull: true },
    fecha_vencimiento: { type: DataTypes.DATEONLY, allowNull: true },
    respuesta: { type: DataTypes.TEXT, allowNull: true },
    fecha_respuesta: { type: DataTypes.DATE, allowNull: true },
    respondido_por: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id_user' } },
  });
  const qi = sequelize.getQueryInterface();
  const meta = await mysqlColumns([[table, 'estado']]);
  const estado = meta.get(`${table}.estado`);
  if (estado && !enumEquals(estado.COLUMN_TYPE, estados)) {
    await sequelize.query(`UPDATE ${table} SET estado = 'en_proceso' WHERE estado NOT IN (${estados.map(() => '?').join(',')})`, { replacements: estados });
    await qi.changeColumn(table, 'estado', { type: DataTypes.ENUM(...estados), allowNull: false, defaultValue: 'pendiente' });
  }
  const indexes = await qi.showIndex(table);
  if (!indexes.some(index => index.unique && index.fields.length === 1 && index.fields[0].attribute === 'codigo')) {
    await qi.addIndex(table, ['codigo'], { unique: true, name: 'libro_reclamaciones_codigo_uq' });
  }
};

// Solicitudes de importacion y de armado: tablas, historiales y columnas nuevas.
// Idempotente. fecha_entrega_estimada pasa de DATETIME a DATE (fecha civil, sin zona).
const ensureSolicitudes = async () => {
  const { SolicitudImportacion, SolicitudEnsamble, SolicitudImportacionHistorial, SolicitudEnsambleHistorial } = require('../models');
  await SolicitudImportacion.sync();
  await SolicitudEnsamble.sync();
  await SolicitudImportacionHistorial.sync();
  await SolicitudEnsambleHistorial.sync();
  await addMissing('solicitudes_importacion', {
    valida_hasta: { type: DataTypes.DATE, allowNull: true },
    importacion_id: { type: DataTypes.INTEGER, allowNull: true },
    convertida_en: { type: DataTypes.DATE, allowNull: true },
  });
  await addMissing('solicitudes_ensamble', {
    valida_hasta: { type: DataTypes.DATE, allowNull: true },
    cotizacion_id: { type: DataTypes.INTEGER, allowNull: true },
    convertida_en: { type: DataTypes.DATE, allowNull: true },
  });
  const qi = sequelize.getQueryInterface();
  for (const table of ['solicitudes_importacion', 'solicitudes_ensamble']) {
    const meta = (await mysqlColumns([[table, 'fecha_entrega_estimada']])).get(`${table}.fecha_entrega_estimada`);
    if (meta && String(meta.COLUMN_TYPE).toLowerCase() !== 'date') {
      await qi.changeColumn(table, 'fecha_entrega_estimada', { type: DataTypes.DATEONLY, allowNull: true });
    }
  }
};

const ensureCommerceSchema = async () => {
const { CarritoItem, PedidoVenta, Proveedor, Compra, CompraDetalle, MovimientoInventario, Cotizacion, CotizacionDetalle, AreaGrant, AccessRequest, PaymentGateway, SolicitudEnsamble, LibroReclamaciones } = require('../models');
  await SolicitudEnsamble.sync();
  await CarritoItem.sync();
  await PedidoVenta.sync();
  await Proveedor.sync();
  await Compra.sync();
  await CompraDetalle.sync();
  await MovimientoInventario.sync();
  await Cotizacion.sync();
  await CotizacionDetalle.sync();
  await AreaGrant.sync();
  await AccessRequest.sync();
  await PaymentGateway.sync();
  await LibroReclamaciones.sync();
  await addMissing('productos', {
    condicion: { type: DataTypes.ENUM('nuevo', 'segunda_mano'), allowNull: false, defaultValue: 'nuevo' },
    garantia_meses: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 12 },
    estado_observaciones: { type: DataTypes.TEXT, allowNull: true },
    propietario_id: { type: DataTypes.INTEGER, allowNull: true },
    affiliate_business_id: { type: DataTypes.INTEGER, allowNull: true },
    costo_promedio: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    ultimo_costo: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    stock_minimo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    ubicacion: { type: DataTypes.STRING(100), allowNull: true },
    // pedidos-web-reserva: unidades pagadas pero no entregadas todavía; no son
    // físicamente parte del stock disponible, pero tampoco se han descontado.
    stock_reservado: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  });
  await addMissing('users', {
    tipo_vendedor: { type: DataTypes.ENUM('fisico', 'virtual', 'afiliado'), allowNull: true },
    comision_servicio_porcentaje: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 8 },
    acceso_expira_en: { type: DataTypes.DATE, allowNull: true },
    acceso_otorgado_por: { type: DataTypes.INTEGER, allowNull: true },
    superusuario_temporal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    superusuario_expira_en: { type: DataTypes.DATE, allowNull: true },
    affiliate_business_id: { type: DataTypes.INTEGER, allowNull: true },
  });
  await addMissing('affiliate_businesses', {
    prueba_inicia_en: { type: DataTypes.DATE, allowNull: true },
    prueba_finaliza_en: { type: DataTypes.DATE, allowNull: true },
    logo_url: { type: DataTypes.STRING(255), allowNull: true },
    identidad_configurada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });
  const businessesWithoutTrial = await sequelize.models.AffiliateBusiness.findAll({ where: { prueba_finaliza_en: null } });
  for (const business of businessesWithoutTrial) {
    const startedAt = business.prueba_inicia_en || business.creado_en || new Date();
    const endsAt = new Date(startedAt);
    endsAt.setMonth(endsAt.getMonth() + 2);
    await business.update({ prueba_inicia_en: startedAt, prueba_finaliza_en: endsAt });
  }
  await addMissing('detalle_ventas', {
    descripcion: { type: DataTypes.STRING(255), allowNull: true },
    condicion: { type: DataTypes.ENUM('nuevo', 'segunda_mano'), allowNull: false, defaultValue: 'nuevo' },
    garantia_meses: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 12 },
    estado_observaciones: { type: DataTypes.TEXT, allowNull: true },
  });
  await addMissing('pedido_detalles', {
    affiliate_business_id: { type: DataTypes.INTEGER, allowNull: true },
    propietario_id: { type: DataTypes.INTEGER, allowNull: true },
    comision_porcentaje: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
  });
  await addMissing('cierres_caja', { affiliate_business_id: { type: DataTypes.INTEGER, allowNull: true } });
  await addMissing('pedidos', {
    payment_token_hash: { type: DataTypes.STRING(64), allowNull: true },
    recargo_tarjeta: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  });
  await addMissing('ventas', {
    cliente_direccion: { type: DataTypes.STRING(255), allowNull: true },
    cliente_email: { type: DataTypes.STRING(150), allowNull: true },
    estado_comprobante: { type: DataTypes.ENUM('sin_emitir', 'pendiente', 'aceptado', 'rechazado', 'error'), allowNull: false, defaultValue: 'sin_emitir' },
    garantia_texto: { type: DataTypes.TEXT, allowNull: true },
    id_company_emisor: { type: DataTypes.INTEGER, allowNull: true },
    tipo_vendedor_snapshot: { type: DataTypes.STRING(20), allowNull: true },
    comision_porcentaje: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    comision_servicio: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    neto_vendedor: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    affiliate_business_id: { type: DataTypes.INTEGER, allowNull: true },
    // pedidos-web-pasarela: distingue una venta nacida de un pedido web de una
    // de mostrador (origen_tipo) e identifica con qué pasarela se cobró
    // ('culqi', 'manual', o el proveedor que corresponda) cuando aplica.
    pasarela_pago: { type: DataTypes.STRING(30), allowNull: true },
  });
  await addMissing('companies', {
    tipo_ruc: { type: DataTypes.ENUM('10', '20'), allowNull: false, defaultValue: '10' },
    facturacion_habilitada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    emisor_predeterminado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    serie_factura: { type: DataTypes.STRING(4), allowNull: false, defaultValue: 'F001' },
    serie_boleta: { type: DataTypes.STRING(4), allowNull: false, defaultValue: 'B001' },
    sunat_config_key: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'RUC10' },
    instagram_url: { type: DataTypes.STRING(255), allowNull: true },
    facebook_url: { type: DataTypes.STRING(255), allowNull: true },
    tiktok_url: { type: DataTypes.STRING(255), allowNull: true },
    youtube_url: { type: DataTypes.STRING(255), allowNull: true },
    whatsapp_number: { type: DataTypes.STRING(20), allowNull: true },
    horario_inicio: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '08:50' },
    horario_fin: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '21:15' },
    horario_restriccion_activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    mostrar_en_web: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });
  await addMissing('banner', {
    media_type: { type: DataTypes.ENUM('image', 'video'), allowNull: false, defaultValue: 'image' },
    titulo: { type: DataTypes.STRING(120), allowNull: true },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  });
  // ecom-logica T2: vigencia opcional de ofertas (NULL = sin límite).
  await addMissing('ofertas', {
    vigente_desde: { type: DataTypes.DATE, allowNull: true },
    vigente_hasta: { type: DataTypes.DATE, allowNull: true },
  });
  await addMissing('documentos_electronicos', {
    id_company_emisor: { type: DataTypes.INTEGER, allowNull: true },
  });
  const [[enabled]] = await sequelize.query('SELECT COUNT(*) AS total FROM companies WHERE facturacion_habilitada = 1');
  if (Number(enabled.total) === 0) {
    const [[primary]] = await sequelize.query("SELECT id_company FROM companies WHERE ruc LIKE '10%' ORDER BY id_company ASC LIMIT 1");
    if (primary) {
      await sequelize.query('UPDATE companies SET facturacion_habilitada = 1, emisor_predeterminado = 1, tipo_ruc = \'10\', sunat_config_key = \'RUC10\' WHERE id_company = ?', { replacements: [primary.id_company] });
    }
  }
  // Si ninguna empresa fue elegida aun para mostrarse en la web, se usa la misma por defecto
  // que ya actua como emisor principal (para no dejar la web sin datos de contacto por omision).
  const [[publicChosen]] = await sequelize.query('SELECT COUNT(*) AS total FROM companies WHERE mostrar_en_web = 1');
  if (Number(publicChosen.total) === 0) {
    const [[defaultPublic]] = await sequelize.query('SELECT id_company FROM companies ORDER BY emisor_predeterminado DESC, id_company ASC LIMIT 1');
    if (defaultPublic) {
      await sequelize.query('UPDATE companies SET mostrar_en_web = 1 WHERE id_company = ?', { replacements: [defaultPublic.id_company] });
    }
  }
  const qi = sequelize.getQueryInterface();
  const metadata = await mysqlColumns([['detalle_ventas', 'producto_id'], ['ventas', 'tipo_documento']]);
  const productId = metadata.get('detalle_ventas.producto_id');
  if (productId && productId.IS_NULLABLE !== 'YES') {
    await qi.changeColumn('detalle_ventas', 'producto_id', { type: DataTypes.INTEGER, allowNull: true });
  }
  const documentType = metadata.get('ventas.tipo_documento');
  if (documentType && (documentType.IS_NULLABLE !== 'YES' || !enumEquals(documentType.COLUMN_TYPE, ['0', '1', '3']))) {
    await qi.changeColumn('ventas', 'tipo_documento', { type: DataTypes.ENUM('0', '1', '3'), allowNull: true });
  }
  await ensureLibroReclamaciones();
  await ensureSolicitudes();
};

module.exports = { ensureCommerceSchema, enumValues, enumEquals };
