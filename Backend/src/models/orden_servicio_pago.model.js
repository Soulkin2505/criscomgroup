const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

module.exports = sequelize.define('OrdenServicioPago', {
  id_pago_servicio: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  id_orden_servicio: { type: DataTypes.INTEGER, allowNull: false },
  metodo: {
    type: DataTypes.ENUM('efectivo', 'pos', 'qr', 'transferencia', 'otro', 'tarjeta', 'yape', 'plin', 'pago_link'),
    allowNull: false,
  },
  monto: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  moneda: { type: DataTypes.ENUM('PEN', 'USD'), allowNull: false },
  referencia: { type: DataTypes.STRING(100), allowNull: true },
  nota: { type: DataTypes.STRING(255), allowNull: true },
  estado: {
    type: DataTypes.ENUM('confirmado', 'anulado'),
    allowNull: false,
    defaultValue: 'confirmado',
  },
  registrado_por: { type: DataTypes.INTEGER, allowNull: false },
  anulado_por: { type: DataTypes.INTEGER, allowNull: true },
  anulado_en: { type: DataTypes.DATE, allowNull: true },
  anulacion_motivo: { type: DataTypes.STRING(255), allowNull: true },
}, {
  tableName: 'ordenes_servicio_pagos',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
  indexes: [
    { fields: ['id_orden_servicio', 'estado'] },
    { fields: ['metodo', 'referencia'] },
  ],
});
