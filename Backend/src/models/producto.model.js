const { DataTypes } = require("sequelize")
const { sequelize } = require("../config/database")
const moment = require("moment-timezone")

const Producto = sequelize.define(
  "Producto",
  {
    id_producto: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    sku: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
      },
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    descripcion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    precio_unitario: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        isDecimal: true,
        min: 0,
      },
    },
    precio_unitario_con_igv: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        isDecimal: true,
        min: 0,
      },
    },
    precio_mayoritario: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        isDecimal: true,
        min: 0,
      },
    },
    precio_mayoritario_con_igv: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        isDecimal: true,
        min: 0,
      },
    },
    // NUEVOS CAMPOS DE OFERTA
    es_oferta: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si el producto está en oferta',
    },
    precio_oferta: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Precio de oferta si aplica',
    },
    precio_oferta_con_igv: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Precio de oferta con IGV si aplica',
    },
    imagen_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'URL de la imagen del producto',
    },
    stock: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        isInt: true,
        min: 0,
      },
    },
    // Reservado (no físico): unidades de pedidos web ya pagados pero aún no
    // entregados. Disponible para vender = stock - stock_reservado. El stock
    // físico solo baja de verdad cuando el pedido pasa a "entregado".
    stock_reservado: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { isInt: true, min: 0 } },
    costo_promedio: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    ultimo_costo: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    stock_minimo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    ubicacion: { type: DataTypes.STRING(100), allowNull: true },
    condicion: {
      type: DataTypes.ENUM("nuevo", "segunda_mano"),
      allowNull: false,
      defaultValue: "nuevo",
      comment: "Condición comercial informada al comprador",
    },
    origen: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "local",
      validate: { isIn: [["local", "importado"]] },
    },
    garantia_meses: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 12,
      validate: { min: 0, max: 120 },
    },
    estado_observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Desgaste, reparaciones o detalles conocidos del producto",
    },
    id_categoria: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "categorias",
        key: "id_categoria",
      },
    },
    propietario_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id_user' },
    },
    affiliate_business_id: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "productos",
    defaultScope: { where: { affiliate_business_id: null } },
    scopes: { allBusinesses: {} },
    timestamps: true,
    createdAt: "creado_en",
    updatedAt: "actualizado_en",
  },
)

// En el método toJSON de los modelos
Producto.prototype.toJSON = function () {
  const values = Object.assign({}, this.get())
  if (values.creado_en) {
    values.creado_en = moment(values.creado_en).tz("America/Lima").format("YYYY-MM-DD HH:mm:ss")
  }
  if (values.actualizado_en) {
    values.actualizado_en = moment(values.actualizado_en).tz("America/Lima").format("YYYY-MM-DD HH:mm:ss")
  }
  return values
}
module.exports = Producto
