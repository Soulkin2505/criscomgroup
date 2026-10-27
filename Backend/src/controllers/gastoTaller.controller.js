const { Op } = require('sequelize');
const { GastoTaller, sequelize } = require('../models');

const CATEGORIAS = [
  'insumos', 'herramientas', 'repuestos_stock', 'alquiler', 'servicios',
  'mano_obra_tercerizada', 'transporte', 'limpieza', 'software', 'capacitacion', 'otros',
];
const COMPROBANTES = ['ninguno', 'boleta', 'factura', 'recibo', 'otro'];

const normalize = (body) => {
  const data = {
    fecha: body.fecha || new Date().toISOString().slice(0, 10),
    categoria: CATEGORIAS.includes(body.categoria) ? body.categoria : 'otros',
    descripcion: String(body.descripcion || '').trim(),
    monto: Number(body.monto || 0),
    medio_pago: body.medio_pago ? String(body.medio_pago).trim() : null,
    proveedor: body.proveedor ? String(body.proveedor).trim() : null,
    comprobante_tipo: COMPROBANTES.includes(body.comprobante_tipo) ? body.comprobante_tipo : 'ninguno',
    comprobante_numero: body.comprobante_numero ? String(body.comprobante_numero).trim() : null,
    orden_servicio_id: body.orden_servicio_id ? Number(body.orden_servicio_id) : null,
    notas: body.notas ? String(body.notas).trim() : null,
  };
  if (data.categoria === 'mano_obra_tercerizada' && !data.orden_servicio_id) throw new Error('Vincula el pago al técnico con su orden de trabajo');
  if (!data.descripcion) throw new Error('La descripción del gasto es obligatoria');
  if (!Number.isFinite(data.monto) || data.monto <= 0) throw new Error('El monto debe ser un número mayor a 0');
  return data;
};

// Rango de fechas a partir de ?desde=&hasta= o ?periodo=hoy|semana|mes (por defecto: mes actual)
const resolveRange = (query) => {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (query.desde || query.hasta) {
    return { desde: query.desde || '1900-01-01', hasta: query.hasta || iso(today) };
  }
  const periodo = query.periodo || 'mes';
  if (periodo === 'hoy') return { desde: iso(today), hasta: iso(today) };
  if (periodo === 'semana') {
    const start = new Date(today); start.setDate(today.getDate() - 6);
    return { desde: iso(start), hasta: iso(today) };
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { desde: iso(start), hasta: iso(today) };
};

exports.list = async (req, res) => {
  try {
    const { desde, hasta } = resolveRange(req.query);
    const where = { fecha: { [Op.between]: [desde, hasta] } };
    if (req.query.categoria && CATEGORIAS.includes(req.query.categoria)) where.categoria = req.query.categoria;
    if (req.query.orden_servicio_id) where.orden_servicio_id = Number(req.query.orden_servicio_id);
    const records = await GastoTaller.findAll({ where, order: [['fecha', 'DESC'], ['id_gasto', 'DESC']] });
    res.json(records);
  } catch (error) { res.status(400).json({ message: error.message }); }
};

// Resumen para el panel Caja del taller: total del periodo + desglose por categoría.
exports.summary = async (req, res) => {
  try {
    const { desde, hasta } = resolveRange(req.query);
    const where = { fecha: { [Op.between]: [desde, hasta] } };
    const porCategoria = await GastoTaller.findAll({
      attributes: [
        'categoria',
        [sequelize.fn('SUM', sequelize.col('monto')), 'total'],
        [sequelize.fn('COUNT', sequelize.col('id_gasto')), 'cantidad'],
      ],
      where,
      group: ['categoria'],
      order: [[sequelize.literal('total'), 'DESC']],
      raw: true,
    });
    const total = porCategoria.reduce((sum, row) => sum + Number(row.total || 0), 0);
    res.json({
      periodo: { desde, hasta },
      total_gastos: Number(total.toFixed(2)),
      por_categoria: porCategoria.map((row) => ({
        categoria: row.categoria,
        total: Number(Number(row.total || 0).toFixed(2)),
        cantidad: Number(row.cantidad || 0),
      })),
    });
  } catch (error) { res.status(400).json({ message: error.message }); }
};

exports.create = async (req, res) => {
  try {
    const record = await GastoTaller.create({ ...normalize(req.body), registrado_por: req.user.id_user });
    res.status(201).json(record);
  } catch (error) { res.status(400).json({ message: error.message }); }
};

exports.update = async (req, res) => {
  try {
    const record = await GastoTaller.findByPk(req.params.id);
    if (!record) return res.status(404).json({ message: 'Gasto no encontrado' });
    await record.update(normalize(req.body));
    res.json(record);
  } catch (error) { res.status(400).json({ message: error.message }); }
};

exports.remove = async (req, res) => {
  try {
    const record = await GastoTaller.findByPk(req.params.id);
    if (!record) return res.status(404).json({ message: 'Gasto no encontrado' });
    await record.destroy();
    res.status(204).end();
  } catch (error) { res.status(400).json({ message: error.message }); }
};
