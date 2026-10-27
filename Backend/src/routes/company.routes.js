// routes/company.routes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const { verificarRolesSinHorario } = require('../middlewares/restricciones.middleware');
const { registrarAuditoria, capturarEstadoOriginal } = require('../middlewares/audit.middleware');
const Company = require('../models/company.model');
const sunat = require('../services/sunat.service');
const culqi = require('../services/culqi.service');
const gatewayService = require('../services/payment-gateway.service');
const businessHours = require('../services/business-hours.service');
const upload = require('../middlewares/upload.middleware');
const { RUC_DIR, markerFor, readSheet } = require('../services/ruc-sheet.service');
const {
  createCompany, updateCompanyPatch, updateCompanyPut, getCompanies, getCompanyByRuc,
  deleteCompanyByRuc, getCompanyForSales, setPublicCompany, fail, safe, ORDER,
} = require('../controllers/company.controller');

const SHEET_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];
const SHEET_MAX = 5 * 1024 * 1024;

// Multer reporta sus errores como excepciones HTML: aqui salen como JSON 422.
const jsonUpload = middleware => (req, res, next) => middleware(req, res, error => {
  if (!error) return next();
  const message = error.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño máximo permitido'
    : error instanceof multer.MulterError ? 'No se pudo procesar el archivo enviado'
      : error.message || 'Archivo no válido';
  return fail(res, 422, message);
});
const companyFiles = jsonUpload(upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cert', maxCount: 1 }]));
const defaultCompany = () => Company.findOne({ order: ORDER });
const canSeePayments = user => user.id_role === 1 || user.superusuario_temporal || Boolean(user.area_grants?.includes('pagos_pos'));

router.use(authMiddleware);

// Lectura: gerentes, administradores y vendedores (roles 1, 2, 3). Los roles 2 y 3 reciben solo datos publicos.
router.get('/', verificarRolesSinHorario([1, 2, 3]), getCompanies);
router.get('/for-sales', verificarRolesSinHorario([1, 2, 3]), getCompanyForSales);

// ---- Horario laboral (aplica solo a vendedores fisicos, hora de Lima) ----
const hoursPayload = company => {
  const state = businessHours.evaluate(company);
  return {
    horario_inicio: state.horario_inicio,
    horario_fin: state.horario_fin,
    horario_restriccion_activa: state.restriccion_activa,
    horario_valido: state.valida,
    configurada: Boolean(company),
    zona_horaria: businessHours.TIMEZONE,
    ahora_lima: state.ahora_lima,
    dentro_de_horario: state.dentro,
    bloquea_a: businessHours.BLOCKS,
  };
};
router.get('/settings/business-hours', verificarRolesSinHorario([1, 2, 3, 5]), safe(async (_req, res) => {
  res.json(hoursPayload(await defaultCompany()));
}, 'horario'));
router.patch('/settings/business-hours', verificarRolesSinHorario([1]), registrarAuditoria('actualizar', 'horario_laboral'), safe(async (req, res) => {
  const body = req.body || {};
  const errores = {};
  const avisos = [];
  const company = await defaultCompany();
  if (!company) return fail(res, 404, 'Primero debes registrar una empresa');
  let activa = businessHours.parseBoolean(body.horario_restriccion_activa);
  if (body.horario_restriccion_activa === undefined) {
    activa = false;
    avisos.push('No enviaste horario_restriccion_activa: se interpretó como false y la restricción quedó apagada.');
  } else if (activa === null) errores.horario_restriccion_activa = 'Debe ser verdadero o falso';
  const inicio = body.horario_inicio === undefined ? company.horario_inicio : body.horario_inicio;
  const fin = body.horario_fin === undefined ? company.horario_fin : body.horario_fin;
  if (!businessHours.TIME_RE.test(String(inicio))) errores.horario_inicio = 'Usa el formato HH:mm (00:00 a 23:59)';
  if (!businessHours.TIME_RE.test(String(fin))) errores.horario_fin = 'Usa el formato HH:mm (00:00 a 23:59)';
  if (!errores.horario_inicio && !errores.horario_fin && inicio === fin) errores.horario_fin = 'La hora de cierre no puede ser igual a la de inicio (bloquearía a todos los vendedores)';
  if (Object.keys(errores).length) return fail(res, 422, 'Revisa el horario', errores);
  await company.update({ horario_inicio: inicio, horario_fin: fin, horario_restriccion_activa: activa });
  await company.reload();
  res.json({ ...hoursPayload(company), avisos });
}, 'horario-guardar'));

// ---- Estado de integraciones (SUNAT para rol 2 / empresa_sunat; Culqi solo con acceso a pagos) ----
router.get('/settings/integrations', verificarRolesSinHorario([1, 2], 'empresa_sunat'), safe(async (req, res) => {
  const company = await defaultCompany();
  if (company) await sunat.activateIfReady(company);
  const modo = sunat.companyMode(company);
  const ready = sunat.readiness(company);
  const body = {
    sunat: {
      mode: modo.mode,
      mode_valid: modo.servidor_valido,
      warning: modo.aviso_servidor,
      motivo: modo.motivo,
      pendientes: modo.pendientes,
      pruebas_manual: Boolean(company?.sunat_pruebas_manual),
      produccion_desde: company?.sunat_produccion_desde || null,
      servidor: modo.servidor,
      credentials: ready.sol,
      certificate: ready.certificate,
      credentials_source: ready.sol_source,
      certificate_source: ready.certificate_source,
      connected: ready.sol && (ready.certificate || modo.mode !== 'production'),
    },
    culqi: null,
  };
  if (canSeePayments(req.user)) {
    const stored = await gatewayService.getActiveCredentials('culqi').catch(() => null);
    const envPublic = Boolean(process.env.CULQI_PUBLIC_KEY);
    const envSecret = Boolean(process.env.CULQI_SECRET_KEY);
    body.culqi = {
      mode: stored ? (stored.mode === 'production' ? 'production' : 'sandbox') : (process.env.PAYMENTS_MODE === 'production' ? 'production' : 'sandbox'),
      source: stored ? 'pasarela' : (envPublic || envSecret ? 'servidor' : 'ninguna'),
      public_key: Boolean(stored?.public_key || envPublic),
      secret_key: Boolean(stored?.secret_key || envSecret),
      connected: Boolean(await culqi.isConfigured()),
    };
  }
  res.json(body);
}, 'integraciones'));

// ---- Modo pruebas manual (solo rol 1, auditado). Cada cambio exige escribir la palabra de confirmacion ----
const normalizeWord = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
router.patch('/settings/sunat-mode', verificarRolesSinHorario([1]), registrarAuditoria('actualizar', 'modo_sunat'), safe(async (req, res) => {
  const pruebas = req.body?.pruebas;
  if (typeof pruebas !== 'boolean') return fail(res, 422, 'Indica pruebas: true o false');
  const company = await defaultCompany();
  if (!company) return fail(res, 404, 'Primero debes registrar una empresa');
  const word = pruebas ? 'PRUEBAS' : 'PRODUCCION';
  if (normalizeWord(req.body.confirmacion) !== word) {
    const consecuencia = pruebas
      ? 'Activar el modo pruebas deja de enviar los comprobantes a SUNAT: las ventas que factures no tendrán validez legal.'
      : 'Desactivar el modo pruebas vuelve a enviar los comprobantes a SUNAT con validez legal.';
    return fail(res, 409, `${consecuencia} Escribe ${pruebas ? 'PRUEBAS' : 'PRODUCCIÓN'} para confirmar.`, { requiere_confirmacion: true, confirmacion_esperada: pruebas ? 'PRUEBAS' : 'PRODUCCIÓN' });
  }
  await company.update({ sunat_pruebas_manual: pruebas });
  if (!pruebas) await sunat.activateIfReady(company);
  await company.reload();
  const modo = sunat.companyMode(company);
  res.json({ mode: modo.mode, motivo: modo.motivo, pendientes: modo.pendientes, pruebas_manual: company.sunat_pruebas_manual, produccion_desde: company.sunat_produccion_desde });
}, 'modo-sunat'));

// ---- Ficha RUC (una por empresa; solo rol 1; PDF/JPG/PNG hasta 5 MB) ----
const sheetInfo = sheet => (sheet
  ? { uploaded: true, original_name: sheet.original_name, updated_at: sheet.updated_at, size: sheet.size || null, mime: sheet.mime || null }
  : { uploaded: false });
const sheetMagic = file => {
  const fd = fs.openSync(file.path, 'r');
  try {
    const buf = Buffer.alloc(8); fs.readSync(fd, buf, 0, 8, 0);
    if (file.mimetype === 'application/pdf') return buf.slice(0, 4).toString('latin1') === '%PDF';
    return upload.hasMagic(buf, file.mimetype);
  } finally { fs.closeSync(fd); }
};

router.get('/settings/ruc-sheet', verificarRolesSinHorario([1]), safe(async (_req, res) => {
  const company = await defaultCompany();
  res.json(company ? sheetInfo(readSheet(company)) : { uploaded: false });
}, 'ficha-estado'));
router.get('/settings/ruc-sheet/download', verificarRolesSinHorario([1]), safe(async (_req, res) => {
  const company = await defaultCompany();
  const sheet = company && readSheet(company);
  if (!sheet) return fail(res, 404, 'No hay ficha RUC cargada');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sheet.original_name || 'ficha-ruc')}"`);
  if (sheet.mime) res.type(sheet.mime);
  return res.sendFile(sheet.path);
}, 'ficha-descarga'));
router.post('/settings/ruc-sheet', verificarRolesSinHorario([1]), jsonUpload(upload.single('ficha_ruc')), registrarAuditoria('actualizar', 'ficha_ruc'), safe(async (req, res) => {
  const file = req.file;
  const discard = () => { if (file) try { fs.rmSync(file.path, { force: true }); } catch { /* sin accion */ } };
  if (!file) return fail(res, 422, 'Selecciona una ficha RUC en PDF, JPG o PNG');
  let valid = SHEET_MIMES.includes(file.mimetype) && file.size <= SHEET_MAX;
  if (valid) { try { valid = sheetMagic(file); } catch { valid = false; } }
  if (!valid) { discard(); return fail(res, 422, 'La ficha RUC debe ser PDF, JPG o PNG de hasta 5 MB'); }
  const company = await defaultCompany();
  if (!company) { discard(); return fail(res, 404, 'Primero debes registrar una empresa'); }
  const previous = readSheet(company);
  fs.mkdirSync(RUC_DIR, { recursive: true });
  const record = { path: file.path, original_name: file.originalname, mime: file.mimetype, size: file.size, updated_at: new Date().toISOString() };
  fs.writeFileSync(markerFor(company), JSON.stringify(record));
  if (previous && previous.path !== file.path) try { fs.rmSync(previous.path, { force: true }); } catch { /* sin accion */ }
  // La ficha es el ultimo requisito: con SOL y certificado listos, la empresa pasa sola a produccion.
  await sunat.activateIfReady(company);
  res.json(sheetInfo(record));
}, 'ficha-subir'));
router.delete('/settings/ruc-sheet', verificarRolesSinHorario([1]), registrarAuditoria('eliminar', 'ficha_ruc'), safe(async (_req, res) => {
  const company = await defaultCompany();
  const sheet = company && readSheet(company);
  if (!sheet) return fail(res, 404, 'No hay ficha RUC cargada');
  try { fs.rmSync(sheet.path, { force: true }); fs.rmSync(sheet.marker, { force: true }); } catch (error) { console.warn('[company] no se pudo borrar la ficha:', error.message); }
  res.json({ uploaded: false });
}, 'ficha-borrar'));

router.get('/:ruc', verificarRolesSinHorario([1, 2, 3]), getCompanyByRuc);

// ---- Escritura: solo gerentes (rol 1) ----
router.post('/', verificarRolesSinHorario([1]), companyFiles, registrarAuditoria('crear', 'empresas'), createCompany);
router.put('/:id', verificarRolesSinHorario([1]), companyFiles, capturarEstadoOriginal(Company), registrarAuditoria('actualizar', 'empresas'), updateCompanyPut);
router.patch('/:id', verificarRolesSinHorario([1]), companyFiles, capturarEstadoOriginal(Company), registrarAuditoria('actualizar', 'empresas'), updateCompanyPatch);
router.patch('/:id/mostrar-en-web', verificarRolesSinHorario([1]), capturarEstadoOriginal(Company), registrarAuditoria('actualizar', 'empresas'), setPublicCompany);
router.delete('/:ruc', verificarRolesSinHorario([1]), registrarAuditoria('eliminar', 'empresas'), deleteCompanyByRuc);

module.exports = router;
