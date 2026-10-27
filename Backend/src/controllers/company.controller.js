// controllers/company.controller.js
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');
const { Op } = require('sequelize');
const Company = require('../models/company.model');
const { DocumentoElectronico, Venta } = require('../models');
const sunat = require('../services/sunat.service');
const { hasMagic } = require('../middlewares/upload.middleware');

const UPLOADS = path.resolve(__dirname, '../uploads');
const LIMITS = { razon_social: 100, direccion: 255, sol_user: 50, sol_pass: 50, client_id: 50, client_secret: 50 };
const LOGO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const LOGO_MAX = 2 * 1024 * 1024;
const CERT_EXT = ['.pem', '.txt', '.crt', '.cer', '.cert', '.p12', '.pfx'];
const PKCS12_EXT = ['.p12', '.pfx'];
const CERT_MAX = 256 * 1024;
// cert_password solo se usa para abrir el .p12/.pfx al subirlo: nunca se guarda ni se audita.
const SECRET_KEYS = ['sol_user', 'sol_pass', 'client_secret', 'cert_password'];

// Respuesta de error uniforme. `error` se conserva por compatibilidad con clientes antiguos.
const fail = (res, status, message, errores) => res.status(status).json({ message, error: message, ...(errores ? { errores } : {}) });
const safe = (fn, label) => async (req, res, next) => {
  try { await fn(req, res, next); } catch (error) {
    console.error(`[company] ${label}:`, error);
    if (!res.headersSent) fail(res, 500, 'Error en el servidor');
  }
};

// Los secretos nunca deben terminar en la auditoria: se enmascaran en req.body despues de leerlos.
const redactBody = req => {
  if (!req.body || typeof req.body !== 'object') return;
  const clean = { ...req.body };
  for (const key of SECRET_KEYS) if (clean[key]) clean[key] = '[REDACTADO]';
  req.body = clean;
};

const uploadedFiles = req => Object.values(req.files || {}).flat();
const discardUploads = req => uploadedFiles(req).forEach(file => { try { fs.rmSync(file.path, { force: true }); } catch { /* sin accion */ } });
const removeStored = (file, dirs) => {
  try {
    if (!file) return;
    const resolved = path.isAbsolute(file) ? file : path.join(UPLOADS, String(file).replace(/^\/?uploads\//, ''));
    if (dirs.some(dir => resolved.startsWith(path.join(UPLOADS, dir) + path.sep)) && fs.existsSync(resolved)) fs.rmSync(resolved, { force: true });
  } catch { /* sin accion */ }
};
const readHead = file => { const fd = fs.openSync(file.path, 'r'); try { const buf = Buffer.alloc(32); const n = fs.readSync(fd, buf, 0, 32, 0); return buf.slice(0, n); } finally { fs.closeSync(fd); } };

const sameKey = (cert, key) => cert.publicKey?.n && key?.n && cert.publicKey.n.equals(key.n);
// RUC del titular segun el certificado (SUNAT/RENIEC lo ponen en OU y en organizationIdentifier NTRPE-<ruc>).
const certificateRuc = cert => {
  for (const attr of cert.subject.attributes) {
    const found = String(attr.value || '').match(/(?:^|\D)((?:10|20)\d{9})(?:\D|$)/);
    if (found) return found[1];
  }
  return null;
};

// Convierte un .p12/.pfx (con su contrasena) en el PEM combinado que usa el firmador y borra el original.
// node-forge abre tambien los PKCS#12 antiguos de SUNAT (RC2-40) que OpenSSL 3 rechaza sin -legacy.
const convertPkcs12 = (file, password) => {
  if (!password) throw new Error('Escribe la contraseña del certificado .p12/.pfx');
  let p12;
  try {
    const der = fs.readFileSync(file.path).toString('binary');
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password);
  } catch {
    throw new Error('No se pudo abrir el certificado: la contraseña es incorrecta o el archivo no es un .p12/.pfx válido');
  }
  const bags = type => p12.getBags({ bagType: type })[type] || [];
  const key = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)].find(bag => bag.key)?.key;
  const certs = bags(forge.pki.oids.certBag).map(bag => bag.cert).filter(Boolean);
  const leaf = certs.find(cert => sameKey(cert, key));
  if (!key || !leaf) throw new Error('El .p12/.pfx no contiene un certificado con su clave privada');
  const pem = [forge.pki.privateKeyToPem(key), forge.pki.certificateToPem(leaf), ...certs.filter(c => c !== leaf).map(c => forge.pki.certificateToPem(c))].join('');
  const target = file.path.replace(/\.(p12|pfx)$/i, '') + '.pem';
  fs.writeFileSync(target, pem, { mode: 0o600 });
  fs.rmSync(file.path, { force: true });
  file.path = target;
};

const inspectCertificate = file => {
  const text = fs.readFileSync(file.path, 'utf8');
  const cert = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  const key = text.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/)?.[0];
  if (!cert || !key) throw new Error('El certificado debe ser un .p12/.pfx con su contraseña o un PEM con certificado y clave privada sin cifrar');
  const parsed = forge.pki.certificateFromPem(cert);
  let privateKey = null;
  try { privateKey = forge.pki.privateKeyFromPem(key); } catch { /* se informa abajo */ }
  if (!sameKey(parsed, privateKey)) throw new Error('La clave privada no corresponde al certificado');
  if (parsed.validity.notAfter < new Date()) throw new Error(`El certificado venció el ${parsed.validity.notAfter.toISOString().slice(0, 10)}`);
  return { vence_en: parsed.validity.notAfter.toISOString().slice(0, 10), ruc: certificateRuc(parsed) };
};

// Valida logo y certificado subidos. Devuelve { errores } o { cert }. `ruc` = RUC final de la empresa.
const validateUploads = (req, ruc) => {
  const errores = {};
  let cert = null;
  const logo = req.files?.logo?.[0];
  if (logo) {
    if (!LOGO_MIMES.includes(logo.mimetype)) errores.logo = 'El logo debe ser JPG, PNG o WebP';
    else if (logo.size > LOGO_MAX) errores.logo = 'El logo supera el máximo de 2 MB';
    else { let ok = false; try { ok = hasMagic(readHead(logo), logo.mimetype); } catch { ok = false; } if (!ok) errores.logo = 'El contenido del logo no coincide con su formato'; }
  }
  const file = req.files?.cert?.[0];
  if (file) {
    if (!CERT_EXT.includes(path.extname(file.originalname).toLowerCase())) errores.cert = 'El certificado debe ser un archivo .pem, .txt, .crt, .cer o .cert';
    else if (file.size > CERT_MAX) errores.cert = 'El certificado supera el máximo de 256 KB';
    else {
      try {
        if (PKCS12_EXT.includes(path.extname(file.originalname).toLowerCase())) convertPkcs12(file, req.body?.cert_password ? String(req.body.cert_password) : '');
        cert = inspectCertificate(file);
        if (cert.ruc && ruc && cert.ruc !== ruc) errores.cert = `El certificado es del RUC ${cert.ruc}, no del RUC ${ruc} de la empresa`;
      } catch (error) { errores.cert = error.message || 'El certificado no es válido'; }
    }
  }
  return { errores: Object.keys(errores).length ? errores : null, cert };
};

const text = value => (value === undefined || value === null ? undefined : String(value).trim());
const flag = value => value === true || value === 'true' || value === '1' || value === 1;

// Interpreta el cuerpo. Los secretos vacios significan "conservar el actual".
const parseBody = (body, { creating, current }) => {
  const errores = {};
  const data = {};
  const avisos = [];
  for (const key of ['razon_social', 'direccion']) {
    const value = text(body[key]);
    if (value !== undefined) data[key] = value;
    if ((creating || value !== undefined) && !value) errores[key] = key === 'razon_social' ? 'La razón social es requerida' : 'La dirección es requerida';
  }
  for (const key of ['sol_user', 'sol_pass', 'client_secret', 'client_id']) {
    const value = text(body[key]);
    if (value) data[key] = value;
  }
  if (flag(body.limpiar_client_secret)) data.client_secret = null;
  if (flag(body.limpiar_client_id)) data.client_id = null;
  if (creating) {
    if (!data.sol_user) errores.sol_user = 'El usuario SOL es requerido';
    if (!data.sol_pass) errores.sol_pass = 'La clave SOL es requerida';
  }
  for (const [key, max] of Object.entries(LIMITS)) if (typeof data[key] === 'string' && data[key].length > max) errores[key] = `Máximo ${max} caracteres`;

  const ruc = text(body.ruc);
  if (creating && !ruc) errores.ruc = 'El RUC es requerido';
  if (ruc !== undefined && ruc !== '') {
    if (!Company.isValidRucFormat(ruc)) errores.ruc = 'El RUC debe tener 11 dígitos y empezar con 10 o 20';
    else {
      const unchanged = current && current.ruc === ruc;
      data.ruc = ruc;
      data.tipo_ruc = ruc.slice(0, 2);
      if (!Company.isValidRuc(ruc)) {
        if (unchanged || flag(body.ruc_demo)) avisos.push('El RUC no supera el dígito verificador (módulo 11): se trata como RUC de demostración y no debe usarse en producción.');
        else errores.ruc = 'El RUC no supera el dígito verificador. Si es un RUC de demostración, marca «RUC de demostración».';
      }
    }
  }
  if (body.production !== undefined) avisos.push('El modo producción no se cambia con este campo: es automático (SUNAT_MODE del servidor + configuración completa) y el modo pruebas se activa en «Modo SUNAT».');
  return { data, errores: Object.keys(errores).length ? errores : null, avisos };
};

const documentCount = async idCompany => {
  const [docs, ventas] = await Promise.all([
    DocumentoElectronico.count({ where: { id_company_emisor: idCompany } }),
    Venta.unscoped().count({ where: { id_company_emisor: idCompany } }),
  ]);
  return docs + ventas;
};

const publicShape = company => ({ id_company: company.id_company, razon_social: company.razon_social, ruc: company.ruc, tipo_ruc: company.tipo_ruc, direccion: company.direccion, logo_url: company.logo_url, mostrar_en_web: company.mostrar_en_web });
const serializeFor = (company, role) => (role === 1 ? company.toJSON() : publicShape(company));
const ORDER = [['emisor_predeterminado', 'DESC'], ['id_company', 'ASC']];

const getCompanies = safe(async (req, res) => {
  const companies = await Company.findAll({ order: ORDER });
  return res.status(200).json(companies.map(company => serializeFor(company, req.user.id_role)));
}, 'listar');

const getCompanyByRuc = safe(async (req, res) => {
  const company = await Company.findOne({ where: { ruc: req.params.ruc } });
  if (!company) return fail(res, 404, 'Compañía no encontrada');
  return res.status(200).json({ message: 'Compañía encontrada', data: serializeFor(company, req.user.id_role) });
}, 'obtener');

const getCompanyForSales = safe(async (_req, res) => {
  const company = await Company.findOne({ order: ORDER });
  if (!company) return res.status(200).json({ status: true, data: null });
  // Solo lo necesario para ventas; nunca sol_*, cert_path ni client_*.
  return res.status(200).json({
    message: 'Información de empresa para ventas',
    data: { ...publicShape(company), production: sunat.companyMode(company).mode === 'production' },
  });
}, 'for-sales');

const createCompany = safe(async (req, res) => {
  const uploads = validateUploads(req, text(req.body?.ruc));
  const parsed = parseBody(req.body || {}, { creating: true, current: null });
  redactBody(req);
  const errores = { ...(parsed.errores || {}), ...(uploads.errores || {}) };
  if (!req.files?.cert?.length && !errores.cert) errores.cert = 'El certificado es obligatorio';
  if (Object.keys(errores).length) { discardUploads(req); return fail(res, 422, 'Revisa los campos marcados', errores); }
  if (await Company.findOne({ where: { id_user: req.user.id } })) { discardUploads(req); return fail(res, 409, 'El usuario ya tiene una empresa registrada'); }
  if (await Company.findOne({ where: { ruc: parsed.data.ruc } })) { discardUploads(req); return fail(res, 409, 'Ya existe una empresa con ese RUC', { ruc: 'RUC ya registrado' }); }
  const logo = req.files?.logo?.[0];
  const company = await Company.create({
    ...parsed.data,
    logo_url: logo ? `/uploads/logos/${path.basename(logo.path)}` : null,
    cert_path: req.files.cert[0].path,
    id_user: req.user.id,
    // RUC 20 permanece bloqueado para facturacion hasta su activacion independiente.
    facturacion_habilitada: false,
    emisor_predeterminado: false,
  });
  await sunat.activateIfReady(company);
  await company.reload();
  return res.status(201).json({ message: 'Empresa creada correctamente', company, avisos: parsed.avisos, certificado: uploads.cert });
}, 'crear');

const updateCompany = (partialUpdate) => safe(async (req, res) => {
  const company = await Company.findByPk(req.params.id);
  if (!company) { discardUploads(req); return fail(res, 404, 'Empresa no encontrada'); }
  const uploads = validateUploads(req, text(req.body?.ruc) || company.ruc);
  const parsed = parseBody(req.body || {}, { creating: false, current: company });
  redactBody(req);
  const errores = { ...(parsed.errores || {}), ...(uploads.errores || {}) };
  if (!partialUpdate && !req.body.razon_social && !errores.razon_social) errores.razon_social = 'La razón social es requerida';
  if (Object.keys(errores).length) { discardUploads(req); return fail(res, 422, 'Revisa los campos marcados', errores); }
  const data = { ...parsed.data };
  if (data.ruc && data.ruc !== company.ruc) {
    if (await Company.findOne({ where: { ruc: data.ruc, id_company: { [Op.ne]: company.id_company } } })) { discardUploads(req); return fail(res, 409, 'Ya existe una empresa con ese RUC', { ruc: 'RUC ya registrado' }); }
    if (await documentCount(company.id_company)) { discardUploads(req); return fail(res, 409, 'No se puede cambiar el RUC: esta empresa ya tiene comprobantes o ventas emitidas', { ruc: 'RUC bloqueado por comprobantes emitidos' }); }
  }
  if (data.tipo_ruc === '20') { data.facturacion_habilitada = false; data.emisor_predeterminado = false; }
  const logo = req.files?.logo?.[0];
  const cert = req.files?.cert?.[0];
  const oldLogo = company.logo_url;
  const oldCert = company.cert_path;
  if (logo) data.logo_url = `/uploads/logos/${path.basename(logo.path)}`;
  if (cert) data.cert_path = cert.path;
  await company.update(data);
  if (logo) removeStored(oldLogo, ['logos']);
  if (cert) removeStored(oldCert, [path.join('private', 'certs')]);
  await sunat.activateIfReady(company);
  await company.reload();
  return res.status(200).json({ message: 'Empresa actualizada correctamente', company, avisos: parsed.avisos, certificado: uploads.cert });
}, 'actualizar');

const updateCompanyPut = updateCompany(false);
const updateCompanyPatch = updateCompany(true);

// Cual empresa muestra su razon social/RUC/direccion en la web publica: una a la vez.
// Se maneja aparte del PATCH general (que ademas valida certificado SUNAT) para que elegirla
// no dependa de volver a enviar sol_user/sol_pass/cert.
const setPublicCompany = safe(async (req, res) => {
  const company = await Company.findByPk(req.params.id);
  if (!company) return fail(res, 404, 'Empresa no encontrada');
  const mostrar = flag(req.body?.mostrar_en_web);
  await Company.sequelize.transaction(async (transaction) => {
    if (mostrar) await Company.update({ mostrar_en_web: false }, { where: {}, transaction });
    await company.update({ mostrar_en_web: mostrar }, { transaction });
  });
  await company.reload();
  return res.status(200).json({ message: 'Visibilidad pública actualizada', company });
}, 'mostrar-en-web');

const deleteCompanyByRuc = safe(async (req, res) => {
  const company = await Company.findOne({ where: { ruc: req.params.ruc } });
  if (!company) return fail(res, 404, 'Empresa no encontrada');
  if (company.emisor_predeterminado || company.facturacion_habilitada) return fail(res, 409, 'Esta empresa es un emisor fiscal activo: deshabilítala como emisor antes de eliminarla');
  if (await documentCount(company.id_company)) return fail(res, 409, 'No se puede eliminar: la empresa tiene comprobantes o ventas asociadas');
  await company.destroy();
  removeStored(company.logo_url, ['logos']);
  removeStored(company.cert_path, [path.join('private', 'certs')]);
  return res.status(200).json({ message: 'Empresa eliminada correctamente' });
}, 'eliminar');

module.exports = { createCompany, updateCompanyPatch, updateCompanyPut, getCompanies, getCompanyByRuc, deleteCompanyByRuc, getCompanyForSales, setPublicCompany, fail, safe, redactBody, ORDER };
