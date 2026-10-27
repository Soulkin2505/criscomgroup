const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const ensureServiceSchema = async () => {
  const qi = sequelize.getQueryInterface();
  const products = await qi.describeTable('productos');
  if (!products.origen) await qi.addColumn('productos', 'origen', { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'local' });
  const acquisitions = await qi.describeTable('adquisiciones_usados');
  if (!acquisitions.inventario_registrado_en) await qi.addColumn('adquisiciones_usados', 'inventario_registrado_en', { type: DataTypes.DATE, allowNull: true });
  const imports = await qi.describeTable('importaciones');
  const importColumns = {
    producto_id: { type: DataTypes.INTEGER, allowNull: true },
    cantidad: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    tipo_cambio: { type: DataTypes.DECIMAL(12, 6), allowNull: false, defaultValue: 1 },
    inventario_registrado_en: { type: DataTypes.DATE, allowNull: true },
  };
  for (const [name, definition] of Object.entries(importColumns))
    if (!imports[name]) await qi.addColumn('importaciones', name, definition);
  // Teléfono del usuario (usado para mapear WhatsApp → técnico en órdenes de servicio).
  const usersTable = await qi.describeTable('users');
  if (!usersTable.telefono) await qi.addColumn('users', 'telefono', { type: DataTypes.STRING(30), allowNull: true });
  const { OrdenServicioDiagnostico, OrdenServicioMensaje, OrdenServicioCanalEvento, GastoTaller, ClienteServicio, ActivoTecnico, OrdenServicioCredencial, InventarioUbicacion, InventarioQuant, InventarioReserva } = require('../models');
  // Producción omite sequelize.sync() cuando el esquema base ya existe. Cada
  // tabla agregada al módulo debe sincronizarse aquí para que los despliegues
  // incrementales no dejen el modelo disponible con su tabla ausente.
  await GastoTaller.sync();
  await OrdenServicioDiagnostico.sync();
  await OrdenServicioMensaje.sync();
  await OrdenServicioCanalEvento.sync();
  await ClienteServicio.sync();
  await ActivoTecnico.sync();
  await OrdenServicioCredencial.sync();
  await InventarioUbicacion.sync();
  await InventarioQuant.sync();
  await InventarioReserva.sync();
  const evidences = await qi.describeTable('ordenes_servicio_evidencias');
  const evidenceColumns = {
    origen: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'erp' },
    visible_cliente: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    publicada_por: { type: DataTypes.INTEGER, allowNull: true },
    publicada_en: { type: DataTypes.DATE, allowNull: true },
    // Firma digital (S1): metadatos para etapas firma_recepcion/firma_garantia.
    firmante_nombre: { type: DataTypes.STRING(160), allowNull: true },
    firmante_dni: { type: DataTypes.STRING(20), allowNull: true },
    hash_sha256: { type: DataTypes.STRING(64), allowNull: true },
  };
  for (const [name, definition] of Object.entries(evidenceColumns))
    if (!evidences[name]) await qi.addColumn('ordenes_servicio_evidencias', name, definition);
  // Migrar etapa/tipo de ENUM a STRING para admitir nuevas etapas (firma_*) sin
  // ALTER de enum, igual que ordenes_servicio_eventos.tipo.
  const [evidenceEnumCols] = await sequelize.query(
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ordenes_servicio_evidencias'
        AND COLUMN_NAME IN ('etapa','tipo')`,
  );
  for (const col of evidenceEnumCols) {
    if (String(col.DATA_TYPE || '').toLowerCase() !== 'enum') continue;
    await qi.changeColumn('ordenes_servicio_evidencias', col.COLUMN_NAME, {
      type: DataTypes.STRING(col.COLUMN_NAME === 'etapa' ? 40 : 20),
      allowNull: false,
    });
  }
  const requests = await qi.describeTable('solicitudes_servicio');
  if (!requests.consentimiento_contacto) await qi.addColumn('solicitudes_servicio', 'consentimiento_contacto', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  if (!requests.consentimiento_contacto_en) await qi.addColumn('solicitudes_servicio', 'consentimiento_contacto_en', { type: DataTypes.DATE, allowNull: true });
  const current = await qi.describeTable("ordenes_servicio");
  if (String(current.tipo?.type || '').toUpperCase().startsWith('ENUM')) {
    await qi.changeColumn('ordenes_servicio', 'tipo', {
      type: DataTypes.STRING(30),
      allowNull: false,
    });
  }
  const columns = {
    subtipo_trabajo: { type: DataTypes.STRING(40), allowNull: true },
    tareas_solicitadas: { type: DataTypes.JSON, allowNull: true },
    cliente_servicio_id: { type: DataTypes.INTEGER, allowNull: true },
    activo_tecnico_id: { type: DataTypes.INTEGER, allowNull: true },
    estado_fisico: { type: DataTypes.JSON, allowNull: true },
    accesorios_recibidos: { type: DataTypes.JSON, allowNull: true },
    recepcion_conforme: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    recepcion_conforme_en: { type: DataTypes.DATE, allowNull: true },
    recepcion_responsable_id: { type: DataTypes.INTEGER, allowNull: true },
    descuento: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    recargo: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    garantia_inicio: { type: DataTypes.DATEONLY, allowNull: true },
    garantia_fin: { type: DataTypes.DATEONLY, allowNull: true },
    garantia_cobertura: { type: DataTypes.TEXT, allowNull: true },
    garantia_exclusiones: { type: DataTypes.TEXT, allowNull: true },
    fecha_entrega_real: { type: DataTypes.DATEONLY, allowNull: true },
    orden_origen_garantia_id: { type: DataTypes.INTEGER, allowNull: true },
    anulada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    anulacion_motivo: { type: DataTypes.TEXT, allowNull: true },
    anulada_en: { type: DataTypes.DATE, allowNull: true },
    tecnico_id: { type: DataTypes.INTEGER, allowNull: true },
    token_seguimiento: { type: DataTypes.STRING(48), allowNull: true },
    affiliate_business_id: { type: DataTypes.INTEGER, allowNull: true },
    whatsapp_consentimiento: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    whatsapp_consentimiento_en: { type: DataTypes.DATE, allowNull: true },
    whatsapp_consentimiento_revocado_en: { type: DataTypes.DATE, allowNull: true },
    whatsapp_consentimiento_fuente: { type: DataTypes.STRING(80), allowNull: true },
    venta_id: { type: DataTypes.INTEGER, allowNull: true, unique: true },
    clasificacion_fiscal: { type: DataTypes.STRING(30), allowNull: true },
    estado_facturacion: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'sin_facturar' },
    referencia_comprobante: { type: DataTypes.STRING(80), allowNull: true },
  };
  for (const [name, definition] of Object.entries(columns))
    if (!current[name])
      await qi.addColumn("ordenes_servicio", name, definition);
  const sales = await qi.describeTable('ventas');
  const saleColumns = {
    origen_tipo: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'venta_directa' },
    orden_servicio_id: { type: DataTypes.INTEGER, allowNull: true, unique: true },
    categoria_ingreso: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'productos' },
  };
  for (const [name, definition] of Object.entries(saleColumns))
    if (!sales[name]) await qi.addColumn('ventas', name, definition);
  const [paymentColumn] = await sequelize.query("SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_servicio_pagos' AND COLUMN_NAME = 'metodo'");
  if (paymentColumn[0] && !paymentColumn[0].COLUMN_TYPE.includes("'yape'")) {
    await qi.changeColumn('ordenes_servicio_pagos', 'metodo', { type: DataTypes.ENUM('efectivo', 'pos', 'qr', 'transferencia', 'otro', 'tarjeta', 'yape', 'plin', 'pago_link'), allowNull: false });
  }
  const [expenseColumn] = await sequelize.query("SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gastos_taller' AND COLUMN_NAME = 'categoria'");
  if (expenseColumn[0] && !expenseColumn[0].COLUMN_TYPE.includes("'mano_obra_tercerizada'")) {
    await qi.changeColumn('gastos_taller', 'categoria', { type: DataTypes.ENUM('insumos', 'herramientas', 'repuestos_stock', 'alquiler', 'servicios', 'transporte', 'limpieza', 'software', 'capacitacion', 'mano_obra_tercerizada', 'otros'), allowNull: false, defaultValue: 'otros' });
  }
  // Backfill de tokens de seguimiento para órdenes existentes sin token.
  if (!current.token_seguimiento) {
    const crypto = require("crypto");
    const [rows] = await sequelize.query(
      "SELECT id_orden_servicio FROM ordenes_servicio WHERE token_seguimiento IS NULL",
    );
    for (const row of rows) {
      await sequelize.query(
        "UPDATE ordenes_servicio SET token_seguimiento = :token WHERE id_orden_servicio = :id",
        { replacements: { token: crypto.randomBytes(9).toString("hex"), id: row.id_orden_servicio } },
      );
    }
  }
  const [eventColumns] = await sequelize.query(
    `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ordenes_servicio_eventos'
        AND COLUMN_NAME = 'tipo' LIMIT 1`,
  );
  if (String(eventColumns[0]?.DATA_TYPE || '').toLowerCase() === 'enum') {
    await qi.changeColumn("ordenes_servicio_eventos", "tipo", {
      type: DataTypes.STRING(40),
      allowNull: false,
    });
  }
};
module.exports = { ensureServiceSchema };

if (require.main === module) {
  ensureServiceSchema()
    .then(async () => {
      console.log('Esquema de servicio técnico sincronizado');
      await sequelize.close();
    })
    .catch(async (error) => {
      console.error('No se pudo sincronizar el esquema de servicio técnico:', error.message);
      await sequelize.close().catch(() => {});
      process.exitCode = 1;
    });
}
