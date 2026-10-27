'use strict';
// Arranque del area Empresa/SUNAT/Pagos. Solo agrega columnas nuevas (nunca cambia datos) y
// avisa de configuraciones inconsistentes. Las correcciones son acciones explicitas
// (p. ej. POST /api/facturacion/emisores/bloquear-ruc20).
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const Company = require('../models/company.model');
const sunat = require('../services/sunat.service');

const ensureCompanyColumns = async () => {
  const [existing] = await sequelize.query('SHOW COLUMNS FROM companies');
  const names = new Set(existing.map(column => column.Field));
  const columns = {
    sunat_pruebas_manual: 'TINYINT(1) NOT NULL DEFAULT 0',
    sunat_produccion_desde: 'DATETIME NULL',
  };
  for (const [name, definition] of Object.entries(columns)) {
    if (!names.has(name)) await sequelize.query(`ALTER TABLE companies ADD COLUMN ${name} ${definition}`);
  }
};

const ensureAdminEmpresaSchema = async () => {
  const info = sunat.sunatModeInfo(); // avisa una vez si SUNAT_MODE es invalido
  const issues = [];
  await ensureCompanyColumns();
  try {
    const defaults = await Company.count({ where: { emisor_predeterminado: true } });
    if (defaults > 1) issues.push(`hay ${defaults} emisores predeterminados`);
    const ruc20 = await Company.count({ where: { tipo_ruc: '20', [Op.or]: [{ facturacion_habilitada: true }, { emisor_predeterminado: true }] } });
    if (ruc20) issues.push(`hay ${ruc20} empresa(s) RUC 20 habilitadas para facturar (usa el bloqueo explicito)`);
  } catch (error) {
    console.warn('[empresa] diagnostico omitido:', error.message);
  }
  issues.forEach(issue => console.warn(`[empresa] ${issue}`));
  return { mode: info.mode, modeValid: info.valid, issues };
};

module.exports = { ensureAdminEmpresaSchema };
