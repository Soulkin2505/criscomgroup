const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const moment = require('moment-timezone');

const Venta = sequelize.define('Venta', {
  venta_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fecha: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  total: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      isDecimal: true,
      min: 0
    }
  },
  total_con_igv: { 
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      isDecimal: true,
      min: 0
    }
  },
  id_cajero: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  metodo_pago: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  observaciones: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // Nuevos campos para facturación
  tipo_documento: {
    type: DataTypes.ENUM('0', '1', '3'),  // 0 = Nota de venta, 1 = Factura, 3 = Boleta
    allowNull: true,  // Puede ser nulo si aún no se genera comprobante
    comment: '0=Nota de venta interna, 1=Factura, 3=Boleta'
  },
  serie: {
    type: DataTypes.STRING(4),
    allowNull: true,  // Puede ser nulo si aún no se genera comprobante
    comment: 'F001 para facturas, B001 para boletas'
  },
  correlativo: {
    type: DataTypes.INTEGER,
    allowNull: true,  // Puede ser nulo si aún no se genera comprobante
  },
  idempotency_key: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'Clave de idempotencia del POS: un reintento con la misma clave no duplica la venta'
  },
  // Datos del cliente
  cliente_tipo_documento: {
    type: DataTypes.ENUM('1', '6'),  // 1 = DNI, 6 = RUC
    allowNull: true,  // Puede ser nulo si aún no se genera comprobante
    comment: '1=DNI, 6=RUC'
  },
  cliente_numero_documento: {
    type: DataTypes.STRING(15),
    allowNull: true  // Puede ser nulo si aún no se genera comprobante
  },
  cliente_nombre: {
    type: DataTypes.STRING(100),
    allowNull: true  // Puede ser nulo si aún no se genera comprobante
  },
  comprobante_emitido: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  cliente_direccion: { type: DataTypes.STRING(255), allowNull: true },
  cliente_email: { type: DataTypes.STRING(150), allowNull: true },
  estado_comprobante: {
    type: DataTypes.ENUM('sin_emitir', 'pendiente', 'aceptado', 'rechazado', 'error'),
    allowNull: false,
    defaultValue: 'sin_emitir'
  },
  garantia_texto: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  id_company_emisor: { type: DataTypes.INTEGER, allowNull: true },
  tipo_vendedor_snapshot: { type: DataTypes.STRING(20), allowNull: true },
  comision_porcentaje: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
  comision_servicio: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  neto_vendedor: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  affiliate_business_id: { type: DataTypes.INTEGER, allowNull: true },
  origen_tipo: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'venta_directa' },
  pasarela_pago: { type: DataTypes.STRING(30), allowNull: true },
  orden_servicio_id: { type: DataTypes.INTEGER, allowNull: true, unique: true },
  categoria_ingreso: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'productos' },
  // NUEVOS CAMPOS PARA DESCUENTO EN VENTA
  es_descuento: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Indica si la venta tiene descuento aplicado',
  },
  descuento: {
    type: DataTypes.FLOAT,
    allowNull: true,
    comment: 'Porcentaje de descuento aplicado a la venta',
  }
}, {
  tableName: 'ventas',
  defaultScope: { where: { affiliate_business_id: null } },
  scopes: { allBusinesses: {} },
  timestamps: true,
  createdAt: false,
  updatedAt: false,
  // Red de seguridad contra correlativos duplicados (NULLs permitidos: notas
  // internas y ventas de servicio/cotizacion sin numerar). La asignacion real
  // la hace services/correlativo.service.js; en dev/prod el indice lo crea
  // scripts/ensure-series-comprobantes.js tras verificar que no haya duplicados.
  indexes: [{ unique: true, name: 'ventas_serie_correlativo_unique', fields: ['serie', 'correlativo'] }, { unique: true, name: 'ventas_idempotencia_unique', fields: ['idempotency_key'] }]
});

module.exports = Venta;
