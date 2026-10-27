const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Gastos internos del taller (egresos NO ligados a la compra de un repuesto de una orden):
// insumos, herramientas, alquiler prorrateado, servicios, transporte, etc.
// Alimenta el panel "Caja del taller" (Gastos del taller / Ganancia estimada).
module.exports = sequelize.define('GastoTaller', {
  id_gasto: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  categoria: {
    type: DataTypes.ENUM(
      'insumos',        // pasta térmica, alcohol isopropílico, hisopos, cautín, estaño
      'herramientas',   // destornilladores, multímetro, estación de soldadura
      'repuestos_stock',// repuestos comprados a stock (no imputados aún a una orden)
      'alquiler',       // alquiler del local (prorrateo)
      'servicios',      // luz, agua, internet, telefonía
      'transporte',     // envíos, movilidad, recojo de equipos
      'limpieza',       // limpieza y mantenimiento del local
      'software',       // licencias, suscripciones, diagnóstico
      'capacitacion',   // cursos, certificaciones del personal técnico
      'mano_obra_tercerizada',
      'otros'
    ),
    allowNull: false,
    defaultValue: 'otros',
  },
  descripcion: { type: DataTypes.STRING(200), allowNull: false },
  monto: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  medio_pago: { type: DataTypes.STRING(50), allowNull: true }, // efectivo, yape, plin, transferencia, tarjeta
  proveedor: { type: DataTypes.STRING(160), allowNull: true },
  comprobante_tipo: {
    type: DataTypes.ENUM('ninguno', 'boleta', 'factura', 'recibo', 'otro'),
    allowNull: false,
    defaultValue: 'ninguno',
  },
  comprobante_numero: { type: DataTypes.STRING(60), allowNull: true },
  // Gasto imputable a una orden específica (opcional): permite costeo real por reparación.
  orden_servicio_id: { type: DataTypes.INTEGER, allowNull: true },
  notas: { type: DataTypes.TEXT, allowNull: true },
  registrado_por: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'gastos_taller',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
  indexes: [
    { fields: ['fecha'] },
    { fields: ['categoria'] },
    { fields: ['orden_servicio_id'] },
  ],
});
