const { CierreCaja, User, Venta } = require('../models');
const { Op } = require('sequelize');
const { loadReceipts } = require('../services/cash-ledger.service');

// Una fuente de cobros: ventas directas y pagos del taller, sin duplicar su comprobante.
const scopedModel = (req) => req.user.affiliate_business_id ? CierreCaja.unscoped() : CierreCaja;
const accessWhere = (req, extra = {}) => req.user.affiliate_business_id
  ? { ...extra, affiliate_business_id: req.user.affiliate_business_id }
  : req.user.id_role === 3 ? { ...extra, cajero_id: req.user.id_user, affiliate_business_id: null } : { ...extra, affiliate_business_id: null };

const cierreCajaController = {
  // Crear un cierre de caja
  create: async (req, res) => {
    try {
      const { fecha_apertura, fecha_cierre, cajero_id, saldo_efectivo, estado, observaciones } = req.body;

      if (!fecha_apertura || !fecha_cierre) {
        return res.status(400).json({ message: 'fecha_apertura y fecha_cierre son obligatorias' });
      }
      const desde = new Date(fecha_apertura);
      const hasta = new Date(fecha_cierre);
      if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime()) || hasta <= desde) {
        return res.status(400).json({ message: 'Rango de fechas inválido' });
      }
      const cajeroId = req.user.id_role === 3 ? req.user.id_user : Number(cajero_id);
      if (!Number.isInteger(cajeroId) || cajeroId <= 0) {
        return res.status(400).json({ message: 'Cajero no válido' });
      }

      const ledger = await loadReceipts({ user: req.user, desde, hasta });
      const totales = Object.fromEntries(Object.entries(ledger.por_metodo).map(([key, value]) => [key, value.total]));
      const otros = totales.pago_link + totales.qr + totales.otro;
      const observacionesFinal = [observaciones, 'Caja de cobros: ventas + taller, sin duplicar comprobantes',
        'Egresos de efectivo registrados: S/ ' + ledger.egresos_efectivo.toFixed(2),
        otros ? 'Otros medios: S/ ' + otros.toFixed(2) : null,
        'No incluye fondo inicial ni retiros no registrados'].filter(Boolean).join(' | ');

      const cierre = await CierreCaja.create({
        fecha_apertura: desde,
        fecha_cierre: hasta,
        cajero_id: cajeroId,
        affiliate_business_id: req.user.affiliate_business_id || null,
        saldo_efectivo,
        total_efectivo: ledger.efectivo_neto,
        total_tarjeta: Number(totales.tarjeta.toFixed(2)),
        total_transferencia: Number(totales.transferencia.toFixed(2)),
        total_yape: Number(totales.yape.toFixed(2)),
        total_plin: Number(totales.plin.toFixed(2)),
        cantidad_ventas: Object.values(ledger.por_metodo).reduce((sum, item) => sum + item.cantidad, 0),
        estado,
        observaciones: observacionesFinal
      });
      return res.status(201).json({ message: 'Cierre de caja registrado', cierre });
    } catch (error) {
      return res.status(500).json({ message: 'Error al crear cierre de caja', error: error.message });
    }
  },

  // Obtener todos los cierres de caja
  getAll: async (req, res) => {
    try {
      const cierres = await scopedModel(req).findAll({ where: accessWhere(req), order: [['fecha_apertura', 'DESC']] });
      return res.status(200).json(cierres);
    } catch (error) {
      return res.status(500).json({ message: 'Error al obtener cierres de caja', error: error.message });
    }
  },

  // Obtener cierre de caja por ID
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const cierre = await scopedModel(req).findOne({ where: accessWhere(req, { id_cierre: id }) });
      if (!cierre) return res.status(404).json({ message: 'Cierre de caja no encontrado' });
      return res.status(200).json(cierre);
    } catch (error) {
      return res.status(500).json({ message: 'Error al obtener cierre de caja', error: error.message });
    }
  },

  // Actualizar cierre de caja
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const cierre = await scopedModel(req).findOne({ where: accessWhere(req, { id_cierre: id }) });
      if (!cierre) return res.status(404).json({ message: 'Cierre de caja no encontrado' });
      // Si en el body viene monto_total, cambiarlo a saldo_efectivo
      if (req.body.monto_total !== undefined) {
        req.body.saldo_efectivo = req.body.monto_total;
        delete req.body.monto_total;
      }
      // Los totales y la cantidad los calcula el servidor (M1): no se aceptan del cliente
      for (const campo of ['total_efectivo', 'total_tarjeta', 'total_transferencia', 'total_yape', 'total_plin', 'cantidad_ventas'])
        delete req.body[campo];
      await cierre.update(req.body);
      return res.status(200).json({ message: 'Cierre de caja actualizado', cierre });
    } catch (error) {
      return res.status(500).json({ message: 'Error al actualizar cierre de caja', error: error.message });
    }
  },

  // Eliminar cierre de caja
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const cierre = await scopedModel(req).findOne({ where: accessWhere(req, { id_cierre: id }) });
      if (!cierre) return res.status(404).json({ message: 'Cierre de caja no encontrado' });
      await cierre.destroy();
      return res.status(200).json({ message: 'Cierre de caja eliminado' });
    } catch (error) {
      return res.status(500).json({ message: 'Error al eliminar cierre de caja', error: error.message });
    }
  },

  // Obtener cierres de caja por cajero
  getByCajero: async (req, res) => {
    try {
      const { cajero_id } = req.params;
      const cierres = await scopedModel(req).findAll({
        where: accessWhere(req, { cajero_id: req.user.id_role === 3 ? req.user.id_user : cajero_id }),
        order: [['fecha_apertura', 'DESC']]
      });
      return res.status(200).json(cierres);
    } catch (error) {
      return res.status(500).json({ message: 'Error al obtener cierres por cajero', error: error.message });
    }
  },

  // Obtener cierres de caja por rango de fechas
  getByDateRange: async (req, res) => {
    try {
      const { fechaInicio, fechaFin } = req.query;
      if (!fechaInicio || !fechaFin) {
        return res.status(400).json({ message: 'Debe proporcionar fechaInicio y fechaFin' });
      }
      // Sumar un día a la fechaFin para incluir todo el día final
      const fechaFinObj = new Date(fechaFin);
      fechaFinObj.setDate(fechaFinObj.getDate() + 1);
      const fechaFinInclusive = fechaFinObj.toISOString().split('T')[0];
      const cierres = await scopedModel(req).findAll({
        where: accessWhere(req, {
          fecha_apertura: {
            [Op.gte]: fechaInicio,
            [Op.lt]: fechaFinInclusive
          }
        }),
        order: [['fecha_apertura', 'DESC']]
      });
      return res.status(200).json(cierres);
    } catch (error) {
      return res.status(500).json({ message: 'Error al obtener cierres por rango de fechas', error: error.message });
    }
  }
};

module.exports = cierreCajaController;
